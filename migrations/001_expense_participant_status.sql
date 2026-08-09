-- Reemplaza el booleano is_paid por un estado de 3 valores con confirmación
-- bilateral, y agrega updated_at a expenses para soportar edición.
--
-- Aplicada manualmente el 2026-08-08 vía scripts/run-migration.js.

ALTER TABLE expense_participants
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE expense_participants
  ADD CONSTRAINT expense_participants_status_check
  CHECK (status IN ('pending', 'paid_pending_confirmation', 'paid'));

UPDATE expense_participants
SET status = 'paid', confirmed_at = COALESCE(confirmed_at, now())
WHERE is_paid = true;

ALTER TABLE expense_participants DROP COLUMN is_paid;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
