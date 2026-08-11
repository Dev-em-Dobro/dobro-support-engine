/**
 * totp — TOTP (RFC 6238) + HOTP (RFC 4226) com node:crypto, sem dependência.
 *
 * Usado no 2FA do gestor de vendas (role 'monitor'). Compatível com Google
 * Authenticator, Authy, 1Password etc.: SHA1, 6 dígitos, janela de 30s.
 *
 * O secret é gerado aqui em base32 e exibido uma única vez no enrollment (QR
 * via URI otpauth:// ou digitação manual). Em repouso ele é cifrado — ver
 * lib/crypto-secret.ts. Nada aqui persiste estado.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** Gera um novo secret base32 (160 bits por padrão). */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/**
 * Verifica um código TOTP de 6 dígitos. window=1 aceita o passo anterior e o
 * próximo (±30s) pra tolerar relógio dessincronizado. Comparação constant-time.
 */
export function verifyTotp(secretB32: string, token: string, window = 1): boolean {
  const t = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  const secret = base32Decode(secretB32);
  if (secret.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqualStr(hotp(secret, counter + i), t)) return true;
  }
  return false;
}

/** URI otpauth:// pra QR code / importação no app autenticador. */
export function otpauthUri(secretB32: string, account: string, issuer = 'Dev em Dobro'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Quebra o secret em grupos de 4 pra facilitar digitação manual. */
export function formatSecretForDisplay(secretB32: string): string {
  return secretB32.replace(/(.{4})/g, '$1 ').trim();
}

// ---------- Backup codes ----------
// Códigos de uso único pra recuperar acesso se o device do TOTP for perdido.
// São alta-entropia (40 bits), então sha256 (sem salt/KDF) é suficiente.

/** Gera `count` códigos de backup no formato "abcd-ef12". */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = randomBytes(5).toString('hex'); // 10 chars
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
  }
  return codes;
}

function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, '').toLowerCase();
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
}

/**
 * Verifica um código de backup contra a lista de hashes. Se casar, devolve a
 * lista SEM o hash usado (uso único). Comparação constant-time.
 */
export function consumeBackupCode(
  code: string,
  hashes: string[]
): { ok: boolean; remaining: string[] } {
  const h = hashBackupCode(code);
  const idx = hashes.findIndex((stored) => timingSafeEqualStr(stored, h));
  if (idx === -1) return { ok: false, remaining: hashes };
  const remaining = hashes.slice();
  remaining.splice(idx, 1);
  return { ok: true, remaining };
}
