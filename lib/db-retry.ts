/**
 * Retry helper para erros transientes do Neon serverless.
 *
 * O Neon (especialmente free tier + dev local Windows) fecha websockets idle
 * ou em momentos de carga, fazendo `Connection terminated unexpectedly`
 * surgir tanto como rejeição da query atual quanto como evento na pool. Em
 * produção (Vercel) cada request roda em função isolada e o impacto é só
 * 5xx pontual; em dev derruba o processo via uncaughtException.
 *
 * Esse módulo:
 *   1. Exporta `isTransientDbError` + `withTransientRetry` pra uso explícito
 *      em rotas críticas (já em monitor/login/route.ts) e dentro do
 *      withUserContext (cobre todo `asService`/`asStudent`/`asMonitor`).
 *   2. Em DEV, instala um handler global que engole o uncaughtException
 *      QUANDO ele for transiente — pra não matar `next dev` toda vez que o
 *      socket cair. Em prod o handler não é instalado: erros uncaught devem
 *      seguir sendo visíveis pro runtime.
 */

export function isTransientDbError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lowered = msg.toLowerCase();
  return (
    lowered.includes('connection terminated unexpectedly') ||
    lowered.includes('fetch failed') ||
    lowered.includes('socket hang up') ||
    lowered.includes('econnreset') ||
    lowered.includes('etimedout') ||
    // Neon as vezes manda esses dois quando o pool tá renegociando
    lowered.includes('client has encountered a connection error') ||
    lowered.includes('terminating connection due to administrator command')
  );
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = i === attempts - 1;
      if (!isTransientDbError(error) || isLast) {
        throw error;
      }
      // Backoff incremental: 250ms, 500ms.
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastError;
}

// ---------- Dev-only uncaughtException safety net ----------
//
// Sem isso, queda de websocket do Neon vira uncaughtException, mata o
// processo do `next dev` e qualquer página seguinte vê
// "__webpack_modules__[moduleId] is not a function" → overlay
// "Missing required error components, refreshing...".
//
// Em PROD não é instalado: queremos visibilidade total de qualquer crash
// não tratado em produção. Aqui é só pra DX em dev.
const HANDLER_FLAG = Symbol.for('dobro.db.transient.uncaught.handler');
type ProcessWithFlag = typeof process & { [HANDLER_FLAG]?: true };

if (
  typeof process !== 'undefined' &&
  process.env.NODE_ENV !== 'production' &&
  !(process as ProcessWithFlag)[HANDLER_FLAG]
) {
  (process as ProcessWithFlag)[HANDLER_FLAG] = true;
  process.on('uncaughtException', (err) => {
    if (isTransientDbError(err)) {
      console.warn(
        '[db-retry] uncaughtException transiente do Neon engolido em dev:',
        err instanceof Error ? err.message : err
      );
      return;
    }
    // Não-transiente: relança pra Node lidar com o crash visivelmente
    // (sem loop, porque o handler só roda uma vez por evento).
    throw err;
  });
  // Mesma coisa pra unhandledRejection — Promise rejeitada do driver
  // é o canal mais comum quando o websocket cai durante uma query.
  process.on('unhandledRejection', (reason) => {
    if (isTransientDbError(reason)) {
      console.warn(
        '[db-retry] unhandledRejection transiente do Neon engolida em dev:',
        reason instanceof Error ? reason.message : reason
      );
      return;
    }
    throw reason as Error;
  });
}
