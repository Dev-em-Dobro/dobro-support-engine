/**
 * Status messages shown while the AI agents process a submission.
 * Style: The Sims status popups, but for devs — short, specific, a little
 * absurd, never cynical. Grouped roughly by "phase" so the loader can
 * escalate as time goes on.
 */

export const LOADER_MESSAGES_EARLY: string[] = [
  'Acordando os gêmeos...',
  'Clonando o repositório na cabeça...',
  'Lendo o README com atenção...',
  'Contando os arquivos do projeto...',
  'Fazendo café pros agentes da Dobro...',
  'Colocando os óculos de leitura...',
  'Abrindo o index.html com carinho...',
  'Conferindo se o repo é público...',
];

export const LOADER_MESSAGES_MID: string[] = [
  'Procurando o div que fugiu...',
  'Perguntando pro semicolon se ele tá bem...',
  'Negociando com o prettier...',
  'Pedindo desculpa pro JavaScript...',
  'Reclamando do CSS que não centraliza...',
  'Tomando um café com o TypeScript...',
  'Discutindo filosofia com o eslint...',
  'Investigando aquele console.log esquecido...',
  'Vendo se o button realmente é um button...',
  'Conferindo o alt das imagens...',
  'Rodando npm install mentalmente...',
  'Traduzindo o erro do React pra português...',
  'Contando quantos useEffect são demais...',
  'Checando se o mobile chora ou não...',
  'Testando contraste com óculos escuros...',
  'Tentando entender a regex que você escreveu...',
  'Admirando o for loop bem-feito...',
  'Refatorando a variável chamada "teste2"...',
];

export const LOADER_MESSAGES_LATE: string[] = [
  'Revisando com o outro gêmeo...',
  'Deixando o feedback mais gentil...',
  'Escolhendo as palavras com carinho...',
  'Tirando o "crucial" do texto (IA-speak detectado)...',
  'Adicionando comentário didático no código...',
  'Conferindo se a nota tá justa...',
  'Colocando o pingo nos i...',
  'Revisando o tom dos gêmeos...',
  'Quase lá, tá ficando lindo...',
  'Último ajuste antes de te mostrar...',
  'Passando pente fino no markdown...',
  'Garantindo que nada em inglês escapou...',
];

export const LOADER_MESSAGES_ALL: string[] = [
  ...LOADER_MESSAGES_EARLY,
  ...LOADER_MESSAGES_MID,
  ...LOADER_MESSAGES_LATE,
];

/**
 * Pick a message appropriate for how long the user has been waiting.
 * Uses a deterministic shuffle seeded by `tick` so the sequence is
 * varied but reproducible within a session.
 */
export function loaderMessage(tick: number, elapsedMs: number): string {
  let pool: string[];
  if (elapsedMs < 15_000) pool = LOADER_MESSAGES_EARLY;
  else if (elapsedMs < 45_000) pool = LOADER_MESSAGES_MID;
  else pool = LOADER_MESSAGES_LATE;
  // Simple deterministic hash to pick from pool
  const idx = Math.abs(tick * 2654435761) % pool.length;
  return pool[idx];
}
