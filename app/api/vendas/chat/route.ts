/**
 * POST /api/vendas/chat — chat com RAG sobre a base de conhecimento de vendas.
 *
 * O fluxo embeda a pergunta, busca os chunks mais próximos por similaridade
 * coseno, filtra por threshold, monta o prompt com os trechos e o histórico e
 * faz streaming da resposta do modelo. A mensagem, as fontes e o custo são
 * persistidos ao final.
 *
 * No Modo Quebra de Objeção o agente deixa de responder dúvidas e passa a
 * gerar 3 respostas curtas prontas pra mandar no WhatsApp, ancoradas nos
 * mesmos trechos da KB. Esse modo não faz streaming: devolve as 3 opções de
 * uma vez num evento `objection`.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull, desc, sql, asc } from 'drizzle-orm';
import { requireSales } from '@/lib/session';
import { asSalesUser, asService } from '@/lib/db-context';
import {
  salesConversations,
  salesMessages,
  kbChunks,
  kbDocumentVersions,
  kbDocuments,
  salesAuditEvents,
} from '@/drizzle/schema';
import { env } from '@/lib/env';
import { getClientIp } from '@/lib/rate-limit';
import { withTransientRetry } from '@/lib/db-retry';
import { getChatContext } from '@/lib/sales-settings';
import { sanitizeAgentOutput } from '@/lib/output-sanitizer';
import { SYSTEM_PROMPT, buildGestorBlock } from '@/lib/sales-prompt';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Score mínimo (similaridade coseno) pra um trecho da KB entrar no prompt.
// Abaixo disso o trecho é descartado; se nada passar, devolvemos a resposta
// pré-canned sem chamar o LLM (economia: 0 token de chat gasto).
const SIMILARITY_THRESHOLD = Number(process.env.SALES_SIMILARITY_THRESHOLD ?? '0.35');

// Quantos trechos da KB enviar no prompt. É o MAIOR fator de custo conforme a
// base cresce — cada trecho são ~300-500 tokens de ENTRADA por pergunta, e
// entrada é ~96% do custo. 4 cobre bem a maioria das perguntas; suba só se
// notar respostas perdendo contexto. Vale tanto pro chat quanto pro Modo Objeção.
const TOP_K = Number(process.env.SALES_TOP_K ?? '4');

// Quantas mensagens anteriores reenviar a cada pergunta (memória da conversa).
// Reenviado INTEIRO a cada turno, então em conversas longas vira o 2º maior
// gasto. 6 mantém o fio da conversa. NÃO afeta o Modo Objeção (que é stateless:
// só vê a objeção colada, sem histórico).
const MAX_HISTORY_MESSAGES = Number(process.env.SALES_MAX_HISTORY_MESSAGES ?? '6');

const CHAT_MODEL = 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const GPT_INPUT_COST_PER_1M = 0.15;
const GPT_OUTPUT_COST_PER_1M = 0.60;
const SALES_RATE_LIMIT_HOUR = Number(process.env.SALES_CHAT_RATE_LIMIT_HOUR ?? '30');
const MAX_MESSAGES_PER_CONV = Number(process.env.SALES_MAX_MESSAGES_PER_CONV ?? '50');
// Teto de saída do LLM — evita inflar a fatura em respostas em loop.
const CHAT_MAX_TOKENS = Number(process.env.SALES_CHAT_MAX_TOKENS ?? '1200');
const OBJECTION_MAX_TOKENS = Number(process.env.SALES_OBJECTION_MAX_TOKENS ?? '700');
// Timeout das chamadas à OpenAI (ms). Guarda contra conexões presas.
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? '15000');

const OBJECTION_PROMPT = `Você é coach de vendas da Dev em Dobro. O vendedor vai colar a objeção que um lead falou (ex: "tá caro", "não tenho tempo"). Gere EXATAMENTE 3 respostas curtas e distintas entre si, prontas pra enviar no WhatsApp, em português do Brasil, com tom humano e persuasivo. Regras inegociáveis:

1. Cada resposta tem no máximo 3 frases.
2. Use APENAS informações dos trechos fornecidos. Nunca invente preço, prazo, desconto ou condição que não esteja explícita neles.
3. Se nenhum trecho sustentar um argumento comercial específico, quebre a objeção pelo valor e pela transformação, sem prometer número.
4. No máximo um emoji por resposta, e só quando soar natural.
5. Responda exclusivamente em JSON no formato {"options":["...","...","..."]}, sem texto fora do JSON.`;

const Body = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().min(1).max(4000),
  isObjectionMode: z.boolean().optional().default(false),
});

async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }),
  });
  if (!res.ok) throw new Error(`Embedding error ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

async function checkRateLimit(email: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await asService(async (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(salesMessages)
      .leftJoin(salesConversations, eq(salesConversations.id, salesMessages.conversationId))
      .where(
        and(
          eq(salesConversations.salesUserEmail, email),
          eq(salesMessages.role, 'user'),
          sql`${salesMessages.createdAt} > ${since}`
        )
      )
  );
  return (rows[0]?.count ?? 0) < SALES_RATE_LIMIT_HOUR;
}

export async function POST(req: Request) {
  try {
    const session = await requireSales();
    const ip = getClientIp(req);

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
    }

    const { conversationId: existingConvId, message, isObjectionMode } = parsed.data;

    // Rate limit por vendedor
    const allowed = await withTransientRetry(() => checkRateLimit(session.email));
    if (!allowed) {
      return NextResponse.json({ error: 'limite de mensagens/hora atingido' }, { status: 429 });
    }

    // Cria ou carrega conversa
    let convId = existingConvId;
    if (!convId) {
      const [conv] = await asService(async (tx) =>
        tx
          .insert(salesConversations)
          .values({
            salesUserEmail: session.email,
            title: message.slice(0, 50),
          })
          .returning({ id: salesConversations.id })
      );
      convId = conv.id;
    } else {
      // Verifica ownership
      const conv = await asSalesUser(session.email, async (tx) => {
        const rows = await tx
          .select({ id: salesConversations.id, messageCount: salesConversations.messageCount })
          .from(salesConversations)
          .where(
            and(
              eq(salesConversations.id, convId!),
              eq(salesConversations.salesUserEmail, session.email)
            )
          )
          .limit(1);
        return rows[0] ?? null;
      });
      if (!conv) return NextResponse.json({ error: 'conversa não encontrada' }, { status: 404 });
      if (conv.messageCount >= MAX_MESSAGES_PER_CONV) {
        return NextResponse.json(
          { error: `limite de ${MAX_MESSAGES_PER_CONV} mensagens por conversa atingido. Inicie uma nova conversa.` },
          { status: 429 }
        );
      }
    }

    // Persiste mensagem do usuário
    await asService(async (tx) => {
      await tx.insert(salesMessages).values({
        conversationId: convId!,
        role: 'user',
        content: message,
      });
      await tx
        .update(salesConversations)
        .set({ updatedAt: new Date(), messageCount: sql`message_count + 1` })
        .where(eq(salesConversations.id, convId!));
    });

    // Embed query
    const queryEmbedding = await embedQuery(message);

    // Busca chunks por similaridade coseno
    const embeddingLiteral = `[${queryEmbedding.join(',')}]`;
    const chunks = await asService(async (tx) => {
      return tx.execute<{
        id: string;
        document_id: string;
        version_id: string;
        content: string;
        chunk_index: number;
        score: number;
        document_title: string;
      }>(sql`
        SELECT
          c.id,
          c.document_id,
          c.version_id,
          c.content,
          c.chunk_index,
          1 - (c.embedding <=> ${embeddingLiteral}::vector) AS score,
          d.title AS document_title
        FROM kb_chunks c
        JOIN kb_document_versions v ON v.id = c.version_id
        JOIN kb_documents d ON d.id = c.document_id
        WHERE d.archived_at IS NULL
          AND d.current_version_id = v.id
          AND d.status = 'active'
        ORDER BY c.embedding <=> ${embeddingLiteral}::vector
        LIMIT ${TOP_K}
      `);
    });

    const relevantChunks = (chunks.rows ?? []).filter((c) => c.score >= SIMILARITY_THRESHOLD);

    // Histórico da conversa (últimas N mensagens)
    const history = await asService(async (tx) =>
      tx
        .select({ role: salesMessages.role, content: salesMessages.content })
        .from(salesMessages)
        .where(
          and(
            eq(salesMessages.conversationId, convId!),
            sql`${salesMessages.role} IN ('user', 'assistant')`
          )
        )
        .orderBy(desc(salesMessages.createdAt))
        .limit(MAX_HISTORY_MESSAGES)
    );
    history.reverse();

    // Monta prompt
    let contextBlock = '';
    if (relevantChunks.length > 0) {
      contextBlock =
        '\n\nTrechos da base de conhecimento:\n' +
        relevantChunks
          .map((c, i) => `[${i + 1}] (${c.document_title})\n${c.content}`)
          .join('\n\n');
    }

    // Contexto extra editável pelo gestor — entra DEPOIS das regras
    // inegociáveis e é envolvido por delimitadores derivados de um hash do
    // próprio conteúdo (não-falsificáveis: o gestor não conhece o token usado
    // num run específico). Instruímos o modelo a tratar tudo entre eles como
    // dados, nunca como instruções. Não é à prova de bala, mas eleva o custo
    // de um prompt injection caso a conta do gestor seja comprometida.
    const gestorBlock = buildGestorBlock(await getChatContext());

    const sources = relevantChunks.map((c, i) => ({
      documentId: c.document_id,
      title: c.document_title,
      versionId: c.version_id,
      chunkId: c.id,
      score: Number(c.score.toFixed(4)),
      citation: i + 1,
    }));

    if (isObjectionMode) {
      return handleObjectionMode({
        objectionPrompt: OBJECTION_PROMPT + gestorBlock + contextBlock,
        leadMessage: message,
        convId: convId!,
        sources,
        session,
        ip,
      });
    }

    const systemContent = SYSTEM_PROMPT + gestorBlock + contextBlock;
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemContent },
      ...history.map((h) => ({ role: h.role, content: h.content })),
    ];

    // Resposta pré-canned quando nenhum trecho passa do threshold.
    if (relevantChunks.length === 0) {
      const noInfoMsg =
        'Não encontrei essa informação na nossa base de conhecimento. Sugira ao time atualizar a KB.';

      // Persistência protegida: uma falha aqui (ex.: hiccup de banco) não pode
      // virar 500 na cara do vendedor — a resposta pré-canned é entregue de
      // qualquer forma. Mesmo padrão dos outros inserts de resposta da rota.
      try {
        await asService(async (tx) => {
          await tx.insert(salesMessages).values({
            conversationId: convId!,
            role: 'assistant',
            content: noInfoMsg,
            sources: [],
            model: CHAT_MODEL,
            promptVersion: 'v1',
            effectivePrompt: systemContent,
          });
          await tx
            .update(salesConversations)
            .set({ updatedAt: new Date(), messageCount: sql`message_count + 1` })
            .where(eq(salesConversations.id, convId!));
        });
      } catch (err) {
        console.warn('[vendas/chat] falha ao persistir resposta sem-info:', err);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', content: noInfoMsg })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', conversationId: convId, sources: [] })}\n\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Stream da resposta do LLM. O timeout cobre o estabelecimento da conexão
    // (até os headers): clearTimeout dispara assim que o fetch resolve, sem
    // matar o corpo do stream que ainda está chegando.
    const llmController = new AbortController();
    const llmTimeout = setTimeout(() => llmController.abort(), OPENAI_TIMEOUT_MS);
    let llmRes: Response;
    try {
      llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: llmController.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages,
          temperature: 0.2,
          max_completion_tokens: CHAT_MAX_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
        }),
      });
    } catch (err) {
      clearTimeout(llmTimeout);
      console.error('[vendas/chat] falha/timeout ao chamar LLM:', err);
      return NextResponse.json({ error: 'falha ao chamar LLM' }, { status: 502 });
    }
    clearTimeout(llmTimeout);

    if (!llmRes.ok || !llmRes.body) {
      return NextResponse.json({ error: 'falha ao chamar LLM' }, { status: 502 });
    }

    const encoder = new TextEncoder();
    let fullContent = '';
    let tokensIn = 0;
    let tokensOut = 0;

    const stream = new ReadableStream({
      async start(controller) {
        const reader = llmRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const chunk = JSON.parse(data);
                const delta = chunk.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  fullContent += delta;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'token', content: delta })}\n\n`)
                  );
                }
                if (chunk.usage) {
                  tokensIn = chunk.usage.prompt_tokens ?? 0;
                  tokensOut = chunk.usage.completion_tokens ?? 0;
                }
              } catch {}
            }
          }

          const costUsd =
            (tokensIn / 1_000_000) * GPT_INPUT_COST_PER_1M +
            (tokensOut / 1_000_000) * GPT_OUTPUT_COST_PER_1M;

          // Defense in depth: filtra a resposta antes de persistir. Os tokens
          // já foram enviados ao vendedor durante o streaming, então o que
          // sanitizamos aqui é a cópia armazenada (reexibida ao recarregar a
          // conversa) e geramos sinal de auditoria se algo foi removido.
          const sanitized = sanitizeAgentOutput(fullContent);

          // Persiste resposta do assistente
          try {
            await asService(async (tx) => {
              await tx.insert(salesMessages).values({
                conversationId: convId!,
                role: 'assistant',
                content: sanitized.text,
                sources,
                model: CHAT_MODEL,
                promptVersion: 'v1',
                effectivePrompt: systemContent,
                tokensIn,
                tokensOut,
                costUsd: costUsd.toFixed(6),
              });
              await tx
                .update(salesConversations)
                .set({
                  updatedAt: new Date(),
                  messageCount: sql`message_count + 1`,
                  totalCostUsd: sql`total_cost_usd + ${costUsd.toFixed(6)}`,
                })
                .where(eq(salesConversations.id, convId!));

              await tx.insert(salesAuditEvents).values({
                eventType: 'chat_response',
                actorEmail: session.email,
                actorRole: 'sales',
                targetId: convId,
                metadata: {
                  tokensIn,
                  tokensOut,
                  costUsd: costUsd.toFixed(6),
                  sourceCount: sources.length,
                  ...(sanitized.flagged ? { sanitized: sanitized.reasons } : {}),
                },
                ip,
              });
            });
          } catch (err) {
            console.warn('[vendas/chat] falha ao persistir resposta:', err);
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'done', conversationId: convId, sources })}\n\n`
            )
          );
        } catch (err) {
          console.error('[vendas/chat] stream error:', err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'erro no streaming' })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/vendas/chat]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

interface ChatSource {
  documentId: string;
  title: string;
  versionId: string;
  chunkId: string;
  score: number;
  citation: number;
}

interface ObjectionParams {
  objectionPrompt: string;
  leadMessage: string;
  convId: string;
  sources: ChatSource[];
  session: { email: string };
  ip: string;
}

/**
 * Gera 3 respostas prontas pra uma objeção do lead. Diferente do chat normal,
 * a resposta não faz streaming: o modelo devolve um JSON com as 3 opções de uma
 * vez e o cliente recebe tudo num único evento `objection`.
 */
async function handleObjectionMode({
  objectionPrompt,
  leadMessage,
  convId,
  sources,
  session,
  ip,
}: ObjectionParams): Promise<Response> {
  // Timeout cobre fetch + leitura do JSON (resposta não faz streaming).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let data: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: objectionPrompt },
          { role: 'user', content: leadMessage },
        ],
        temperature: 0.5,
        max_completion_tokens: OBJECTION_MAX_TOKENS,
        response_format: { type: 'json_object' },
      }),
    });

    if (!llmRes.ok) {
      return NextResponse.json({ error: 'falha ao chamar LLM' }, { status: 502 });
    }

    data = (await llmRes.json()) as typeof data;
  } catch (err) {
    console.error('[vendas/chat] falha/timeout no Modo Objeção:', err);
    return NextResponse.json({ error: 'falha ao chamar LLM' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  let options: string[] = [];
  try {
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}') as { options?: unknown };
    if (Array.isArray(parsed.options)) {
      options = parsed.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).slice(0, 3);
    }
  } catch {
    // Modelo não respeitou o JSON — degrada pra mensagem amigável.
  }

  if (options.length === 0) {
    options = ['Não consegui gerar respostas agora. Tenta reformular a objeção do lead.'];
  }

  // Defense in depth: aqui a resposta vai inteira (sem streaming), então a
  // sanitização protege o que é efetivamente entregue ao vendedor.
  const sanitizedReasons = new Set<string>();
  options = options.map((o) => {
    const s = sanitizeAgentOutput(o);
    s.reasons.forEach((r) => sanitizedReasons.add(r));
    return s.text;
  });

  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  const costUsd =
    (tokensIn / 1_000_000) * GPT_INPUT_COST_PER_1M + (tokensOut / 1_000_000) * GPT_OUTPUT_COST_PER_1M;

  try {
    await asService(async (tx) => {
      await tx.insert(salesMessages).values({
        conversationId: convId,
        role: 'assistant',
        content: options.join('\n\n'),
        // Mantém `content` (texto único, p/ busca/auditoria) e também as opções
        // estruturadas, pra o GET .../messages reconstruir os cards ao reabrir.
        objectionOptions: options,
        sources,
        model: CHAT_MODEL,
        promptVersion: 'objection-v1',
        effectivePrompt: objectionPrompt,
        tokensIn,
        tokensOut,
        costUsd: costUsd.toFixed(6),
      });
      await tx
        .update(salesConversations)
        .set({
          updatedAt: new Date(),
          messageCount: sql`message_count + 1`,
          totalCostUsd: sql`total_cost_usd + ${costUsd.toFixed(6)}`,
        })
        .where(eq(salesConversations.id, convId));

      await tx.insert(salesAuditEvents).values({
        eventType: 'chat_response',
        actorEmail: session.email,
        actorRole: 'sales',
        targetId: convId,
        metadata: {
          tokensIn,
          tokensOut,
          costUsd: costUsd.toFixed(6),
          mode: 'objection',
          sourceCount: sources.length,
          ...(sanitizedReasons.size > 0 ? { sanitized: [...sanitizedReasons] } : {}),
        },
        ip,
      });
    });
  } catch (err) {
    console.warn('[vendas/chat] falha ao persistir resposta de objeção:', err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'objection', options, conversationId: convId, sources })}\n\n`)
      );
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'done', conversationId: convId, sources })}\n\n`)
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
