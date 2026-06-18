/**
 * Pipeline de ingestão da base de conhecimento: texto bruto vira chunks, cada
 * chunk recebe um embedding e os chunks são gravados em kb_chunks.
 *
 * O chunking quebra por parágrafo duplo com janela deslizante de ~600 tokens e
 * 100 de overlap. Os embeddings usam text-embedding-3-small (1536 dimensões) em
 * lotes de até 100 por chamada à OpenAI.
 */

import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { asService } from './db-context';
import { kbDocuments, kbDocumentVersions, kbChunks } from '@/drizzle/schema';
import { env } from './env';

export interface FaqPair {
  question: string;
  answer: string;
}

const FaqPairsSchema = z
  .array(
    z.object({
      question: z.string().trim().min(1).max(2000),
      answer: z.string().trim().min(1).max(8000),
    })
  )
  .min(1)
  .max(200);

/** Valida e normaliza o JSON de pares de FAQ vindo do form. Retorna null se inválido. */
export function parseFaqPairs(raw: unknown): FaqPair[] | null {
  if (raw == null) return null;
  try {
    const parsed = FaqPairsSchema.safeParse(JSON.parse(String(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_COST_PER_1M = 0.02;
const CHUNK_SIZE_TOKENS = 600;
const CHUNK_OVERLAP_TOKENS = 100;
const EMBED_BATCH_SIZE = 100;

// Aproximação: 1 token ≈ 4 chars em PT-BR
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Fatia uma única frase que ainda assim ultrapassa CHUNK_SIZE_TOKENS (ex.: texto
 * sem pontuação, tabelas, base64). Quebra por blocos de caracteres de tamanho
 * fixo derivado do orçamento de tokens, garantindo que nenhum chunk estoure o
 * limite da API de embeddings.
 */
function splitOversizedText(text: string): string[] {
  const maxChars = CHUNK_SIZE_TOKENS * 4; // estimateTokens usa ~4 chars/token
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    const slice = text.slice(i, i + maxChars).trim();
    if (slice.length > 0) out.push(slice);
  }
  return out;
}

function chunkText(text: string): string[] {
  // 1. Quebra preliminar por parágrafos.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = '';
  let currentTokens = 0;

  const flush = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
    currentTokens = 0;
  };

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // 2. Parágrafo único maior que o limite: precisa ser fatiado para não
    // gerar um chunk gigante que estoure tokens/custo da OpenAI.
    if (paraTokens > CHUNK_SIZE_TOKENS) {
      flush();

      const sentences = para.split(/(?<=[.?!])\s+/);
      for (const sentence of sentences) {
        // Frase isolada ainda gigante (sem pontuação): fatia por tamanho fixo.
        const pieces =
          estimateTokens(sentence) > CHUNK_SIZE_TOKENS ? splitOversizedText(sentence) : [sentence];

        for (const piece of pieces) {
          const pieceTokens = estimateTokens(piece);
          if (currentTokens + pieceTokens > CHUNK_SIZE_TOKENS && current.length > 0) {
            flush();
          }
          current = current ? current + ' ' + piece : piece;
          currentTokens += pieceTokens;
        }
      }
      continue;
    }

    // 3. Parágrafo normal: acumula com janela de overlap entre chunks.
    if (currentTokens + paraTokens > CHUNK_SIZE_TOKENS && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(CHUNK_OVERLAP_TOKENS * 0.75));
      current = overlapWords.join(' ') + '\n\n' + para;
      currentTokens = estimateTokens(current);
    } else {
      current = current ? current + '\n\n' + para : para;
      currentTokens += paraTokens;
    }
  }

  flush();

  return chunks.length > 0 ? chunks : [text.trim()];
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI embeddings error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

export async function extractText(
  sourceType: 'pdf' | 'markdown' | 'faq',
  content: string | Buffer,
  faqPairs?: FaqPair[]
): Promise<string> {
  if (sourceType === 'pdf') {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content as string, 'base64');

    // Valida a assinatura binária (%PDF-) em vez de confiar no Content-Type
    // enviado pelo navegador, que é trivial de falsificar. Hex: 25 50 44 46 2d.
    const isPdfSignature = buf.subarray(0, 5).toString('latin1') === '%PDF-';
    if (!isPdfSignature) {
      throw new Error('Arquivo inválido: assinatura PDF (%PDF-) não encontrada.');
    }

    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text: pages } = await extractPdfText(pdf, { mergePages: true });
    const text = pages.trim();
    if (text.length < 50) {
      throw new Error(
        'PDF sem texto extraível (possivelmente digitalizado/imagem). Converta manualmente para PDF com texto.'
      );
    }
    return text;
  }
  if (sourceType === 'faq') {
    if (!faqPairs || faqPairs.length === 0) throw new Error('FAQ requer ao menos um par pergunta/resposta');
    return faqPairs.map((p) => `P: ${p.question.trim()}\nR: ${p.answer.trim()}`).join('\n\n');
  }
  return typeof content === 'string' ? content : content.toString('utf-8');
}

export interface IngestResult {
  chunkCount: number;
  totalTokens: number;
  costUsd: number;
}

export async function ingestDocument(
  documentId: string,
  versionId: string,
  rawText: string
): Promise<IngestResult> {
  if (rawText.trim().length < 10) {
    throw new Error('Texto extraído muito curto. Verifique o arquivo enviado.');
  }

  const chunks = chunkText(rawText);

  const allEmbeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
  }

  const totalTokens = chunks.reduce((sum, c) => sum + estimateTokens(c), 0);
  const costUsd = (totalTokens / 1_000_000) * EMBEDDING_COST_PER_1M;

  await asService(async (tx) => {
    await tx.delete(kbChunks).where(eq(kbChunks.versionId, versionId));

    const rows = chunks.map((content, i) => ({
      documentId,
      versionId,
      chunkIndex: i,
      content,
      tokenCount: estimateTokens(content),
      embedding: allEmbeddings[i] as number[],
    }));

    for (let i = 0; i < rows.length; i += 50) {
      await tx.insert(kbChunks).values(rows.slice(i, i + 50));
    }

    await tx
      .update(kbDocumentVersions)
      .set({ embeddingTokens: totalTokens, embeddingCostUsd: costUsd.toFixed(6) })
      .where(eq(kbDocumentVersions.id, versionId));

    await tx
      .update(kbDocuments)
      .set({ status: 'active', currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(kbDocuments.id, documentId));
  });

  return { chunkCount: chunks.length, totalTokens, costUsd };
}
