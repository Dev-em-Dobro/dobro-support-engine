-- Migration 0005 — security hardening
--
-- Duas mudanças:
--
-- 1) Rate limit por IP em /api/correcoes/submit
--    Adiciona submissions.client_ip + index pra contar submits recentes do
--    mesmo IP. Sem isso, o endpoint público dispara o pipeline de IA (~$0.05
--    por chamada entre enumerator + writer + polisher) sem nenhum freio —
--    atacador roda script e gera centenas de USD de custo OpenAI numa noite.
--
-- 2) Login do monitor sai do env (MONITOR_EMAILS allowlist + MONITOR_PASSWORD
--    única e em texto puro) e vai pra tabela monitor_users com password_hash
--    per-user. Bootstrap via scripts/add-monitor.ts. Hash via scrypt
--    (node:crypto built-in, sem dependência nova). RLS service-only — só o
--    backend lê/escreve.
--
-- IDEMPOTENTE: pode rodar várias vezes sem quebrar.

-- ---------- 1) submissions.client_ip ----------
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS client_ip inet;

CREATE INDEX IF NOT EXISTS submissions_client_ip_recent_idx
  ON submissions (client_ip, submitted_at DESC);

COMMENT ON COLUMN submissions.client_ip IS 'IP do cliente que enviou — usado pra rate limit em /api/correcoes/submit. Pode ser NULL pra rows antigas (pré-0005).';


-- ---------- 2) monitor_users ----------
CREATE TABLE IF NOT EXISTS monitor_users (
  email          text         PRIMARY KEY,
  password_hash  text         NOT NULL,
  active         boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  CONSTRAINT monitor_users_email_chk
    CHECK (email = lower(email)),
  CONSTRAINT monitor_users_password_hash_chk
    CHECK (length(password_hash) >= 32)
);

COMMENT ON TABLE monitor_users IS 'Monitores (Carlos, Caique, etc) com credenciais per-user. Substitui MONITOR_EMAILS + MONITOR_PASSWORD do env.';
COMMENT ON COLUMN monitor_users.password_hash IS 'Formato "scrypt:N:r:p:salt_hex:hash_hex" — gerado por lib/password.ts.';
COMMENT ON COLUMN monitor_users.active IS 'Toggle pra desativar acesso sem precisar deletar (preserva audit trail em monitor_actions).';

ALTER TABLE monitor_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'monitor_users'
      AND policyname = 'monitor_users_service_only'
  ) THEN
    CREATE POLICY monitor_users_service_only ON monitor_users
      FOR ALL
      USING (app_is_service())
      WITH CHECK (app_is_service());
  END IF;
END $$;
