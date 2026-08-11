-- Migration 0010 — RLS policies for Sales Agent tables
-- Depends on: 0002_rls.sql (helper functions), 0007..0009 (tables)
--
-- Strategy mirrors 0002_rls.sql:
--   app.user_role = 'sales'   → vendedor logado
--   app.user_role = 'monitor' → monitor (KB admin)
--   app.user_role = 'service' → service bypass (cron, migrations, seed)
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION app_is_sales() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_user_role() = 'sales'
$$;

-- ============================================================================
-- sales_users — service only (bootstrap via CLI, not app-level reads)
-- ============================================================================
ALTER TABLE sales_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_users_service_all ON sales_users;
CREATE POLICY sales_users_service_all ON sales_users
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

-- ============================================================================
-- sales_audit_events — INSERT append-only for all roles; SELECT for monitor/service
-- ============================================================================
ALTER TABLE sales_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_audit_events_insert ON sales_audit_events;
CREATE POLICY sales_audit_events_insert ON sales_audit_events
  FOR INSERT
  WITH CHECK (app_user_role() IN ('sales', 'monitor', 'service'));

DROP POLICY IF EXISTS sales_audit_events_select ON sales_audit_events;
CREATE POLICY sales_audit_events_select ON sales_audit_events
  FOR SELECT
  USING (app_user_role() IN ('monitor', 'service'));

-- ============================================================================
-- kb_documents — monitor: full; sales: SELECT non-archived; service: full
-- ============================================================================
ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kb_documents_service_all ON kb_documents;
CREATE POLICY kb_documents_service_all ON kb_documents
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS kb_documents_monitor_all ON kb_documents;
CREATE POLICY kb_documents_monitor_all ON kb_documents
  FOR ALL
  USING (app_user_role() = 'monitor')
  WITH CHECK (app_user_role() = 'monitor');

DROP POLICY IF EXISTS kb_documents_sales_select ON kb_documents;
CREATE POLICY kb_documents_sales_select ON kb_documents
  FOR SELECT
  USING (app_is_sales() AND archived_at IS NULL AND status = 'active');

-- ============================================================================
-- kb_document_versions — monitor: full; sales: SELECT via active doc; service: full
-- ============================================================================
ALTER TABLE kb_document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kb_document_versions_service_all ON kb_document_versions;
CREATE POLICY kb_document_versions_service_all ON kb_document_versions
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS kb_document_versions_monitor_all ON kb_document_versions;
CREATE POLICY kb_document_versions_monitor_all ON kb_document_versions
  FOR ALL
  USING (app_user_role() = 'monitor')
  WITH CHECK (app_user_role() = 'monitor');

DROP POLICY IF EXISTS kb_document_versions_sales_select ON kb_document_versions;
CREATE POLICY kb_document_versions_sales_select ON kb_document_versions
  FOR SELECT
  USING (
    app_is_sales() AND EXISTS (
      SELECT 1 FROM kb_documents d
      WHERE d.id = document_id
        AND d.archived_at IS NULL
        AND d.status = 'active'
        AND d.current_version_id = kb_document_versions.id
    )
  );

-- ============================================================================
-- kb_chunks — monitor: full; sales: SELECT via active doc/current version; service: full
-- ============================================================================
ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kb_chunks_service_all ON kb_chunks;
CREATE POLICY kb_chunks_service_all ON kb_chunks
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS kb_chunks_monitor_all ON kb_chunks;
CREATE POLICY kb_chunks_monitor_all ON kb_chunks
  FOR ALL
  USING (app_user_role() = 'monitor')
  WITH CHECK (app_user_role() = 'monitor');

DROP POLICY IF EXISTS kb_chunks_sales_select ON kb_chunks;
CREATE POLICY kb_chunks_sales_select ON kb_chunks
  FOR SELECT
  USING (
    app_is_sales() AND EXISTS (
      SELECT 1 FROM kb_documents d
      WHERE d.id = document_id
        AND d.archived_at IS NULL
        AND d.status = 'active'
        AND d.current_version_id = version_id
    )
  );

-- ============================================================================
-- sales_conversations — sales: own rows; monitor: SELECT aggregate (via view, v1.1); service: full
-- ============================================================================
ALTER TABLE sales_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_conversations_service_all ON sales_conversations;
CREATE POLICY sales_conversations_service_all ON sales_conversations
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS sales_conversations_sales_own ON sales_conversations;
CREATE POLICY sales_conversations_sales_own ON sales_conversations
  FOR ALL
  USING (app_is_sales() AND sales_user_email = app_user_email())
  WITH CHECK (app_is_sales() AND sales_user_email = app_user_email());

-- ============================================================================
-- sales_messages — follows parent conversation ownership
-- ============================================================================
ALTER TABLE sales_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_messages_service_all ON sales_messages;
CREATE POLICY sales_messages_service_all ON sales_messages
  FOR ALL
  USING (app_is_service())
  WITH CHECK (app_is_service());

DROP POLICY IF EXISTS sales_messages_sales_own ON sales_messages;
CREATE POLICY sales_messages_sales_own ON sales_messages
  FOR ALL
  USING (
    app_is_sales() AND EXISTS (
      SELECT 1 FROM sales_conversations c
      WHERE c.id = conversation_id
        AND c.sales_user_email = app_user_email()
    )
  )
  WITH CHECK (
    app_is_sales() AND EXISTS (
      SELECT 1 FROM sales_conversations c
      WHERE c.id = conversation_id
        AND c.sales_user_email = app_user_email()
    )
  );

COMMIT;
