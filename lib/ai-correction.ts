/**
 * AI correction generator.
 *
 * Flow:
 *   1. Parse GitHub URL → owner/repo
 *   2. Fetch repo metadata + README + file tree
 *   3. Filter file tree (skip binaries, lockfiles, deps) and fetch content of
 *      every relevant file in parallel batches (GitHub blob API, SHA-addressed)
 *   4. Build prompt: project-wide context + full numbered file content
 *   5. Call OpenAI (gpt-4o-mini) with json_object response format
 *   6. Validate output against CorrectionDraftInput schema
 *
 * Without GITHUB_TOKEN: 60 req/hour per IP (tight with many files per correction).
 * With GITHUB_TOKEN: 5000 req/hour — use in production.
 */

import { z } from 'zod';
import { env } from './env';
import { CorrectionDraftInput, type CorrectionDraftInputT } from './validators';
import {
  DNA_GEMEOS,
  EVALUATION_RUBRIC,
  HUMANIZER_RULES,
  HUMAN_EXAMPLES,
  TEACHER_STYLE,
} from './prompt-assets';
import { buildUsage, sumUsage, type UsageReport } from './cost';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/;
const OPENAI_MODEL = 'gpt-4o-mini';
const PROMPT_VERSION = 'v9-2026-04';

// File content budget — keeps us well under gpt-4o-mini's 128k token context
const MAX_FILES = 60;
const MAX_CHARS_PER_FILE = 8000;
const MAX_TOTAL_CHARS = 250_000;
const BLOB_FETCH_CONCURRENCY = 8;

// Sem timeout, fetch do Node fica pendurado em socket lento e a função Vercel
// é morta sem cair no catch — submission fica eternamente em "processing".
const GITHUB_FETCH_TIMEOUT_MS = 15_000;
// Writer (Pass 2) gera JSON denso (improvements + codeSnippet + proposedFix);
// 75s tava ficando apertado em dias de OpenAI lenta — submissão caía em
// "failed" com "operation was aborted due to timeout". 120s deixa margem
// confortável dentro do maxDuration=300 da função.
const OPENAI_WRITER_TIMEOUT_MS = 120_000;
// Enumerator (Pass 1) tem output menor (max_tokens=6000); 90s é suficiente.
const OPENAI_ENUMERATOR_TIMEOUT_MS = 90_000;

const SKIP_PATH_PREFIXES = [
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '.nuxt/',
  'coverage/',
  '.git/',
  'out/',
  '.vercel/',
  '.cache/',
  '__pycache__/',
  'venv/',
  '.venv/',
  'env/',
  'target/',
  'bin/',
  'obj/',
  '.idea/',
  '.vscode/',
];

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff', '.avif',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.ogg', '.flac',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.wasm',
  '.psd', '.ai', '.sketch', '.fig',
  '.map',
  // Credenciais e certificados — proteção contra aluno commitar segredo no repo
  '.pem', '.key', '.crt', '.cer', '.pfx', '.p12', '.keystore', '.jks',
]);

const SKIP_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Pipfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'composer.lock',
  'Gemfile.lock',
  '.DS_Store',
  'Thumbs.db',
]);

// Padrões de arquivos sensíveis que não cabem nas listas acima (ex: .env*
// com sufixo variável, chaves SSH com nome convencional sem extensão).
// Segredos NUNCA podem entrar no prompt da IA — vazam pro provedor (OpenAI/
// Anthropic) e potencialmente pro próprio output da correção.
const SKIP_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,           // .env, .env.local, .env.production, .env.example, etc
  /^id_rsa(\..+)?$/i,           // SSH RSA private/public keys
  /^id_ed25519(\..+)?$/i,       // SSH Ed25519 keys
  /^id_dsa(\..+)?$/i,           // SSH DSA keys
  /^id_ecdsa(\..+)?$/i,         // SSH ECDSA keys
  /^known_hosts$/i,             // SSH known hosts
  /^authorized_keys$/i,         // SSH authorized keys
  /^\.htpasswd$/i,              // Apache basic auth
  /^\.netrc$/i,                 // curl/ftp credentials
  /^credentials(\..+)?$/i,      // AWS / cloud credentials files
  /^\.aws-credentials$/i,
  /^secrets?\.(yaml|yml|json|toml)$/i,  // secrets.yml, secret.json, etc
];

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

interface RepoFile {
  path: string;
  content: string; // Full file content (possibly truncated)
  truncated: boolean;
  totalLines: number;
}

interface ProjectProfile {
  // Stack detectada por package.json + extensão de arquivos. Determina quais
  // checagens de README fazem sentido (npm install só em projeto Node, etc).
  stack:
    | 'static'        // HTML/CSS/JS puro, sem package.json
    | 'next'          // Next.js
    | 'react'         // React (CRA, Vite, etc) sem framework superior
    | 'vue'
    | 'svelte'
    | 'express'
    | 'fastify'
    | 'node'          // Node sem framework reconhecido
    | 'python'
    | 'unknown';
  hasPackageJson: boolean;
  hasNodeDependencies: boolean;
  usesEnvVars: boolean;
  envVarSamples: string[]; // Caminhos de até 5 arquivos onde process.env etc apareceu
  installCommand: string | null;       // null quando não tem o que instalar
  runCommandSuggestion: string;        // Como o aluno deveria rodar localmente
}

interface RepoContext {
  owner: string;
  repo: string;
  description: string | null;
  primaryLanguage: string | null;
  defaultBranch: string;
  readme: string | null;
  files: RepoFile[];
  totalFilesInRepo: number;
  filesFetched: number;
  filesSkipped: number;
  deployedUrl: string | null;
  profile: ProjectProfile;
}

function parseGithubUrl(url: string): { owner: string; repo: string } {
  const m = url.match(GITHUB_URL_REGEX);
  if (!m) throw new Error(`URL do GitHub inválida: ${url}`);
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function ghHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) {
    (headers as Record<string, string>).Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  return headers;
}

function shouldSkipFile(path: string, size: number | undefined): boolean {
  const lower = path.toLowerCase();
  if (SKIP_PATH_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(`/${p}`))) {
    return true;
  }
  const basename = lower.split('/').pop() || '';
  if (SKIP_FILENAMES.has(basename)) return true;
  // Padrões sensíveis (.env*, chaves SSH, credentials*, secrets.yaml, etc)
  if (SKIP_FILE_PATTERNS.some((pat) => pat.test(basename))) return true;
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = basename.slice(dotIdx);
    if (SKIP_EXTENSIONS.has(ext)) return true;
  }
  // Skip huge files (likely minified or binary-ish) — cap at 200KB raw size
  if (size !== undefined && size > 200 * 1024) return true;
  return false;
}

function truncateContent(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) return { text: content, truncated: false };
  const lines = content.split('\n');
  const out: string[] = [];
  let acc = 0;
  for (const l of lines) {
    if (acc + l.length + 1 > maxChars) break;
    out.push(l);
    acc += l.length + 1;
  }
  return { text: out.join('\n'), truncated: true };
}

async function fetchBlob(owner: string, repo: string, sha: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: ghHeaders(), signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  if (data.encoding !== 'base64' || typeof data.content !== 'string') return null;
  const buf = Buffer.from(data.content, 'base64');
  // Quick binary sniff: if content has >5% null bytes in first 4KB, skip
  const sample = buf.subarray(0, Math.min(4096, buf.length));
  let nulls = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nulls++;
  if (sample.length > 0 && nulls / sample.length > 0.05) return null;
  return buf.toString('utf-8');
}

async function fetchInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

/**
 * Detecta stack + se o projeto realmente precisa de .env / npm install.
 *
 * O propósito é alimentar o prompt com contexto verificável pra IA não cobrar
 * artefatos inexistentes (npm install num projeto static, .env.example num
 * projeto sem process.env). Detecção é HEURÍSTICA — quando incerto, vira
 * 'unknown' e o prompt deixa a IA usar o próprio julgamento.
 */
function detectProjectProfile(files: RepoFile[]): ProjectProfile {
  const pkgFile = files.find(
    (f) => f.path === 'package.json' || f.path.endsWith('/package.json')
  );

  let pkg: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    scripts?: Record<string, string>;
  } | null = null;
  if (pkgFile) {
    try {
      pkg = JSON.parse(pkgFile.content);
    } catch {
      pkg = null;
    }
  }

  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  } as Record<string, unknown>;
  const depKeys = Object.keys(deps);
  const hasPackageJson = !!pkgFile;
  const hasNodeDependencies = depKeys.length > 0;

  // Stack detection — checa frameworks na ordem mais específica primeiro
  let stack: ProjectProfile['stack'] = 'unknown';
  if (hasPackageJson) {
    if ('next' in deps) stack = 'next';
    else if ('react' in deps || 'react-dom' in deps) stack = 'react';
    else if ('vue' in deps) stack = 'vue';
    else if ('svelte' in deps || '@sveltejs/kit' in deps) stack = 'svelte';
    else if ('express' in deps) stack = 'express';
    else if ('fastify' in deps) stack = 'fastify';
    else stack = 'node';
  } else {
    const hasHtml = files.some(
      (f) => f.path.endsWith('.html') || f.path.endsWith('.htm')
    );
    const hasPy = files.some((f) => f.path.endsWith('.py'));
    if (hasPy && !hasHtml) stack = 'python';
    else if (hasHtml) stack = 'static';
  }

  // Env var usage — varre conteúdo dos arquivos por padrões reais de leitura
  // de env. Comentário mencionando ".env" não conta — só uso de fato.
  const envPatterns = [
    /\bprocess\.env\.[A-Z_][A-Z0-9_]*/,
    /\bprocess\.env\[/,
    /\bimport\.meta\.env\./,
    /\bos\.environ(\.get)?\b/,
    /\bos\.getenv\b/,
    /\bDeno\.env\.get\b/,
  ];
  const envVarSamples: string[] = [];
  for (const f of files) {
    if (envPatterns.some((p) => p.test(f.content))) {
      envVarSamples.push(f.path);
      if (envVarSamples.length >= 5) break;
    }
  }
  const usesEnvVars = envVarSamples.length > 0;

  // Run/install commands — derivados do stack
  const installCommand = hasNodeDependencies
    ? 'npm install'
    : stack === 'python'
      ? 'pip install -r requirements.txt (se houver)'
      : null;

  let runCommandSuggestion: string;
  const scripts = pkg?.scripts ?? {};
  if (stack === 'static') {
    runCommandSuggestion =
      'abrir index.html direto no navegador (ou usar a extensão Live Server do VS Code)';
  } else if (scripts.dev) {
    runCommandSuggestion = 'npm run dev';
  } else if (scripts.start) {
    runCommandSuggestion = 'npm start';
  } else if (stack === 'python') {
    runCommandSuggestion = 'python <arquivo principal>.py';
  } else if (stack === 'express' || stack === 'fastify') {
    runCommandSuggestion = 'node <arquivo de entrada> (ou npm start se script existir)';
  } else {
    runCommandSuggestion = '(stack desconhecido — verificar README/scripts)';
  }

  return {
    stack,
    hasPackageJson,
    hasNodeDependencies,
    usesEnvVars,
    envVarSamples,
    installCommand,
    runCommandSuggestion,
  };
}

async function fetchRepoContext(
  githubUrl: string,
  deployedUrl: string | null
): Promise<RepoContext> {
  const { owner, repo } = parseGithubUrl(githubUrl);
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  // Repo metadata
  const repoRes = await fetch(base, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
  if (!repoRes.ok) {
    throw new Error(
      `GitHub API ${repoRes.status} pra ${owner}/${repo}: ${await repoRes.text().catch(() => '')}`
    );
  }
  const repoData = await repoRes.json();
  const defaultBranch: string = repoData.default_branch || 'main';

  // README
  let readme: string | null = null;
  const readmeRes = await fetch(`${base}/readme`, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
  if (readmeRes.ok) {
    const rd = await readmeRes.json();
    if (rd.content && rd.encoding === 'base64') {
      readme = Buffer.from(rd.content, 'base64').toString('utf-8');
      if (readme.length > 6000) readme = readme.slice(0, 6000) + '\n... [README truncado]';
    }
  }

  // Full file tree
  const treeRes = await fetch(
    `${base}/git/trees/${defaultBranch}?recursive=1`,
    { headers: ghHeaders(), signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS) }
  );
  let allEntries: TreeEntry[] = [];
  let totalFilesInRepo = 0;
  if (treeRes.ok) {
    const tree = await treeRes.json();
    if (Array.isArray(tree.tree)) {
      allEntries = tree.tree.filter((n: TreeEntry) => n.type === 'blob');
      totalFilesInRepo = allEntries.length;
    }
  }

  // Filter and cap
  const candidates = allEntries.filter((e) => !shouldSkipFile(e.path, e.size));
  const filesSkipped = allEntries.length - candidates.length;

  // Prioritize: put README-level and source files near the root first, then by shallowness
  const prioritized = [...candidates].sort((a, b) => {
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.path.localeCompare(b.path);
  });

  const capped = prioritized.slice(0, MAX_FILES);

  // Fetch blob contents in parallel batches
  const fetched = await fetchInBatches(capped, BLOB_FETCH_CONCURRENCY, async (entry) => {
    const content = await fetchBlob(owner, repo, entry.sha);
    if (content === null) return null;
    return { entry, content };
  });

  // Apply per-file + total-char budgets
  const files: RepoFile[] = [];
  let totalChars = 0;
  for (const item of fetched) {
    if (!item) continue;
    const { text, truncated } = truncateContent(item.content, MAX_CHARS_PER_FILE);
    if (totalChars + text.length > MAX_TOTAL_CHARS) break;
    const totalLines = item.content.split('\n').length;
    files.push({ path: item.entry.path, content: text, truncated, totalLines });
    totalChars += text.length;
  }

  const profile = detectProjectProfile(files);

  return {
    owner,
    repo,
    description: repoData.description ?? null,
    primaryLanguage: repoData.language ?? null,
    defaultBranch,
    readme,
    files,
    totalFilesInRepo,
    filesFetched: files.length,
    filesSkipped,
    deployedUrl,
    profile,
  };
}

function numberLines(content: string, startLine = 1): string {
  const lines = content.split('\n');
  const width = String(startLine + lines.length - 1).length;
  return lines
    .map((l, i) => `${String(startLine + i).padStart(width, ' ')}: ${l}`)
    .join('\n');
}

function buildSystemPrompt(): string {
  return [
    'Você é um professor experiente da Dev em Dobro, corrigindo um desafio prático de aluno da DevQuest (curso de programação front-end / full-stack).',
    'Sua função é dar um feedback técnico preciso, específico e motivador — no tom da casa.',
    '',
    'Você vai receber: README, lista de arquivos, e o CONTEÚDO LITERAL de cada arquivo do repositório, com NUMERAÇÃO DE LINHA no formato "  42: <código>".',
    'Use esses números de linha pra citar exatamente onde cada melhoria se aplica.',
    '',
    TEACHER_STYLE,
    '',
    EVALUATION_RUBRIC,
    '',
    'IMPORTANTE: Você vai receber, junto com os arquivos do projeto, uma ENUMERAÇÃO feita por um auditor que já passou pelo código e listou os issues. Sua função é transformar CADA issue da enumeração em um improvement formatado seguindo as regras de tom e estrutura abaixo.',
    'Não pule issues da lista do auditor. Pode mergear 2 que sejam idênticos (mesmo file + linha + categoria). Se notar algo que o auditor passou, pode adicionar — mas a base é a enumeração dele.',
    '',
    DNA_GEMEOS,
    '',
    HUMANIZER_RULES,
    '',
    HUMAN_EXAMPLES,
    '',
    'FORMATO DE RESPOSTA (JSON estrito):',
    '{',
    '  "grade": número de 0 a 10 (uma casa decimal),',
    '  "improvements": array com TODOS os problemas reais — sem teto, sem mínimo formal além do bom-senso. Cada item é um objeto {',
    '    "area": string curta (ex: "acessibilidade", "nomes de variáveis", "CSS responsivo"),',
    '    "severity": "low" | "medium" | "high",',
    '    "suggestion": string (1–3 frases, concreto, direto),',
    '    "file": string opcional (ex: "src/App.jsx") — só se vai citar linha daquele arquivo,',
    '    "lineStart": número opcional (linha inicial citada — OBRIGATÓRIO quando "file" preenchido),',
    '    "lineEnd": número opcional (linha final citada, pode omitir se é uma única linha),',
    '    "codeSnippet": string opcional (trecho LITERAL do código entre lineStart e lineEnd — OBRIGATÓRIO quando "file" preenchido. Sem fence markdown, sem \\"...\\", sem modificar.),',
    '    "proposedFix": string opcional (markdown com bloco \\`\\`\\`linguagem mostrando como ficaria depois da correção — use sempre que der)',
    '  },',
    '  "strengths": array de 3 a 5 strings (pontos fortes específicos, com nome de arquivo/função quando dá),',
    '  "narrativeMd": markdown de 80 a 200 palavras, parágrafo curto de intro + fechamento motivador. Sem repetir o que já tá nas listas. Sem cabeçalho, sem lista, sem emoji.',
    '}',
    '',
    'REGRA CRÍTICA DO RANGE (lineStart / lineEnd / codeSnippet):',
    '- SEMPRE cite um bloco CONTEXTUALMENTE COMPLETO: a função inteira (do `function`/`const fn = ...` até o `}` final), a tag HTML inteira com seus filhos, a regra CSS inteira (do seletor até o `}`), o bloco `if`/`for`/`while` inteiro com corpo.',
    '- NUNCA cite uma linha única que seja só pontuação, fechamento de bloco, ou símbolo isolado. Exemplos PROIBIDOS de codeSnippet: "}", "})", ");", "{", "</div>", "<br>" sozinhos. Se o problema está na linha X que é só `}`, expanda para começar na linha do cabeçalho da função/bloco pai.',
    '- MÍNIMO: 3 linhas quando é questão de bloco (função, if, laço, regra CSS, elemento HTML com filhos). 1 linha só é aceitável para afirmações atômicas (uma const/let/import/let solto, ou uma única property CSS).',
    '- O codeSnippet deve ser autoexplicativo — o aluno tem que entender QUAL pedaço do código tá sendo discutido só olhando pra ele, sem precisar abrir o arquivo.',
    '',
    'REGRA CRÍTICA DO proposedFix (contexto é obrigatório — NUNCA fragmento solto):',
    '- O proposedFix deve mostrar o MESMO BLOCO do codeSnippet, mas DEPOIS da correção aplicada. Se o codeSnippet é a função inteira, o proposedFix é a função inteira corrigida. Se o codeSnippet é uma regra CSS, o proposedFix é a regra CSS corrigida. Mesmo escopo, sempre.',
    '- O aluno tem que conseguir SUBSTITUIR o codeSnippet pelo proposedFix verbatim — copiar o proposedFix e colar por cima do bloco original. Se a proposta é só "adicione uma linha X", mostre O BLOCO INTEIRO com a linha já inserida no lugar certo, não a linha sozinha.',
    '- EXEMPLO PROIBIDO: sugestão "adicione return false na função validateEmptyInput" e o proposedFix é apenas `return false;` sozinho. CERTO: o proposedFix mostra a função validateEmptyInput inteira, com o `return false;` já posicionado dentro dela, no lugar correto.',
    '- Se a correção tem 2 mudanças no mesmo bloco, o proposedFix mostra o bloco inteiro com AMBAS as mudanças aplicadas. Se envolve 2 blocos diferentes, faça 2 improvements separados (cada um com seu codeSnippet + proposedFix próprios) — NUNCA misture escopos num único proposedFix.',
    '- Fragmento solto força o aluno a virar detetive (onde coloco? antes de qual linha? dentro de qual if?). Contexto elimina essa dúvida.',
    '',
    'ATENÇÃO MÁXIMA: NUNCA invente número de linha, nome de arquivo ou trecho de código. Se não tem certeza, deixa file/lineStart/codeSnippet em branco e vira uma observação geral.',
    '',
    'REGRA ANTI-COMENTÁRIO (forte):',
    '- NÃO gere improvement pedindo pro aluno "adicionar comentário", "comentar o código", "incluir comentário explicativo" ou variações. Comentário no código não é boa prática nessa rubrica.',
    '- NÃO inclua comentários (//, /* */, <!-- -->, #) dentro do proposedFix. O fix é só código — a explicação fica na suggestion, em texto.',
    '- Se o auditor enumerou um issue desse tipo, IGNORA esse issue (não vira improvement). Se você vê o sintoma "código difícil de entender", mira no problema real (nome ruim, função grande, lógica obscura) — não no comentário ausente.',
    '',
    'REGRA DE COBRANÇA POR STACK (use o "PERFIL DETECTADO DO PROJETO" do contexto):',
    '- NÃO gere improvement cobrando "npm install" / "como instalar dependências" se o perfil diz "Tem dependências node? NÃO".',
    '- NÃO gere improvement cobrando ".env.example" / "documentar variáveis de ambiente" / "criar .env" se o perfil diz "Usa variáveis de ambiente? NÃO".',
    '- NÃO gere improvement sugerindo "npm run dev" / "scripts de build" / configurar bundler em projeto com Stack=static.',
    '- Se o auditor (Pass 1) enumerou um desses por engano, DESCARTA — não vira improvement. Cobrança inaplicável é pior que cobrança ausente: o aluno fica perdido tentando fazer algo que não faz sentido.',
    '- Comando de execução cobrável é o "Comando de execução sugerido" do perfil. Em static, é abrir o HTML — citar Live Server ou double-click no arquivo é correto, "npm run dev" não.',
    '',
    'REGRA ANTI-ESPECULAÇÃO (improvement é AFIRMAÇÃO, não pergunta):',
    '- PROIBIDO usar "verifica se", "confirma se", "talvez", "pode estar", "é possível que", "se for o caso", "caso seja necessário" pra abrir um improvement. O aluno não tá aqui pra investigar dúvida sua — ou você confirmou que é problema, ou você não cita.',
    '- Path/arquivo referenciado: o contexto te entrega a LISTA COMPLETA dos arquivos do repo. ANTES de cobrar "esse arquivo pode não existir", PROCURA na lista. Se existe, não cita. Se não existe, afirma diretamente: "O index.html referencia ./images/favicon-32x32.png na linha 8, mas esse arquivo não está no repositório — o favicon não vai aparecer."',
    '- Versão/conteúdo de recurso EXTERNO (CDN, link pra imagem em outro domínio, biblioteca de terceiro): NUNCA cite "verifica se a versão é a mais recente" — você não tem como saber, e o aluno também não quer caçar isso. A única exceção é versão claramente abandonada que VOCÊ identifica pelo número (ex: jQuery 1.x, React 15) — aí afirma direto.',
    '- "Pode causar problemas se X" sem evidência concreta: descarta. Só vira improvement quando você CONSEGUE apontar o efeito real no código que tá vendo.',
    '- REGRA DE OURO (do dono do produto): "se não souber, é melhor não colocar nada". Lista de improvements curta e correta vale infinitamente mais que lista longa com chute. Na MENOR dúvida sobre se é problema real → DESCARTA o improvement. Aluno enxerga IA chutando uma vez e perde confiança em todas as outras correções.',
    '',
    'SEVERITY — CALIBRAÇÃO ESTRITA (use essa régua, não infla):',
    '- "high" = bug ativo, código quebrado, segurança real. Exemplos: chave de API hardcoded, SQL injection, await esquecido em chamada crítica, useEffect com loop infinito, app crasha em caso comum, .env commitado no repo, fetch sem tratamento de erro deixando UI quebrada.',
    '- "medium" = boa prática que faz diferença real na manutenção/UX/acessibilidade. Exemplos: img sem alt, falta de loading state, naming ruim em arquivo central, mistura PT/EN, useState em vez de useReducer pra estado complexo, falta de validação de input no back-end, README sem exemplo de uso.',
    '- "low" = polimento, organização, micro-otimização. Exemplos: nome de variável poderia ser melhor (mas é entendível), espaçamento inconsistente, classe CSS com nome genérico, link de favicon com path duvidoso, ordem dos imports, file solto que poderia ir pra subpasta.',
    '- Default: na dúvida entre low e medium, é low. Na dúvida entre medium e high, é medium. INFLAR severity dilui o sinal pro aluno — ele vai achar tudo "crítico" e ignorar TUDO.',
    '',
    'AREA — TAXONOMIA (use uma dessas, não invente nem misture):',
    '- "segurança" — RESERVADO pra: chave/token/senha exposta, .env commitado, SQL injection, XSS, CORS aberto sem motivo, autenticação quebrada. NUNCA pra favicon, asset, versão de lib, link externo.',
    '- "acessibilidade" — alt, aria-label, label de form, contraste, ordem de heading.',
    '- "html semântico" — uso de div onde cabia header/main/section/article/nav.',
    '- "css" / "css responsivo" — media query, unidades, especificidade, layout.',
    '- "naming" — nomes curtos/genéricos, mistura de idiomas, verbosidade redundante.',
    '- "dead code" — console.log, código comentado, import não usado.',
    '- "estrutura" — organização de pastas, arquivos soltos.',
    '- "react" / "estado" / "componentização" — específicas de React.',
    '- "tratamento de erro" — try/catch ausente, .catch ausente, res.ok não checado.',
    '- "loading state" / "error state" / "empty state" — UX do fetch.',
    '- "validação" — input sem validar (back-end ou form).',
    '- "README" — qualquer item da rubrica de README.',
    '- "assets" — favicon, imagens locais, fontes self-hosted (path quebrado, etc).',
    '- "polimento" — qualquer outra coisa de baixa relevância. Use livremente quando nada acima encaixa, em vez de forçar área errada.',
  ].join('\n');
}

// ---------- Pass 1: Enumerator ----------
// O enumerator é EXAUSTIVO: passa pelos arquivos linha-por-linha e lista
// todo issue que vê, sem filtrar por relevância nem formatar bonito. Output
// alimenta o Pass 2 (writer) que então transforma cada issue em improvement
// formatado com tom + codeSnippet + proposedFix.

const EnumerationSchema = z.object({
  fileIssues: z.array(
    z.object({
      file: z.string().min(1),
      issues: z.array(z.string().min(1)),
    })
  ),
  projectIssues: z.array(z.string().min(1)),
});
type EnumerationResult = z.infer<typeof EnumerationSchema>;

function buildEnumeratorSystem(): string {
  return [
    'Você é um auditor sênior de projetos DevQuest. Sua função é EXAUSTIVA: lista TODOS os issues que vê em cada arquivo, sem filtrar por relevância, sem formatar bonito.',
    '',
    'Como trabalhar:',
    '- Pra CADA arquivo de código (ignora package.json, package-lock, tsconfig*.json, .gitignore, vite.config, eslint.config), examina linha por linha.',
    '- Pra cada coisa que poderia melhorar — POR PEQUENA QUE SEJA — adiciona à lista do arquivo.',
    '- Inclui issues triviais E grandes. O FILTRO É DEPOIS. O objetivo aqui é não deixar nada passar.',
    '- Use número de linha sempre (do contexto numerado). Cite o trecho específico ou nome de função/variável.',
    '- BARRA PEDAGÓGICA: você é auditor de aluno aprendendo, não code reviewer de produção. Apontar coisa pequena é OK — o aluno aprende com cada apontamento.',
    '',
    'Categorias possíveis (orientação, não exaustivo):',
    '- README: instalação, execução, exemplo de uso, screenshot/deploy, .env.example, tech stack',
    '- Naming: nomes curtos/genéricos (x, data, arr, temp), funções vagas (handle, doStuff), mistura PT/EN, verbosidade (listaDe..., arrayDe...)',
    '- Dead code: console.log, código comentado, imports não usados, função declarada mas nunca chamada',
    '- Segurança: .env commitado, API key hardcoded, SQL injection',
    '- Estrutura: tudo na raiz, arquivo solto, falta separação',
    '- HTML: semântica (só div, sem header/main/section), h1 múltiplo ou ausente',
    '- Acessibilidade: img sem alt, button sem texto/aria-label, form sem label, contraste',
    '- Responsividade: sem media query, px fixo, falta unidade flexível',
    '- React: useEffect com array errado, key={index}, componente gigante (100+ linhas), lógica que devia ser custom hook',
    '- Estado: useState múltiplo (3+ que mudam juntos)',
    '- Error handling: try/catch ausente, .catch ausente, res.ok não checado',
    '- Loading state: tela em branco durante fetch',
    '- Error state: catch vazio ou só console.error',
    '- Empty state: array vazio sem mensagem',
    '- TypeScript: any, sem return type, types fracos',
    '- Validação backend: req.body sem validar',
    '- Status code: tudo retorna 200',
    '- Async: await esquecido',
    '',
    'REGRA: nunca invente. Cada issue tem que apontar pra trecho REAL do código. Se não tem certeza, não inclui.',
    '',
    'PROIBIDO ENUMERAR: "falta comentário", "código sem comentário explicativo", "adicionar comentário pra esclarecer", ou qualquer variação. Comentário no código NÃO é boa prática nessa rubrica — código limpo se explica por nome de variável/função e estrutura. Se você sente que falta comentário, o problema real é nome ruim, função fazendo coisa demais ou lógica obscura — enumera ESSE problema, não o sintoma "falta comentário".',
    '',
    'PROIBIDO ENUMERAR (cobrança INAPLICÁVEL ao stack):',
    '- O contexto te entrega um bloco "PERFIL DETECTADO DO PROJETO". USE esse perfil pra filtrar o que vale cobrar.',
    '- Se o perfil diz "Tem dependências node? NÃO" → NÃO enumera "falta npm install no README", "falta como instalar dependências", etc. Não tem o que instalar.',
    '- Se o perfil diz "Usa variáveis de ambiente? NÃO" → NÃO enumera "falta .env.example", "criar arquivo .env", "documentar variáveis de ambiente", etc. O projeto não usa env.',
    '- Se o perfil diz "Stack: static" → NÃO enumera "falta npm run dev/start", "configurar bundler/build", "package.json mal configurado". O projeto roda abrindo o HTML.',
    '- Cobrar artefato que não pertence ao stack é falha de auditoria. Confia no perfil — ele foi derivado de scan real do código (busca por process.env, parse de package.json, etc).',
    '',
    'PROIBIDO ESPECULAR — issue é AFIRMAÇÃO, não pergunta:',
    '- NÃO enumere "verifica se X", "confirma se Y existe", "talvez esteja desatualizado", "pode estar quebrado". Issue só entra se você TEM CERTEZA olhando pro código.',
    '- Path de asset (img, favicon, font local, css/js linkado): o contexto contém a LISTA COMPLETA DE ARQUIVOS DO REPOSITÓRIO. Antes de enumerar "esse arquivo pode não existir", PROCURA na lista. Se existe, não enumera. Se não existe, enumera afirmando: "linha 8 referencia ./images/favicon-32x32.png mas esse arquivo não está no repo".',
    '- Recurso EXTERNO (CDN, link externo, versão de biblioteca de terceiro): NÃO enumere "verifica se a versão é a mais recente", "confirma se o link ainda funciona", etc. Você não tem como saber, e nem o aluno deveria perder tempo investigando isso. Exceção única: versão CLARAMENTE abandonada que dá pra reconhecer pelo número (ex: jQuery 1.x, React 15, Node 12) — aí enumera afirmando.',
    '- REGRA DE OURO: na menor dúvida sobre se um issue é real, NÃO ENUMERA. Lista honesta e curta vale mais que lista cheia com chute. O writer não tem como filtrar o que você inventou.',
    '',
    'PROIBIDO ROTULAR como "segurança" (categoria reservada):',
    '- "segurança" só aparece quando é REALMENTE problema de segurança: chave/token/senha exposta no código, .env commitado, SQL injection (string concat numa query), XSS (innerHTML com dado de usuário não escapado), CORS aberto sem critério, autenticação quebrada, hash fraco em senha.',
    '- Path de favicon, link de CDN, versão de lib externa, asset faltando — NÃO é segurança. Se quiser apontar, usa categoria correta (assets, polimento, README) e severity baixa/média.',
    '- Confunde categoria = aluno acha que tem buraco de segurança quando não tem. Custo de credibilidade alto.',
    '',
    'OUTPUT FORMAT (JSON estrito):',
    '{',
    '  "fileIssues": [',
    '    { "file": "src/App.tsx", "issues": [',
    '      "linha 12: useState múltiplo (filme, loading, error mudam juntos), candidato a useReducer",',
    '      "linha 18: useEffect com [] mas referencia prop \'filter\' que muda",',
    '      "linha 25: nome \'data\' genérico, poderia ser \'films\'"',
    '    ]}',
    '  ],',
    '  "projectIssues": [',
    '    "README falta exemplo de uso da API",',
    '    "Sem .env.example listando variáveis necessárias"',
    '  ]',
    '}',
    '',
    'Retorne SOMENTE esse JSON.',
  ].join('\n');
}

async function enumerateIssues(
  ctx: RepoContext
): Promise<{ enumeration: EnumerationResult; usage: UsageReport }> {
  const system = buildEnumeratorSystem();
  const user = buildFileContextPrompt(ctx);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      // Temperature baixa: enumeração quer ser determinística, não criativa.
      temperature: 0.3,
      max_tokens: 6000,
    }),
    signal: AbortSignal.timeout(OPENAI_ENUMERATOR_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI (enumerator) ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Enumerator não devolveu conteúdo');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[ai-correction:enumerator] JSON parse falhou. Raw:\n', raw);
    throw new Error('Enumerator devolveu JSON inválido');
  }

  const validated = EnumerationSchema.safeParse(parsed);
  if (!validated.success) {
    console.error(
      '[ai-correction:enumerator] Schema falhou:',
      JSON.stringify(validated.error.flatten(), null, 2),
      '\nRaw:',
      JSON.stringify(parsed, null, 2)
    );
    throw new Error('Enumerator devolveu shape inválido');
  }

  return {
    enumeration: validated.data,
    usage: buildUsage(OPENAI_MODEL, data.usage),
  };
}

// ---------- File context (compartilhado entre Pass 1 e Pass 2) ----------

function stackDescription(stack: ProjectProfile['stack']): string {
  switch (stack) {
    case 'static':
      return ' (HTML/CSS/JS puro, sem package.json — não tem dependências, não tem build, não tem .env)';
    case 'next':
      return ' (Next.js — usa npm install + npm run dev)';
    case 'react':
      return ' (React — usa npm install + npm run dev/start)';
    case 'vue':
      return ' (Vue)';
    case 'svelte':
      return ' (Svelte)';
    case 'express':
      return ' (Express — back-end Node)';
    case 'fastify':
      return ' (Fastify — back-end Node)';
    case 'node':
      return ' (Node sem framework reconhecido — verifique scripts)';
    case 'python':
      return ' (Python)';
    case 'unknown':
      return ' (stack não identificado com certeza — use os arquivos pra inferir)';
  }
}

function buildFileContextPrompt(ctx: RepoContext): string {
  const header = [
    `Repositório: ${ctx.owner}/${ctx.repo}`,
    ctx.description ? `Descrição: ${ctx.description}` : null,
    ctx.primaryLanguage ? `Linguagem principal: ${ctx.primaryLanguage}` : null,
    ctx.deployedUrl ? `Deploy: ${ctx.deployedUrl}` : null,
    `Arquivos no repo: ${ctx.totalFilesInRepo} (${ctx.filesFetched} incluídos abaixo, ${ctx.filesSkipped} pulados por serem binário/dependência/lock)`,
    '',
    '--- PERFIL DETECTADO DO PROJETO (use isso pra calibrar suas cobranças) ---',
    `Stack: ${ctx.profile.stack}${stackDescription(ctx.profile.stack)}`,
    `Tem package.json? ${ctx.profile.hasPackageJson ? 'sim' : 'NÃO'}`,
    `Tem dependências node pra instalar? ${ctx.profile.hasNodeDependencies ? 'sim' : 'NÃO'}`,
    `Usa variáveis de ambiente (process.env / import.meta.env / os.environ)? ${
      ctx.profile.usesEnvVars
        ? `sim — encontradas em: ${ctx.profile.envVarSamples.join(', ')}`
        : 'NÃO — nenhum uso real de env detectado no código'
    }`,
    `Comando de instalação aplicável: ${ctx.profile.installCommand ?? 'NENHUM (nada pra instalar)'}`,
    `Comando de execução sugerido: ${ctx.profile.runCommandSuggestion}`,
    '',
    'IMPLICAÇÕES DIRETAS pra cobrança de README:',
    ctx.profile.hasNodeDependencies
      ? '- Pode cobrar instruções de "npm install" no README (tem dependências reais).'
      : '- NÃO cobre "npm install" / "como instalar dependências" — não existe nada pra instalar nesse projeto.',
    ctx.profile.usesEnvVars
      ? `- Pode cobrar .env.example (o código realmente lê env vars em ${ctx.profile.envVarSamples[0]}).`
      : '- NÃO cobre .env.example / "criar variáveis de ambiente" — o projeto NÃO usa env vars no código.',
    ctx.profile.stack === 'static'
      ? '- Projeto static (HTML/CSS/JS puro): comando de execução é abrir index.html — NÃO cobre "npm run dev" / "npm start".'
      : '- Comando de execução cobrável é o do stack detectado (ver acima).',
    '',
    '--- README ---',
    ctx.readme || '(sem README)',
    '',
    '--- ARQUIVOS DO PROJETO (numeração de linha à esquerda) ---',
    '',
  ].filter((l) => l !== null) as string[];

  const fileBlocks = ctx.files.map((f) => {
    const trailing = f.truncated
      ? `\n[arquivo truncado — arquivo original tem ${f.totalLines} linhas]`
      : '';
    return `### ${f.path}\n${numberLines(f.content)}${trailing}`;
  });

  return [...header, ...fileBlocks, '', '--- FIM DOS ARQUIVOS ---'].join('\n');
}

// ---------- Pass 2: Writer ----------

function buildWriterUserPrompt(
  ctx: RepoContext,
  enumeration: EnumerationResult
): string {
  const baseContext = buildFileContextPrompt(ctx);

  const enumerationBlock: string[] = ['', '--- ENUMERAÇÃO DO AUDITOR ---', ''];

  if (enumeration.fileIssues.length === 0 && enumeration.projectIssues.length === 0) {
    enumerationBlock.push('(O auditor não retornou issues — você examina o código diretamente.)');
  } else {
    enumerationBlock.push('Issues por arquivo:');
    enumerationBlock.push('');
    for (const f of enumeration.fileIssues) {
      enumerationBlock.push(`### ${f.file}`);
      for (const issue of f.issues) {
        enumerationBlock.push(`- ${issue}`);
      }
      enumerationBlock.push('');
    }
    if (enumeration.projectIssues.length > 0) {
      enumerationBlock.push('Issues do projeto (estruturais):');
      for (const issue of enumeration.projectIssues) {
        enumerationBlock.push(`- ${issue}`);
      }
      enumerationBlock.push('');
    }
  }

  const footer = [
    '',
    'Agora gera a correção no formato JSON exigido, seguindo a ordem: improvements → strengths → narrativeMd.',
    'Cada issue da enumeração vira 1 improvement (mergear apenas duplicatas exatas — mesmo arquivo + mesma linha + mesma categoria). Use os números de linha do contexto acima.',
  ];

  return [baseContext, ...enumerationBlock, ...footer].join('\n');
}

export interface AIGenerationResult {
  correction: CorrectionDraftInputT;
  model: string;
  promptVersion: string;
  usage: UsageReport;
}

export async function generateCorrectionViaAI(input: {
  githubUrl: string;
  deployedUrl: string | null;
}): Promise<AIGenerationResult> {
  const ctx = await fetchRepoContext(input.githubUrl, input.deployedUrl);

  // Pass 1: Enumerator — lista exaustiva de issues por arquivo, sem filtro.
  // Forçar enumeração explícita resolve o problema do AI ser conservador
  // demais quando tem que decidir "o que vale apontar" + "como formatar"
  // numa única chamada.
  const passOne = await enumerateIssues(ctx);
  const totalEnumeratedIssues =
    passOne.enumeration.fileIssues.reduce((acc, f) => acc + f.issues.length, 0) +
    passOne.enumeration.projectIssues.length;
  console.log(
    `[ai-correction] Pass 1 (enumerator): ${totalEnumeratedIssues} issues em ${passOne.enumeration.fileIssues.length} arquivos + ${passOne.enumeration.projectIssues.length} estruturais`
  );

  // Pass 2: Writer — formata cada issue da enumeração em improvement com tom,
  // codeSnippet e proposedFix. Recebe os arquivos + a enumeração.
  const system = buildSystemPrompt();
  const user = buildWriterUserPrompt(ctx, passOne.enumeration);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 8000,
    }),
    signal: AbortSignal.timeout(OPENAI_WRITER_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI (writer) ${res.status}: ${body}`);
  }

  const data = await res.json();
  const writerUsage = buildUsage(OPENAI_MODEL, data.usage);
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenAI (writer) não devolveu conteúdo');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[ai-correction:writer] JSON parse failed. Raw response:\n', raw);
    throw new Error('OpenAI (writer) devolveu JSON inválido');
  }

  // Normalize AI output before strict validation:
  // - strip improvement.file (plus lineStart/lineEnd/codeSnippet) when codeSnippet
  //   is missing, so a partial citation degrades to a general observation instead
  //   of failing the whole correction.
  const normalized = normalizeAIOutput(parsed);

  const validated = CorrectionDraftInput.safeParse(normalized);
  if (!validated.success) {
    console.error(
      '[ai-correction] Schema validation failed.\nErrors:',
      JSON.stringify(validated.error.flatten(), null, 2),
      '\nRaw AI output:\n',
      JSON.stringify(parsed, null, 2)
    );
    throw new Error(
      `Correção não bate com o schema: ${JSON.stringify(validated.error.flatten())}`
    );
  }

  // Soma usage de Pass 1 (enumerator) + Pass 2 (writer)
  const totalUsage = sumUsage([passOne.usage, writerUsage]);
  console.log(
    `[ai-correction] Pass 2 (writer): ${validated.data.improvements.length} improvements gerados | total tokens: ${totalUsage.tokensIn} in / ${totalUsage.tokensOut} out | total cost: $${totalUsage.costUsd.toFixed(6)}`
  );

  return {
    correction: validated.data,
    model: OPENAI_MODEL,
    promptVersion: PROMPT_VERSION,
    usage: {
      model: OPENAI_MODEL,
      tokensIn: totalUsage.tokensIn,
      tokensOut: totalUsage.tokensOut,
      costUsd: totalUsage.costUsd,
    },
  };
}

/**
 * Clean up AI output so minor omissions don't nuke the whole correction:
 *   - If an improvement has `file` but missing `codeSnippet`, drop the file
 *     reference entirely (graceful degrade to general observation).
 *   - Coerce empty-string optionals to undefined so z.string().min(1) passes.
 */
function normalizeAIOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.improvements)) return raw;

  const cleaned = r.improvements.map((imp) => {
    if (!imp || typeof imp !== 'object') return imp;
    const i = { ...(imp as Record<string, unknown>) };

    // Empty strings → undefined
    for (const k of ['file', 'codeSnippet', 'proposedFix'] as const) {
      if (typeof i[k] === 'string' && (i[k] as string).trim() === '') {
        delete i[k];
      }
    }
    // Coerce line numbers — IA às vezes manda como string ("55") em vez de
    // número (55), o que faz o Zod (.int().positive()) falhar. Aceita number
    // ou string parseável; dropa qualquer outra coisa (NaN, decimal, <= 0).
    for (const k of ['lineStart', 'lineEnd'] as const) {
      const v = i[k];
      if (v === undefined) continue;
      if (v === null) {
        delete i[k];
        continue;
      }
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (Number.isInteger(n) && n > 0) {
        i[k] = n;
      } else {
        delete i[k];
      }
    }

    // codeSnippet sem conteúdo alfanumérico é inútil (ex: "}", ");", "});").
    // Trata como snippet ausente — o prompt ensina a citar o bloco inteiro,
    // mas blindamos contra o caso de a IA desobedecer.
    if (typeof i.codeSnippet === 'string' && !/[A-Za-z0-9]/.test(i.codeSnippet)) {
      delete i.codeSnippet;
    }

    // Arquivos .md (README, etc): improvements ficam TEXT-ONLY na suggestion.
    // Tira codeSnippet + proposedFix porque markdown citado/renderizado dentro
    // de markdown na UI vira bagunça visual (--- vira hr, # vira heading).
    // O bloco "incomplete citation" abaixo então remove file/lineStart/lineEnd
    // em cascata, deixando só a suggestion em texto puro.
    if (typeof i.file === 'string' && i.file.toLowerCase().endsWith('.md')) {
      delete i.proposedFix;
      delete i.codeSnippet;
    }

    // If citation is incomplete (file without codeSnippet or lineStart), strip
    // the whole citation so the suggestion stands on its own.
    if (i.file && (!i.codeSnippet || i.lineStart === undefined)) {
      delete i.file;
      delete i.lineStart;
      delete i.lineEnd;
      delete i.codeSnippet;
    }
    return i;
  });

  return { ...r, improvements: cleaned };
}
