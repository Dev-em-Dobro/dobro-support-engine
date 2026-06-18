-- Migration 0011 — Sales Settings: key-value store editável pelo gestor de vendas (monitor)
-- Depends on: 0007_sales_agent.sql, 0010_sales_rls.sql
--
-- Tabela key-value com chaves controladas (chat_context, how_it_works).
-- chat_context  → texto livre concatenado ao SYSTEM_PROMPT do agente de vendas.
-- how_it_works  → markdown explicando como o chat funciona (lido por vendedores).
--
-- RLS: service/monitor full; sales SELECT (vendedores leem how_it_works).
-- Limite de 20.000 chars por valor (proteção contra payload abusivo).
-- ============================================================================

-- ALTER TYPE precisa rodar fora de transação (pg < 12) — IF NOT EXISTS torna idempotente.
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'chat_context_update';
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'how_it_works_update';

BEGIN;

CREATE TABLE IF NOT EXISTS sales_settings (
  key              text PRIMARY KEY CHECK (key IN ('chat_context', 'how_it_works')),
  value            text NOT NULL DEFAULT '' CHECK (char_length(value) <= 20000),
  updated_by_email text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_settings_service_all ON sales_settings;
CREATE POLICY sales_settings_service_all ON sales_settings
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS sales_settings_monitor_all ON sales_settings;
CREATE POLICY sales_settings_monitor_all ON sales_settings
  FOR ALL
  USING (app_user_role() = 'monitor')
  WITH CHECK (app_user_role() = 'monitor');

DROP POLICY IF EXISTS sales_settings_sales_select ON sales_settings;
CREATE POLICY sales_settings_sales_select ON sales_settings
  FOR SELECT
  USING (app_is_sales());

-- Seed das chaves (UPSERT-safe). Sem rows aqui o UPDATE no app falharia silenciosamente.
INSERT INTO sales_settings (key, value) VALUES ('chat_context', '')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO sales_settings (key, value) VALUES ('how_it_works', '')
  ON CONFLICT (key) DO NOTHING;

COMMIT;
