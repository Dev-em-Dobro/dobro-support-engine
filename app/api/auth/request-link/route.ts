import { NextResponse } from 'next/server';
import { z } from 'zod';
import { issueMagicLink, countRecentLinks } from '@/lib/magic-link';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(254),
});

const MAX_PER_10MIN = 5;

export async function POST(req: Request) {
  // Login nominado por e-mail está desabilitado por padrão. Em DEV_MODE o
  // endpoint ainda funciona (devolve o link no JSON) pra desenvolvimento e
  // testes; em produção retorna 410 Gone e o cliente mostra mensagem clara.
  if (!env.EMAIL_ENABLED && !env.DEV_MODE) {
    return NextResponse.json(
      {
        error: 'email_disabled',
        message:
          'Login por e-mail está desabilitado no momento. Use a página de envio do desafio (a correção é entregue ao vivo na tela).',
      },
      { status: 410 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'email inválido' }, { status: 400 });
  }

  const { email } = parsed.data;
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;
  const userAgent = req.headers.get('user-agent') || undefined;

  const recent = await countRecentLinks(email);
  if (recent >= MAX_PER_10MIN) {
    return NextResponse.json(
      { error: 'muitos links pedidos. Aguarda 10min.' },
      { status: 429 }
    );
  }

  const link = await issueMagicLink(email, { ip, userAgent });

  if (env.DEV_MODE) {
    // Em dev, devolvemos o link pra testar sem precisar de Resend.
    console.log(`[magic-link] ${email} → ${link.url}`);
    return NextResponse.json({ ok: true, devLink: link.url });
  }

  // Em produção com email habilitado: Resend (implementação mínima inline)
  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.FROM_EMAIL,
          to: email,
          subject: 'Seu link de acesso ao Dobro Support',
          html: `<p>Olá!</p>
<p>Clique no link abaixo pra entrar no Dobro Support:</p>
<p><a href="${link.url}">Entrar no Dobro Support</a></p>
<p>Esse link expira em 15 minutos e só pode ser usado uma vez.</p>`,
        }),
      });
    } catch {
      // log silenciado; não vaza pro cliente
    }
  }

  return NextResponse.json({ ok: true });
}
