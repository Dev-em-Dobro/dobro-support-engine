import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, SESSION_COOKIE_NAME, type Session } from '@/lib/session';

export const config = {
  matcher: [
    // Vendedores (role 'sales')
    '/vendas/:path*',
    '/api/vendas/:path*',
    // Gestor de vendas / monitor (role 'monitor')
    '/gestor-vendas/:path*',
    '/api/gestor-vendas/:path*',
    '/monitor/vendas/:path*',
    '/api/monitor/vendas/:path*',
  ],
};

// Rotas públicas (não exigem sessão). Login de cada papel + auth endpoints.
const PUBLIC_PATHS = new Set([
  '/vendas/login',
  '/api/vendas/auth/login',
  '/monitor/login',
  '/api/monitor/login',
  // Login dedicado do gestor de vendas (reusa a auth do monitor, com 2FA).
  '/gestor-vendas/login',
]);

/**
 * Define o papel exigido e a tela de login de cada grupo de rotas. Mantém o
 * matcher e a verificação de papel em sincronia: ao adicionar uma rota
 * administrativa nova basta listá-la no matcher acima — a regra de papel é
 * derivada do prefixo aqui, sem depender de checagem manual no componente.
 */
// Casa o prefixo exato (ex.: `/vendas`) ou com sub-rota (`/vendas/...`). O
// matcher `/vendas/:path*` inclui o próprio `/vendas` sem barra, então um
// startsWith('/vendas/') sozinho deixaria a raiz escapar.
function matchesBase(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/');
}

function requiredRoleFor(pathname: string): { role: Session['role']; loginPath: string } | null {
  if (matchesBase(pathname, '/vendas') || matchesBase(pathname, '/api/vendas')) {
    return { role: 'sales', loginPath: '/vendas/login' };
  }
  if (
    matchesBase(pathname, '/gestor-vendas') ||
    matchesBase(pathname, '/api/gestor-vendas') ||
    matchesBase(pathname, '/monitor/vendas') ||
    matchesBase(pathname, '/api/monitor/vendas')
  ) {
    // Área do gestor de vendas: role 'monitor' (a conta que controla o agente),
    // mas a tela de login é a branded do gestor — não a de correções.
    return { role: 'monitor', loginPath: '/gestor-vendas/login' };
  }
  return null;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const required = requiredRoleFor(pathname);
  // Sem regra mapeada: por segurança, nega (não deveria ocorrer dado o matcher).
  if (!required) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session || session.role !== required.role) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = required.loginPath;
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
