/**
 * AI polisher — takes a raw correction draft and returns a polished version.
 *
 * Unlike a "review-only" reviewer that just flags issues, this rewrites the
 * correction applying tone, specificity and completeness fixes directly.
 * The monitor sees the polished version on screen — no surfaced issues to
 * resolve manually, unless polishing fails.
 *
 * Hard constraints (enforced in the prompt):
 *   - Never invent file paths, line numbers or codeSnippet content not in the
 *     raw draft. Polisher can only rewrite what's there.
 *   - Keep the grade within ±0.5 of the original.
 *   - Always return a schema-valid correction or we fall back to the raw.
 */

import { env } from './env';
import { DNA_GEMEOS, HUMANIZER_RULES, HUMAN_EXAMPLES } from './prompt-assets';
import {
  CorrectionDraftInput,
  type CorrectionDraftInputT,
} from './validators';
import { buildUsage, type UsageReport } from './cost';

export interface PolishResult {
  polished: CorrectionDraftInputT;
  changes: string[];
  score: number;
  model: string;
  fallback: boolean; // true if polishing failed and we returned the raw
  usage: UsageReport;
}

export interface PolishContext {
  githubUrl: string;
  studentEmail: string;
}

const POLISH_MODEL = 'gpt-4o-mini';
// Polisher tem fallback graceful pro raw — timeout curto evita engolir tempo
// se a OpenAI estiver lenta, deixando margem pro generator.
const POLISH_FETCH_TIMEOUT_MS = 60_000;

function buildPolishSystem(): string {
  return [
    'Você é um revisor sênior da DevQuest (Dev em Dobro) que NÃO apenas aponta problemas — você aplica as correções direto no texto.',
    'Você recebe um rascunho de correção gerado por outra IA e devolve uma VERSÃO POLIDA pronta pra entregar, seguindo o tom e as regras abaixo.',
    '',
    '=== PÚBLICO ALVO ===',
    '',
    'O aluno é iniciante ou leigo em programação. Pode ser o primeiro projeto da vida dele.',
    'Seu trabalho como polisher é garantir que a correção REALMENTE ENSINE.',
    '',
    '=== O QUE VOCÊ PODE REESCREVER ===',
    '',
    '1. Sugestões vagas → específicas E didáticas.',
    '   "Melhore o código" → reformula pra citar trecho concreto, explicar POR QUÊ importa, COMO resolver.',
    '   Sugestão curta demais (1 frase) pra iniciante → expande pra 3–6 frases incluindo:',
    '     • o QUE tá errado (o aluno localiza no próprio código)',
    '     • o POR QUÊ (consequência prática — quebra em mobile? leitor de tela ignora? bug?)',
    '     • o COMO (caminho pra corrigir)',
    '     • se tem jargão ("especificidade CSS", "event bubbling"), acrescenta uma explicação de UMA frase inline.',
    '',
    '2. AI-speak → tom Dobro.',
    '   "É crucial aplicar boas práticas" → "Vale ajustar pra seguir boas práticas".',
    '',
    '3. proposedFix sem fence de linguagem → ADICIONE a fence correta (```html, ```css, ```jsx, etc).',
    '   Se o proposedFix CONTÉM comentário no código (//, /* */, <!-- -->, #), REMOVA o comentário e a explicação vai pra suggestion em texto. Comentário no código não é boa prática nessa rubrica — código limpo se explica por nome e estrutura.',
    '',
    '4. narrativeMd genérica ou fora do tom → reescrita em 80–200 palavras no DNA dos gêmeos.',
    '',
    '5. strengths genéricos ("bom trabalho") → reescritos pra citar algo específico que JÁ APARECE no rascunho ou nas próprias sugestões.',
    '',
    '6. Melhorias DUPLICADAS EXATAS → merge. Duplicata = mesma area + mesmo file + mesmo lineStart. "Tema parecido" (ex: 2 issues de naming em arquivos diferentes) NÃO é duplicata — preserva os dois.',
    '',
    '7. AREA mal-classificada → corrige (sem mudar o conteúdo do improvement).',
    '   "segurança" SÓ vale pra: chave/token/senha exposta, .env commitado, SQL injection (string concat em query), XSS (innerHTML com input não escapado), CORS aberto sem critério, autenticação quebrada, hash fraco em senha. Qualquer outra coisa rotulada "segurança" → reclassifica pra área correta (assets, polimento, README, etc).',
    '   Exemplo prático: improvement sobre path de favicon, link de CDN, versão de Font Awesome, asset faltando — NÃO é segurança. Reclassifica.',
    '',
    '8. SEVERITY inflada → ajusta pra calibração correta.',
    '   high = bug ativo, segurança real, código quebrado.',
    '   medium = boa prática que faz diferença real (acessibilidade, naming, error handling, README incompleto).',
    '   low = polimento, organização, asset com path duvidoso, micro-otimização.',
    '   Se um improvement de polimento veio como "high", baixa pra "low". Severity inflada dilui o sinal pro aluno.',
    '',
    '9. Improvement ESPECULATIVO ("verifica se", "talvez", "pode estar") → DESCARTA.',
    '   Princípio do dono do produto: "se não souber, é melhor não colocar nada". Improvement tem que ser AFIRMAÇÃO, nunca pergunta. Se o rascunho tem improvement abrindo com "verifica se X existe / é a versão mais recente / etc", remove (essa é exceção legítima ao "NUNCA reduz quantidade", junto com duplicata exata e improvement de comentário).',
    '',
    '=== O QUE VOCÊ NÃO PODE FAZER ===',
    '',
    '- NUNCA invente nome de arquivo, número de linha ou conteúdo de codeSnippet que não esteja no rascunho original.',
    '- NUNCA escreva em inglês (exceto termos técnicos universais tipo "CSS", "HTML", "function").',
    '- NUNCA adicione emoji.',
    '- NUNCA adicione comentário no código (//, /* */, <!-- -->, #). Se o rascunho tem improvement pedindo "adicione comentário explicativo" ou similar, REMOVA esse improvement (não merge, não reescreve — descarta). Comentário no código não é boa prática nessa rubrica.',
    '- NUNCA mude a grade em mais de 0.5 pontos pra cima ou pra baixo.',
    '- NUNCA acrescente melhorias novas do zero (você pode tirar, unir ou reescrever — mas não inventar).',
    '- NUNCA deixe jargão técnico sem uma explicação curta (o aluno é iniciante).',
    '- Se o rascunho tá bom, não reescreva só por reescrever. Preserva o que já tá no ponto.',
    '',
    '=== REGRAS DE TOM (DNA DOS GÊMEOS) ===',
    '',
    DNA_GEMEOS,
    '',
    '=== REGRAS ANTI-AI-SPEAK ===',
    '',
    HUMANIZER_RULES,
    '',
    '=== EXEMPLOS DE TOM (use como vara de medir) ===',
    '',
    HUMAN_EXAMPLES,
    '',
    'IMPORTANTE: se o rascunho tem alguma frase que parece com o "ANTES" dos exemplos acima, REESCREVA. O objetivo é que cada improvement.suggestion saia tão concreto e específico quanto o "DEPOIS" desses exemplos.',
    '',
    '=== FORMATO DE RESPOSTA (JSON estrito) ===',
    '{',
    '  "score": número de 0 a 10 (qualidade do rascunho ORIGINAL, antes do polimento),',
    '  "changes": array de strings descrevendo o que você alterou (ex: "Reformulei suggestion #2 pra citar App.jsx:42 explicitamente"). Array vazio se não mudou nada.,',
    '  "correction": {',
    '    "grade": número (dentro de ±0.5 do original),',
    '    "strengths": array de 3 a 5 strings,',
    '    "improvements": array com TODOS os improvements do rascunho original — sem teto, mesma quantidade que veio. Cada item: { area, severity ("low"|"medium"|"high"), suggestion, file?, lineStart?, lineEnd?, codeSnippet?, proposedFix? },',
    '    "narrativeMd": string de 80 a 200 palavras em markdown leve',
    '  }',
    '}',
    '',
    'IMPORTANTE: o polisher NUNCA reduz a quantidade de improvements. Se o rascunho tem 12 improvements, a saída polida tem 12 improvements. Exceções legítimas (são as ÚNICAS): (a) duplicata exata = mesma area + mesmo file + mesmo lineStart; (b) improvement pedindo "adicione comentário explicativo" ou similar — descarta sem substituir; (c) improvement especulativo abrindo com "verifica se", "talvez", "pode estar", "confirma se" — descarta sem substituir. Fora essas três exceções, sua função é polir TEXTO, não enxugar listas.',
    '',
    'O campo "correction" tem que ser exatamente o schema da correção original, só com os textos lapidados.',
    'Se você olhar o rascunho e achar que não tem nada a melhorar, devolve ele igualzinho no campo "correction" e changes=[] — totalmente OK.',
  ].join('\n');
}

function buildPolishUser(
  raw: CorrectionDraftInputT,
  ctx: PolishContext
): string {
  return [
    `Submissão: ${ctx.githubUrl}`,
    `Aluno: ${ctx.studentEmail}`,
    '',
    'Rascunho pra polir:',
    '```json',
    JSON.stringify(raw, null, 2),
    '```',
    '',
    'Devolve a versão polida no formato JSON exigido.',
  ].join('\n');
}

/**
 * Take a raw correction draft and return a polished version. On any error
 * (API failure, invalid JSON, schema mismatch), returns the raw draft
 * unchanged with `fallback: true` so the pipeline keeps flowing.
 */
export async function polishCorrection(
  raw: CorrectionDraftInputT,
  ctx: PolishContext
): Promise<PolishResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: POLISH_MODEL,
        messages: [
          { role: 'system', content: buildPolishSystem() },
          { role: 'user', content: buildPolishUser(raw, ctx) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 8000,
      }),
      signal: AbortSignal.timeout(POLISH_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Polisher API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const polishUsage = buildUsage(POLISH_MODEL, data.usage);
    const rawBody = data.choices?.[0]?.message?.content;
    if (!rawBody) throw new Error('polisher sem conteúdo');

    const parsed = JSON.parse(rawBody);
    const validated = CorrectionDraftInput.safeParse(parsed.correction);
    if (!validated.success) {
      throw new Error(
        `correction polida falhou no schema: ${JSON.stringify(validated.error.flatten()).slice(0, 200)}`
      );
    }

    // Enforce grade guardrail: if polisher moved it more than 0.5, clamp.
    const maxDelta = 0.5;
    let grade = validated.data.grade;
    if (Math.abs(grade - raw.grade) > maxDelta) {
      grade = raw.grade + Math.sign(grade - raw.grade) * maxDelta;
    }

    const changes = Array.isArray(parsed.changes)
      ? parsed.changes.filter((c: unknown) => typeof c === 'string' && c.length > 0)
      : [];
    const score = typeof parsed.score === 'number' ? parsed.score : 0;

    return {
      polished: { ...validated.data, grade },
      changes,
      score,
      model: POLISH_MODEL,
      fallback: false,
      usage: polishUsage,
    };
  } catch (err) {
    console.warn(
      '[ai-polisher] fallback to raw correction:',
      err instanceof Error ? err.message : err
    );
    return {
      polished: raw,
      changes: [],
      score: 0,
      model: POLISH_MODEL,
      fallback: true,
      usage: { model: POLISH_MODEL, tokensIn: 0, tokensOut: 0, costUsd: 0 },
    };
  }
}
