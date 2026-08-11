import { NextResponse } from 'next/server';
import { desc, eq, and } from 'drizzle-orm';
import { requireSales } from '@/lib/session';
import { asSalesUser, asService } from '@/lib/db-context';
import { salesConversations } from '@/drizzle/schema';

export const runtime = 'nodejs';

// GET /api/vendas/conversations — lista do vendedor logado
export async function GET() {
  try {
    const session = await requireSales();

    const convs = await asSalesUser(session.email, async (tx) =>
      tx
        .select({
          id: salesConversations.id,
          title: salesConversations.title,
          messageCount: salesConversations.messageCount,
          totalCostUsd: salesConversations.totalCostUsd,
          createdAt: salesConversations.createdAt,
          updatedAt: salesConversations.updatedAt,
        })
        .from(salesConversations)
        .where(eq(salesConversations.salesUserEmail, session.email))
        .orderBy(desc(salesConversations.updatedAt))
        .limit(50)
    );

    return NextResponse.json({ conversations: convs });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/vendas/conversations]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

// POST /api/vendas/conversations — cria conversa vazia
export async function POST() {
  try {
    const session = await requireSales();

    const [conv] = await asService(async (tx) =>
      tx
        .insert(salesConversations)
        .values({ salesUserEmail: session.email })
        .returning({ id: salesConversations.id, createdAt: salesConversations.createdAt })
    );

    return NextResponse.json(conv, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/vendas/conversations]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
