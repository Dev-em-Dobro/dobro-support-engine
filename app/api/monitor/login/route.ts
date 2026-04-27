import { NextResponse } from 'next/server';
import { z } from 'zod';
import { setSessionCookie } from '@/lib/session';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'dados inválidos' }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const allowed = env.MONITOR_EMAILS.includes(email);
  const expected = env.MONITOR_PASSWORD;

  if (!allowed || !expected || parsed.data.password !== expected) {
    // Mesma resposta pra ambos os casos — evita enumeration
    return NextResponse.json({ error: 'credenciais inválidas' }, { status: 401 });
  }

  await setSessionCookie({ role: 'monitor', email });
  return NextResponse.json({ ok: true });
}
