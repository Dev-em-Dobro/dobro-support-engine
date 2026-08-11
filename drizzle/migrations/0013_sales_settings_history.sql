-- Migration 0013 — Histórico de versões de sales_settings (rollback de chat_context)
-- Depends on: 0011_sales_settings.sql
--
-- Cada PUT bem-sucedido em sales_settings grava um snapshot imutável aqui. Isso
-- permite rollback rápido (≤1 min) caso uma versão maliciosa do chat_context
-- entre em produção — defesa contra conta de gestor comprometida (prompt
-- injection). Tabela insert-only: nunca atualizada/apagada no app.
--
-- Também adiciona dois event types de auditoria:
--   chat_context_rejected → o guard heurístico barrou um salvamento suspeito.
--   chat_context_restore  → uma versão anterior foi restaurada via histórico.
--
-- RLS: service/monitor full. Vendedores não acessam (registro interno).
-- ============================================================================

-- ALTER TYPE precisa rodar fora de transação — IF NOT EXISTS torna idempotente.
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'chat_context_rejected';
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'chat_context_restore';

BEGIN;

CREATE TABLE IF NOT EXISTS sales_settings_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL,
  version         integer NOT NULL,
  value           text NOT NULL,
  edited_by_email text,
  edited_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_settings_history_key_version_idx
  ON sales_settings_history (key, version);

CREATE INDEX IF NOT EXISTS sales_settings_history_key_edited_idx
  ON sales_settings_history (key, edited_at DESC);

ALTER TABLE sales_settings_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_settings_history_service_all ON sales_settings_history;
CREATE POLICY sales_settings_history_service_all ON sales_settings_history
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS sales_settings_history_monitor_all ON sales_settings_history;
CREATE POLICY sales_settings_history_monitor_all ON sales_settings_history
  FOR ALL
  USING (app_user_role() = 'monitor')
  WITH CHECK (app_user_role() = 'monitor');

-- Backfill: semeia a versão 1 com o valor atual de cada chave que ainda não
-- tem histórico, pra que a primeira edição não pareça surgir do nada.
INSERT INTO sales_settings_history (key, version, value, edited_by_email, edited_at)
SELECT s.key, 1, s.value, s.updated_by_email, s.updated_at
FROM sales_settings s
WHERE NOT EXISTS (
  SELECT 1 FROM sales_settings_history h WHERE h.key = s.key
);

COMMIT;
