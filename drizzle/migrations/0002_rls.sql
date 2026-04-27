-- ============================================================================
-- Dobro Support — Row-Level Security policies
-- Migration: 0002_rls.sql
-- Depends on: 0001_init.sql
--
-- Strategy:
--   1 Postgres role for the app (we use the default Neon role, configured via env).
--   Per-request, the app sets session variables:
--     SET LOCAL app.user_email = 'student@example.com';
--     SET LOCAL app.user_role  = 'student' | 'monitor' | 'service';
--   Policies consult current_setting('app.user_email', true) and current_setting('app.user_role', true).
--
-- Why this strategy (vs Neon serverless roles):
--   - Single connection pool (works with Neon HTTP driver — per-request connections)
--   - Simpler grants (no role proliferation)
--   - Neon's own multi-tenant examples use exactly this pattern
--   - Easy to test: `SELECT set_config('app.user_email','a@b.c', true);` in psql
--
-- Defense-in-depth:
--   - App ALSO checks ownership before querying (never rely solely on RLS)
--   - Service-role queries (cron, migrations) run with app.user_role='service' to bypass policies
--   - auth_tokens / auth_events are service-role only (no student/monitor access)
-- ============================================================================

BEGIN;

-- ---------- Helper functions ----------
CREATE OR REPLACE FUNCTION app_user_email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_email', true), '')
$$;

CREATE OR REPLACE FUNCTION app_user_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_role', true), ''), 'anonymous')
$$;

CREATE OR REPLACE FUNCTION app_is_monitor() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_user_role() IN ('monitor', 'service')
$$;

CREATE OR REPLACE FUNCTION app_is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_user_role() = 'service'
$$;

-- ---------- Enable RLS ----------
ALTER TABLE auth_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdfs             ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owner (defense in depth against accidental elevated queries)
-- Commented out because service role needs to bypass. Only enable on specific tables if desired.
-- ALTER TABLE submissions FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- auth_tokens — service role only
-- ============================================================================
CREATE POLICY auth_tokens_service_all ON auth_tokens
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

-- ============================================================================
-- auth_events — service role only (append-only by app)
-- ============================================================================
CREATE POLICY auth_events_service_all ON auth_events
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

-- ============================================================================
-- submissions
-- ============================================================================
-- Student: SELECT own rows
CREATE POLICY submissions_student_select ON submissions
  FOR SELECT
  USING (
    app_user_role() = 'student'
    AND student_email = app_user_email()
  );

-- Student: INSERT only own rows (email must match session)
CREATE POLICY submissions_student_insert ON submissions
  FOR INSERT
  WITH CHECK (
    app_user_role() = 'student'
    AND student_email = app_user_email()
  );

-- Student: UPDATE disallowed (only service moves statuses forward)
-- (No policy → deny by default)

-- Monitor & service: full access
CREATE POLICY submissions_monitor_all ON submissions
  FOR ALL
  USING (app_is_monitor())
  WITH CHECK (app_is_monitor());

-- ============================================================================
-- screenshots — readable by owner of submission + monitor/service
-- ============================================================================
CREATE POLICY screenshots_student_select ON screenshots
  FOR SELECT
  USING (
    app_user_role() = 'student'
    AND EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = screenshots.submission_id
        AND s.student_email = app_user_email()
    )
  );

CREATE POLICY screenshots_monitor_all ON screenshots
  FOR ALL
  USING (app_is_monitor())
  WITH CHECK (app_is_monitor());

-- ============================================================================
-- corrections — student reads own (only after approved/delivered), monitor all
-- Rationale: aluno não deve ver o draft antes do monitor aprovar
-- ============================================================================
CREATE POLICY corrections_student_select_approved ON corrections
  FOR SELECT
  USING (
    app_user_role() = 'student'
    AND EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = corrections.submission_id
        AND s.student_email = app_user_email()
        AND s.status IN ('approved', 'delivered')
    )
  );

CREATE POLICY corrections_monitor_all ON corrections
  FOR ALL
  USING (app_is_monitor())
  WITH CHECK (app_is_monitor());

-- ============================================================================
-- monitor_actions — monitors can INSERT + SELECT own/all, no UPDATE/DELETE (trigger blocks)
-- Students: no access
-- ============================================================================
CREATE POLICY monitor_actions_monitor_select ON monitor_actions
  FOR SELECT
  USING (app_is_monitor());

CREATE POLICY monitor_actions_monitor_insert ON monitor_actions
  FOR INSERT
  WITH CHECK (app_is_monitor());

-- ============================================================================
-- pdfs — student reads own (only after delivered), monitor/service all
-- ============================================================================
CREATE POLICY pdfs_student_select_delivered ON pdfs
  FOR SELECT
  USING (
    app_user_role() = 'student'
    AND EXISTS (
      SELECT 1 FROM submissions s
      WHERE s.id = pdfs.submission_id
        AND s.student_email = app_user_email()
        AND s.status = 'delivered'
    )
  );

CREATE POLICY pdfs_monitor_all ON pdfs
  FOR ALL
  USING (app_is_monitor())
  WITH CHECK (app_is_monitor());

-- ============================================================================
-- Test queries (run manually after migration — MUST pass)
-- ============================================================================
-- -- Setup: insert two students, verify isolation
-- INSERT INTO submissions (student_email, github_url) VALUES
--   ('alice@test.com', 'https://github.com/alice/repo1'),
--   ('bob@test.com',   'https://github.com/bob/repo2');
--
-- -- As Alice: sees only her row
-- SET LOCAL app.user_email = 'alice@test.com';
-- SET LOCAL app.user_role  = 'student';
-- SELECT count(*) FROM submissions;  -- expected: 1
--
-- -- As Bob: sees only his row
-- SET LOCAL app.user_email = 'bob@test.com';
-- SET LOCAL app.user_role  = 'student';
-- SELECT count(*) FROM submissions;  -- expected: 1
--
-- -- As monitor: sees both
-- SET LOCAL app.user_role  = 'monitor';
-- SELECT count(*) FROM submissions;  -- expected: 2
--
-- -- As anonymous: sees nothing
-- RESET app.user_email;
-- RESET app.user_role;
-- SELECT count(*) FROM submissions;  -- expected: 0

COMMIT;
