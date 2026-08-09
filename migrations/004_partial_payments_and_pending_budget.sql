-- Dos cambios relacionados:
--
-- 1) Pagos parciales en expense_participants: en vez de pagado/no-pagado
--    binario, se acumula `amount_paid` con cada abono hasta llegar a
--    `amount_owed`. `pending_claim_amount` guarda el monto que el deudor
--    reclamó como pagado mientras espera confirmación del pagador.
--
-- 2) budget_items.is_pending: permite reflejar en el presupuesto personal
--    la obligación de un gasto compartido ANTES de que se pague de verdad
--    (visible, pero excluido del Balance hasta que se confirma el pago).

ALTER TABLE expense_participants
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_claim_amount NUMERIC;

UPDATE expense_participants SET amount_paid = amount_owed WHERE status = 'paid' AND amount_paid = 0;

ALTER TABLE budget_items
  ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT false;
