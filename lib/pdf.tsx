/**
 * PDF generation — React PDF renderer espelhando o design system da página.
 *
 * Design tokens (mirror de styles/globals.css):
 *   --dobro-verde-claro #22C55E   acento principal (grade, rules, file refs)
 *   --dobro-verde-acao  #6BB27C   acento secundário (reservado)
 *   --dobro-bg          #111111   fundo da página
 *   --dobro-text        #EDEDED   texto principal
 *
 * Typography (mesma stack da página):
 *   Ubuntu       — títulos + body
 *   MartianMono  — code blocks + refs de arquivo
 *
 * Two entry points:
 *   - renderCorrectionPdf(data)   pure, returns Buffer (used by preview + storage)
 *   - generateAndStorePdf(id, email)   loads from DB, stores in pdfs table,
 *     flips submission to delivered
 */

import { eq } from 'drizzle-orm';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from '@react-pdf/renderer';
import { asMonitor } from './db-context';
import { corrections, pdfs, submissions } from '@/drizzle/schema';
import { setSubmissionStatus } from './monitor-actions';
import { SEVERITY_META, type Severity } from './severity';
import {
  highlightCode,
  langFromPath,
  detectLang,
  extractCodeBlocks,
  CODE_PALETTE,
} from './syntax-highlight';
import React from 'react';

// ---------- Fonts ----------
// @fontsource packages served via jsdelivr CDN; @react-pdf fetches TTFs on first
// render and caches in-process. If CDN is unreachable or the TTFs fail to load,
// we downgrade to Helvetica (no brand typography but still renders).
const FONT_CDN = 'https://cdn.jsdelivr.net/npm';

type FontState = 'unknown' | 'custom' | 'fallback';
let fontState: FontState = 'unknown';

/**
 * Pre-warm fonts by fetching the TTFs ourselves before handing off to react-pdf.
 * If any fetch fails, we mark state=fallback and skip Font.register so styles
 * can switch to Helvetica family names without react-pdf trying to fetch again.
 */
async function ensureFontsReady(): Promise<FontState> {
  if (fontState !== 'unknown') return fontState;

  const urls = [
    `${FONT_CDN}/@fontsource/ubuntu@5.0.18/files/ubuntu-latin-400-normal.ttf`,
    `${FONT_CDN}/@fontsource/ubuntu@5.0.18/files/ubuntu-latin-500-normal.ttf`,
    `${FONT_CDN}/@fontsource/ubuntu@5.0.18/files/ubuntu-latin-700-normal.ttf`,
    `${FONT_CDN}/@fontsource/plus-jakarta-sans@5.0.18/files/plus-jakarta-sans-latin-400-normal.ttf`,
    `${FONT_CDN}/@fontsource/plus-jakarta-sans@5.0.18/files/plus-jakarta-sans-latin-500-normal.ttf`,
    `${FONT_CDN}/@fontsource/plus-jakarta-sans@5.0.18/files/plus-jakarta-sans-latin-600-normal.ttf`,
    `${FONT_CDN}/@fontsource/martian-mono@5.0.18/files/martian-mono-latin-400-normal.ttf`,
    `${FONT_CDN}/@fontsource/martian-mono@5.0.18/files/martian-mono-latin-600-normal.ttf`,
  ];

  try {
    const results = await Promise.all(
      urls.map((u) =>
        fetch(u, { method: 'HEAD' }).then((r) => {
          if (!r.ok) throw new Error(`font ${u} → ${r.status}`);
          return true;
        })
      )
    );
    if (!results.every(Boolean)) throw new Error('partial font fetch');

    Font.register({
      family: 'Ubuntu',
      fonts: [
        { src: urls[0], fontWeight: 400 },
        { src: urls[1], fontWeight: 600 },
        { src: urls[2], fontWeight: 700 },
      ],
    });
    Font.register({
      family: 'PlusJakartaSans',
      fonts: [
        { src: urls[3], fontWeight: 400 },
        { src: urls[4], fontWeight: 500 },
        { src: urls[5], fontWeight: 600 },
      ],
    });
    Font.register({
      family: 'MartianMono',
      fonts: [
        { src: urls[6], fontWeight: 400 },
        { src: urls[7], fontWeight: 600 },
      ],
    });
    Font.registerHyphenationCallback((word) => [word]);
    fontState = 'custom';
  } catch (err) {
    console.warn('[pdf] brand fonts unavailable, using Helvetica:', err instanceof Error ? err.message : err);
    fontState = 'fallback';
  }
  return fontState;
}

function fontFam(state: FontState, kind: 'title' | 'body' | 'mono'): string {
  if (state === 'custom') {
    if (kind === 'mono') return 'MartianMono';
    // Title e body ambos Ubuntu — espelha a stack da página (globals.css usa
    // 'Ubuntu' como primária pra body e h1-h4).
    return 'Ubuntu';
  }
  if (kind === 'mono') return 'Courier';
  return kind === 'title' ? 'Helvetica-Bold' : 'Helvetica';
}

// ---------- Design tokens (editorial dark — mirrored from globals.css) ----------
// Brand accent é verde-claro (mesmo dos h1-h4 da página). Surface dark.
// Borders hairlines (8-14% opacity branco) — no heavy fills, type carries hierarchy.
const C = {
  // Brand
  accent: '#22C55E',       // --dobro-verde-claro — usado em rules, hero grade, file refs, +
  accentSoft: '#6BB27C',   // --dobro-verde-acao — reservado
  // Surfaces
  bg: '#111111',
  surface: '#000000',
  surfaceElev: '#1A1A1A',
  // Text
  text: '#EDEDED',
  textMuted: 'rgba(237, 237, 237, 0.72)',
  textFaint: 'rgba(237, 237, 237, 0.45)',
  textDim: 'rgba(237, 237, 237, 0.3)',
  // Lines
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',
};

function makeStyles(state: FontState) {
  const titleFam = fontFam(state, 'title');
  const bodyFam = fontFam(state, 'body');
  const monoFam = fontFam(state, 'mono');
  return StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingHorizontal: 52,
    paddingBottom: 60,
    fontFamily: bodyFam,
    fontSize: 10.5,
    color: C.text,
    lineHeight: 1.55,
    backgroundColor: C.bg,
  },

  // --- Top brand hairline (left-aligned, fixed width — not full bleed) ---
  brandBar: {
    width: 44,
    height: 2,
    backgroundColor: C.accent,
    marginBottom: 14,
  },

  // --- Header ---
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 36,
  },
  brand: {
    fontFamily: titleFam,
    fontSize: 18,
    fontWeight: 700,
    color: C.text,
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontFamily: bodyFam,
    fontSize: 8.5,
    color: C.accent,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    fontWeight: 600,
  },
  headerMeta: {
    alignItems: 'flex-end',
  },
  headerMetaLabel: {
    fontSize: 7.5,
    color: C.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    fontWeight: 500,
  },
  headerMetaValue: {
    fontSize: 10,
    color: C.text,
    fontWeight: 500,
    marginTop: 3,
  },

  // --- Hero grade (editorial, big) ---
  hero: {
    marginBottom: 40,
  },
  heroLabel: {
    fontSize: 8,
    color: C.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    fontWeight: 600,
    marginBottom: 6,
  },
  heroGradeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  heroGradeNum: {
    fontFamily: titleFam,
    fontSize: 88,
    fontWeight: 700,
    color: C.accent,
    lineHeight: 1,
    letterSpacing: -4,
  },
  heroGradeMax: {
    fontFamily: titleFam,
    fontSize: 22,
    fontWeight: 500,
    color: C.textFaint,
    marginLeft: 4,
  },
  heroUnderline: {
    width: 28,
    height: 2,
    backgroundColor: C.accent,
    marginTop: 2,
    marginBottom: 14,
  },
  heroRepo: {
    fontFamily: monoFam,
    fontSize: 10.5,
    color: C.text,
    marginBottom: 2,
  },
  heroStudent: {
    fontSize: 9.5,
    color: C.textMuted,
  },

  // --- Section ---
  section: { marginBottom: 32 },
  sectionKicker: {
    fontSize: 8,
    color: C.textFaint,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
    fontWeight: 600,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: titleFam,
    fontSize: 18,
    fontWeight: 700,
    color: C.text,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  sectionRule: {
    width: 24,
    height: 1.5,
    backgroundColor: C.accent,
    marginBottom: 18,
  },

  // --- Narrative (no card — just typography with a hairline) ---
  narrativeBlock: {
    borderLeftWidth: 2,
    borderLeftColor: C.accent,
    paddingLeft: 16,
    paddingVertical: 2,
  },
  narrativeText: {
    fontSize: 11.5,
    color: C.text,
    lineHeight: 1.7,
  },

  // --- Improvement (minimal card: hairline outline only) ---
  impCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    padding: 18,
    marginBottom: 14,
  },
  impTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  impIndexCol: {
    width: 44,
  },
  impIndex: {
    fontFamily: monoFam,
    fontSize: 22,
    fontWeight: 600,
    color: C.textDim,
    lineHeight: 1,
    letterSpacing: -0.5,
  },
  impMain: {
    flex: 1,
  },
  impAreaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  impArea: {
    fontFamily: titleFam,
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
    marginRight: 10,
  },
  sevDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  sevLabel: {
    fontFamily: bodyFam,
    fontSize: 8.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sevRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  impSuggestion: {
    fontSize: 10.5,
    color: C.textMuted,
    lineHeight: 1.6,
    marginBottom: 12,
  },
  codeRef: {
    fontSize: 8.5,
    color: C.textFaint,
    marginTop: 2,
    marginBottom: 4,
    fontFamily: monoFam,
    textTransform: 'none',
    letterSpacing: 0.3,
  },
  codeRefFile: {
    color: C.accent,
    fontWeight: 600,
  },
  // --- Code block: macOS-style dark window with traffic lights ---
  codeWindow: {
    backgroundColor: CODE_PALETTE.bg,
    borderRadius: 6,
    marginBottom: 6,
    overflow: 'hidden',
  },
  codeChrome: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CODE_PALETTE.chromeBg,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  codeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  codeDotsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  codeFilename: {
    flex: 1,
    textAlign: 'center',
    fontSize: 8.5,
    color: CODE_PALETTE.chromeText,
    fontFamily: fontFam(state, 'mono'),
    // Counterweight: matches the dots' width so filename stays truly centered
    marginRight: 40,
  },
  codeBody: {
    padding: 10,
    fontFamily: fontFam(state, 'mono'),
    fontSize: 8.5,
    lineHeight: 1.55,
    color: CODE_PALETTE.default,
  },
  fixLabel: {
    fontSize: 7.5,
    color: C.textFaint,
    marginTop: 8,
    marginBottom: 6,
    fontFamily: bodyFam,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },

  // --- Strengths list ---
  strengthRow: {
    flexDirection: 'row',
    marginBottom: 9,
    alignItems: 'flex-start',
  },
  strengthMark: {
    fontFamily: monoFam,
    fontWeight: 600,
    color: C.accent,
    width: 16,
    fontSize: 10.5,
    marginTop: 1,
  },
  strengthText: {
    flex: 1,
    fontSize: 10.5,
    color: C.text,
    lineHeight: 1.55,
  },

  // --- Footer ---
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 52,
    right: 52,
  },
  footerRule: {
    width: 24,
    height: 1,
    backgroundColor: C.accent,
    marginBottom: 8,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 7.5,
    color: C.textFaint,
    letterSpacing: 0.3,
  },
  footerBrand: {
    fontFamily: titleFam,
    fontWeight: 700,
    color: C.text,
    fontSize: 8,
    letterSpacing: 0.4,
  },
  footerPage: {
    fontFamily: monoFam,
    fontSize: 7.5,
    color: C.textFaint,
  },
  });
}

type Styles = ReturnType<typeof makeStyles>;

type ImprovementPdf = {
  area: string;
  severity: Severity;
  suggestion: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  proposedFix?: string;
};

export interface RenderPdfInput {
  studentEmail: string;
  githubUrl: string;
  grade: string;
  strengths: string[];
  improvements: ImprovementPdf[];
  narrativeMd: string;
  correctedAt: Date;
}

function formatLineRange(start?: number, end?: number): string {
  if (start === undefined) return '';
  if (end === undefined || end === start) return `linha ${start}`;
  return `linhas ${start}–${end}`;
}

function sevColor(s: Severity): string {
  return SEVERITY_META[s].hex;
}

/**
 * Resolve the effective language for a proposedFix block.
 *
 * Order of preference:
 *   1. Explicit fence lang (most reliable — AI declared it)
 *   2. Detected from content (const/let/<div>/etc.)
 *   3. Inherited from the cited file (codeSnippet came from e.g. index.html)
 *   4. 'plain' — no highlighting, at least the block renders
 */
function resolveFixLang(
  explicit: string | undefined,
  code: string,
  fileLang: string
): string {
  if (explicit) return explicit;
  const detected = detectLang(code);
  if (detected) return detected;
  if (fileLang && fileLang !== 'plain') return fileLang;
  return 'plain';
}

function shortRepoName(githubUrl: string): string {
  return githubUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
}

function CodeBlock({
  code,
  lang,
  filename,
  styles,
}: {
  code: string;
  lang?: string;
  filename: string;
  styles: Styles;
}) {
  const tokens = highlightCode(code, lang);
  return (
    <View style={styles.codeWindow} wrap={false}>
      <View style={styles.codeChrome}>
        <View style={styles.codeDotsWrap}>
          <View style={[styles.codeDot, { backgroundColor: CODE_PALETTE.traffic.red }]} />
          <View style={[styles.codeDot, { backgroundColor: CODE_PALETTE.traffic.yellow }]} />
          <View style={[styles.codeDot, { backgroundColor: CODE_PALETTE.traffic.green }]} />
        </View>
        <Text style={styles.codeFilename}>{filename}</Text>
      </View>
      <Text style={styles.codeBody}>
        {tokens.map((t, i) => (
          <Text key={i} style={{ color: t.color }}>
            {t.text}
          </Text>
        ))}
      </Text>
    </View>
  );
}

function SectionHeader({
  kicker,
  title,
  styles,
}: {
  kicker?: string;
  title: string;
  styles: Styles;
}) {
  // minPresenceAhead: moves to next page if less than ~140pt of space remains,
  // preventing the header from being orphaned at the bottom when the first
  // content block would wrap to the next page anyway.
  return (
    <View minPresenceAhead={140} wrap={false}>
      {kicker ? <Text style={styles.sectionKicker}>{kicker}</Text> : null}
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

function PdfDoc(props: RenderPdfInput & { styles: Styles }) {
  const { styles } = props;
  return (
    <Document
      title={`Correção DevQuest — ${shortRepoName(props.githubUrl)}`}
      author="Dev em Dobro"
      creator="Dobro Support"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Dev em Dobro</Text>
            <Text style={styles.brandSubtitle}>Correção DevQuest</Text>
          </View>
          <View style={styles.headerMeta}>
            <Text style={styles.headerMetaLabel}>Entregue em</Text>
            <Text style={styles.headerMetaValue}>
              {props.correctedAt.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Nota final</Text>
          <View style={styles.heroGradeRow}>
            <Text style={styles.heroGradeNum}>{Number(props.grade).toFixed(1)}</Text>
            <Text style={styles.heroGradeMax}>/10</Text>
          </View>
          <View style={styles.heroUnderline} />
          <Text style={styles.heroRepo}>{shortRepoName(props.githubUrl)}</Text>
          <Text style={styles.heroStudent}>{props.studentEmail}</Text>
        </View>

        {props.narrativeMd ? (
          <View style={styles.section}>
            <SectionHeader title="Resumo da correção" styles={styles} />
            <View style={styles.narrativeBlock}>
              <Text style={styles.narrativeText}>{props.narrativeMd}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader
            kicker="01 · Pontos de atenção"
            title="O que melhorar"
            styles={styles}
          />
          {props.improvements.map((imp, i) => {
            const lineRange = formatLineRange(imp.lineStart, imp.lineEnd);
            const sHex = sevColor(imp.severity);
            return (
              <View key={i} style={styles.impCard}>
                <View style={styles.impTop} wrap={false}>
                  <View style={styles.impIndexCol}>
                    <Text style={styles.impIndex}>
                      {String(i + 1).padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={styles.impMain}>
                    <View style={styles.impAreaRow}>
                      <Text style={styles.impArea}>{imp.area}</Text>
                      <View style={styles.sevRow}>
                        <View style={[styles.sevDot, { backgroundColor: sHex }]} />
                        <Text style={[styles.sevLabel, { color: sHex }]}>
                          {SEVERITY_META[imp.severity].label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.impSuggestion}>{imp.suggestion}</Text>
                  </View>
                </View>

                {imp.file ? (
                  <View>
                    <Text style={styles.codeRef}>
                      <Text style={styles.codeRefFile}>{imp.file}</Text>
                      {lineRange ? `  ·  ${lineRange}` : ''}
                    </Text>
                    {imp.codeSnippet && /[A-Za-z0-9]/.test(imp.codeSnippet) ? (
                      <CodeBlock
                        code={imp.codeSnippet}
                        lang={langFromPath(imp.file)}
                        filename={imp.file.split('/').pop() || imp.file}
                        styles={styles}
                      />
                    ) : null}
                  </View>
                ) : null}

                {imp.proposedFix
                  ? extractCodeBlocks(imp.proposedFix).map((b, j) => {
                      const fileLang = imp.file ? langFromPath(imp.file) : 'plain';
                      const lang = resolveFixLang(b.lang, b.code, fileLang);
                      return (
                        <View key={j}>
                          <Text style={styles.fixLabel}>Como ficaria</Text>
                          <CodeBlock
                            code={b.code}
                            lang={lang}
                            filename={`sugestao.${lang === 'plain' ? 'txt' : lang}`}
                            styles={styles}
                          />
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <SectionHeader
            kicker="02 · Reconhecimento"
            title="O que ficou bom"
            styles={styles}
          />
          {props.strengths.map((s, i) => (
            <View key={i} style={styles.strengthRow}>
              <Text style={styles.strengthMark}>+</Text>
              <Text style={styles.strengthText}>{s}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <View style={styles.footerRule} />
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>
              <Text style={styles.footerBrand}>DEV EM DOBRO</Text>
              {'   Correção DevQuest'}
            </Text>
            <Text
              style={styles.footerPage}
              render={({ pageNumber, totalPages }) =>
                `${String(pageNumber).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`
              }
            />
          </View>
        </View>
      </Page>
    </Document>
  );
}

/** Render a correction to a PDF buffer. Pure — does not hit the DB. */
export async function renderCorrectionPdf(data: RenderPdfInput): Promise<Buffer> {
  const state = await ensureFontsReady();
  const styles = makeStyles(state);
  return renderToBuffer(<PdfDoc {...data} styles={styles} />);
}

/** Generate PDF for a submission and mark it as delivered. */
export async function generateAndStorePdf(
  submissionId: string,
  monitorEmail: string
): Promise<{ version: number; sizeBytes: number }> {
  return asMonitor(monitorEmail, async (tx) => {
    const sub = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    if (sub.length === 0) throw new Error('submission not found');

    const corr = await tx
      .select()
      .from(corrections)
      .where(eq(corrections.submissionId, submissionId))
      .limit(1);
    if (corr.length === 0) throw new Error('correction not found');

    const existing = await tx
      .select()
      .from(pdfs)
      .where(eq(pdfs.submissionId, submissionId));
    const nextVersion = existing.length + 1;

    const buffer = await renderCorrectionPdf({
      studentEmail: sub[0].studentEmail,
      githubUrl: sub[0].githubUrl,
      grade: corr[0].grade,
      strengths: corr[0].strengths as string[],
      improvements: corr[0].improvements as ImprovementPdf[],
      narrativeMd: corr[0].narrativeMd,
      correctedAt: sub[0].correctedAt ?? new Date(),
    });

    if (buffer.length > 2 * 1024 * 1024) {
      throw new Error(`PDF exceeds 2MB limit: ${buffer.length} bytes`);
    }

    await tx.insert(pdfs).values({
      submissionId,
      data: buffer,
      version: nextVersion,
      sizeBytes: buffer.length,
    });

    await setSubmissionStatus(tx, submissionId, 'delivered', {
      deliveredAt: new Date(),
    });

    return { version: nextVersion, sizeBytes: buffer.length };
  });
}
