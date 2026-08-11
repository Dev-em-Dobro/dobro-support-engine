import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asMonitor, asService } from '@/lib/db-context';
import { kbDocuments, salesAuditEvents } from '@/drizzle/schema';
import { getClientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// POST /api/monitor/vendas/kb/documents/[id]/archive
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') ?? undefined;
    const { id: documentId } = params;

    const doc = await asMonitor(session.email, async (tx) => {
      const rows = await tx.select({ id: kbDocuments.id, archivedAt: kbDocuments.archivedAt }).from(kbDocuments).where(eq(kbDocuments.id, documentId)).limit(1);
      return rows[0] ?? null;
    });

    if (!doc) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
    if (doc.archivedAt) return NextResponse.json({ error: 'já arquivado' }, { status: 409 });

    await asService(async (tx) => {
      await tx
        .update(kbDocuments)
        .set({ archivedAt: new Date(), status: 'archived', updatedAt: new Date() })
        .where(eq(kbDocuments.id, documentId));

      await tx.insert(salesAuditEvents).values({
        eventType: 'kb_archive',
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
    console.error('[POST /api/monitor/vendas/kb/documents/[id]/archive]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
