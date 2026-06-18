-- Migration 0007 — Sales Agent: sales_users + sales_audit_events
-- Depends on: 0001_init.sql

BEGIN;

CREATE TABLE IF NOT EXISTS sales_users (
  email         text PRIMARY KEY CHECK (email = lower(email)),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- CREATE TYPE não aceita IF NOT EXISTS; envolvemos num bloco que ignora o
-- duplicate_object pra a migration poder ser reaplicada em lote (db:migrate
-- sem filtro) sem quebrar quando o enum já existe.
DO $$ BEGIN
  CREATE TYPE sales_audit_event_type AS ENUM (
    'login',
    'logout',
    'unauthorized_access_attempt',
    'kb_create',
    'kb_reupload',
    'kb_archive',
    'kb_reactivate',
    'kb_reindex',
    'chat_query',
    'chat_response',
    'rate_limited'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE sales_actor_role AS ENUM ('sales', 'monitor', 'service');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS sales_audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   sales_audit_event_type NOT NULL,
  actor_email  text,
  actor_role   sales_actor_role NOT NULL,
  target_id    uuid,
  metadata     jsonb,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_audit_events_actor_created_idx
  ON sales_audit_events (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_audit_events_event_type_created_idx
  ON sales_audit_events (event_type, created_at DESC);

COMMIT;
