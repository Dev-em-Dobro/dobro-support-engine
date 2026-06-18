/**
 * crypto-secret — cifra simétrica (AES-256-GCM) pra segredos em repouso.
 *
 * Hoje protege o `totp_secret` do gestor de vendas em monitor_users: mesmo que
 * o banco vaze, o secret do 2FA não é utilizável sem a chave da aplicação.
 *
 * A chave deriva de TOTP_ENC_KEY (se setada) ou, na falta, de AUTH_SECRET —
 * assim não exige nova variável obrigatória. ATENÇÃO: girar AUTH_SECRET/
 * TOTP_ENC_KEY invalida os secrets já cifrados (os gestores precisam re-fazer
 * o enrollment do 2FA).
 *
 * Formato: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>".
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from './env';

const IV_LEN = 12; // GCM padrão

function encKey(): Buffer {
  const base = process.env.TOTP_ENC_KEY || env.AUTH_SECRET;
  // sha256 garante 32 bytes (AES-256) independente do tamanho da fonte.
  return createHash('sha256').update(`${base}:totp-enc`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('crypto-secret: formato de ciphertext inválido');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
