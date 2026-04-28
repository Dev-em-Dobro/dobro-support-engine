/**
 * Password hashing — scrypt (Node.js built-in, sem dependência externa).
 *
 * Formato armazenado:
 *   "scrypt:N:r:p:salt_hex:hash_hex"
 *
 * Vantagens vs bcrypt/argon2:
 *   - Sem dependência (node:crypto já vem com Node).
 *   - Mesma família de KDF — resistente a GPU/ASIC.
 *   - Self-describing (parâmetros embutidos no hash) → migração de cost
 *     fica simples no futuro (cada hash carrega seu N/r/p).
 *
 * Compare é constant-time via crypto.timingSafeEqual — bloqueia timing attack.
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

// Parâmetros do scrypt — alinhados com OWASP Password Storage Cheat Sheet.
// N=2^15 = 32768 → ~50–100ms por hash em hardware moderno (alvo ~100ms).
// r=8, p=1 → padrão recomendado. keylen=64 → 512 bits de saída.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

const FORMAT_PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error('Senha precisa ter pelo menos 8 caracteres.');
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password, salt, KEY_LEN);
  return [
    FORMAT_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join(':');
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  // Hash com formato inválido → não autoriza. Não throw — login flow
  // converte em "credenciais inválidas" sem distinguir do caso "senha errada".
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  // Caps defensivos pra impedir DoS via hash com parâmetros malucos
  // (N=2^30 trava o servidor por minutos). Aceita só faixa razoável.
  if (N > 2 ** 20 || r > 32 || p > 16) return false;

  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = (await new Promise((resolve, reject) => {
      scrypt(password, salt, expected.length, { N, r, p }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    })) as Buffer;
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
