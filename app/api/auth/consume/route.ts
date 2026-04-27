import { NextResponse } from 'next/server';
import { consumeMagicLink } from '@/lib/magic-link';
import { attachSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('token');
  if (!raw) {
    return NextResponse.redirect(new URL('/entrar?erro=token_ausente', req.url));
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;
  const userAgent = req.headers.get('user-agent') || undefined;

  const result = await consumeMagicLink(raw, { ip, userAgent });
  if (!result.ok || !result.email) {
    const reason = result.reason || 'invalid';
    return NextResponse.redirect(new URL(`/entrar?erro=${reason}`, req.url));
  }

  const res = NextResponse.redirect(new URL('/correcoes', req.url));
  return attachSessionCookie(res, { role: 'student', email: result.email });
}
