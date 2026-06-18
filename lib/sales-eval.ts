/**
 * sales-eval — avaliação automatizada do Agente de Vendas (item 3.1).
 *
 * Roda as perguntas canônicas (lib/sales-eval-questions) contra o agente real
 * — mesmo prompt da produção (lib/sales-prompt) + RAG na KB —, embeda as
 * respostas e compara com um baseline confiável. Divergência alta sinaliza que
 * o comportamento do agente mudou (tipicamente via chat_context envenenado).
 *
 * Dois modos:
 *   - baseline: grava as respostas atuais como referência (use quando o agente
 *     está sabidamente íntegro).
 *   - compare (default): mede a divergência vs. baseline e persiste o run;
 *     alerta se passar do threshold.
 *
 * Custo: ~1 embedding + 1 completion + 1 embedding por pergunta (~$0.01/run).
 */

import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { asService } from './db-context';
import { env } from './env';
import { getChatContext } from './sales-settings';
import { SYSTEM_PROMPT, buildGestorBlock } from './sales-prompt';
import { EVAL_QUESTIONS } from './sales-eval-questions';
import { salesEvalBaseline, salesEvalRuns } from '@/drizzle/schema';
import { sendEvalAlert } from './sales-alerts';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const SIMILARITY_THRESHOLD = 0.35;
const TOP_K = 6;
const EVAL_MAX_TOKENS = 500;
const AVG_DIVERGENCE_ALERT = Number(process.env.SALES_EVAL_AVG_THRESHOLD ?? '0.2');
const MAX_DIVERGENCE_ALERT = Number(process.env.SALES_EVAL_MAX_THRESHOLD ?? '0.4');

export type EvalTrigger = 'manual' | 'context_change' | 'baseline';

export interface EvalSummary {
  isBaseline: boolean;
  questionCount: number;
  avgDivergence: number | null;
  maxDivergence: number | null;
  flagged: boolean;
  details: { questionId: string; divergence: number }[];
}

function toVector(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as number[];
    } catch {
      return [];
    }
  }
  return [];
}

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embedding ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

async function retrieveContextBlock(queryEmbedding: number[]): Promise<string> {
  const literal = `[${queryEmbedding.join(',')}]`;
  const chunks = await asService(async (tx) =>
    tx.execute<{ content: string; document_title: string; score: number }>(sql`
      SELECT c.content, d.title AS document_title,
             1 - (c.embedding <=> ${literal}::vector) AS score
      FROM kb_chunks c
      JOIN kb_document_versions v ON v.id = c.version_id
      JOIN kb_documents d ON d.id = c.document_id
      WHERE d.archived_at IS NULL AND d.current_version_id = v.id AND d.status = 'active'
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${TOP_K}
    `)
  );
  const relevant = (chunks.rows ?? []).filter((c) => c.score >= SIMILARITY_THRESHOLD);
  if (relevant.length === 0) return '';
  return (
    '\n\nTrechos da base de conhecimento:\n' +
    relevant.map((c, i) => `[${i + 1}] (${c.document_title})\n${c.content}`).join('\n\n')
  );
}

async function complete(systemContent: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      max_completion_tokens: EVAL_MAX_TOKENS,
    }),
  });
  if (!res.ok) throw new Error(`completion ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Executa a avaliação. setBaseline=true regrava o baseline; senão compara com o
 * baseline existente. Sempre persiste um registro em sales_eval_runs e alerta
 * quando flagged. Lança só em falhas catastróficas (sem rede/API).
 */
export async function runEval(
  trigger: EvalTrigger,
  setBaseline = false
): Promise<EvalSummary> {
  const gestorContext = await getChatContext();
  const gestorBlock = buildGestorBlock(gestorContext);
  const chatContextHash = gestorContext.trim()
    ? createHash('sha256').update(gestorContext.trim()).digest('hex').slice(0, 16)
    : null;

  // Respostas atuais do agente.
  const current: { questionId: string; question: string; answer: string; embedding: number[] }[] = [];
  for (const q of EVAL_QUESTIONS) {
    const qEmbedding = await embed(q.prompt);
    const contextBlock = await retrieveContextBlock(qEmbedding);
    const systemContent = SYSTEM_PROMPT + gestorBlock + contextBlock;
    const answer = await complete(systemContent, q.prompt);
    const aEmbedding = await embed(answer || '(vazio)');
    current.push({ questionId: q.id, question: q.prompt, answer, embedding: aEmbedding });
  }

  // Modo baseline (explícito ou quando ainda não há baseline gravado).
  const existingBaseline = await asService(async (tx) =>
    tx
      .select({ questionId: salesEvalBaseline.questionId, embedding: salesEvalBaseline.embedding })
      .from(salesEvalBaseline)
  );
  const baselineMap = new Map(existingBaseline.map((b) => [b.questionId, toVector(b.embedding)]));
  const mustBaseline = setBaseline || baselineMap.size === 0;

  if (mustBaseline) {
    await asService(async (tx) => {
      for (const c of current) {
        await tx
          .insert(salesEvalBaseline)
          .values({ questionId: c.questionId, question: c.question, answer: c.answer, embedding: c.embedding })
          .onConflictDoUpdate({
            target: salesEvalBaseline.questionId,
            set: { question: c.question, answer: c.answer, embedding: c.embedding, createdAt: new Date() },
          });
      }
      await tx.insert(salesEvalRuns).values({
        trigger: 'baseline',
        chatContextHash,
        questionCount: current.length,
        isBaseline: true,
        flagged: false,
      });
    });
    return {
      isBaseline: true,
      questionCount: current.length,
      avgDivergence: null,
      maxDivergence: null,
      flagged: false,
      details: [],
    };
  }

  // Modo compare.
  const details: { questionId: string; divergence: number }[] = [];
  for (const c of current) {
    const base = baselineMap.get(c.questionId);
    if (!base || base.length === 0) continue; // pergunta sem baseline → ignora
    const divergence = 1 - cosine(c.embedding, base);
    details.push({ questionId: c.questionId, divergence: Number(divergence.toFixed(4)) });
  }

  const divs = details.map((d) => d.divergence);
  const avgDivergence = divs.length ? divs.reduce((s, d) => s + d, 0) / divs.length : 0;
  const maxDivergence = divs.length ? Math.max(...divs) : 0;
  const flagged = avgDivergence >= AVG_DIVERGENCE_ALERT || maxDivergence >= MAX_DIVERGENCE_ALERT;

  await asService(async (tx) => {
    await tx.insert(salesEvalRuns).values({
      trigger,
      chatContextHash,
      questionCount: details.length,
      avgDivergence: avgDivergence.toFixed(4),
      maxDivergence: maxDivergence.toFixed(4),
      flagged,
      isBaseline: false,
      details,
    });
  });

  if (flagged) {
    const worst = [...details].sort((a, b) => b.divergence - a.divergence).slice(0, 3);
    void sendEvalAlert({
      avgDivergence,
      maxDivergence,
      worst,
      chatContextHash,
    });
  }

  return { isBaseline: false, questionCount: details.length, avgDivergence, maxDivergence, flagged, details };
}

/**
 * Dispara runEval('context_change') em background (não bloqueia a resposta) se
 * SALES_EVAL_AUTO estiver ligado. Usa waitUntil pra a função serverless não ser
 * encerrada antes do término. Best-effort: engole erros.
 */
export function maybeScheduleEvalAfterContextChange(): void {
  if (!env.SALES_EVAL_AUTO) return;
  waitUntil(
    runEval('context_change').catch((err) => {
      console.warn('[sales-eval] avaliação automática falhou:', err);
    })
  );
}
