/**
 * Alertas fora-de-banda de mudanças críticas no agente de vendas.
 *
 * O campo livre `chat_context` é concatenado ao system prompt do LLM em toda
 * conversa. Se a conta do gestor (role 'monitor') for comprometida, um atacante
 * pode reescrever esse contexto para forçar comportamento malicioso. Auditoria
 * sozinha é só forense pós-fato; o alerta empurra a detecção pra perto do
 * tempo real (canal Slack/Discord dos donos do produto).
 *
 * Disparo é best-effort: nunca lança, tem timeout próprio e é fire-and-forget
 * em relação à requisição que o originou — uma falha de webhook não pode
 * quebrar o PUT do gestor.
 */

import { env } from './env';

const ALERT_TIMEOUT_MS = 5000;

export interface ChatContextAlert {
  actorEmail: string;
  ip: string;
  userAgent?: string;
  oldValue: string;
  newValue: string;
  /** true = é só uma proposta aguardando aprovação (modo two-eyes), não aplicada. */
  pending?: boolean;
}

function preview(text: string, max = 500): string {
  const t = text.trim();
  if (t.length === 0) return '(vazio)';
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * Notifica o webhook configurado sobre uma edição do chat_context. Sem
 * SALES_ALERT_WEBHOOK setado, é no-op. Compatível com o formato de payload do
 * Slack/Discord (campo `text`/`content`).
 */
export async function sendChatContextAlert(alert: ChatContextAlert): Promise<void> {
  const url = env.SALES_ALERT_WEBHOOK;
  if (!url) return;

  const header = alert.pending
    ? '🟡 *chat_context do Agente de Vendas: proposta aguardando aprovação*'
    : '🚨 *chat_context do Agente de Vendas foi alterado*';

  const message =
    `${header}\n` +
    `• Por: ${alert.actorEmail}\n` +
    `• IP: ${alert.ip}\n` +
    `• User-Agent: ${alert.userAgent ?? 'n/d'}\n` +
    `• Tamanho: ${alert.oldValue.length} → ${alert.newValue.length} chars\n\n` +
    `*${alert.pending ? 'Conteúdo proposto' : 'Novo conteúdo'}:*\n${preview(alert.newValue)}`;

  await postWebhook(url, message, 'chat_context');
}

export interface EvalAlert {
  avgDivergence: number;
  maxDivergence: number;
  worst: { questionId: string; divergence: number }[];
  chatContextHash: string | null;
}

/**
 * Alerta quando a avaliação automatizada do agente (lib/sales-eval) detecta
 * divergência acima do threshold — sinal de que o comportamento mudou (ex.:
 * chat_context envenenado). Best-effort, igual ao alerta de chat_context.
 */
export async function sendEvalAlert(alert: EvalAlert): Promise<void> {
  const url = env.SALES_ALERT_WEBHOOK;
  if (!url) return;

  const worst = alert.worst
    .map((w) => `   - ${w.questionId}: ${(w.divergence * 100).toFixed(1)}%`)
    .join('\n');
  const message =
    `🔴 *Avaliação do Agente de Vendas: divergência acima do limite*\n` +
    `• Divergência média: ${(alert.avgDivergence * 100).toFixed(1)}%\n` +
    `• Divergência máxima: ${(alert.maxDivergence * 100).toFixed(1)}%\n` +
    `• Hash do contexto: ${alert.chatContextHash ?? '(vazio)'}\n` +
    `*Perguntas mais divergentes:*\n${worst}`;

  await postWebhook(url, message, 'eval');
}

async function postWebhook(url: string, message: string, label: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      // `text` (Slack) e `content` (Discord) — mandamos ambos pra cobrir os dois.
      body: JSON.stringify({ text: message, content: message }),
    });
  } catch (err) {
    console.warn(`[sales-alerts] falha ao enviar alerta (${label}):`, err);
  } finally {
    clearTimeout(timeout);
  }
}
