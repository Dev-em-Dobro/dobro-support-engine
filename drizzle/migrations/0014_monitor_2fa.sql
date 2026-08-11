-- Migration 0014 — 2FA (TOTP) para o gestor de vendas (monitor)
-- Depends on: 0005_security_hardening.sql (monitor_users)
--
-- Adiciona o segundo fator de autenticação na conta de monitor. O risco número
-- 1 do agente de vendas é a conta do gestor comprometida (quem controla o
-- chat_context molda o comportamento do agente). TOTP corta a maior parte desse
-- risco com baixo custo de UX.
--
--   totp_secret       → secret base32 CIFRADO (lib/crypto-secret), nullable.
--   totp_enabled_at   → quando NULL, é só enrollment pendente; 2FA não exigido.
--                       Após confirmar o primeiro código, vira obrigatório.
--   totp_backup_codes → hashes sha256 de códigos de uso único (recuperação).
--
-- monitor_users é RLS service-only; sem novas policies.
-- ============================================================================

-- ALTER TYPE precisa rodar fora de transação — IF NOT EXISTS torna idempotente.
ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'two_factor_enabled';
ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'two_factor_disabled';
ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'two_factor_failed';

BEGIN;

ALTER TABLE monitor_users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE monitor_users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE monitor_users ADD COLUMN IF NOT EXISTS totp_backup_codes jsonb;

COMMIT;
