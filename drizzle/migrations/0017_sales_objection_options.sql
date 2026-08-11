-- Migration 0017 — Persistência estruturada das opções do Modo Quebra de Objeção
-- Depends on: 0009_sales_conversations.sql, 0012_sales_effective_prompt.sql
--
-- Hoje a resposta de objeção é salva só em `content` (as 3 opções juntas por
-- \n\n), então ao reabrir a conversa ela renderiza como parágrafo, não como os
-- 3 cards copiáveis. Esta coluna guarda as opções como array JSON pra o
-- GET .../messages devolvê-las e o frontend reconstruir os cards.
--
-- Nullable: só mensagens do assistente em Modo Objeção a preenchem; chat normal
-- e histórico antigo ficam NULL (e seguem renderizando como texto).
-- ============================================================================

BEGIN;

ALTER TABLE sales_messages ADD COLUMN IF NOT EXISTS objection_options jsonb;

COMMIT;
