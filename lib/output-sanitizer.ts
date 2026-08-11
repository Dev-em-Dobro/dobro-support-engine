/**
 * output-sanitizer — filtro de saída do Agente de Vendas (defense in depth).
 *
 * Mesmo com o prompt blindado (regras inegociáveis + contexto do gestor
 * demarcado e subordinado), um `chat_context` envenenado ou um chunk malicioso
 * da KB poderiam fazer o modelo emitir conteúdo indesejado. Este filtro roda na
 * saída antes de persistir/devolver a resposta e mira três coisas:
 *
 *   1. URLs externas (phishing) — só domínios da Dev em Dobro passam; o resto
 *      vira "[link removido]".
 *   2. Vazamento de tokens de template / marcadores de papel — removidos.
 *   3. Iscas de "clique/baixe agora" apontando pra fora — sinalizadas.
 *
 * NÃO é à prova de bala (o modelo pode parafrasear uma isca sem URL). É a última
 * linha: reduz o estrago de uma injeção bem-sucedida e gera sinal de auditoria.
 *
 * Observação sobre streaming: no chat normal os tokens já foram enviados ao
 * vendedor enquanto chegavam, então aqui sanitizamos a CÓPIA PERSISTIDA (a que
 * é reexibida ao recarregar a conversa e serve de base forense). No Modo
 * Objeção a resposta vem inteira de uma vez, então a sanitização protege o que
 * é efetivamente entregue.
 */

// Domínios cujas URLs são consideradas legítimas na saída do agente.
const ALLOWED_HOSTS = [
  'devemdobro.com',
  'devemdobro.com.br',
  'devquest.com.br',
  'dev em dobro', // nunca casa como host, só documentação
];

const URL_RE = /\bhttps?:\/\/[^\s<>()[\]{}"']+/gi;

// Tokens de template de modelo / marcadores de papel que nunca deveriam vazar.
const TEMPLATE_TOKENS_RE =
  /<\|im_(?:start|end)\|>|<\|(?:system|assistant|user)\|>|\[\/?INST\]|<<SYS>>|<\/?s>/gi;

// Iscas clássicas de phishing apontando pra ação externa.
const LURE_RE =
  /\b(clique|click|baixe|baixar|download|acesse|entre)\b[^.\n]{0,30}\b(aqui|agora|neste link|no link|abaixo|este link)\b/i;

function hostAllowed(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

export interface SanitizeResult {
  /** Texto já filtrado, seguro pra persistir/devolver. */
  text: string;
  /** true se algo foi removido ou sinalizado. */
  flagged: boolean;
  /** Rótulos curtos do que disparou (pra metadata de auditoria). */
  reasons: string[];
}

/**
 * Filtra a resposta do agente. Sempre devolve um texto utilizável — nunca
 * lança. Quando `flagged` é true, o chamador deve registrar um evento de
 * auditoria pra investigação.
 */
export function sanitizeAgentOutput(text: string): SanitizeResult {
  const reasons: string[] = [];
  let out = text;

  if (TEMPLATE_TOKENS_RE.test(out)) {
    out = out.replace(TEMPLATE_TOKENS_RE, '');
    reasons.push('template_token_leak');
  }

  let strippedUrl = false;
  out = out.replace(URL_RE, (url) => {
    if (hostAllowed(url)) return url;
    strippedUrl = true;
    return '[link removido]';
  });
  if (strippedUrl) reasons.push('external_url');

  if (LURE_RE.test(out)) reasons.push('phishing_lure');

  return { text: out, flagged: reasons.length > 0, reasons };
}
