-- Migration 0016 — Avaliação automatizada do Agente de Vendas
-- Depends on: 0008_kb_tables.sql (extensão vector), 0011_sales_settings.sql
--
-- Detecta envenenamento sutil do agente: roda um conjunto fixo de perguntas
-- canônicas, embeda as respostas e compara com um baseline confiável. Se a
-- divergência passar do threshold, dispara alerta — pega mudanças de
-- comportamento que o guard heurístico (texto) não enxerga.
--
--   sales_eval_baseline → resposta + embedding de referência por pergunta.
--   sales_eval_runs      → histórico de execuções e seus scores.
--
-- RLS: service/monitor full (mesmo padrão de sales_settings).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sales_eval_baseline (
  question_id text PRIMARY KEY,
  question    text NOT NULL,
  answer      text NOT NULL,
  embedding   vector(1536) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_eval_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger           text NOT NULL,
  chat_context_hash text,
  question_count    integer NOT NULL DEFAULT 0,
  avg_divergence    numeric(6,4),
  max_divergence    numeric(6,4),
  flagged           boolean NOT NULL DEFAULT false,
  is_baseline       boolean NOT NULL DEFAULT false,
  details           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_eval_runs_created_idx ON sales_eval_runs (created_at DESC);

ALTER TABLE sales_eval_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_eval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_eval_baseline_service_all ON sales_eval_baseline;
CREATE POLICY sales_eval_baseline_service_all ON sales_eval_baseline
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS sales_eval_baseline_monitor_all ON sales_eval_baseline;
CREATE POLICY sales_eval_baseline_monitor_all ON sales_eval_baseline
  FOR ALL USING (app_user_role() = 'monitor') WITH CHECK (app_user_role() = 'monitor');

DROP POLICY IF EXISTS sales_eval_runs_service_all ON sales_eval_runs;
CREATE POLICY sales_eval_runs_service_all ON sales_eval_runs
  FOR ALL USING (app_is_service()) WITH CHECK (app_is_service());

DROP POLICY IF EXISTS sales_eval_runs_monitor_all ON sales_eval_runs;
CREATE POLICY sales_eval_runs_monitor_all ON sales_eval_runs
  FOR ALL USING (app_user_role() = 'monitor') WITH CHECK (app_user_role() = 'monitor');

COMMIT;
