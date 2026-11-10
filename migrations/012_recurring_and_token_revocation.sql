-- 1) Sesiones: al cambiar la contraseña, los tokens emitidos antes dejan de valer.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_valid_after TIMESTAMPTZ;

-- 2) Gastos que se repiten. Una plantilla genera, al abrir cada mes, un ítem
-- en Gastos fijos (planeado, sin pagar). Sirve para dos cosas:
--   - gasto fijo de todos los meses (months_count NULL: no termina);
--   - compra a cuotas (months_count = N, total_amount = total de la compra;
--     la última cuota absorbe el redondeo).
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    label TEXT NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    total_amount NUMERIC,
    start_month DATE NOT NULL,
    months_count INTEGER CHECK (months_count IS NULL OR months_count BETWEEN 2 AND 120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_user ON recurring_expenses(user_id);

-- Qué meses ya recibieron su ítem: si borras el ítem de un mes, no reaparece.
CREATE TABLE IF NOT EXISTS recurring_runs (
    recurring_id INTEGER NOT NULL REFERENCES recurring_expenses(id) ON DELETE CASCADE,
    budget_month_id INTEGER NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
    PRIMARY KEY (recurring_id, budget_month_id)
);

ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS recurring_id INTEGER REFERENCES recurring_expenses(id) ON DELETE SET NULL;
