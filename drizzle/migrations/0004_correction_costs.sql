-- Migration 0004 — tracking de custo por correção
--
-- Cada correção passa por 2 chamadas de IA (gerador + polisher), cada uma
-- consumindo tokens de input + output. Sem rastrear isso, não dá pra
-- responder "qual o custo médio por correção?" ou "qual o teto que estamos
-- gastando este mês?". Decisão Carlos 2026-04-25: custo precisa ser baixo.
--
-- Campos agregados (gerador + polisher somados). Se quiser breakdown por
-- pass, dá pra ler o JSONB monitor_actions.edits onde cada pass loga seu
-- próprio model + usage.
--
-- IDEMPOTENTE: pode rodar múltiplas vezes sem quebrar.

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS tokens_in INTEGER NOT NULL DEFAULT 0;

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS tokens_out INTEGER NOT NULL DEFAULT 0;

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corrections_tokens_in_nonneg_chk'
  ) THEN
    ALTER TABLE corrections
      ADD CONSTRAINT corrections_tokens_in_nonneg_chk CHECK (tokens_in >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corrections_tokens_out_nonneg_chk'
  ) THEN
    ALTER TABLE corrections
      ADD CONSTRAINT corrections_tokens_out_nonneg_chk CHECK (tokens_out >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'corrections_cost_usd_nonneg_chk'
  ) THEN
    ALTER TABLE corrections
      ADD CONSTRAINT corrections_cost_usd_nonneg_chk CHECK (cost_usd >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS corrections_created_cost_idx
  ON corrections(created_at, cost_usd);
