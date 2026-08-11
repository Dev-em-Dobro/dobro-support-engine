-- Migration 0015 — Aprovação two-eyes do chat_context (opt-in)
-- Depends on: 0011_sales_settings.sql, 0013_sales_settings_history.sql
--
-- Quando SALES_CONTEXT_REQUIRE_APPROVAL=true, uma edição do chat_context não é
-- aplicada direto: fica nas colunas pending_* até um SEGUNDO monitor aprovar.
-- Isso elimina o ataque solo — um único gestor comprometido não empurra
-- contexto malicioso pra produção sozinho. Com o flag desligado (default), o
-- comportamento é o de sempre (aplica direto).
--
-- Também adiciona os event types de auditoria do fluxo de revisão.
-- RLS de sales_settings (0011) já cobre as colunas novas.
-- ============================================================================

-- ALTER TYPE precisa rodar fora de transação — IF NOT EXISTS torna idempotente.
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'chat_context_submitted';
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'chat_context_approved';
ALTER TYPE sales_audit_event_type ADD VALUE IF NOT EXISTS 'chat_context_review_rejected';

BEGIN;

ALTER TABLE sales_settings ADD COLUMN IF NOT EXISTS pending_value text;
ALTER TABLE sales_settings ADD COLUMN IF NOT EXISTS pending_by_email text;
ALTER TABLE sales_settings ADD COLUMN IF NOT EXISTS pending_at timestamptz;

COMMIT;
