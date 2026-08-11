-- Migration 0012 — Persistência do prompt efetivo nas respostas do agente de vendas
-- Depends on: 0009_sales_conversations.sql
--
-- Adiciona sales_messages.effective_prompt: snapshot do system prompt usado pelo
-- LLM no momento da resposta (regras inegociáveis + contexto editável do gestor +
-- trechos da KB recuperados). Serve para auditoria forense de respostas
-- inesperadas — ex.: chunks desatualizados ou prompt injection via chat_context.
--
-- Coluna nullable: só mensagens do assistente a preenchem; histórico antigo fica
-- NULL. Sem default para não reescrever linhas existentes.
-- ============================================================================

BEGIN;

ALTER TABLE sales_messages ADD COLUMN IF NOT EXISTS effective_prompt text;

COMMIT;
