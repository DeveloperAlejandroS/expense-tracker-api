const db = require('../db/connection');
const { getOrCreateBudgetMonth, currentMonthDate, toMonthDate, recomputeForwardChainForMonth } = require('../services/budgetSyncService');

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

const serializeInstallment = (row) => ({
    id: row.id,
    number: row.number,
    due_month: String(row.due_month_text).slice(0, 7),
    amount: Number(row.amount),
    paid: row.paid_at != null,
    paid_at: row.paid_at,
});

const serializeEntry = (row, installments = []) => ({
    id: row.id,
    creditor_name: row.creditor_name,
    description: row.description,
    amount_owed: Number(row.amount_owed),
    amount_paid: Number(row.amount_paid),
    remaining: Number(row.amount_owed) - Number(row.amount_paid),
    status: row.status,
    start_date: row.start_date_text ?? null,
    installments_count: row.installments_count,
    installments: installments.map(serializeInstallment),
    created_at: row.created_at,
    updated_at: row.updated_at,
});

const ENTRY_COLUMNS = 'de.*, de.start_date::text AS start_date_text';
const INSTALLMENT_COLUMNS = 'di.*, di.due_month::text AS due_month_text';

const loadInstallments = async (client, entryId) => {
    const result = await client.query(
        `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments di WHERE di.debt_entry_id = $1 ORDER BY di.number`,
        [entryId]
    );
    return result.rows;
};

const loadEntryRow = async (client, entryId) => {
    const result = await client.query(`SELECT ${ENTRY_COLUMNS} FROM debt_entries de WHERE de.id = $1`, [entryId]);
    return result.rows[0];
};

const addMonths = (monthDate, n) => {
    const d = new Date(`${String(monthDate).slice(0, 7)}-01T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
};

// Una cuota ya vencida (mes pasado) no se mete en un presupuesto cerrado: se
// muestra en el mes actual. Las futuras caen en su mes.
const itemMonthFor = (dueMonth) => {
    const current = currentMonthDate();
    return String(dueMonth) > current ? String(dueMonth) : current;
};

const installmentLabel = (number, count, creditor) => `Cuota ${number}/${count}: ${creditor}`;

// Reparte el total en cuotas enteras; la última absorbe el redondeo.
const splitAmount = (total, count) => {
    const base = Math.floor(total / count);
    const amounts = Array(count).fill(base);
    amounts[count - 1] = Number((total - base * (count - 1)).toFixed(2));
    return amounts;
};

const nextPosition = async (client, monthId) => {
    const r = await client.query(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM budget_items WHERE budget_month_id = $1 AND section = $2',
        [monthId, 'debt']
    );
    return r.rows[0].next_position;
};

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
            `SELECT ${ENTRY_COLUMNS} FROM debt_entries de WHERE de.user_id = $1 ORDER BY de.status = 'paid', de.created_at DESC`,
            [userId]
        );
        const installmentRows = await db.query(
            `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments di INNER JOIN debt_entries de ON de.id = di.debt_entry_id WHERE de.user_id = $1 ORDER BY di.number`,
            [userId]
        );
        const byEntry = new Map();
        for (const row of installmentRows.rows) {
            if (!byEntry.has(row.debt_entry_id)) byEntry.set(row.debt_entry_id, []);
            byEntry.get(row.debt_entry_id).push(row);
        }
        const entries = result.rows.map((row) => serializeEntry(row, byEntry.get(row.id) || []));
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
        const { creditor_name: creditorName, description, amount_owed: amountOwed, start_date: startDateRaw, installments: installmentsRaw } = req.body || {};

        if (!creditorName || typeof creditorName !== 'string' || !creditorName.trim()) {
            return res.status(400).json({ message: 'creditor_name es requerido' });
        }
        const amount = Number(amountOwed);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'amount_owed debe ser un número mayor a 0' });
        }

        let startDate = null;
        if (startDateRaw !== undefined && startDateRaw !== null && startDateRaw !== '') {
            const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(startDateRaw)) ? new Date(`${startDateRaw}T00:00:00Z`) : null;
            if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== startDateRaw || parsed.getUTCFullYear() < 2000) {
                return res.status(400).json({ message: 'start_date debe tener formato YYYY-MM-DD' });
            }
            startDate = startDateRaw;
        }

        let installmentsCount = null;
        if (installmentsRaw !== undefined && installmentsRaw !== null && installmentsRaw !== '') {
            installmentsCount = Number(installmentsRaw);
            if (!Number.isInteger(installmentsCount) || installmentsCount < 2 || installmentsCount > 120) {
                return res.status(400).json({ message: 'installments debe ser un entero entre 2 y 120' });
            }
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const created = await client.query(
            `
            INSERT INTO debt_entries (user_id, creditor_name, description, amount_owed, start_date, installments_count)
            VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6)
            RETURNING id
            `,
            [userId, creditorName.trim(), description ? String(description).trim() : null, amount, startDate, installmentsCount]
        );
        const entryId = created.rows[0].id;

        await adjustOpeningDebtBalance(client, userId, amount);

        if (installmentsCount) {
            const entryRow = await loadEntryRow(client, entryId);
            const firstMonth = toMonthDate(`${entryRow.start_date_text}T00:00:00Z`);
            const amounts = splitAmount(amount, installmentsCount);
            const name = creditorName.trim();
            for (let i = 0; i < installmentsCount; i += 1) {
                const number = i + 1;
                const dueMonth = addMonths(firstMonth, i);
                const inst = await client.query(
                    'INSERT INTO debt_installments (debt_entry_id, number, due_month, amount) VALUES ($1, $2, $3, $4) RETURNING id',
                    [entryId, number, dueMonth, amounts[i]]
                );
                const month = await getOrCreateBudgetMonth(client, userId, itemMonthFor(dueMonth));
                await client.query(
                    `
                    INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending, debt_entry_id, debt_installment_id, position)
                    VALUES ($1, 'debt', $2, $3, $3, true, $4, $5, $6)
                    `,
                    [month.id, installmentLabel(number, installmentsCount, name), amounts[i], entryId, inst.rows[0].id, await nextPosition(client, month.id)]
                );
            }
        }

        await client.query('COMMIT');

        const createdRow = await loadEntryRow(db, entryId);
        return res.status(201).json({ message: 'Deuda registrada', entry: serializeEntry(createdRow, await loadInstallments(db, entryId)) });
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
        if (entry.installments_count && Math.abs(nextAmountOwed - Number(entry.amount_owed)) > 0.001) {
            return res.status(400).json({ message: 'El total de una deuda a cuotas no se puede cambiar. Elimínala y créala de nuevo.' });
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

        if (entry.installments_count) {
            await client.query(
                `
                UPDATE budget_items bi
                SET label = 'Cuota ' || di.number || '/' || $1::int || ': ' || $2::text, updated_at = now()
                FROM debt_installments di
                WHERE bi.debt_installment_id = di.id AND di.debt_entry_id = $3
                `,
                [entry.installments_count, nextName, entryId]
            );
        }

        await client.query('COMMIT');

        const updatedRow = await loadEntryRow(db, entryId);
        return res.status(200).json({ message: 'Deuda actualizada', entry: serializeEntry(updatedRow, await loadInstallments(db, entryId)) });
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
        // Las cuotas que aún no pagaste eran solo un aviso en el presupuesto: se van con la deuda.
        await client.query('DELETE FROM budget_items WHERE debt_entry_id = $1 AND is_pending = true', [entryId]);
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

        if (entry.installments_count) {
            return res.status(400).json({ message: 'Esta deuda se paga por cuotas: marca la cuota como pagada' });
        }

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
            entry: serializeEntry({ ...updatedEntry.rows[0], start_date_text: entry.start_date_text }),
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

// Marca una cuota como pagada (o la deshace). Pagada = el dinero sale ahora, en
// el mes actual (base de caja), y baja lo que debes. Deshacer la devuelve a su
// mes como aviso pendiente. Idempotente: repetir el mismo estado no hace nada.
const setInstallmentPaid = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const entryId = Number(req.params.id);
        const number = Number(req.params.number);
        const paid = req.body?.paid;

        if (!Number.isInteger(entryId) || entryId <= 0 || !Number.isInteger(number) || number <= 0) {
            return res.status(400).json({ message: 'id y número de cuota deben ser enteros positivos' });
        }
        if (typeof paid !== 'boolean') {
            return res.status(400).json({ message: 'paid debe ser true o false' });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        // Se bloquea la deuda para que dos toques seguidos no sumen dos veces.
        const entryResult = await client.query('SELECT * FROM debt_entries WHERE id = $1 FOR UPDATE', [entryId]);
        const entry = entryResult.rows[0];
        if (!entry || entry.user_id !== userId) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return res.status(404).json({ message: 'Deuda no encontrada' });
        }

        const instResult = await client.query(
            `SELECT ${INSTALLMENT_COLUMNS} FROM debt_installments di WHERE di.debt_entry_id = $1 AND di.number = $2`,
            [entryId, number]
        );
        const inst = instResult.rows[0];
        if (!inst) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return res.status(404).json({ message: 'Cuota no encontrada' });
        }

        if ((inst.paid_at != null) !== paid) {
            const amount = Number(inst.amount);
            const targetMonth = await getOrCreateBudgetMonth(client, userId, paid ? currentMonthDate() : itemMonthFor(inst.due_month_text));

            const itemResult = await client.query('SELECT * FROM budget_items WHERE debt_installment_id = $1', [inst.id]);
            const item = itemResult.rows[0];
            const touchedMonths = new Set([targetMonth.id]);

            if (item) {
                touchedMonths.add(item.budget_month_id);
                const position = item.budget_month_id === targetMonth.id ? item.position : await nextPosition(client, targetMonth.id);
                await client.query(
                    'UPDATE budget_items SET budget_month_id = $1, is_pending = $2, budgeted_amount = $3, actual_amount = $3, position = $4, updated_at = now() WHERE id = $5',
                    [targetMonth.id, !paid, amount, position, item.id]
                );
            } else {
                await client.query(
                    `
                    INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending, debt_entry_id, debt_installment_id, position)
                    VALUES ($1, 'debt', $2, $3, $3, $4, $5, $6, $7)
                    `,
                    [targetMonth.id, installmentLabel(inst.number, entry.installments_count, entry.creditor_name), amount, !paid, entryId, inst.id, await nextPosition(client, targetMonth.id)]
                );
            }

            await client.query('UPDATE debt_installments SET paid_at = $1 WHERE id = $2', [paid ? new Date() : null, inst.id]);

            const nextPaid = Math.max(0, Number(entry.amount_paid) + (paid ? amount : -amount));
            const nextStatus = nextPaid >= Number(entry.amount_owed) - 0.01 ? 'paid' : (nextPaid > 0 ? 'partial' : 'pending');
            await client.query('UPDATE debt_entries SET amount_paid = $1, status = $2, updated_at = now() WHERE id = $3', [nextPaid, nextStatus, entryId]);

            const months = await client.query('SELECT id FROM budget_months WHERE id = ANY($1::int[]) ORDER BY month', [[...touchedMonths]]);
            for (const m of months.rows) await recomputeForwardChainForMonth(client, m.id);
        }

        await client.query('COMMIT');

        const entryRow = await loadEntryRow(db, entryId);
        return res.status(200).json({
            message: paid ? 'Cuota marcada como pagada' : 'Cuota marcada como pendiente',
            entry: serializeEntry(entryRow, await loadInstallments(db, entryId)),
        });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en setInstallmentPaid:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

module.exports = {
    setInstallmentPaid,
    getEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    contributeToEntry,
};
