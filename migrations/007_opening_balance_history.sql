-- Bitácora de cambios a los saldos iniciales de un mes (caja, ahorros,
-- deuda). Antes, PATCH /budget/:month/opening pisaba el valor sin dejar
-- rastro de quién/cuándo/desde qué número -- si alguien preguntaba "¿por
-- qué mi saldo de marzo cambió?", no había forma de saberlo.

CREATE TABLE IF NOT EXISTS budget_opening_history (
    id SERIAL PRIMARY KEY,
    budget_month_id INTEGER NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK (field IN ('cash_balance', 'savings_balance', 'debt_balance')),
    old_value NUMERIC NOT NULL,
    new_value NUMERIC NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_opening_history_month ON budget_opening_history(budget_month_id);
