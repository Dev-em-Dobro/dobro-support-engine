/**
 * Automatic AI correction processor.
 *
 * Called from two places:
 *   1. Submit route (via waitUntil) — runs immediately after student submits.
 *   2. Cron safety net — picks up anything stuck in queued/processing.
 *
 * Runs with service-role DB context (no monitor session required).
 *
 * State machine:
 *   queued → processing → draft   (happy path)
 *   queued → processing → failed  (with errorMsg)
 *
 * Idempotency: claimSubmission() only transitions queued → processing or
 * stale-processing → processing. If another caller already claimed it, we skip.
 */

import { and, eq, lt, inArray, sql } from 'drizzle-orm';
import { asService } from './db-context';
import { submissions, corrections, monitorActions } from '@/drizzle/schema';
import { generateCorrectionViaAI } from './ai-correction';
import { polishCorrection } from './ai-reviewer';
import { sumUsage, type UsageReport } from './cost';

// How long a "processing" row can sit before we consider it stale and retry.
const STALE_PROCESSING_MINUTES = 5;

/**
 * Atomically claim a submission for processing. Returns the submission if we
 * won the claim, or null if it was already picked up / not in a claimable state.
 */
async function claimSubmission(submissionId: string) {
  return asService(async (tx) => {
    const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);

    // Claim if status is queued, OR status is processing but hasn't updated in a while
    const claimed = await tx
      .update(submissions)
      .set({ status: 'processing', updatedAt: new Date(), errorMsg: null })
      .where(
        and(
          eq(submissions.id, submissionId),
          sql`(${submissions.status} = 'queued' OR (${submissions.status} = 'processing' AND ${submissions.updatedAt} < ${staleCutoff}))`
        )
      )
      .returning();

    return claimed[0] ?? null;
  });
}

interface DraftInput {
  correction: Awaited<ReturnType<typeof generateCorrectionViaAI>>['correction'];
  model: string;
  promptVersion: string;
  polishChanges?: string[];
  polishFallback?: boolean;
  genUsage: UsageReport;
  polishUsage: UsageReport;
}

async function saveDraft(submissionId: string, draft: DraftInput) {
  const totalUsage = sumUsage([draft.genUsage, draft.polishUsage]);

  return asService(async (tx) => {
    const existing = await tx
      .select()
      .from(corrections)
      .where(eq(corrections.submissionId, submissionId))
      .limit(1);

    if (existing.length === 0) {
      await tx.insert(corrections).values({
        submissionId,
        grade: String(draft.correction.grade),
        strengths: draft.correction.strengths,
        improvements: draft.correction.improvements,
        narrativeMd: draft.correction.narrativeMd,
        model: draft.model,
        promptVersion: draft.promptVersion,
        tokensIn: totalUsage.tokensIn,
        tokensOut: totalUsage.tokensOut,
        costUsd: totalUsage.costUsd.toFixed(6),
      });
    } else {
      await tx
        .update(corrections)
        .set({
          grade: String(draft.correction.grade),
          strengths: draft.correction.strengths,
          improvements: draft.correction.improvements,
          narrativeMd: draft.correction.narrativeMd,
          model: draft.model,
          promptVersion: draft.promptVersion,
          tokensIn: totalUsage.tokensIn,
          tokensOut: totalUsage.tokensOut,
          costUsd: totalUsage.costUsd.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(corrections.submissionId, submissionId));
    }

    await tx
      .update(submissions)
      .set({
        status: 'draft',
        correctedAt: new Date(),
        updatedAt: new Date(),
        errorMsg: null,
      })
      .where(eq(submissions.id, submissionId));

    // Audit trail — "IA gerou rascunho automaticamente" + polisher changes
    // + breakdown de custo por pass (gerador vs polisher) pra debug futuro.
    await tx.insert(monitorActions).values({
      submissionId,
      monitorUserId: 'ai-auto',
      monitorEmail: 'ai-auto',
      action: 'regenerate',
      edits: {
        source: 'ai-auto',
        model: draft.model,
        promptVersion: draft.promptVersion,
        polishChanges: draft.polishChanges ?? [],
        polishFallback: draft.polishFallback ?? false,
        usage: {
          generator: draft.genUsage,
          polisher: draft.polishUsage,
          total: {
            tokensIn: totalUsage.tokensIn,
            tokensOut: totalUsage.tokensOut,
            costUsd: Number(totalUsage.costUsd.toFixed(6)),
          },
        },
      },
    });
  });
}

async function markFailed(submissionId: string, errorMsg: string) {
  await asService(async (tx) => {
    await tx
      .update(submissions)
      .set({ status: 'failed', errorMsg, updatedAt: new Date() })
      .where(eq(submissions.id, submissionId));
  });
}

/**
 * Process a single submission end-to-end. Safe to call multiple times — if
 * another caller already claimed and is working on it, this returns quickly.
 *
 * Never throws — errors are captured in the submission row as status=failed.
 */
export async function processSubmissionWithAI(submissionId: string): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const claimed = await claimSubmission(submissionId);
  if (!claimed) {
    return { ok: false, reason: 'not claimable (already processing or terminal)' };
  }

  try {
    const generated = await generateCorrectionViaAI({
      githubUrl: claimed.githubUrl,
      deployedUrl: claimed.deployedUrl,
    });

    // Polish pass — second AI rewrites issues (vagueness, AI-speak, tom) in
    // place. Falls back to the raw correction if polisher is unavailable.
    const polish = await polishCorrection(generated.correction, {
      githubUrl: claimed.githubUrl,
      studentEmail: claimed.studentEmail,
    });

    await saveDraft(submissionId, {
      ...generated,
      correction: polish.polished,
      polishChanges: polish.changes,
      polishFallback: polish.fallback,
      genUsage: generated.usage,
      polishUsage: polish.usage,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido na geração IA';
    console.error(`[ai-processor] submission ${submissionId} failed:`, msg);
    await markFailed(submissionId, msg).catch((writeErr) => {
      console.error(`[ai-processor] failed to mark submission ${submissionId} as failed:`, writeErr);
    });
    return { ok: false, reason: msg };
  }
}

/**
 * Find and process all submissions that are stuck (queued for any duration, or
 * processing for longer than STALE_PROCESSING_MINUTES). Called by the safety cron.
 *
 * Processes sequentially to avoid hammering the GitHub + OpenAI APIs.
 */
export async function processStuckSubmissions(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);

  const candidates = await asService(async (tx) =>
    tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          inArray(submissions.status, ['queued', 'processing']),
          lt(submissions.updatedAt, staleCutoff)
        )
      )
      .limit(20)
  );

  let succeeded = 0;
  let failed = 0;
  for (const c of candidates) {
    const r = await processSubmissionWithAI(c.id);
    if (r.ok) succeeded++;
    else failed++;
  }

  return { attempted: candidates.length, succeeded, failed };
}
