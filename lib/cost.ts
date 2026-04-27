/**
 * Pricing por modelo de IA usado pra correção.
 *
 * Atualizar quando:
 *   - Modelo novo entrar em uso (gerador OU polisher)
 *   - Provedor mudar preço (raro mas acontece)
 *
 * Valores em USD por 1M tokens. Fonte: páginas oficiais de pricing dos
 * provedores. Nem todos os modelos abaixo estão em uso hoje — manter a
 * lista pra que futuras migrações (ex: DS-009 polisher pra Claude Sonnet)
 * tenham o pricing pronto.
 */

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },

  // Anthropic
  'claude-haiku-4-5': { inputPer1M: 1.00, outputPer1M: 5.00 },
  'claude-sonnet-4-6': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-7': { inputPer1M: 15.00, outputPer1M: 75.00 },
};

/**
 * Calcula o custo em USD de uma chamada dado o modelo e os tokens consumidos.
 * Retorna 0 (em vez de lançar) pra modelo desconhecido — assim a correção
 * ainda salva mesmo se o pricing não estiver cadastrado, e fica visível pelo
 * `tokens_in/out > 0 AND cost_usd = 0` em queries de auditoria.
 */
export function calcCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model];
  if (!p) {
    console.warn(`[cost] modelo sem pricing cadastrado: ${model}`);
    return 0;
  }
  return (tokensIn * p.inputPer1M + tokensOut * p.outputPer1M) / 1_000_000;
}

export interface UsageReport {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Constrói um UsageReport completo a partir de um response do OpenAI/Anthropic.
 * `usage` segue o shape OpenAI: { prompt_tokens, completion_tokens }.
 */
export function buildUsage(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined | null
): UsageReport {
  const tokensIn = usage?.prompt_tokens ?? 0;
  const tokensOut = usage?.completion_tokens ?? 0;
  return {
    model,
    tokensIn,
    tokensOut,
    costUsd: calcCost(model, tokensIn, tokensOut),
  };
}

/** Soma vários UsageReport num agregado (ex: gerador + polisher). */
export function sumUsage(reports: UsageReport[]): {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
} {
  return reports.reduce(
    (acc, r) => ({
      tokensIn: acc.tokensIn + r.tokensIn,
      tokensOut: acc.tokensOut + r.tokensOut,
      costUsd: acc.costUsd + r.costUsd,
    }),
    { tokensIn: 0, tokensOut: 0, costUsd: 0 }
  );
}
