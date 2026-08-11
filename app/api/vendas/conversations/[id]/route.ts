import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireSales } from '@/lib/session';
import { asSalesUser, asService } from '@/lib/db-context';
import { salesConversations } from '@/drizzle/schema';

export const runtime = 'nodejs';

// PATCH /api/vendas/conversations/[id] — renomear conversa
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSales();
    const { id } = params;

    const body = z.object({ title: z.string().min(1).max(200) }).safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: 'título inválido' }, { status: 400 });

    const conv = await asSalesUser(session.email, async (tx) => {
      const rows = await tx
        .select({ id: salesConversations.id })
        .from(salesConversations)
        .where(and(eq(salesConversations.id, id), eq(salesConversations.salesUserEmail, session.email)))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!conv) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });

    await asService(async (tx) => {
      await tx
        .update(salesConversations)
        .set({ title: body.data.title, updatedAt: new Date() })
        .where(eq(salesConversations.id, id));
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

// DELETE /api/vendas/conversations/[id] — remove a conversa e suas mensagens
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSales();
    const { id } = params;

    const conv = await asSalesUser(session.email, async (tx) => {
      const rows = await tx
        .select({ id: salesConversations.id })
        .from(salesConversations)
        .where(and(eq(salesConversations.id, id), eq(salesConversations.salesUserEmail, session.email)))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!conv) return NextResponse.json({ error: 'não encontrada' }, { status: 404 });

    await asService(async (tx) => {
      await tx.delete(salesConversations).where(eq(salesConversations.id, id));
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
