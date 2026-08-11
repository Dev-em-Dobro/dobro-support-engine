/**
 * Session layer — JWT cookie for both student and monitor.
 *
 * - Student: role='student', email=<student_email>
 * - Monitor: role='monitor', email=<monitor_email>
 *
 * HS256, 24h expiry, httpOnly + sameSite=lax + secure in prod.
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { env } from './env';

export const SESSION_COOKIE_NAME = 'dobro_session';
// Cookie intermediário entre senha-ok e código-2FA-ok. Curto (5min) e marcado
// como pendente: NÃO é uma sessão válida, só prova que a senha foi aceita.
export const PENDING_2FA_COOKIE_NAME = 'dobro_2fa_pending';
const ALG = 'HS256';
const MAX_AGE_SEC = 60 * 60 * 24; // 24h
const PENDING_2FA_MAX_AGE_SEC = 60 * 5; // 5min

export interface Session {
  role: 'student' | 'monitor' | 'sales';
  email: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SEC,
};

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, email: s.email })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (
      (payload.role === 'student' || payload.role === 'monitor' || payload.role === 'sales') &&
      typeof payload.email === 'string'
    ) {
      return { role: payload.role, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}

/** Set session cookie via next/headers (use in Server Actions / Route Handlers that return JSON). */
export async function setSessionCookie(s: Session): Promise<void> {
  const token = await signSession(s);
  cookies().set(SESSION_COOKIE_NAME, token, COOKIE_OPTS);
}

/** Attach session cookie directly to a NextResponse (use when returning a redirect). */
export async function attachSessionCookie(res: NextResponse, s: Session): Promise<NextResponse> {
  const token = await signSession(s);
  res.cookies.set(SESSION_COOKIE_NAME, token, COOKIE_OPTS);
  return res;
}

export function clearSessionCookie(): void {
  cookies().delete(SESSION_COOKIE_NAME);
}

// ---------- 2FA pré-auth ----------

const PENDING_2FA_COOKIE_OPTS = {
  ...COOKIE_OPTS,
  maxAge: PENDING_2FA_MAX_AGE_SEC,
};

/** Emite e seta o cookie de pré-auth (senha ok, falta o código 2FA). */
export async function setPending2faCookie(email: string): Promise<void> {
  const token = await new SignJWT({ email, pending2fa: true })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_2FA_MAX_AGE_SEC}s`)
    .sign(secret());
  cookies().set(PENDING_2FA_COOKIE_NAME, token, PENDING_2FA_COOKIE_OPTS);
}

/** Lê o cookie de pré-auth e devolve o email se válido. */
export async function getPending2fa(): Promise<{ email: string } | null> {
  const c = cookies().get(PENDING_2FA_COOKIE_NAME);
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c.value, secret());
    if (payload.pending2fa === true && typeof payload.email === 'string') {
      return { email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPending2faCookie(): void {
  cookies().delete(PENDING_2FA_COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  const c = cookies().get(SESSION_COOKIE_NAME);
  if (!c) return null;
  return verifySession(c.value);
}

export async function requireStudent(): Promise<Session> {
  const s = await getSession();
  if (!s || s.role !== 'student') {
    throw new Response('Unauthorized', { status: 401 });
  }
  return s;
}

export async function requireMonitor(): Promise<Session> {
  const s = await getSession();
  if (!s || s.role !== 'monitor') {
    throw new Response('Unauthorized', { status: 401 });
  }
  return s;
}

export async function requireSales(): Promise<Session> {
  const s = await getSession();
  if (!s || s.role !== 'sales') {
    throw new Response('Unauthorized', { status: 401 });
  }
  return s;
}
