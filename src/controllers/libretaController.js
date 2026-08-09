const db = require('../db/connection');
const { getOrCreateBudgetMonth, currentMonthDate, recomputeForwardChainForMonth } = require('../services/budgetSyncService');

// Trae una entrada de la Libreta validando que sea del usuario autenticado.
const loadOwnedEntry = async (client, entryId, userId) => {
    const result = await client.query('SELECT * FROM libreta_entries WHERE id = $1', [entryId]);
    const entry = result.rows[0];
    if (!entry || entry.user_id !== userId) return { error: { status: 404, message: 'Deuda no encontrada' } };
    return { entry };
};

const serializeEntry = (row) => ({
    id: row.id,
    debtor_name: row.debtor_name,
    description: row.description,
    amount_owed: Number(row.amount_owed),
    amount_paid: Number(row.amount_paid),
    remaining: Number(row.amount_owed) - Number(row.amount_paid),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

// Lista todas las deudas de la Libreta del usuario, más un resumen del
// total pendiente. Este total NO tiene ninguna relación con los ítems de
// Ingresos que los abonos fueron generando en el presupuesto -- son cosas
// separadas a propósito.
const getEntries = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await db.query(
            'SELECT * FROM libreta_entries WHERE user_id = $1 ORDER BY status = \'paid\', created_at DESC',
            [userId]
        );
        const entries = result.rows.map(serializeEntry);
        const totalPending = entries.reduce((sum, e) => sum + e.remaining, 0);

        return res.status(200).json({ entries, total_pending: totalPending });
    } catch (error) {
        console.error('Error en getEntries:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Registra que alguien (no necesariamente un usuario de Split.it) te debe
// dinero. No toca el presupuesto para nada -- todavía no entró dinero
// real, así que no hay nada que reflejar en Ingresos ni en ningún lado.
const createEntry = async (req, res) => {
    try {
        const userId = req.user.id;
        const { debtor_name: debtorName, description, amount_owed: amountOwed } = req.body || {};

        if (!debtorName || typeof debtorName !== 'string' || !debtorName.trim()) {
            return res.status(400).json({ message: 'debtor_name es requerido' });
        }
        const amount = Number(amountOwed);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'amount_owed debe ser un número mayor a 0' });
        }

        const created = await db.query(
            `
            INSERT INTO libreta_entries (user_id, debtor_name, description, amount_owed)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [userId, debtorName.trim(), description ? String(description).trim() : null, amount]
        );

        return res.status(201).json({ message: 'Deuda registrada', entry: serializeEntry(created.rows[0]) });
    } catch (error) {
        console.error('Error en createEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const updateEntry = async (req, res) => {
    try {
        const userId = req.user.id;
        const entryId = Number(req.params.id);
        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error, entry } = await loadOwnedEntry(db, entryId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        const { debtor_name: debtorName, description, amount_owed: amountOwed } = req.body || {};

        const nextName = debtorName !== undefined ? String(debtorName).trim() : entry.debtor_name;
        const nextDescription = description !== undefined ? (description ? String(description).trim() : null) : entry.description;
        const nextAmountOwed = amountOwed !== undefined ? Number(amountOwed) : Number(entry.amount_owed);

        if (!nextName) {
            return res.status(400).json({ message: 'debtor_name es requerido' });
        }
        if (!Number.isFinite(nextAmountOwed) || nextAmountOwed <= 0) {
            return res.status(400).json({ message: 'amount_owed debe ser un número mayor a 0' });
        }
        if (nextAmountOwed < Number(entry.amount_paid)) {
            return res.status(400).json({ message: `No puedes bajar la deuda por debajo de lo que ya te pagaron (${entry.amount_paid})` });
        }

        const nextStatus = nextAmountOwed <= Number(entry.amount_paid) ? 'paid' : (Number(entry.amount_paid) > 0 ? 'partial' : 'pending');

        const updated = await db.query(
            `
            UPDATE libreta_entries
            SET debtor_name = $1, description = $2, amount_owed = $3, status = $4, updated_at = now()
            WHERE id = $5
            RETURNING *
            `,
            [nextName, nextDescription, nextAmountOwed, nextStatus, entryId]
        );

        return res.status(200).json({ message: 'Deuda actualizada', entry: serializeEntry(updated.rows[0]) });
    } catch (error) {
        console.error('Error en updateEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const deleteEntry = async (req, res) => {
    try {
        const userId = req.user.id;
        const entryId = Number(req.params.id);
        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error } = await loadOwnedEntry(db, entryId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        // Los ítems de Ingresos que ya se generaron por abonos anteriores NO
        // se borran -- ese dinero ya entró de verdad, borrar la entrada de la
        // Libreta no la hace desaparecer del presupuesto.
        await db.query('DELETE FROM libreta_entries WHERE id = $1', [entryId]);

        return res.status(200).json({ message: 'Deuda eliminada' });
    } catch (error) {
        console.error('Error en deleteEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Registra un abono (pago parcial o total) que alguien te hizo. Esto es lo
// único que sí toca el presupuesto: crea un ítem `income` nuevo en tu mes
// actual por el monto exacto del abono. El saldo pendiente de la deuda se
// actualiza aquí mismo, en la Libreta -- son dos cálculos independientes,
// ninguno se deriva del otro.
const contributeToEntry = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const entryId = Number(req.params.id);
        const amount = Number(req.body?.amount);

        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error, entry } = await loadOwnedEntry(client, entryId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        const remaining = Number(entry.amount_owed) - Number(entry.amount_paid);
        const contributeAmount = req.body?.amount !== undefined ? amount : remaining;

        if (!Number.isFinite(contributeAmount) || contributeAmount <= 0) {
            return res.status(400).json({ message: 'amount debe ser un número mayor a 0' });
        }
        if (contributeAmount > remaining + 0.01) {
            return res.status(400).json({ message: `No puedes registrar más de lo que falta (te deben ${remaining})` });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const nextAmountPaid = Number(entry.amount_paid) + contributeAmount;
        const isFullyPaid = nextAmountPaid >= Number(entry.amount_owed) - 0.01;

        const updatedEntry = await client.query(
            `
            UPDATE libreta_entries
            SET amount_paid = $1, status = $2, updated_at = now()
            WHERE id = $3
            RETURNING *
            `,
            [nextAmountPaid, isFullyPaid ? 'paid' : 'partial', entryId]
        );

        const budgetMonth = await getOrCreateBudgetMonth(client, userId, currentMonthDate());

        const label = entry.description
            ? `Abono: ${entry.debtor_name} — ${entry.description}`
            : `Abono: ${entry.debtor_name}`;

        const positionResult = await client.query(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM budget_items WHERE budget_month_id = $1 AND section = $2',
            [budgetMonth.id, 'income']
        );

        const createdItem = await client.query(
            `
            INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending, libreta_entry_id, position)
            VALUES ($1, 'income', $2, $3, $3, false, $4, $5)
            RETURNING *
            `,
            [budgetMonth.id, label, contributeAmount, entryId, positionResult.rows[0].next_position]
        );

        await recomputeForwardChainForMonth(client, budgetMonth.id);

        await client.query('COMMIT');

        return res.status(200).json({
            message: 'Abono registrado',
            entry: serializeEntry(updatedEntry.rows[0]),
            income_item: createdItem.rows[0],
        });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en contributeToEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

module.exports = {
    getEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    contributeToEntry,
};
