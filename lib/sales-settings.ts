/**
 * sales-settings — leitura cacheada das chaves de sales_settings.
 *
 * O chat route lê chat_context em toda mensagem. Cache em memória com TTL
 * curto (60s) evita 1 query extra por chamada de chat sem comprometer a
 * latência da edição pelo gestor — quando o PUT acontece, chama
 * invalidateChatContextCache() pra refletir imediato no próximo chat.
 *
 * Não persiste entre cold-starts; isso é aceitável (o pior caso é 1 cache
 * miss extra). Não usa Redis pra manter stack simples (só Postgres).
 */

import { eq } from 'drizzle-orm';
import { asService } from './db-context';
import { salesSettings } from '@/drizzle/schema';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

async function loadSetting(key: 'chat_context' | 'how_it_works'): Promise<string> {
  const rows = await asService(async (tx) =>
    tx.select({ value: salesSettings.value }).from(salesSettings).where(eq(salesSettings.key, key)).limit(1)
  );
  return rows[0]?.value ?? '';
}

export async function getChatContext(): Promise<string> {
  const now = Date.now();
  const cached = cache.get('chat_context');
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const value = await loadSetting('chat_context');
    cache.set('chat_context', { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  } catch (err) {
    // Falha de leitura não pode quebrar o chat — degrada pra string vazia.
    console.warn('[sales-settings] falha ao ler chat_context:', err);
    return cached?.value ?? '';
  }
}

export function invalidateChatContextCache(): void {
  cache.delete('chat_context');
}
