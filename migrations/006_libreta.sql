-- "Libreta": deudas informales de gente que NO usa Split.it (no son
-- usuarios registrados) y te debe dinero a ti. Es lo inverso de la sección
-- `debt` del presupuesto personal (esa es lo que TÚ debes a otros).
--
-- Crear una deuda aquí NO toca el presupuesto para nada -- todavía no
-- entró dinero real. Cada abono que registras:
--   1) resta del saldo pendiente de la entrada (amount_paid sube),
--   2) crea un ítem `income` nuevo en tu mes actual por ese monto exacto.
--
-- El saldo final de la deuda (aquí) y el total que ese abono sumó en
-- Ingresos (en el presupuesto) son DOS NÚMEROS INDEPENDIENTES -- no se
-- recalculan uno a partir del otro, para que nunca se pisen ni se
-- cuenten dos veces.

CREATE TABLE IF NOT EXISTS libreta_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    debtor_name TEXT NOT NULL,
    description TEXT,
    amount_owed NUMERIC NOT NULL CHECK (amount_owed > 0),
    amount_paid NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_libreta_entries_user ON libreta_entries(user_id);

-- Marca qué ítem de Ingresos vino de un abono de la Libreta (para no
-- dejarlo editar directo desde el presupuesto, y para poder linkearlo de
-- vuelta a la entrada que lo generó).
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS libreta_entry_id INTEGER REFERENCES libreta_entries(id) ON DELETE SET NULL;
