-- Hasta ahora, cuando alguien te devolvía tu parte de un gasto compartido,
-- eso se reflejaba REDUCIENDO tu ítem de Gastos (tracked_expense) por el
-- monto devuelto. Matemáticamente el Balance final daba igual, pero
-- escondía la plata real que entró: si vos ponés $0 de tu bolsillo y un
-- amigo te debe $300.000 completos (fue más una venta/préstamo que un
-- gasto tuyo), el presupuesto mostraba $300.000 en Gastos -- como si
-- hubieras gastado algo que en realidad nunca fue tuyo.
--
-- El nuevo modelo separa las dos cosas:
--   - Tu ítem de Gastos ahora se crea por TU PROPIA parte del gasto
--     (shares.get(paid_by)), no por el monto total.
--   - Cada devolución que confirmás genera/incrementa un ítem de Ingresos
--     ("Reembolso: <descripción>") en tu mes actual, en vez de bajar Gastos.
--
-- Esto agrega el rol 'payer_income' para esos ítems de reembolso. A
-- diferencia de 'payer'/'participant' (uno por gasto, fijo), puede haber
-- varios ítems 'payer_income' para el mismo gasto+usuario si los pagos
-- llegan en meses distintos -- por eso el UNIQUE original ya no aplica acá;
-- se vuelve parcial, restringido a los roles que sí son 1:1.

ALTER TABLE budget_split_sync DROP CONSTRAINT IF EXISTS budget_split_sync_expense_id_user_id_role_key;

ALTER TABLE budget_split_sync DROP CONSTRAINT IF EXISTS budget_split_sync_role_check;
ALTER TABLE budget_split_sync ADD CONSTRAINT budget_split_sync_role_check
    CHECK (role IN ('payer', 'participant', 'payer_income'));

CREATE UNIQUE INDEX IF NOT EXISTS budget_split_sync_payer_participant_unique
    ON budget_split_sync (expense_id, user_id, role)
    WHERE role IN ('payer', 'participant');
