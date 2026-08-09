-- Módulo de gastos personales: presupuesto mensual por usuario, con
-- sincronización automática desde gastos compartidos (expenses/expense_participants).
-- Ver PLAN_GASTOS_PERSONALES.md para el diseño completo.

CREATE TABLE IF NOT EXISTS budget_months (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    month DATE NOT NULL,
    opening_cash_balance NUMERIC NOT NULL DEFAULT 0,
    opening_savings_balance NUMERIC NOT NULL DEFAULT 0,
    opening_debt_balance NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, month)
);

CREATE TABLE IF NOT EXISTS budget_items (
    id SERIAL PRIMARY KEY,
    budget_month_id INTEGER NOT NULL REFERENCES budget_months(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('income', 'fixed_expense', 'tracked_expense', 'saving', 'debt')),
    label TEXT NOT NULL,
    budgeted_amount NUMERIC NOT NULL DEFAULT 0,
    actual_amount NUMERIC NOT NULL DEFAULT 0,
    is_savings_link BOOLEAN NOT NULL DEFAULT false,
    linked_saving_item_id INTEGER REFERENCES budget_items(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budget_split_sync (
    id SERIAL PRIMARY KEY,
    budget_item_id INTEGER NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('payer', 'participant')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (expense_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_budget_items_month ON budget_items(budget_month_id);
CREATE INDEX IF NOT EXISTS idx_budget_split_sync_expense ON budget_split_sync(expense_id);
