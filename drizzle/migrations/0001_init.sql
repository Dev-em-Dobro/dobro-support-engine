-- ============================================================================
-- Dobro Support — Initial schema v1
-- Migration: 0001_init.sql
-- PRD: docs/prd/dobro-support.md
--
-- Execution order:
--   1. Run this file (DDL)
--   2. Run 0002_rls.sql (policies)
--   3. Run seed.ts (via Drizzle)
--
-- Safe to run on empty DB. NOT idempotent (use IF NOT EXISTS guards in patches).
-- ============================================================================

BEGIN;

-- ---------- Extensions ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- v2 RAG (installed early to avoid future migration friction)
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email comparisons if needed later

-- ---------- Enums ----------
CREATE TYPE submission_status AS ENUM (
  'pending_auth',
  'queued',
  'processing',
  'draft',
  'approved',
  'rejected',
  'delivered',
  'failed'
);

CREATE TYPE monitor_action_type AS ENUM (
  'edit',
  'approve',
  'reject',
  'regenerate'
);

CREATE TYPE auth_event_type AS ENUM (
  'magic_link_issued',
  'magic_link_consumed',
  'magic_link_expired',
  'magic_link_rate_limited',
  'login',
  'logout',
  'session_refresh',
  'unauthorized_access_attempt'
);

CREATE TYPE viewport AS ENUM ('desktop', 'mobile');

-- ---------- auth_tokens ----------
CREATE TABLE auth_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX auth_tokens_token_hash_idx ON auth_tokens (token_hash);
CREATE INDEX auth_tokens_email_created_idx    ON auth_tokens (email, created_at DESC);

COMMENT ON TABLE  auth_tokens IS 'Magic-link tokens for student authentication. Single-use, 15-min TTL.';
COMMENT ON COLUMN auth_tokens.token_hash IS 'SHA-256 of the raw token. Raw token is only sent via email, never stored.';

-- ---------- auth_events (audit) ----------
CREATE TABLE auth_events (
  id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  auth_event_type   NOT NULL,
  email_hash  text              NOT NULL,
  ip          inet,
  user_agent  text,
  created_at  timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX auth_events_email_hash_created_idx ON auth_events (email_hash, created_at DESC);
CREATE INDEX auth_events_created_idx            ON auth_events (created_at DESC);

COMMENT ON TABLE  auth_events IS 'Immutable audit log for auth events. Emails stored hashed (SHA-256) for LGPD compliance.';

-- ---------- submissions ----------
CREATE TABLE submissions (
  id             uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  student_email  text              NOT NULL,
  github_url     text              NOT NULL,
  deployed_url   text,
  submitted_at   timestamptz       NOT NULL DEFAULT now(),
  corrected_at   timestamptz,
  delivered_at   timestamptz,
  status         submission_status NOT NULL DEFAULT 'pending_auth',
  error_msg      text,
  correction_url text,
  updated_at     timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT submissions_github_url_chk
    CHECK (github_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'),
  CONSTRAINT submissions_email_chk
    CHECK (student_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX submissions_email_submitted_idx  ON submissions (student_email, submitted_at DESC);
CREATE INDEX submissions_status_submitted_idx ON submissions (status, submitted_at);

-- Partial index: cron pickup + overdue checker operate only on non-terminal statuses.
-- Enormously cheaper than a full-table scan since most rows end up in delivered/rejected/failed.
CREATE INDEX submissions_active_status_idx ON submissions (status, submitted_at)
  WHERE status IN ('queued', 'processing', 'draft', 'approved');

CREATE INDEX submissions_delivered_at_idx ON submissions (delivered_at)
  WHERE delivered_at IS NOT NULL;

COMMENT ON TABLE  submissions IS 'One row per student submission. Status machine: pending_auth->queued->processing->draft->(approved|rejected)->delivered|failed.';

-- Trigger: updated_at auto-bump
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER submissions_set_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- screenshots ----------
CREATE TABLE screenshots (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  viewport       viewport    NOT NULL,
  data           bytea       NOT NULL,
  mime_type      text        NOT NULL DEFAULT 'image/webp',
  size_bytes     integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screenshots_size_chk CHECK (size_bytes <= 524288) -- 512KB
);

CREATE UNIQUE INDEX screenshots_submission_viewport_idx ON screenshots (submission_id, viewport);

COMMENT ON TABLE  screenshots IS 'WebP screenshots at desktop (1440px) and mobile (390px). Served via authenticated API routes only.';

-- ---------- corrections ----------
CREATE TABLE corrections (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid           NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  grade           numeric(3,1)   NOT NULL,
  strengths       jsonb          NOT NULL,
  improvements    jsonb          NOT NULL,
  narrative_md    text           NOT NULL,
  model           text           NOT NULL,
  prompt_version  text           NOT NULL,
  rag_sources     jsonb,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  updated_at      timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT corrections_grade_chk CHECK (grade >= 0 AND grade <= 10)
);

CREATE TRIGGER corrections_set_updated_at
  BEFORE UPDATE ON corrections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE corrections IS 'AI-generated correction output. One per submission. Monitor edits this before approval.';

-- ---------- monitor_actions (audit, append-only) ----------
CREATE TABLE monitor_actions (
  id              uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid                 NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  monitor_user_id text                 NOT NULL,
  monitor_email   text                 NOT NULL,
  action          monitor_action_type  NOT NULL,
  edits           jsonb,
  created_at      timestamptz          NOT NULL DEFAULT now()
);

CREATE INDEX monitor_actions_submission_created_idx ON monitor_actions (submission_id, created_at DESC);

COMMENT ON TABLE monitor_actions IS 'Append-only audit log of monitor actions. Never UPDATE/DELETE — enforced by policy in 0002_rls.sql.';

-- Enforce append-only: block UPDATE and DELETE via trigger
CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'monitor_actions is append-only; % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER monitor_actions_no_update
  BEFORE UPDATE ON monitor_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER monitor_actions_no_delete
  BEFORE DELETE ON monitor_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ---------- pdfs ----------
CREATE TABLE pdfs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  data           bytea       NOT NULL,
  mime_type      text        NOT NULL DEFAULT 'application/pdf',
  version        integer     NOT NULL DEFAULT 1,
  size_bytes     integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pdfs_size_chk CHECK (size_bytes <= 2097152) -- 2MB
);

CREATE UNIQUE INDEX pdfs_submission_version_idx ON pdfs (submission_id, version);

COMMENT ON TABLE pdfs IS 'Final correction PDFs. Version increments on regeneration. Served via authenticated API route only.';

COMMIT;
