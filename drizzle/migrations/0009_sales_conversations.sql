-- Migration 0009 — Sales Agent: conversations + messages
-- Depends on: 0007_sales_agent.sql, 0008_kb_tables.sql

BEGIN;

CREATE TABLE IF NOT EXISTS sales_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_user_email text NOT NULL,
  title            text,
  message_count    int NOT NULL DEFAULT 0,
  total_cost_usd   numeric(10,6) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_conversations_user_updated_idx
  ON sales_conversations (sales_user_email, updated_at DESC);

-- CREATE TYPE não aceita IF NOT EXISTS; bloco ignora duplicate_object para
-- permitir reaplicar a migration em lote.
DO $$ BEGIN
  CREATE TYPE sales_message_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS sales_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES sales_conversations(id) ON DELETE CASCADE,
  role            sales_message_role NOT NULL,
  content         text NOT NULL,
  sources         jsonb,
  model           text,
  prompt_version  text,
  tokens_in       int NOT NULL DEFAULT 0,
  tokens_out      int NOT NULL DEFAULT 0,
  cost_usd        numeric(10,6) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_messages_conversation_created_idx
  ON sales_messages (conversation_id, created_at);

COMMIT;
