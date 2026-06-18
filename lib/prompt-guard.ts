/**
 * prompt-guard — detecção heurística de prompt injection no texto livre que o
 * gestor de vendas grava em `chat_context` (sales_settings).
 *
 * Esse texto é concatenado ao system prompt do agente em toda conversa. As
 * mitigações de prompt (demarcação, subordinação às regras, delimitadores) são
 * quebráveis; este guard NÃO promete bloquear um atacante determinado. O alvo
 * dele é mais modesto e ainda assim valioso:
 *
 *   1. barrar erros honestos (gestor colando um prompt inteiro de outro lugar);
 *   2. deter tentativas de injeção de baixa sofisticação;
 *   3. gerar sinal de auditoria quando alguém tenta.
 *
 * É deliberadamente conservador: só rejeita padrões clássicos e inequívocos de
 * override de instruções, pra não atrapalhar contexto comercial legítimo (que
 * pode falar de "regras", "preço", "ignore o concorrente", etc).
 */

export interface PromptGuardResult {
  ok: boolean;
  /** Motivo legível pro usuário/auditoria quando ok=false. */
  reason?: string;
  /** Rótulo curto da regra que disparou (pra metadata de auditoria). */
  rule?: string;
}

interface GuardRule {
  rule: string;
  reason: string;
  test: RegExp;
}

// Padrões clássicos de override. Cada regex roda sobre o texto normalizado
// (lowercase, sem acento). Mantém comentário explicando o que cada uma pega.
const RULES: GuardRule[] = [
  {
    rule: 'ignore_instructions',
    reason: 'O texto tenta anular instruções anteriores ("ignore as instruções acima").',
    // ignore/disregard/forget/esqueca/ignore + (previous|above|all|todas as) + instructions/regras/prompt
    test: /\b(ignore|ignorar|disregard|forget|esque[cç]a|desconsidere)\b[^.\n]{0,40}\b(previous|above|all|todas?|anteriores?|acima|as regras|the rules|instru[cç][oõ]es|prompt|system)\b/,
  },
  {
    rule: 'override_role',
    reason: 'O texto tenta redefinir quem o agente é ("você agora é...", "aja como...").',
    // "você agora é", "a partir de agora você é", "you are now", "act as", "pretend to be"
    test: /\b(voce|tu)\s+(agora|a partir de agora)\s+(e|sera|deve ser)\b|\byou are now\b|\bact as\b|\bpretend (to be|you are)\b|\bassuma o papel\b/,
  },
  {
    rule: 'chat_role_marker',
    reason: 'O texto contém marcadores de papel de chat (system:/assistant:/user:) ou tokens de template de modelo.',
    // Marcadores de turno no início de linha + tokens de chat templates conhecidos.
    test: /(^|\n)\s*(system|assistant|user)\s*:/i,
  },
  {
    rule: 'model_template_token',
    reason: 'O texto contém tokens especiais de template de modelo (<|im_start|>, [INST], </s>, etc).',
    test: /<\|im_(start|end)\|>|\[\/?INST\]|<\/?s>|<<SYS>>|<\|system\|>|<\|assistant\|>|<\|user\|>/i,
  },
  {
    rule: 'reveal_system_prompt',
    reason: 'O texto pede pra revelar/repetir o prompt de sistema ou as instruções.',
    test: /\b(reveal|repeat|print|show|mostre|revele|repita|imprima)\b[^.\n]{0,40}\b(system prompt|prompt de sistema|suas instru[cç][oõ]es|your instructions|as regras acima)\b/,
  },
  {
    rule: 'rule_break',
    reason: 'O texto manda quebrar/ignorar as regras inegociáveis do agente.',
    test: /\b(quebre|ignore|desconsidere|n[aã]o siga|break|violate)\b[^.\n]{0,40}\b(regras inegoci[aá]veis|regras 1-5|as regras|the rules|non-negotiable)\b/,
  },
];

// Linha gigante de separadores (===, ---, ___, ***) costuma marcar o começo de
// um bloco de prompt colado de outro lugar. 40+ chars repetidos seguidos.
const SEPARATOR_FLOOD = /([=\-_*#~])\1{39,}/;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // remove acentos (combining marks)
}

/**
 * Inspeciona o texto e devolve { ok:false, reason, rule } no primeiro padrão
 * suspeito encontrado. Texto vazio é sempre ok (limpar o contexto é legítimo).
 */
export function inspectChatContext(text: string): PromptGuardResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true };

  const normalized = normalize(trimmed);

  for (const r of RULES) {
    if (r.test.test(normalized)) {
      return { ok: false, reason: r.reason, rule: r.rule };
    }
  }

  if (SEPARATOR_FLOOD.test(trimmed)) {
    return {
      ok: false,
      rule: 'separator_flood',
      reason: 'O texto contém uma linha enorme de separadores, típica de prompt colado de outra fonte.',
    };
  }

  return { ok: true };
}
