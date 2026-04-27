'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SEVERITY_META, type Severity } from '@/lib/severity';
import { loaderMessage } from '@/lib/loader-messages';
import {
  CODE_PALETTE,
  detectLang,
  highlightCode,
  langFromPath,
  parseMarkdownParts,
} from '@/lib/syntax-highlight';

const ANA_CHAT_URL = 'https://agents.devemdobro.com/chat/ana';

type ImprovementView = {
  area: string;
  severity: Severity;
  suggestion: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  proposedFix?: string;
};

type StatusResponse = {
  id: string;
  status: string;
  githubUrl: string;
  deployedUrl: string | null;
  errorMsg: string | null;
  submittedAt: string;
  correctedAt: string | null;
  correction: {
    grade: string;
    strengths: string[];
    improvements: ImprovementView[];
    narrativeMd: string;
  } | null;
};

const POLL_INTERVAL_MS = 2500;

export function CorrectionLiveView({ submissionId }: { submissionId: string }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [tick, setTick] = useState(0);
  const startRef = useRef<number>(Date.now());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/correcoes/${submissionId}/status`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as StatusResponse;
      setData(json);
    } catch {
      // swallow; we'll retry next tick
    }
  }, [submissionId]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(() => {
      setTick((t) => t + 1);
      fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const elapsed = Date.now() - startRef.current;

  if (!data) {
    return <Loader tick={tick} elapsed={elapsed} repo={null} />;
  }

  if (data.status === 'failed') {
    return <ErrorState repo={data.githubUrl} />;
  }

  if (!data.correction) {
    return <Loader tick={tick} elapsed={elapsed} repo={data.githubUrl} />;
  }

  return (
    <CorrectionView
      submissionId={data.id}
      correction={data.correction}
      githubUrl={data.githubUrl}
      deployedUrl={data.deployedUrl}
    />
  );
}

// ---------------- Loader ----------------

function Loader({
  tick,
  elapsed,
  repo,
}: {
  tick: number;
  elapsed: number;
  repo: string | null;
}) {
  const message = loaderMessage(tick, elapsed);
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div className="flex flex-col items-center gap-8 py-16">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/25" />
        <span className="absolute inset-2 rounded-full bg-emerald-500" />
        <span className="relative h-3 w-3 rounded-full bg-white" />
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-titulo text-xl font-semibold tracking-tight text-emerald-300">
          {message}
        </p>
        <p className="text-[15px] leading-relaxed text-white/65">
          Os agentes da Dobro estão revisando seu código com carinho
        </p>
      </div>

      {repo && (
        <div className="flex flex-col items-center gap-1 text-xs text-white/45">
          <span className="font-mono">{shortRepo(repo)}</span>
          <span className="font-mono">{seconds}s</span>
        </div>
      )}

      <p className="max-w-sm text-center text-[13px] leading-relaxed text-white/50">
        Costuma levar entre 30 e 90 segundos. Pode deixar essa aba aberta que a
        gente te avisa aqui mesmo.
      </p>
    </div>
  );
}

// ---------------- Error ----------------

function ErrorState({ repo }: { repo: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-8 text-center">
      <p className="font-titulo text-lg font-semibold text-red-300">
        Algo travou na correção
      </p>
      <p className="max-w-md text-[15px] leading-relaxed text-white/70">
        A gente não conseguiu processar o repo{' '}
        <span className="font-mono text-[13px] text-white/85">
          {shortRepo(repo)}
        </span>
        . Confere se ele é público e tenta de novo, ou fala com a equipe no
        Discord.
      </p>
      <a
        href="/correcoes/submit"
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 font-titulo text-sm font-bold uppercase tracking-wide text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.55)] transition-all duration-150 hover:bg-emerald-600 active:translate-y-[1px]"
      >
        Tentar outro repo
      </a>
    </div>
  );
}

// ---------------- Correction display ----------------

function CorrectionView({
  submissionId,
  correction,
  githubUrl,
  deployedUrl,
}: {
  submissionId: string;
  correction: NonNullable<StatusResponse['correction']>;
  githubUrl: string;
  deployedUrl: string | null;
}) {
  const gradeNum = Number(correction.grade);
  const gradeColor =
    gradeNum >= 8
      ? 'text-emerald-400'
      : gradeNum >= 6
        ? 'text-amber-300'
        : 'text-red-400';

  const pdfUrl = `/api/correcoes/${submissionId}/pdf`;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-x-8">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Correção pronta
          </span>
          <h1 className="font-titulo text-[2rem] font-bold leading-[1.1] tracking-tight text-white md:text-[2.6rem]">
            {shortRepo(githubUrl)}
          </h1>
          <div className="flex flex-wrap gap-5 text-[14px]">
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-1.5 text-emerald-300 transition-colors hover:text-emerald-200"
            >
              Ver no GitHub
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </a>
            {deployedUrl && (
              <a
                href={deployedUrl}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-1.5 text-emerald-300 transition-colors hover:text-emerald-200"
              >
                Ver deploy
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </a>
            )}
          </div>
        </div>

        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-2 self-start rounded-lg bg-emerald-500 px-5 py-2.5 font-titulo text-sm font-bold uppercase tracking-wide text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.55)] transition-all duration-150 hover:bg-emerald-600 active:translate-y-[1px] md:mt-2"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Baixar PDF
        </a>
      </header>

      {/* Grade */}
      <div>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">
          Nota
        </span>
        <p className={`mt-1 font-titulo text-6xl font-bold leading-none tracking-tight ${gradeColor}`}>
          {gradeNum.toFixed(1)}
          <span className="ml-1 text-2xl font-medium text-white/30">/10</span>
        </p>
      </div>

      {/* Comentário */}
      {correction.narrativeMd && (
        <section className="flex flex-col gap-4">
          <SectionHeader kicker="01" title="Resumo da correção" />
          <div className="whitespace-pre-wrap border-l-2 border-emerald-400/80 pl-5 text-[17px] leading-[1.7] text-white/90">
            {correction.narrativeMd}
          </div>
        </section>
      )}

      {/* Melhorias */}
      <section className="flex flex-col gap-5">
        <SectionHeader
          kicker={correction.narrativeMd ? '02' : '01'}
          title="O que melhorar"
        />
        <ol className="flex flex-col gap-4">
          {correction.improvements.map((imp, i) => {
            const lineRange = formatLineRange(imp.lineStart, imp.lineEnd);
            const severityMeta = SEVERITY_META[imp.severity];
            return (
              <li
                key={i}
                className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-white/35">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-titulo text-[17px] font-semibold tracking-tight text-white">
                    {imp.area}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: severityMeta.hex }}
                    title={severityMeta.description}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: severityMeta.hex }}
                      aria-hidden
                    />
                    {severityMeta.label}
                  </span>
                </div>
                <p className="text-[16px] leading-[1.65] text-white/85">
                  {imp.suggestion}
                </p>

                {imp.file && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline gap-2 font-mono text-[11px]">
                      <span className="font-semibold text-emerald-300">
                        {imp.file}
                      </span>
                      {lineRange && (
                        <span className="text-white/40">· {lineRange}</span>
                      )}
                    </div>
                    {imp.codeSnippet && /[A-Za-z0-9]/.test(imp.codeSnippet) && (
                      <CodeWindow
                        code={imp.codeSnippet}
                        lang={langFromPath(imp.file)}
                        filename={imp.file.split('/').pop() || imp.file}
                      />
                    )}
                  </div>
                )}

                {imp.proposedFix && (
                  <div className="flex flex-col gap-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                      Como ficaria
                    </p>
                    <ProposedFix
                      markdown={imp.proposedFix}
                      fileLang={imp.file ? langFromPath(imp.file) : undefined}
                    />
                  </div>
                )}

                <AnaButton improvement={imp} />
              </li>
            );
          })}
        </ol>
      </section>

      {/* Pontos fortes */}
      {correction.strengths.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeader
            kicker={correction.narrativeMd ? '03' : '02'}
            title="O que ficou bom"
          />
          <ul className="flex flex-col gap-3">
            {correction.strengths.map((s, i) => (
              <li
                key={i}
                className="flex gap-4 text-[16px] leading-[1.6] text-white/90"
              >
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 font-mono text-[12px] font-bold text-emerald-300">
                  +
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AnaClosingNote />

      <a
        href="/correcoes/submit"
        className="mt-4 inline-flex w-fit items-center gap-2 rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/85 transition-all duration-150 hover:border-emerald-400/60 hover:bg-emerald-400/5 hover:text-white active:translate-y-[1px]"
      >
        Corrigir outro desafio
      </a>
    </div>
  );
}

// ---------------- Ana CTAs ----------------

function buildAnaPrompt(imp: ImprovementView): string {
  const lines: string[] = [
    'Recebi essa correção no meu desafio DevQuest e quero entender melhor como aplicar:',
    '',
    `**Área:** ${imp.area}`,
    `**Sugestão do professor:** ${imp.suggestion}`,
  ];

  if (imp.file) {
    const range =
      imp.lineEnd && imp.lineStart && imp.lineEnd !== imp.lineStart
        ? `linhas ${imp.lineStart}–${imp.lineEnd}`
        : imp.lineStart
          ? `linha ${imp.lineStart}`
          : '';
    lines.push('');
    lines.push(`**Arquivo:** \`${imp.file}\`${range ? ` (${range})` : ''}`);

    if (imp.codeSnippet) {
      lines.push('');
      lines.push('**Código atual:**');
      lines.push('```');
      lines.push(imp.codeSnippet);
      lines.push('```');
    }
  }

  if (imp.proposedFix) {
    lines.push('');
    lines.push('**Como o professor sugeriu que ficasse:**');
    lines.push(imp.proposedFix);
  }

  lines.push('');
  lines.push('Pode me explicar melhor o que mudar e como aplicar isso no meu código?');
  return lines.join('\n');
}

function AnaButton({ improvement }: { improvement: ImprovementView }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const copyPrompt = useCallback(async () => {
    const prompt = buildAnaPrompt(improvement);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar pergunta:', err);
    }
  }, [improvement]);

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button
        type="button"
        onClick={copyPrompt}
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold text-white/80 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/[0.08] hover:text-emerald-200"
      >
        {copied ? (
          <>
            Copiado!
            <svg
              className="h-3 w-3 text-emerald-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </>
        ) : (
          <>
            Copiar pergunta
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </>
        )}
      </button>

      <a
        href={ANA_CHAT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.08] px-3 py-1.5 text-[12px] font-semibold text-emerald-300 transition-colors hover:border-emerald-400/70 hover:bg-emerald-500/[0.16] hover:text-emerald-200"
      >
        Pergunte à Ana
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </a>

      <span className="group relative inline-flex">
        <button
          type="button"
          aria-label="Sobre a Ana"
          className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-white/15 bg-white/5 text-[11px] font-semibold text-white/60 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white/90"
        >
          ?
        </button>
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute left-1/2 top-full z-10 mt-2 w-72 -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900 p-3 text-[12px] leading-relaxed text-white/85 opacity-0 shadow-xl transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          Clica em <strong className="text-white">Copiar pergunta</strong> pra
          montar uma mensagem com o contexto da correção. Aí abre a{' '}
          <strong className="text-emerald-300">Ana</strong> e cola (Ctrl+V) —
          ela já vai entender o problema e te ajudar a aplicar.
        </span>
      </span>
    </div>
  );
}

function AnaClosingNote() {
  return (
    <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-6 text-center">
      <p className="text-[15px] leading-relaxed text-white/85">
        E lembre-se: caso precise de ajuda pra aplicar as correções no seu
        desafio,{' '}
        <a
          href={ANA_CHAT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-emerald-300 underline-offset-4 hover:underline"
        >
          a Ana
        </a>{' '}
        está disponível 24/7 pra te ajudar.
      </p>
    </div>
  );
}

// ---------------- Section header ----------------

function SectionHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-400">
        {kicker}
      </span>
      <h2 className="font-titulo text-[22px] font-bold tracking-tight text-white">
        {title}
      </h2>
      <span className="mt-1 block h-[2px] w-6 rounded-full bg-emerald-400" aria-hidden />
    </div>
  );
}

// ---------------- macOS-style code window ----------------

function CodeWindow({
  code,
  lang,
  filename,
}: {
  code: string;
  lang?: string;
  filename: string;
}) {
  const tokens = highlightCode(code, lang);
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] shadow-[0_12px_32px_-16px_rgba(0,0,0,0.7)]">
      <div
        className="flex items-center gap-3 border-b px-4 py-2.5"
        style={{ backgroundColor: CODE_PALETTE.chromeBg, borderColor: 'rgba(255,255,255,0.04)' }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: CODE_PALETTE.traffic.red }}
          />
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: CODE_PALETTE.traffic.yellow }}
          />
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: CODE_PALETTE.traffic.green }}
          />
        </div>
        <p
          className="-mr-[52px] flex-1 truncate text-center font-mono text-[12px]"
          style={{ color: CODE_PALETTE.chromeText }}
        >
          {filename}
        </p>
      </div>
      <pre
        className="overflow-x-auto p-4 font-mono text-[13px] leading-[1.65]"
        style={{ backgroundColor: CODE_PALETTE.bg, color: CODE_PALETTE.default }}
      >
        <code style={{ backgroundColor: 'transparent', color: 'inherit' }}>
          {tokens.map((t, i) => (
            <span key={i} style={{ color: t.color }}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ---------------- Helpers ----------------

function shortRepo(url: string): string {
  return url.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
}

function formatLineRange(start?: number, end?: number): string | null {
  if (start === undefined) return null;
  if (end === undefined || end === start) return `linha ${start}`;
  return `linhas ${start}–${end}`;
}

function ProposedFix({
  markdown,
  fileLang,
}: {
  markdown: string;
  fileLang?: string;
}) {
  const parts = parseMarkdownParts(markdown);
  if (parts.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {parts.map((p, i) => {
        if (p.type === 'text') {
          return (
            <p key={i} className="text-[15px] leading-[1.65] text-white/80">
              {p.content}
            </p>
          );
        }
        const lang = p.lang || detectLang(p.content) || fileLang || 'plain';
        const ext = lang === 'plain' ? 'txt' : lang;
        return (
          <CodeWindow
            key={i}
            code={p.content}
            lang={lang}
            filename={`sugestao.${ext}`}
          />
        );
      })}
    </div>
  );
}
