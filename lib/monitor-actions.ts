/**
 * Shared helpers for monitor action routes:
 *   - upsertCorrection(draft) — insert or update
 *   - logMonitorAction(...)
 *   - transitionStatus(...)
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { corrections, monitorActions, submissions } from '@/drizzle/schema';
import type { CorrectionDraftInputT } from './validators';

type Tx = Parameters<Parameters<typeof import('./db').dbTx.transaction>[0]>[0];

export async function upsertCorrection(
  tx: Tx,
  submissionId: string,
  draft: CorrectionDraftInputT,
  meta: {
    model: string;
    promptVersion: string;
    // Tokens + custo agregado da geração (gerador + polisher somados).
    // Opcional pra retrocompat com edição manual do monitor (sem IA envolvida).
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  }
) {
  const existing = await tx
    .select()
    .from(corrections)
    .where(eq(corrections.submissionId, submissionId))
    .limit(1);

  if (existing.length === 0) {
    const [created] = await tx
      .insert(corrections)
      .values({
        submissionId,
        grade: String(draft.grade),
        strengths: draft.strengths,
        improvements: draft.improvements,
        narrativeMd: draft.narrativeMd,
        model: meta.model,
        promptVersion: meta.promptVersion,
        tokensIn: meta.tokensIn ?? 0,
        tokensOut: meta.tokensOut ?? 0,
        costUsd: (meta.costUsd ?? 0).toFixed(6),
      })
      .returning();
    return created;
  }

  // Update: só sobrescreve custo se o caller passou (edição manual sem IA
  // mantém o custo da geração inicial — não zera).
  const updateValues: Record<string, unknown> = {
    grade: String(draft.grade),
    strengths: draft.strengths,
    improvements: draft.improvements,
    narrativeMd: draft.narrativeMd,
    updatedAt: new Date(),
  };
  if (meta.tokensIn !== undefined) updateValues.tokensIn = meta.tokensIn;
  if (meta.tokensOut !== undefined) updateValues.tokensOut = meta.tokensOut;
  if (meta.costUsd !== undefined) updateValues.costUsd = meta.costUsd.toFixed(6);

  const [updated] = await tx
    .update(corrections)
    .set(updateValues)
    .where(eq(corrections.submissionId, submissionId))
    .returning();
  return updated;
}

export async function logMonitorAction(
  tx: Tx,
  args: {
    submissionId: string;
    monitorEmail: string;
    action: 'edit' | 'approve' | 'reject' | 'regenerate';
    edits?: unknown;
  }
) {
  await tx.insert(monitorActions).values({
    submissionId: args.submissionId,
    monitorUserId: args.monitorEmail, // v1: using email as user id (Stack Auth viria aqui)
    monitorEmail: args.monitorEmail,
    action: args.action,
    edits: (args.edits ?? null) as any,
  });
}

export async function setSubmissionStatus(
  tx: Tx,
  submissionId: string,
  status: 'draft' | 'approved' | 'rejected' | 'delivered',
  extras: Partial<{ correctedAt: Date; deliveredAt: Date; errorMsg: string | null }> = {}
) {
  await tx
    .update(submissions)
    .set({ status, ...extras })
    .where(eq(submissions.id, submissionId));
}
