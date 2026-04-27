/**
 * Lightweight syntax highlighter for PDF code blocks.
 *
 * Returns an array of { color, text } tokens that can be rendered inline.
 * No external deps — handcrafted tokenizers for the languages DevQuest
 * students actually use (HTML/CSS/JS/TS/JSX/TSX/Python/Go/JSON).
 *
 * Not a full parser: it does best-effort recognition of strings, comments,
 * numbers, keywords, function calls and types. Unknown languages render
 * in plain default color. That's fine — PDF code blocks are short.
 */

export type Token = { color: string; text: string };

// Dracula-ish palette — matches the macOS VS Code feel the user asked for.
export const CODE_PALETTE = {
  bg: '#282A36',
  chromeBg: '#1E1F29',
  chromeText: '#6272A4',
  traffic: {
    red: '#FF5F56',
    yellow: '#FFBD2E',
    green: '#27C93F',
  },
  default: '#F8F8F2', // off-white text
  keyword: '#FF79C6', // pink
  string: '#F1FA8C', // yellow
  number: '#BD93F9', // purple
  function: '#50FA7B', // green
  type: '#8BE9FD', // cyan
  comment: '#6272A4', // muted purple
  tag: '#FF79C6', // HTML tag name
  attr: '#50FA7B', // HTML attribute
  property: '#8BE9FD', // CSS property
  punctuation: '#F8F8F2',
};

// ---------- Keyword tables ----------

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new',
  'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await',
  'try', 'catch', 'finally', 'throw', 'true', 'false', 'null', 'undefined',
  'typeof', 'instanceof', 'void', 'yield', 'in', 'of', 'delete',
]);

const TS_KEYWORDS = new Set([
  ...JS_KEYWORDS,
  'type', 'interface', 'enum', 'namespace', 'public', 'private', 'protected',
  'readonly', 'abstract', 'as', 'satisfies', 'implements', 'keyof', 'infer',
  'never', 'any', 'unknown', 'string', 'number', 'boolean', 'symbol',
  'declare', 'is',
]);

const PY_KEYWORDS = new Set([
  'def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import',
  'from', 'as', 'pass', 'break', 'continue', 'True', 'False', 'None', 'and',
  'or', 'not', 'in', 'is', 'lambda', 'async', 'await', 'try', 'except',
  'finally', 'raise', 'with', 'yield', 'global', 'nonlocal', 'del', 'self',
]);

const GO_KEYWORDS = new Set([
  'package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface',
  'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'return',
  'break', 'continue', 'go', 'defer', 'chan', 'select', 'map', 'true',
  'false', 'nil',
]);

// ---------- Tokenizers ----------

interface CLikeOpts {
  lineComment?: string;          // e.g. '//' or '#'
  blockComment?: [string, string]; // e.g. ['/*', '*/']
}

function tokenizeCLike(
  code: string,
  keywords: Set<string>,
  opts: CLikeOpts
): Token[] {
  const tokens: Token[] = [];
  const n = code.length;
  let i = 0;
  let buf = '';

  const flushDefault = () => {
    if (buf) {
      tokens.push({ color: CODE_PALETTE.default, text: buf });
      buf = '';
    }
  };

  while (i < n) {
    const rest2 = code.slice(i, i + 2);

    // Line comment
    if (opts.lineComment && code.startsWith(opts.lineComment, i)) {
      flushDefault();
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      tokens.push({ color: CODE_PALETTE.comment, text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Block comment
    if (opts.blockComment && rest2 === opts.blockComment[0]) {
      flushDefault();
      const end = code.indexOf(opts.blockComment[1], i + 2);
      const stop = end === -1 ? n : end + opts.blockComment[1].length;
      tokens.push({ color: CODE_PALETTE.comment, text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // String
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      flushDefault();
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === quote) { j++; break; }
        j++;
      }
      tokens.push({ color: CODE_PALETTE.string, text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Number (only at identifier boundary)
    if (/[0-9]/.test(ch) && !/[a-zA-Z_$]/.test(code[i - 1] || '')) {
      flushDefault();
      let j = i;
      while (j < n && /[0-9.xXeE_a-fA-F]/.test(code[j])) j++;
      tokens.push({ color: CODE_PALETTE.number, text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Identifier
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);

      // Look ahead past whitespace for a `(`
      let k = j;
      while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;

      if (keywords.has(word)) {
        flushDefault();
        tokens.push({ color: CODE_PALETTE.keyword, text: word });
      } else if (/^[A-Z]/.test(word) && word.length > 1) {
        flushDefault();
        tokens.push({ color: CODE_PALETTE.type, text: word });
      } else if (code[k] === '(') {
        flushDefault();
        tokens.push({ color: CODE_PALETTE.function, text: word });
      } else {
        buf += word;
      }
      i = j;
      continue;
    }

    // Anything else → default
    buf += ch;
    i++;
  }
  flushDefault();
  return tokens;
}

function tokenizeHTML(code: string): Token[] {
  const tokens: Token[] = [];
  const n = code.length;
  let i = 0;

  while (i < n) {
    // Comment
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      tokens.push({ color: CODE_PALETTE.comment, text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // Doctype / processing instruction — treat as tag
    if (code[i] === '<' && (code[i + 1] === '!' || code[i + 1] === '?')) {
      let j = i;
      while (j < n && code[j] !== '>') j++;
      if (j < n) j++;
      tokens.push({ color: CODE_PALETTE.tag, text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Regular tag
    if (code[i] === '<') {
      let j = i + 1;
      if (code[j] === '/') j++;
      while (j < n && /[a-zA-Z0-9_:-]/.test(code[j])) j++;
      tokens.push({ color: CODE_PALETTE.tag, text: code.slice(i, j) });

      // Inside the tag: attrs, whitespace, self-close, closing >
      while (j < n && code[j] !== '>') {
        // Whitespace
        if (/\s/.test(code[j])) {
          let k = j;
          while (k < n && /\s/.test(code[k])) k++;
          tokens.push({ color: CODE_PALETTE.default, text: code.slice(j, k) });
          j = k;
          continue;
        }
        // Attribute name
        if (/[a-zA-Z_@:]/.test(code[j])) {
          let k = j;
          while (k < n && /[a-zA-Z0-9_:-]/.test(code[k])) k++;
          tokens.push({ color: CODE_PALETTE.attr, text: code.slice(j, k) });
          j = k;
          // Optional =value
          if (code[j] === '=') {
            tokens.push({ color: CODE_PALETTE.punctuation, text: '=' });
            j++;
            if (code[j] === '"' || code[j] === "'") {
              const quote = code[j];
              const strEnd = code.indexOf(quote, j + 1);
              const strStop = strEnd === -1 ? n : strEnd + 1;
              tokens.push({
                color: CODE_PALETTE.string,
                text: code.slice(j, strStop),
              });
              j = strStop;
            } else {
              // unquoted value
              let k2 = j;
              while (k2 < n && !/[\s>]/.test(code[k2])) k2++;
              tokens.push({ color: CODE_PALETTE.string, text: code.slice(j, k2) });
              j = k2;
            }
          }
          continue;
        }
        // self-closing / or other punctuation
        tokens.push({ color: CODE_PALETTE.tag, text: code[j] });
        j++;
      }
      if (j < n && code[j] === '>') {
        tokens.push({ color: CODE_PALETTE.tag, text: '>' });
        j++;
      }
      i = j;
      continue;
    }

    // Text content — accumulate until next <
    let j = i;
    while (j < n && code[j] !== '<') j++;
    if (j > i) tokens.push({ color: CODE_PALETTE.default, text: code.slice(i, j) });
    i = j;
  }
  return tokens;
}

function tokenizeCSS(code: string): Token[] {
  const tokens: Token[] = [];
  const n = code.length;
  let i = 0;
  let inBlock = false;
  let buf = '';

  const flush = (color: string) => {
    if (buf) {
      tokens.push({ color, text: buf });
      buf = '';
    }
  };

  while (i < n) {
    // Block comment
    if (code[i] === '/' && code[i + 1] === '*') {
      flush(inBlock ? CODE_PALETTE.default : CODE_PALETTE.keyword);
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      tokens.push({ color: CODE_PALETTE.comment, text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    // String
    if (code[i] === '"' || code[i] === "'") {
      flush(inBlock ? CODE_PALETTE.default : CODE_PALETTE.keyword);
      const quote = code[i];
      const end = code.indexOf(quote, i + 1);
      const stop = end === -1 ? n : end + 1;
      tokens.push({ color: CODE_PALETTE.string, text: code.slice(i, stop) });
      i = stop;
      continue;
    }

    if (code[i] === '{') {
      flush(CODE_PALETTE.keyword);
      tokens.push({ color: CODE_PALETTE.punctuation, text: '{' });
      inBlock = true;
      i++;
      continue;
    }
    if (code[i] === '}') {
      flush(CODE_PALETTE.default);
      tokens.push({ color: CODE_PALETTE.punctuation, text: '}' });
      inBlock = false;
      i++;
      continue;
    }

    // Property inside block: ident followed by :
    if (inBlock && /[a-zA-Z-]/.test(code[i])) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_-]/.test(code[j])) j++;
      let k = j;
      while (k < n && /\s/.test(code[k])) k++;
      if (code[k] === ':') {
        flush(CODE_PALETTE.default);
        tokens.push({ color: CODE_PALETTE.property, text: code.slice(i, j) });
        i = j;
        continue;
      }
    }

    // Number inside block
    if (inBlock && /[0-9]/.test(code[i]) && !/[a-zA-Z_]/.test(code[i - 1] || '')) {
      flush(CODE_PALETTE.default);
      let j = i;
      while (j < n && /[0-9.a-zA-Z%]/.test(code[j])) j++;
      tokens.push({ color: CODE_PALETTE.number, text: code.slice(i, j) });
      i = j;
      continue;
    }

    buf += code[i];
    i++;
  }
  flush(inBlock ? CODE_PALETTE.default : CODE_PALETTE.keyword);
  return tokens;
}

// ---------- Public API ----------

/**
 * Tokenize `code` for syntax highlighting. Returns one Token per colored run.
 * `lang` is matched case-insensitively; falls back to plain for unknown langs.
 */
export function highlightCode(code: string, lang?: string): Token[] {
  const l = (lang || '').toLowerCase();

  if (['html', 'xml', 'svg', 'htm'].includes(l)) return tokenizeHTML(code);
  if (['css', 'scss', 'sass', 'less'].includes(l)) return tokenizeCSS(code);
  if (['js', 'jsx', 'javascript', 'mjs', 'cjs', 'json'].includes(l)) {
    return tokenizeCLike(code, JS_KEYWORDS, {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    });
  }
  if (['ts', 'tsx', 'typescript'].includes(l)) {
    return tokenizeCLike(code, TS_KEYWORDS, {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    });
  }
  if (['py', 'python'].includes(l)) {
    return tokenizeCLike(code, PY_KEYWORDS, { lineComment: '#' });
  }
  if (['go', 'golang'].includes(l)) {
    return tokenizeCLike(code, GO_KEYWORDS, {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    });
  }

  return [{ color: CODE_PALETTE.default, text: code }];
}

/**
 * Best-effort language detection from code content. Use when the AI skips the
 * fence language on proposedFix. Checks the first ~500 chars for strong
 * signals unique to each language. Returns '' if nothing matches, so callers
 * can chain with other fallbacks.
 */
export function detectLang(code: string): string {
  const s = code.slice(0, 500);

  // HTML — doctype or common tags
  if (/<!DOCTYPE/i.test(s)) return 'html';
  if (/<\/?(html|head|body|div|span|section|article|nav|header|footer|main|p|a|img|ul|ol|li|h[1-6]|form|input|button|label|table|tr|td|thead|tbody)\b/i.test(s)) {
    return 'html';
  }

  // CSS — selector block with `prop: value;` or at-rule
  if (/^\s*@(media|keyframes|import|font-face|supports|charset)/m.test(s)) return 'css';
  if (/[.#]?[\w-]+\s*\{[^}]*[\w-]+\s*:\s*[^;{}]+;/.test(s)) return 'css';

  // TypeScript markers (must come before JS)
  if (/\b(interface\s+\w+|type\s+\w+\s*=|enum\s+\w+|:\s*(string|number|boolean|void|any|unknown)\b)/.test(s)) {
    return 'ts';
  }

  // JavaScript / JSX
  if (/\b(const|let|var|function|=>|import\s+.*from|export\s+(default|const|function|class))\b/.test(s)) {
    return 'js';
  }

  // Python
  if (/^\s*(def|class)\s+\w+.*:\s*$/m.test(s)) return 'py';
  if (/^\s*(import|from)\s+\w+/m.test(s)) return 'py';

  // Go
  if (/^\s*package\s+\w+/m.test(s)) return 'go';
  if (/\bfunc\s+\w+\s*\(/.test(s) && /\bpackage\b/.test(s)) return 'go';

  return '';
}

/**
 * Parse a markdown-ish string into ordered code/text parts.
 *
 * Tolerant of AI output quirks: accepts fences with or without leading/trailing
 * newlines, spaces around the lang identifier, and single-line fences. When no
 * fence is found, treats the whole string as a single plain code block (AI
 * skipped the fence entirely) and lets the caller fall back to detectLang or
 * fileLang. This function powers both the PDF renderer and the web viewer so
 * both formats interpret `proposedFix` identically.
 */
export type MarkdownPart =
  | { type: 'code'; lang?: string; content: string }
  | { type: 'text'; content: string };

export function parseMarkdownParts(markdown: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const fenceRe = /```[ \t]*([\w+-]+)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(markdown)) !== null) {
    if (m.index > lastIdx) {
      const text = markdown.slice(lastIdx, m.index).trim();
      if (text) parts.push({ type: 'text', content: text });
    }
    const code = m[2].replace(/^\r?\n+|\r?\n+$/g, '');
    if (code.trim()) {
      parts.push({ type: 'code', lang: m[1]?.toLowerCase() || undefined, content: code });
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < markdown.length) {
    const tail = markdown.slice(lastIdx).trim();
    if (tail) parts.push({ type: 'text', content: tail });
  }

  // No fence matched — AI skipped the fence and delivered raw code. Strip any
  // stray ``` markers and treat the whole payload as one code block.
  const hasCode = parts.some((p) => p.type === 'code');
  if (!hasCode) {
    const plain = markdown
      .replace(/^```[ \t]*[\w+-]*[ \t]*\r?\n?/, '')
      .replace(/\r?\n?```\s*$/, '')
      .trim();
    if (plain) return [{ type: 'code', content: plain }];
    return [];
  }

  return parts;
}

/**
 * Extract only the code blocks from a markdown string. Convenience wrapper
 * over parseMarkdownParts for callers that don't care about interleaved text.
 */
export function extractCodeBlocks(
  markdown: string
): { lang?: string; code: string }[] {
  return parseMarkdownParts(markdown)
    .filter((p): p is Extract<MarkdownPart, { type: 'code' }> => p.type === 'code')
    .map((p) => ({ lang: p.lang, code: p.content }));
}

/**
 * Guess a language id from a file path (for codeSnippet when we only have
 * the file name, not an explicit fence). Returns 'plain' for unknown extensions.
 */
export function langFromPath(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const map: Record<string, string> = {
    html: 'html', htm: 'html', xml: 'xml', svg: 'svg',
    css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx',
    ts: 'ts', tsx: 'tsx',
    py: 'py',
    go: 'go',
    json: 'json',
    md: 'plain', yml: 'plain', yaml: 'plain', toml: 'plain',
  };
  return map[ext] || 'plain';
}
