-- Espejo exacto de libreta_entries, pero en la dirección contraria: acá se
-- itemizan las deudas que TÚ tienes con otros (antes solo existía como un
-- número agregado, opening_debt_balance, sin detalle de a quién le debes
-- ni cuánto le debes a cada uno).
--
-- A diferencia de Libreta (que nunca toca el presupuesto al crearse), una
-- deuda nueva acá SÍ ajusta opening_debt_balance del mes actual al crearse/
-- editarse/borrarse -- así el agregado que ya usa la fórmula de Flujo de
-- Caja (`debt_balance = saldo inicial − pagos del mes`) se mantiene
-- consistente con el detalle. Cada abono sigue generando un ítem de la
-- sección `debt` en el presupuesto, igual que ya funcionaba.

CREATE TABLE IF NOT EXISTS debt_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    creditor_name TEXT NOT NULL,
    description TEXT,
    amount_owed NUMERIC NOT NULL CHECK (amount_owed > 0),
    amount_paid NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_entries_user ON debt_entries(user_id);

ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS debt_entry_id INTEGER REFERENCES debt_entries(id) ON DELETE SET NULL;
