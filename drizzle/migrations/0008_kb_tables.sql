-- Migration 0008 — KB tables for Sales Agent (knowledge base)
-- Depends on: 0001_init.sql (pgvector already enabled), 0007_sales_agent.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CREATE TYPE não aceita IF NOT EXISTS; bloco ignora duplicate_object para
-- permitir reaplicar a migration em lote.
DO $$ BEGIN
  CREATE TYPE kb_source_type AS ENUM ('pdf', 'markdown', 'faq');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE kb_document_status AS ENUM ('processing', 'active', 'failed', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS kb_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL CHECK (char_length(title) <= 200),
  source_type        kb_source_type NOT NULL,
  description        text CHECK (char_length(description) <= 500),
  tags               text[] NOT NULL DEFAULT '{}',
  status             kb_document_status NOT NULL DEFAULT 'processing',
  current_version_id uuid,
  created_by_email   text NOT NULL,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kb_documents_status_updated_idx ON kb_documents (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS kb_documents_source_type_idx ON kb_documents (source_type);
CREATE INDEX IF NOT EXISTS kb_documents_tags_gin_idx ON kb_documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS kb_documents_title_trgm_idx ON kb_documents USING GIN (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS kb_document_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  version             int NOT NULL,
  raw_text            text NOT NULL,
  raw_bytes           bytea,
  char_count          int NOT NULL,
  embedding_tokens    int NOT NULL DEFAULT 0,
  embedding_cost_usd  numeric(10,6) NOT NULL DEFAULT 0,
  created_by_email    text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES kb_documents(id),
  version_id   uuid NOT NULL REFERENCES kb_document_versions(id) ON DELETE CASCADE,
  chunk_index  int NOT NULL,
  content      text NOT NULL,
  token_count  int NOT NULL,
  embedding    vector(1536) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS kb_chunks_document_idx ON kb_chunks (document_id);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx ON kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);

-- FK from kb_documents.current_version_id to kb_document_versions.
-- ADD CONSTRAINT não aceita IF NOT EXISTS; bloco ignora duplicate_object.
DO $$ BEGIN
  ALTER TABLE kb_documents
    ADD CONSTRAINT kb_documents_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES kb_document_versions(id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

COMMIT;
