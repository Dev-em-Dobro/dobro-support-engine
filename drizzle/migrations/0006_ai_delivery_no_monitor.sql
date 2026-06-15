-- Migration 0006 — AI auto-delivery sem workflow de monitor
--
-- Histórico: o pipeline gravava correção pronta com status submission_status=draft,
-- refletindo “revisão do monitor”. Hoje o produto só tem sucesso IA → entrega,
-- ou falha. Esta migration atualiza registros antigos já com linha em
-- corrections pra status terminal delivered (e timestamps coerentes).
--
-- Idempotente: só altera onde ainda não está terminal.

UPDATE submissions s
SET
  status = 'delivered',
  corrected_at = coalesce(s.corrected_at, c.created_at),
  delivered_at = coalesce(s.delivered_at, c.created_at),
  updated_at = now(),
  error_msg = NULL
FROM corrections c
WHERE c.submission_id = s.id
  AND s.status IN ('draft', 'approved', 'queued', 'processing')
  AND s.status NOT IN ('delivered', 'failed', 'rejected');
