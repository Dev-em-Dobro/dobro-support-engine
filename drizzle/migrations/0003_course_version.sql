-- Migration 0003 — course_version em submissions
--
-- Distingue submissões de cohorts da DevQuest 1.0 e 2.0. Aluno NÃO vê esse
-- campo na UI (decisão Carlos 2026-04-25: 1.0 está deprecado, alunos novos
-- nem sabem que existiu). Campo serve pra:
--   1. Dashboard de monitor mostrar chip de versão
--   2. Filtragem analítica futura (cohort 1.0 vs 2.0 em métricas)
--   3. Em v1.2, derivar automaticamente do challenge_id quando esse campo
--      for adicionado (ver PRD §3.5)
--
-- Default '2.0' aplica retroativamente a todas as submissões existentes.
-- Se for necessário reclassificar histórico real da 1.0 depois, rodar
-- UPDATE manual filtrando por submitted_at < <data-cutoff>.
--
-- IDEMPOTENTE: pode rodar múltiplas vezes sem quebrar.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS course_version TEXT NOT NULL DEFAULT '2.0';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'submissions_course_version_chk'
  ) THEN
    ALTER TABLE submissions
      ADD CONSTRAINT submissions_course_version_chk
      CHECK (course_version IN ('1.0', '2.0'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS submissions_course_version_idx
  ON submissions(course_version);
