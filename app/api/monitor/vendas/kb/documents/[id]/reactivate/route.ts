import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { kbDocuments, salesAuditEvents } from '@/drizzle/schema';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// POST /api/monitor/vendas/kb/documents/[id]/reactivate
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;
    const { id: documentId } = params;

    const doc = await asMonitor(session.email, async (tx) => {
      const rows = await tx
        .select({ id: kbDocuments.id, archivedAt: kbDocuments.archivedAt, currentVersionId: kbDocuments.currentVersionId })
        .from(kbDocuments)
        .where(eq(kbDocuments.id, documentId))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!doc) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
    if (!doc.archivedAt) return NextResponse.json({ error: 'documento não está arquivado' }, { status: 409 });

    const newStatus = doc.currentVersionId ? 'active' : 'failed';

    await asService(async (tx) => {
      await tx
        .update(kbDocuments)
        .set({ archivedAt: null, status: newStatus, updatedAt: new Date() })
        .where(eq(kbDocuments.id, documentId));

      await tx.insert(salesAuditEvents).values({
        eventType: 'kb_reactivate',
        actorEmail: session.email,
        actorRole: 'monitor',
        targetId: documentId,
        ip,
        userAgent,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/monitor/vendas/kb/documents/[id]/reactivate]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
