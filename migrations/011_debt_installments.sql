-- Deudas a cuotas. Una deuda puede dividirse en N cuotas mensuales; cada cuota
-- aparece como un ítem PENDIENTE de la sección `debt` en el presupuesto de su
-- mes (visible, pero sin contar en el Balance) y, al marcarla pagada, pasa a
-- contar (sale de caja y baja lo que debes), igual que un abono manual.
--
-- start_date: fecha en que se hizo la deuda (la elige el usuario). La primera
-- cuota cae en ese mes.

ALTER TABLE debt_entries ADD COLUMN IF NOT EXISTS start_date DATE;
UPDATE debt_entries SET start_date = created_at::date WHERE start_date IS NULL;
ALTER TABLE debt_entries ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;
ALTER TABLE debt_entries ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE debt_entries ADD COLUMN IF NOT EXISTS installments_count INTEGER CHECK (installments_count IS NULL OR installments_count BETWEEN 2 AND 120);

CREATE TABLE IF NOT EXISTS debt_installments (
    id SERIAL PRIMARY KEY,
    debt_entry_id INTEGER NOT NULL REFERENCES debt_entries(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    due_month DATE NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    paid_at TIMESTAMPTZ,
    UNIQUE (debt_entry_id, number)
);

CREATE INDEX IF NOT EXISTS idx_debt_installments_entry ON debt_installments(debt_entry_id);

ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS debt_installment_id INTEGER REFERENCES debt_installments(id) ON DELETE SET NULL;
