import { NextResponse } from 'next/server';
import { eq, and, asc } from 'drizzle-orm';
import { requireSales } from '@/lib/session';
import { asSalesUser } from '@/lib/db-context';
import { salesConversations, salesMessages } from '@/drizzle/schema';

export const runtime = 'nodejs';

// GET /api/vendas/conversations/[id]/messages — histórico
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSales();
    const { id } = params;

    // Verifica ownership da conversa
    const conv = await asSalesUser(session.email, async (tx) => {
      const rows = await tx
        .select({ id: salesConversations.id })
        .from(salesConversations)
        .where(and(eq(salesConversations.id, id), eq(salesConversations.salesUserEmail, session.email)))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!conv) return NextResponse.json({ error: 'conversa não encontrada' }, { status: 404 });

    const messages = await asSalesUser(session.email, async (tx) =>
      tx
        .select({
          id: salesMessages.id,
          role: salesMessages.role,
          content: salesMessages.content,
          sources: salesMessages.sources,
          objectionOptions: salesMessages.objectionOptions,
          createdAt: salesMessages.createdAt,
        })
        .from(salesMessages)
        .where(eq(salesMessages.conversationId, id))
        .orderBy(asc(salesMessages.createdAt))
    );

    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
