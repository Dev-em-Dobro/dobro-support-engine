/**
 * POST /api/monitor/login/2fa — segundo passo do login do monitor.
 *
 * Pré-requisito: cookie de pré-auth emitido pelo /api/monitor/login (senha já
 * validada). Aqui validamos o código TOTP (ou um código de backup) e só então
 * emitimos a sessão real. Sem o pré-auth, retorna 401 — não dá pra pular a
 * senha.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  setSessionCookie,
  getPending2fa,
  clearPending2faCookie,
} from '@/lib/session';
import { asService } from '@/lib/db-context';
import { monitorUsers, authEvents } from '@/drizzle/schema';
import { hashEmail } from '@/lib/magic-link';
import { checkMonitorLoginRateLimit, getClientIp } from '@/lib/rate-limit';
import { withTransientRetry } from '@/lib/db-retry';
import { decryptSecret } from '@/lib/crypto-secret';
import { verifyTotp, consumeBackupCode } from '@/lib/totp';

export const runtime = 'nodejs';

const Body = z.object({
  code: z.string().min(6).max(20),
});

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') || undefined;

    // Mesmo rate limit do login por senha — barra brute force no código TOTP
    // (1M combinações em 6 dígitos é viável sem teto).
    let rl: Awaited<ReturnType<typeof checkMonitorLoginRateLimit>> = {
      allowed: true,
      retryAfterSec: 0,
    };
    try {
      rl = await withTransientRetry(() => checkMonitorLoginRateLimit(ip));
    } catch (error) {
      console.warn('[monitor/login/2fa] rate-limit indisponível:', error);
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'muitas tentativas. Aguarda alguns minutos.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const pending = await getPending2fa();
    if (!pending) {
      return NextResponse.json({ error: 'sessão de login expirada. Faz login de novo.' }, { status: 401 });
    }
    const email = pending.email;

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'código inválido' }, { status: 400 });
    }
    const code = parsed.data.code.trim();

    const user = await withTransientRetry(() =>
      asService(async (tx) => {
        const rows = await tx
          .select()
          .from(monitorUsers)
          .where(eq(monitorUsers.email, email))
          .limit(1);
        return rows[0] ?? null;
      })
    );

    // Estado inconsistente (2FA desabilitado entre os passos, conta inativa) →
    // trata como falha sem vazar detalhe.
    if (!user || !user.active || !user.totpEnabledAt || !user.totpSecret) {
      clearPending2faCookie();
      return NextResponse.json({ error: 'sessão de login expirada. Faz login de novo.' }, { status: 401 });
    }

    let valid = false;
    let usedBackup = false;
    let remainingBackup = user.totpBackupCodes ?? [];

    try {
      valid = verifyTotp(decryptSecret(user.totpSecret), code);
    } catch (error) {
      console.error('[monitor/login/2fa] falha ao decifrar/verificar TOTP:', error);
    }

    // Fallback: código de backup (uso único). Só tenta se o TOTP não casou e o
    // formato não parece um código TOTP de 6 dígitos.
    if (!valid && remainingBackup.length > 0 && !/^\d{6}$/.test(code)) {
      const res = consumeBackupCode(code, remainingBackup);
      if (res.ok) {
        valid = true;
        usedBackup = true;
        remainingBackup = res.remaining;
      }
    }

    if (!valid) {
      try {
        await withTransientRetry(() =>
          asService(async (tx) => {
            await tx.insert(authEvents).values({
              eventType: 'two_factor_failed',
              emailHash: hashEmail(email),
              ip,
              userAgent,
            });
          })
        );
      } catch {}
      return NextResponse.json({ error: 'código incorreto' }, { status: 401 });
    }

    // Sucesso: registra login, consome backup code se foi o caso, atualiza
    // lastLogin.
    try {
      await withTransientRetry(() =>
        asService(async (tx) => {
          await tx.insert(authEvents).values({
            eventType: 'login',
            emailHash: hashEmail(email),
            ip,
            userAgent,
          });
          await tx
            .update(monitorUsers)
            .set({
              lastLoginAt: new Date(),
              ...(usedBackup ? { totpBackupCodes: remainingBackup } : {}),
            })
            .where(eq(monitorUsers.email, email));
        })
      );
    } catch (error) {
      console.warn('[monitor/login/2fa] falha ao persistir login:', error);
    }

    clearPending2faCookie();
    await setSessionCookie({ role: 'monitor', email });
    return NextResponse.json({ ok: true, usedBackup, remainingBackup: remainingBackup.length });
  } catch (error) {
    console.error('[monitor/login/2fa] falha inesperada:', error);
    return NextResponse.json({ error: 'serviço temporariamente indisponível.' }, { status: 503 });
  }
}
