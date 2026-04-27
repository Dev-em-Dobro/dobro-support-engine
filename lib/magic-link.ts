/**
 * Magic-link issuance + consumption.
 *
 * Flow:
 *   1. POST /api/auth/request-link  → issueMagicLink(email)
 *        - creates a raw 32-byte token (base64url)
 *        - stores only sha256(token) in auth_tokens with 15-min TTL
 *        - returns the link (dev) or sends email (prod)
 *   2. GET  /api/auth/consume?token=... → consumeMagicLink(raw)
 *        - hashes input, finds unconsumed row with expires_at > now()
 *        - marks consumed_at, sets session cookie
 *
 * LGPD: raw email lives only during issuance; audit uses sha256(email).
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { asService } from './db-context';
import { authTokens, authEvents } from '@/drizzle/schema';
import { env } from './env';

const TTL_MS = 15 * 60 * 1000;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

export interface IssuedLink {
  url: string;
  /** Only populated in DEV_MODE for debugging. Never log in prod. */
  devRawToken?: string;
}

export async function issueMagicLink(
  email: string,
  meta: { ip?: string; userAgent?: string } = {}
): Promise<IssuedLink> {
  const normalized = email.toLowerCase().trim();
  const raw = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + TTL_MS);

  await asService(async (tx) => {
    await tx.insert(authTokens).values({
      email: normalized,
      tokenHash,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await tx.insert(authEvents).values({
      eventType: 'magic_link_issued',
      emailHash: hashEmail(normalized),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  const url = `${env.APP_URL}/api/auth/consume?token=${encodeURIComponent(raw)}`;
  return env.DEV_MODE ? { url, devRawToken: raw } : { url };
}

export interface ConsumedLink {
  ok: boolean;
  email?: string;
  reason?: 'invalid' | 'expired' | 'already_used';
}

export async function consumeMagicLink(
  raw: string,
  meta: { ip?: string; userAgent?: string } = {}
): Promise<ConsumedLink> {
  const tokenHash = hashToken(raw);
  const now = new Date();

  return asService(async (tx) => {
    const rows = await tx
      .select()
      .from(authTokens)
      .where(eq(authTokens.tokenHash, tokenHash))
      .limit(1);
    const token = rows[0];

    if (!token) {
      await tx.insert(authEvents).values({
        eventType: 'unauthorized_access_attempt',
        emailHash: 'unknown',
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ok: false, reason: 'invalid' as const };
    }
    if (token.consumedAt) {
      return { ok: false, reason: 'already_used' as const };
    }
    if (token.expiresAt < now) {
      await tx.insert(authEvents).values({
        eventType: 'magic_link_expired',
        emailHash: hashEmail(token.email),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { ok: false, reason: 'expired' as const };
    }

    await tx
      .update(authTokens)
      .set({ consumedAt: now })
      .where(eq(authTokens.id, token.id));

    await tx.insert(authEvents).values({
      eventType: 'magic_link_consumed',
      emailHash: hashEmail(token.email),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return { ok: true, email: token.email };
  });
}

/** Reserved for future rate-limit lookups. */
export async function countRecentLinks(email: string, windowMs = 10 * 60 * 1000): Promise<number> {
  const normalized = email.toLowerCase().trim();
  const since = new Date(Date.now() - windowMs);
  const rows = await asService(async (tx) =>
    tx
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.email, normalized), gt(authTokens.createdAt, since), isNull(authTokens.consumedAt)))
  );
  return rows.length;
}
