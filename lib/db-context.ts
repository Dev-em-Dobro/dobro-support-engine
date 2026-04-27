/**
 * withUserContext — RLS session helper
 *
 * The Postgres policies in drizzle/migrations/0002_rls.sql consult
 *   current_setting('app.user_email', true)
 *   current_setting('app.user_role',  true)
 *
 * These settings must be applied *inside the same transaction* as the query,
 * otherwise the policy sees NULL and rejects (or leaks, for service bypasses).
 *
 * We use the pooled Drizzle client (drizzle-orm/neon-serverless) so that
 * `db.transaction(async (tx) => ...)` pins a single connection for the whole
 * callback. SET LOCAL expires at COMMIT.
 *
 * Usage:
 *   const rows = await withUserContext(
 *     { email: 'aluno@x.com', role: 'student' },
 *     async (tx) => tx.select().from(submissions)
 *   );
 */

import { sql as sqlExpr } from 'drizzle-orm';
import { dbTx } from './db';

export type UserRole = 'student' | 'monitor' | 'service';

export interface UserContext {
  role: UserRole;
  email?: string; // required for student/monitor; ignored for service
}

type TxType = Parameters<Parameters<typeof dbTx.transaction>[0]>[0];

export async function withUserContext<T>(
  ctx: UserContext,
  fn: (tx: TxType) => Promise<T>
): Promise<T> {
  if ((ctx.role === 'student' || ctx.role === 'monitor') && !ctx.email) {
    throw new Error(`withUserContext: email required for role=${ctx.role}`);
  }

  return dbTx.transaction(async (tx) => {
    // Use set_config() with is_local=true so values are bound to the current tx.
    // Parameterized via sqlExpr to avoid SQL injection on the email value.
    await tx.execute(
      sqlExpr`SELECT set_config('app.user_role', ${ctx.role}, true)`
    );
    if (ctx.email) {
      await tx.execute(
        sqlExpr`SELECT set_config('app.user_email', ${ctx.email.toLowerCase()}, true)`
      );
    } else {
      await tx.execute(sqlExpr`SELECT set_config('app.user_email', '', true)`);
    }
    return fn(tx);
  });
}

// Convenience helpers
export const asStudent = <T>(email: string, fn: (tx: TxType) => Promise<T>) =>
  withUserContext({ role: 'student', email }, fn);

export const asMonitor = <T>(email: string, fn: (tx: TxType) => Promise<T>) =>
  withUserContext({ role: 'monitor', email }, fn);

export const asService = <T>(fn: (tx: TxType) => Promise<T>) =>
  withUserContext({ role: 'service' }, fn);
