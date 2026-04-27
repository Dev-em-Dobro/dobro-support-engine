'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Correction } from '@/drizzle/schema';
import { SEVERITY_META, SEVERITY_ORDER, type Severity } from '@/lib/severity';

type Improvement = {
  area: string;
  severity: Severity;
  suggestion: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  proposedFix?: string;
};

type ReviewIssue = {
  severity: 'minor' | 'major' | 'blocker';
  category: string;
  message: string;
};

type ReviewBlock = {
  stage: 'preview' | 'approve';
  summary: string;
  score: number;
  issues: ReviewIssue[];
};

const ISSUE_STYLE: Record<ReviewIssue['severity'], { label: string; dot: string; text: string }> = {
  blocker: { label: 'Bloqueio', dot: 'bg-red-500', text: 'text-red-300' },
  major: { label: 'Importante', dot: 'bg-amber-500', text: 'text-amber-300' },
  minor: { label: 'Menor', dot: 'bg-sky-500', text: 'text-sky-300' },
};

const SEVERITY_DOT: Record<Severity, string> = {
  low: 'bg-sky-400',
  medium: 'bg-amber-400',
  high: 'bg-red-500',
};

function emptyImprovement(): Improvement {
  return { area: '', severity: 'medium', suggestion: '' };
}

function toNumberOrUndefined(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function Sparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M5 12H1" />
      <path d="M23 12h-4" />
      <path d="m18.36 5.64-2.83 2.83" />
      <path d="m8.47 15.53-2.83 2.83" />
      <path d="m5.64 5.64 2.83 2.83" />
      <path d="m15.53 15.53 2.83 2.83" />
    </svg>
  );
}

function Plus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function Trash() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function SectionHeader({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <header className="flex items-baseline gap-4">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-dobro-laranja/80">
        {String(n).padStart(2, '0')}
      </span>
      <div className="flex flex-1 items-baseline gap-3">
        <h3 className="font-titulo text-base font-semibold tracking-tight text-white">
          {title}
        </h3>
        {hint && <span className="text-xs text-white/40">{hint}</span>}
      </div>
    </header>
  );
}

export function CorrectionEditor({
  submissionId,
  submissionStatus,
  correction,
}: {
  submissionId: string;
  submissionStatus: string;
  correction: Correction | null;
}) {
  const router = useRouter();
  const [grade, setGrade] = useState<string>(
    correction ? String(correction.grade) : '7.0'
  );
  const [strengthsText, setStrengthsText] = useState<string>(
    correction ? correction.strengths.join('\n') : ''
  );
  const [narrativeMd, setNarrativeMd] = useState<string>(
    correction?.narrativeMd || ''
  );
  const [improvements, setImprovements] = useState<Improvement[]>(
    correction?.improvements && correction.improvements.length > 0
      ? (correction.improvements as Improvement[])
      : [emptyImprovement()]
  );
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewBlock | null>(null);

  function updateImprovement(idx: number, patch: Partial<Improvement>) {
    setImprovements((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  async function generateAI() {
    if (
      correction &&
      !confirm('Já existe uma correção. Gerar nova com IA vai sobrescrever o rascunho. Continuar?')
    ) {
      return;
    }
    setAiLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/monitor/submissions/${submissionId}/ai-generate`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || 'Falha na geração');
        setAiLoading(false);
        return;
      }
      router.refresh();
      setAiLoading(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      setAiLoading(false);
    }
  }

  function buildPayload() {
    return {
      grade: Number(grade),
      strengths: strengthsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      improvements: improvements
        .filter((i) => i.area && i.suggestion)
        .map((i) => ({
          area: i.area,
          severity: i.severity,
          suggestion: i.suggestion,
          ...(i.file ? { file: i.file } : {}),
          ...(i.lineStart !== undefined ? { lineStart: i.lineStart } : {}),
          ...(i.lineEnd !== undefined ? { lineEnd: i.lineEnd } : {}),
          ...(i.codeSnippet ? { codeSnippet: i.codeSnippet } : {}),
          ...(i.proposedFix ? { proposedFix: i.proposedFix } : {}),
        })),
      narrativeMd,
    };
  }

  async function save(
    next: 'draft' | 'approve' | 'reject' | 'regenerate',
    opts: { force?: boolean } = {}
  ): Promise<boolean> {
    setSaving(true);
    setErr(null);
    const qs = opts.force ? '?force=1' : '';
    try {
      const res = await fetch(
        `/api/monitor/submissions/${submissionId}/${next}${qs}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        }
      );
      if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        if (data.review) {
          setReview({
            stage: 'approve',
            summary: data.review.summary,
            score: data.review.score,
            issues: data.review.issues || [],
          });
        } else {
          setErr(data.error || 'Revisão bloqueou a entrega');
        }
        setSaving(false);
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || 'Falha ao salvar');
        setSaving(false);
        return false;
      }
      setReview(null);
      router.refresh();
      setSaving(false);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      setSaving(false);
      return false;
    }
  }

  async function previewPdf(force = false) {
    setPreviewLoading(true);
    setErr(null);
    const saved = await save('draft');
    if (!saved) {
      setPreviewLoading(false);
      return;
    }
    const qs = force ? '?force=1' : '';
    try {
      const res = await fetch(
        `/api/monitor/submissions/${submissionId}/pdf-preview${qs}`,
        { method: 'GET' }
      );
      if (res.status === 422) {
        const data = await res.json().catch(() => ({}));
        if (data.review) {
          setReview({
            stage: 'preview',
            summary: data.review.summary,
            score: data.review.score,
            issues: data.review.issues || [],
          });
        } else {
          setErr(data.error || 'Revisão bloqueou a prévia');
        }
        setPreviewLoading(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || 'Falha ao gerar prévia');
        setPreviewLoading(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setReview(null);
      setPreviewLoading(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro desconhecido');
      setPreviewLoading(false);
    }
  }

  function handleForceFromReview() {
    if (!review) return;
    if (review.stage === 'preview') {
      previewPdf(true);
    } else {
      save('approve', { force: true });
    }
  }

  const readOnly = submissionStatus === 'delivered';
  const canApprove = ['queued', 'processing', 'draft', 'rejected'].includes(submissionStatus);
  const gradeNum = Number(grade);
  const gradeColor =
    gradeNum >= 8 ? 'text-emerald-400'
    : gradeNum >= 6 ? 'text-dobro-laranja'
    : 'text-red-400';

  return (
    <section className="editor-surface overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.015]">
      {/* Command bar */}
      <div className="flex flex-col gap-4 border-b border-white/[0.06] px-6 py-5 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
              {correction ? 'Editando' : 'Nova correção'}
            </p>
            <h2 className="mt-1 font-titulo text-xl font-semibold tracking-tight text-white">
              {correction ? 'Ajustar devolutiva' : 'Compor devolutiva'}
            </h2>
          </div>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={generateAI}
            disabled={aiLoading || saving}
            className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-lg bg-dobro-laranja px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(255,107,53,0.6)] transition-all duration-150 hover:bg-dobro-laranja/90 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {aiLoading && (
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent animate-[shimmer_1.4s_infinite]"
              />
            )}
            <Sparkle />
            <span className="relative">
              {aiLoading ? 'Gerando com IA…' : correction ? 'Regerar com IA' : 'Gerar com IA'}
            </span>
          </button>
        )}
      </div>

      {/* Grade hero */}
      <div className="grid gap-6 border-b border-white/[0.06] px-6 py-7 md:grid-cols-[1fr_auto] md:items-end md:px-8">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
            Nota final
          </p>
          <p className="max-w-[50ch] text-sm leading-relaxed text-white/55">
            De 0 a 10, em passos de 0.5 — considere estrutura, semântica, acessibilidade e execução.
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            disabled={readOnly}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className={`w-24 bg-transparent font-mono text-5xl font-bold tracking-tight outline-none transition-colors ${gradeColor} disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            aria-label="Nota"
          />
          <span className="font-mono text-xl text-white/30">/ 10</span>
        </div>
      </div>

      <div className="flex flex-col gap-10 px-6 py-8 md:px-8 md:py-10">
        {/* 1. Pontos a melhorar */}
        <fieldset className="flex flex-col gap-5">
          <SectionHeader n={1} title="Pontos a melhorar" hint={`${improvements.length} item(s)`} />

          <div className="flex flex-col gap-3">
            {improvements.map((imp, i) => (
              <article
                key={i}
                className="group relative flex flex-col gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 transition-colors hover:border-white/[0.12]"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-md border border-white/10 font-mono text-xs font-semibold text-white/70">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <input
                    disabled={readOnly}
                    placeholder="Área — ex: acessibilidade, performance, semântica"
                    value={imp.area}
                    onChange={(e) => updateImprovement(i, { area: e.target.value })}
                    className="flex-1 border-0 border-b border-transparent bg-transparent px-0 py-1 text-sm font-medium text-white placeholder:text-white/30 focus:border-dobro-laranja/60 focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] px-2 py-1 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[imp.severity]}`} aria-hidden />
                    <select
                      disabled={readOnly}
                      value={imp.severity}
                      onChange={(e) =>
                        updateImprovement(i, { severity: e.target.value as Severity })
                      }
                      title={SEVERITY_META[imp.severity].description}
                      className="border-0 bg-transparent py-0 pr-1 text-xs font-medium text-white/80 focus:outline-none"
                    >
                      {SEVERITY_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {SEVERITY_META[s].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        setImprovements(improvements.filter((_, idx) => idx !== i))
                      }
                      className="grid h-7 w-7 place-items-center rounded-md border border-transparent text-white/30 transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Remover item ${i + 1}`}
                    >
                      <Trash />
                    </button>
                  )}
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                    Sugestão
                  </span>
                  <textarea
                    rows={2}
                    disabled={readOnly}
                    placeholder="Descreva o que o aluno pode melhorar e por quê."
                    value={imp.suggestion}
                    onChange={(e) => updateImprovement(i, { suggestion: e.target.value })}
                    className="resize-y rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-white/90 placeholder:text-white/30 focus:border-dobro-laranja/50 focus:outline-none"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                      Arquivo
                    </span>
                    <input
                      disabled={readOnly}
                      placeholder="src/App.jsx"
                      value={imp.file ?? ''}
                      onChange={(e) => updateImprovement(i, { file: e.target.value || undefined })}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-xs text-white/85 placeholder:text-white/25 focus:border-dobro-laranja/50 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                      Linha início
                    </span>
                    <input
                      disabled={readOnly}
                      type="number"
                      min={1}
                      value={imp.lineStart ?? ''}
                      onChange={(e) =>
                        updateImprovement(i, { lineStart: toNumberOrUndefined(e.target.value) })
                      }
                      className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-xs text-white/85 focus:border-dobro-laranja/50 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                      Linha fim
                    </span>
                    <input
                      disabled={readOnly}
                      type="number"
                      min={1}
                      value={imp.lineEnd ?? ''}
                      onChange={(e) =>
                        updateImprovement(i, { lineEnd: toNumberOrUndefined(e.target.value) })
                      }
                      className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-xs text-white/85 focus:border-dobro-laranja/50 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                      Código citado <span className="text-white/25">(literal)</span>
                    </span>
                    <textarea
                      rows={4}
                      disabled={readOnly}
                      placeholder={`<div class="btn">Clique aqui</div>`}
                      value={imp.codeSnippet ?? ''}
                      onChange={(e) =>
                        updateImprovement(i, { codeSnippet: e.target.value || undefined })
                      }
                      className="resize-y rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 py-2 font-mono text-[12px] leading-relaxed text-white/85 placeholder:text-white/20 focus:border-dobro-laranja/50 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
                      Correção sugerida <span className="text-white/25">(```linguagem)</span>
                    </span>
                    <textarea
                      rows={4}
                      disabled={readOnly}
                      placeholder={'```html\n<button aria-label="Entrar">Clique aqui</button>\n```'}
                      value={imp.proposedFix ?? ''}
                      onChange={(e) =>
                        updateImprovement(i, { proposedFix: e.target.value || undefined })
                      }
                      className="resize-y rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 py-2 font-mono text-[12px] leading-relaxed text-white/85 placeholder:text-white/20 focus:border-dobro-laranja/50 focus:outline-none"
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={() => setImprovements([...improvements, emptyImprovement()])}
              className="group inline-flex w-fit items-center gap-2 rounded-lg border border-dashed border-white/15 px-4 py-2 text-xs font-medium text-white/60 transition-all duration-150 hover:border-dobro-laranja/40 hover:bg-dobro-laranja/5 hover:text-white active:translate-y-[1px]"
            >
              <Plus />
              Adicionar ponto de melhoria
            </button>
          )}
        </fieldset>

        {/* 2. Strengths */}
        <fieldset className="flex flex-col gap-3">
          <SectionHeader n={2} title="O que ficou bom" hint="um item por linha" />
          <textarea
            rows={4}
            disabled={readOnly}
            value={strengthsText}
            onChange={(e) => setStrengthsText(e.target.value)}
            placeholder={`Estrutura HTML semântica em index.html\nCSS responsivo no mobile`}
            className="resize-y rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-white/90 placeholder:text-white/30 focus:border-dobro-laranja/50 focus:outline-none"
          />
        </fieldset>

        {/* 3. Narrative */}
        <fieldset className="flex flex-col gap-3">
          <SectionHeader n={3} title="Feedback narrativo" hint="intro + fechamento · 80–200 palavras" />
          <textarea
            rows={7}
            disabled={readOnly}
            value={narrativeMd}
            onChange={(e) => setNarrativeMd(e.target.value)}
            placeholder="Mano, curti o que você fez aqui…"
            className="resize-y rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 font-mono text-[13px] leading-relaxed text-white/90 placeholder:text-white/30 focus:border-dobro-laranja/50 focus:outline-none"
          />
        </fieldset>

        {err && (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">
            <span className="mt-0.5 text-red-400"><AlertIcon /></span>
            <p className="leading-relaxed">{err}</p>
          </div>
        )}

        {review && (
          <div className="flex flex-col gap-4 rounded-xl border border-red-500/30 bg-red-500/[0.05] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-red-500/20 text-red-300">
                  <AlertIcon />
                </span>
                <div>
                  <p className="text-sm font-semibold text-red-200">
                    Revisão bloqueou a {review.stage === 'preview' ? 'prévia' : 'entrega'}
                  </p>
                  <p className="font-mono text-[11px] text-red-200/60">
                    nota da revisão · <strong className="text-red-200/80">{review.score.toFixed(1)}/10</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReview(null)}
                className="text-xs font-medium text-red-200/60 transition-colors hover:text-red-200"
              >
                fechar
              </button>
            </div>
            <p className="text-sm leading-relaxed text-red-100/90">{review.summary}</p>
            {review.issues.length > 0 && (
              <ul className="flex flex-col divide-y divide-red-500/15 overflow-hidden rounded-lg border border-red-500/20 bg-white/[0.02]">
                {review.issues.map((issue, i) => (
                  <li key={i} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${ISSUE_STYLE[issue.severity].dot}`} aria-hidden />
                      <span className={`text-[11px] font-medium uppercase tracking-wider ${ISSUE_STYLE[issue.severity].text}`}>
                        {ISSUE_STYLE[issue.severity].label}
                      </span>
                      <span className="font-mono text-[11px] text-white/40">
                        {issue.category}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-white/80">{issue.message}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setReview(null)}
                className="rounded-lg border border-red-500/30 bg-transparent px-4 py-2 text-xs font-medium text-red-200 transition-all duration-150 hover:bg-red-500/10 active:translate-y-[1px]"
              >
                Corrigir
              </button>
              <button
                type="button"
                onClick={handleForceFromReview}
                disabled={saving || previewLoading}
                className="rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white transition-all duration-150 hover:bg-red-600 active:translate-y-[1px] disabled:opacity-50"
              >
                {review.stage === 'preview' ? 'Forçar prévia' : 'Entregar mesmo assim'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action bar */}
      {!readOnly && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-white/[0.08] bg-[#0f1218]/90 px-6 py-4 backdrop-blur-md md:px-8">
          <button
            type="button"
            disabled={saving}
            onClick={() => save('draft')}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/80 transition-all duration-150 hover:border-white/30 hover:bg-white/[0.04] hover:text-white active:translate-y-[1px] disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar rascunho'}
          </button>
          <button
            type="button"
            disabled={saving || previewLoading}
            onClick={() => previewPdf()}
            title="Salva o rascunho e abre o PDF como o aluno vai ver"
            className="rounded-lg border border-dobro-laranja/40 px-4 py-2 text-sm font-medium text-dobro-laranja transition-all duration-150 hover:border-dobro-laranja hover:bg-dobro-laranja/10 active:translate-y-[1px] disabled:opacity-50"
          >
            {previewLoading ? 'Gerando prévia…' : 'Prévia do PDF'}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => save('reject')}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 transition-all duration-150 hover:border-red-500/60 hover:bg-red-500/10 active:translate-y-[1px] disabled:opacity-50"
            >
              Rejeitar
            </button>
            <button
              type="button"
              disabled={saving || !canApprove}
              onClick={() => save('approve')}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.55)] transition-all duration-150 hover:bg-emerald-600 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aprovar e entregar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
