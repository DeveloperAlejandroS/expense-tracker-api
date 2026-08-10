const db = require('../db/connection');
const { getOrCreateBudgetMonth, currentMonthDate, recomputeForwardChainForMonth } = require('../services/budgetSyncService');

// Espejo de libretaController.js, pero para lo que TÚ debes a otros. La
// diferencia clave: acá SÍ se ajusta opening_debt_balance del mes actual al
// crear/editar/borrar, para que el agregado de Flujo de Caja se mantenga
// consistente con el detalle itemizado.

const loadOwnedEntry = async (client, entryId, userId) => {
    const result = await client.query('SELECT * FROM debt_entries WHERE id = $1', [entryId]);
    const entry = result.rows[0];
    if (!entry || entry.user_id !== userId) return { error: { status: 404, message: 'Deuda no encontrada' } };
    return { entry };
};

const serializeEntry = (row) => ({
    id: row.id,
    creditor_name: row.creditor_name,
    description: row.description,
    amount_owed: Number(row.amount_owed),
    amount_paid: Number(row.amount_paid),
    remaining: Number(row.amount_owed) - Number(row.amount_paid),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
});

// Suma `delta` a opening_debt_balance del mes actual del usuario (puede ser
// negativo, para cuando se borra o se baja una deuda), recalcula la cadena
// hacia adelante, y deja el mismo rastro en budget_opening_history que
// updateOpening en budgetController -- así el ajuste automático por crear/
// editar/borrar una deuda queda igual de trazable que uno manual.
const adjustOpeningDebtBalance = async (client, userId, delta) => {
    if (delta === 0) return;
    const month = await getOrCreateBudgetMonth(client, userId, currentMonthDate());
    const oldValue = Number(month.opening_debt_balance);
    const newValue = oldValue + delta;

    await client.query(
        'UPDATE budget_months SET opening_debt_balance = opening_debt_balance + $1 WHERE id = $2',
        [delta, month.id]
    );
    await client.query(
        'INSERT INTO budget_opening_history (budget_month_id, field, old_value, new_value) VALUES ($1, $2, $3, $4)',
        [month.id, 'debt_balance', oldValue, newValue]
    );
    await recomputeForwardChainForMonth(client, month.id);
};

const getEntries = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await db.query(
            "SELECT * FROM debt_entries WHERE user_id = $1 ORDER BY status = 'paid', created_at DESC",
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

const createEntry = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const { creditor_name: creditorName, description, amount_owed: amountOwed } = req.body || {};

        if (!creditorName || typeof creditorName !== 'string' || !creditorName.trim()) {
            return res.status(400).json({ message: 'creditor_name es requerido' });
        }
        const amount = Number(amountOwed);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'amount_owed debe ser un número mayor a 0' });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const created = await client.query(
            `
            INSERT INTO debt_entries (user_id, creditor_name, description, amount_owed)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [userId, creditorName.trim(), description ? String(description).trim() : null, amount]
        );

        await adjustOpeningDebtBalance(client, userId, amount);

        await client.query('COMMIT');

        return res.status(201).json({ message: 'Deuda registrada', entry: serializeEntry(created.rows[0]) });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en createEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const updateEntry = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const entryId = Number(req.params.id);
        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error, entry } = await loadOwnedEntry(client, entryId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        const { creditor_name: creditorName, description, amount_owed: amountOwed } = req.body || {};

        const nextName = creditorName !== undefined ? String(creditorName).trim() : entry.creditor_name;
        const nextDescription = description !== undefined ? (description ? String(description).trim() : null) : entry.description;
        const nextAmountOwed = amountOwed !== undefined ? Number(amountOwed) : Number(entry.amount_owed);

        if (!nextName) {
            return res.status(400).json({ message: 'creditor_name es requerido' });
        }
        if (!Number.isFinite(nextAmountOwed) || nextAmountOwed <= 0) {
            return res.status(400).json({ message: 'amount_owed debe ser un número mayor a 0' });
        }
        if (nextAmountOwed < Number(entry.amount_paid)) {
            return res.status(400).json({ message: `No puedes bajar la deuda por debajo de lo que ya pagaste (${entry.amount_paid})` });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const delta = nextAmountOwed - Number(entry.amount_owed);
        await adjustOpeningDebtBalance(client, userId, delta);

        const nextStatus = nextAmountOwed <= Number(entry.amount_paid) ? 'paid' : (Number(entry.amount_paid) > 0 ? 'partial' : 'pending');

        const updated = await client.query(
            `
            UPDATE debt_entries
            SET creditor_name = $1, description = $2, amount_owed = $3, status = $4, updated_at = now()
            WHERE id = $5
            RETURNING *
            `,
            [nextName, nextDescription, nextAmountOwed, nextStatus, entryId]
        );

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Deuda actualizada', entry: serializeEntry(updated.rows[0]) });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en updateEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const deleteEntry = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const entryId = Number(req.params.id);
        if (!Number.isInteger(entryId) || entryId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error, entry } = await loadOwnedEntry(client, entryId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        await client.query('BEGIN');
        transactionStarted = true;

        const remaining = Number(entry.amount_owed) - Number(entry.amount_paid);
        await adjustOpeningDebtBalance(client, userId, -remaining);

        // Los ítems de la sección `debt` que ya se generaron por abonos
        // anteriores NO se borran -- esos pagos ya salieron de verdad de tu
        // bolsillo, borrar el registro de esta deuda no los hace desaparecer.
        await client.query('DELETE FROM debt_entries WHERE id = $1', [entryId]);

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Deuda eliminada' });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en deleteEntry:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

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
            return res.status(400).json({ message: `No puedes pagar más de lo que falta (debes ${remaining})` });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const nextAmountPaid = Number(entry.amount_paid) + contributeAmount;
        const isFullyPaid = nextAmountPaid >= Number(entry.amount_owed) - 0.01;

        const updatedEntry = await client.query(
            `
            UPDATE debt_entries
            SET amount_paid = $1, status = $2, updated_at = now()
            WHERE id = $3
            RETURNING *
            `,
            [nextAmountPaid, isFullyPaid ? 'paid' : 'partial', entryId]
        );

        const budgetMonth = await getOrCreateBudgetMonth(client, userId, currentMonthDate());

        const label = entry.description
            ? `Pago: ${entry.creditor_name} — ${entry.description}`
            : `Pago: ${entry.creditor_name}`;

        const positionResult = await client.query(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM budget_items WHERE budget_month_id = $1 AND section = $2',
            [budgetMonth.id, 'debt']
        );

        const createdItem = await client.query(
            `
            INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending, debt_entry_id, position)
            VALUES ($1, 'debt', $2, $3, $3, false, $4, $5)
            RETURNING *
            `,
            [budgetMonth.id, label, contributeAmount, entryId, positionResult.rows[0].next_position]
        );

        await recomputeForwardChainForMonth(client, budgetMonth.id);

        await client.query('COMMIT');

        return res.status(200).json({
            message: 'Pago registrado',
            entry: serializeEntry(updatedEntry.rows[0]),
            debt_item: createdItem.rows[0],
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
