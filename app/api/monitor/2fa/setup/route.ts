/**
 * GET/POST /api/monitor/2fa/setup — enrollment do 2FA do gestor (monitor).
 *
 * GET  → gera um secret novo (enrollment pendente), grava cifrado e devolve o
 *        URI otpauth:// + o secret formatado pra digitação manual. Não habilita
 *        o 2FA ainda (totp_enabled_at continua NULL).
 * POST → confirma o primeiro código TOTP; ao acertar, gera os códigos de backup
 *        (exibidos UMA vez), grava os hashes e marca totp_enabled_at = now.
 *        A partir daí o login passa a exigir o segundo fator.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireMonitor } from '@/lib/session';
import { asService } from '@/lib/db-context';
import { monitorUsers, authEvents } from '@/drizzle/schema';
import { hashEmail } from '@/lib/magic-link';
import { getClientIp } from '@/lib/rate-limit';
import { encryptSecret, decryptSecret } from '@/lib/crypto-secret';
import {
  generateSecret,
  otpauthUri,
  formatSecretForDisplay,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
} from '@/lib/totp';

export const runtime = 'nodejs';

const ConfirmBody = z.object({
  code: z.string().regex(/^\d{6}$/, 'código de 6 dígitos'),
});

export async function GET() {
  try {
    const session = await requireMonitor();

    const user = await asService(async (tx) => {
      const rows = await tx
        .select({ totpEnabledAt: monitorUsers.totpEnabledAt })
        .from(monitorUsers)
        .where(eq(monitorUsers.email, session.email))
        .limit(1);
      return rows[0] ?? null;
    });

    if (user?.totpEnabledAt) {
      return NextResponse.json({ enabled: true });
    }

    const secret = generateSecret();
    await asService(async (tx) => {
      await tx
        .update(monitorUsers)
        .set({ totpSecret: encryptSecret(secret) })
        .where(eq(monitorUsers.email, session.email));
    });

    return NextResponse.json({
      enabled: false,
      secret: formatSecretForDisplay(secret),
      uri: otpauthUri(secret, session.email),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[GET /api/monitor/2fa/setup]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireMonitor();
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') || undefined;

    const json = await req.json().catch(() => null);
    const parsed = ConfirmBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'código inválido' }, { status: 400 });
    }

    const user = await asService(async (tx) => {
      const rows = await tx
        .select({ totpSecret: monitorUsers.totpSecret, totpEnabledAt: monitorUsers.totpEnabledAt })
        .from(monitorUsers)
        .where(eq(monitorUsers.email, session.email))
        .limit(1);
      return rows[0] ?? null;
    });

    if (user?.totpEnabledAt) {
      return NextResponse.json({ error: '2FA já está habilitado.' }, { status: 400 });
    }
    if (!user?.totpSecret) {
      return NextResponse.json({ error: 'inicie o setup antes de confirmar.' }, { status: 400 });
    }

    let valid = false;
    try {
      valid = verifyTotp(decryptSecret(user.totpSecret), parsed.data.code);
    } catch (error) {
      console.error('[monitor/2fa/setup] falha ao decifrar secret:', error);
    }
    if (!valid) {
      return NextResponse.json({ error: 'código incorreto. Confere o relógio do app.' }, { status: 400 });
    }

    const backupCodes = generateBackupCodes();
    const hashes = backupCodes.map(hashBackupCode);

    await asService(async (tx) => {
      await tx
        .update(monitorUsers)
        .set({ totpEnabledAt: new Date(), totpBackupCodes: hashes })
        .where(eq(monitorUsers.email, session.email));
      await tx.insert(authEvents).values({
        eventType: 'two_factor_enabled',
        emailHash: hashEmail(session.email),
        ip,
        userAgent,
      });
    });

    // backupCodes em texto puro só voltam aqui, esta única vez.
    return NextResponse.json({ ok: true, backupCodes });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[POST /api/monitor/2fa/setup]', err);
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }
}
