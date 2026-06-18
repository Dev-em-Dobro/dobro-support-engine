/**
 * POST /api/monitor/2fa/disable — desabilita o 2FA do gestor (monitor).
 *
 * Exige um código TOTP (ou de backup) válido pra provar posse — não basta a
 * sessão ativa, senão uma sessão sequestrada desligaria o 2FA sozinha.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asService } from '@/lib/db-context';
import { monitorUsers, authEvents } from '@/drizzle/schema';
import { hashEmail } from '@/lib/magic-link';
import { getClientIp } from '@/lib/rate-limit';
import { decryptSecret } from '@/lib/crypto-secret';
import { verifyTotp, consumeBackupCode } from '@/lib/totp';

export const runtime = 'nodejs';

const Body = z.object({
  code: z.string().min(6).max(20),
});

export async function POST(req: Request) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') || undefined;

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'código inválido' }, { status: 400 });
    }
    const code = parsed.data.code.trim();

    const user = await asService(async (tx) => {
      const rows = await tx
        .select({
          totpSecret: monitorUsers.totpSecret,
          totpEnabledAt: monitorUsers.totpEnabledAt,
          totpBackupCodes: monitorUsers.totpBackupCodes,
        })
        .from(monitorUsers)
        .where(eq(monitorUsers.email, session.email))
        .limit(1);
      return rows[0] ?? null;
    });

    if (!user?.totpEnabledAt || !user.totpSecret) {
      return NextResponse.json({ error: '2FA não está habilitado.' }, { status: 400 });
    }

    let valid = false;
    try {
      valid = verifyTotp(decryptSecret(user.totpSecret), code);
    } catch (error) {
      console.error('[monitor/2fa/disable] falha ao decifrar secret:', error);
    }
    if (!valid && !/^\d{6}$/.test(code)) {
      valid = consumeBackupCode(code, user.totpBackupCodes ?? []).ok;
    }
    if (!valid) {
      return NextResponse.json({ error: 'código incorreto' }, { status: 401 });
    }

    await asService(async (tx) => {
      await tx
        .update(monitorUsers)
        .set({ totpSecret: null, totpEnabledAt: null, totpBackupCodes: null })
        .where(eq(monitorUsers.email, session.email));
      await tx.insert(authEvents).values({
        eventType: 'two_factor_disabled',
        emailHash: hashEmail(session.email),
        ip,
        userAgent,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/monitor/2fa/disable]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
