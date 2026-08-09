const db = require('../db/connection');
const {
    SECTIONS,
    toMonthDate,
    getOrCreateBudgetMonth,
    computeMonthTotals,
    recomputeForwardChainForMonth,
} = require('../services/budgetSyncService');

const MONTH_PARAM_REGEX = /^\d{4}-\d{2}$/;
const SAVINGS_LINK_SECTIONS = ['fixed_expense', 'tracked_expense'];

const parseMonthParam = (monthParam) => {
    if (!MONTH_PARAM_REGEX.test(String(monthParam || ''))) return null;
    return toMonthDate(`${monthParam}-01`);
};

const getMonth = async (req, res) => {
    try {
        const userId = req.user.id;
        const monthDate = parseMonthParam(req.params.month);

        if (!monthDate) {
            return res.status(400).json({ message: 'El mes debe tener formato YYYY-MM' });
        }

        const budgetMonth = await getOrCreateBudgetMonth(db, userId, monthDate);
        const { sections, totals } = await computeMonthTotals(db, budgetMonth);

        return res.status(200).json({
            month: budgetMonth.month,
            opening: {
                cash_balance: Number(budgetMonth.opening_cash_balance),
                savings_balance: Number(budgetMonth.opening_savings_balance),
                debt_balance: Number(budgetMonth.opening_debt_balance),
            },
            sections,
            totals,
        });
    } catch (error) {
        console.error('Error en getMonth:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Crea (o actualiza, si ya existía) el budget_item espejo en la sección
// `saving` para un ítem marcado como `is_savings_link`.
const upsertSavingsMirror = async (client, sourceItem, existingLinkedId) => {
    const label = `Ahorro · ${sourceItem.label}`;

    if (existingLinkedId) {
        const updated = await client.query(
            'UPDATE budget_items SET label = $1, budgeted_amount = $2, actual_amount = $2, updated_at = now() WHERE id = $3 RETURNING id',
            [label, sourceItem.actual_amount, existingLinkedId]
        );
        if (updated.rows.length > 0) return existingLinkedId;
    }

    const created = await client.query(
        `
        INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount)
        VALUES ($1, 'saving', $2, $3, $3)
        RETURNING id
        `,
        [sourceItem.budget_month_id, label, sourceItem.actual_amount]
    );
    return created.rows[0].id;
};

const createItem = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const monthDate = parseMonthParam(req.params.month);
        const { section, label, budgeted_amount: budgetedAmount, actual_amount: actualAmount, is_savings_link: isSavingsLink } = req.body;

        if (!monthDate) {
            return res.status(400).json({ message: 'El mes debe tener formato YYYY-MM' });
        }
        if (!SECTIONS.includes(section)) {
            return res.status(400).json({ message: `section debe ser uno de: ${SECTIONS.join(', ')}` });
        }
        if (!label || typeof label !== 'string' || !label.trim()) {
            return res.status(400).json({ message: 'label es requerido' });
        }
        const budgeted = Number(budgetedAmount) || 0;
        const actual = Number(actualAmount) || 0;
        if (budgeted < 0 || actual < 0) {
            return res.status(400).json({ message: 'Los montos no pueden ser negativos' });
        }
        const savingsLink = Boolean(isSavingsLink) && SAVINGS_LINK_SECTIONS.includes(section);

        const budgetMonth = await getOrCreateBudgetMonth(client, userId, monthDate);

        await client.query('BEGIN');
        transactionStarted = true;

        const positionResult = await client.query(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM budget_items WHERE budget_month_id = $1 AND section = $2',
            [budgetMonth.id, section]
        );

        const inserted = await client.query(
            `
            INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_savings_link, position)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            `,
            [budgetMonth.id, section, label.trim(), budgeted, actual, savingsLink, positionResult.rows[0].next_position]
        );

        let item = inserted.rows[0];

        if (savingsLink) {
            const linkedId = await upsertSavingsMirror(client, { ...item, budget_month_id: budgetMonth.id }, null);
            const updated = await client.query(
                'UPDATE budget_items SET linked_saving_item_id = $1 WHERE id = $2 RETURNING *',
                [linkedId, item.id]
            );
            item = updated.rows[0];
        }

        await recomputeForwardChainForMonth(client, budgetMonth.id);

        await client.query('COMMIT');

        return res.status(201).json({ message: 'Ítem creado correctamente', item });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en createItem:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

// Trae un budget_item validando que pertenezca al usuario autenticado, y
// si está sincronizado desde Split.it o es el espejo de otro ítem.
const loadOwnedItem = async (client, itemId, userId) => {
    const result = await client.query(
        `
        SELECT bi.*, bm.user_id
        FROM budget_items bi
        INNER JOIN budget_months bm ON bm.id = bi.budget_month_id
        WHERE bi.id = $1
        `,
        [itemId]
    );
    const item = result.rows[0];
    if (!item || item.user_id !== userId) return { error: { status: 404, message: 'Ítem no encontrado' } };

    const syncResult = await client.query('SELECT id FROM budget_split_sync WHERE budget_item_id = $1', [itemId]);
    if (syncResult.rows.length > 0) {
        return { error: { status: 400, message: 'Este ítem está sincronizado con Split.it y no se puede editar directamente' } };
    }

    const mirrorOfResult = await client.query('SELECT id FROM budget_items WHERE linked_saving_item_id = $1', [itemId]);
    if (mirrorOfResult.rows.length > 0) {
        return { error: { status: 400, message: 'Este es el espejo automático de un ahorro — editalo desde el ítem original' } };
    }

    return { item };
};

const updateItem = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const itemId = Number(req.params.id);
        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error, item } = await loadOwnedItem(client, itemId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        const { label, budgeted_amount: budgetedAmount, actual_amount: actualAmount, is_savings_link: isSavingsLink } = req.body;

        const nextLabel = label !== undefined ? String(label).trim() : item.label;
        const nextBudgeted = budgetedAmount !== undefined ? Number(budgetedAmount) || 0 : Number(item.budgeted_amount);
        const nextActual = actualAmount !== undefined ? Number(actualAmount) || 0 : Number(item.actual_amount);
        const nextSavingsLink = isSavingsLink !== undefined
            ? Boolean(isSavingsLink) && SAVINGS_LINK_SECTIONS.includes(item.section)
            : item.is_savings_link;

        if (nextBudgeted < 0 || nextActual < 0) {
            return res.status(400).json({ message: 'Los montos no pueden ser negativos' });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        let linkedSavingItemId = item.linked_saving_item_id;

        if (nextSavingsLink) {
            linkedSavingItemId = await upsertSavingsMirror(
                client,
                { label: nextLabel, actual_amount: nextActual, budget_month_id: item.budget_month_id },
                linkedSavingItemId
            );
        } else if (item.linked_saving_item_id) {
            await client.query('DELETE FROM budget_items WHERE id = $1', [item.linked_saving_item_id]);
            linkedSavingItemId = null;
        }

        const updated = await client.query(
            `
            UPDATE budget_items
            SET label = $1, budgeted_amount = $2, actual_amount = $3, is_savings_link = $4, linked_saving_item_id = $5, updated_at = now()
            WHERE id = $6
            RETURNING *
            `,
            [nextLabel, nextBudgeted, nextActual, nextSavingsLink, linkedSavingItemId, itemId]
        );

        await recomputeForwardChainForMonth(client, item.budget_month_id);

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Ítem actualizado correctamente', item: updated.rows[0] });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en updateItem:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const deleteItem = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const itemId = Number(req.params.id);
        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const { error, item } = await loadOwnedItem(client, itemId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        await client.query('BEGIN');
        transactionStarted = true;

        if (item.linked_saving_item_id) {
            await client.query('DELETE FROM budget_items WHERE id = $1', [item.linked_saving_item_id]);
        }
        await client.query('DELETE FROM budget_items WHERE id = $1', [itemId]);

        await recomputeForwardChainForMonth(client, item.budget_month_id);

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Ítem eliminado correctamente' });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en deleteItem:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

// Abono: suma plata a un ítem existente (típicamente en Ahorros o Deudas)
// en vez de tener que crear una fila nueva cada vez que metés más plata al
// mismo fondo/deuda. Si el ítem tiene un espejo de ahorro vinculado, el
// abono se refleja en ambos para no desincronizarlos.
const addContribution = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const itemId = Number(req.params.id);
        const amount = Number(req.body?.amount);

        if (!Number.isInteger(itemId) || itemId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'amount debe ser un número mayor a 0' });
        }

        const { error, item } = await loadOwnedItem(client, itemId, userId);
        if (error) return res.status(error.status).json({ message: error.message });

        await client.query('BEGIN');
        transactionStarted = true;

        const updated = await client.query(
            'UPDATE budget_items SET actual_amount = actual_amount + $1, updated_at = now() WHERE id = $2 RETURNING *',
            [amount, itemId]
        );

        if (item.linked_saving_item_id) {
            await client.query(
                'UPDATE budget_items SET actual_amount = actual_amount + $1, budgeted_amount = budgeted_amount + $1, updated_at = now() WHERE id = $2',
                [amount, item.linked_saving_item_id]
            );
        }

        await recomputeForwardChainForMonth(client, item.budget_month_id);

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Abono registrado', item: updated.rows[0] });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en addContribution:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

// Permite corregir/sembrar los saldos de apertura de un mes a mano — esto
// es lo que le da sentido real a "Balance Deudas pendiente": sin un monto
// inicial de deuda, ese balance nunca tiene de dónde arrancar y termina
// corriendo al revés (bajando en negativo con cada pago en vez de acercarse
// a cero). Los meses siguientes que ya existan se recalculan en cascada
// (ver `recomputeForwardChainForMonth`), así que corregir un saldo acá
// también corrige lo que ya se había arrastrado mal a futuro.
const updateOpening = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const monthDate = parseMonthParam(req.params.month);
        const { cash_balance: cashBalance, savings_balance: savingsBalance, debt_balance: debtBalance } = req.body;

        if (!monthDate) {
            return res.status(400).json({ message: 'El mes debe tener formato YYYY-MM' });
        }
        if (cashBalance === undefined && savingsBalance === undefined && debtBalance === undefined) {
            return res.status(400).json({ message: 'Enviá al menos un saldo para actualizar' });
        }

        const budgetMonth = await getOrCreateBudgetMonth(client, userId, monthDate);

        const nextCash = cashBalance !== undefined ? Number(cashBalance) : Number(budgetMonth.opening_cash_balance);
        const nextSavings = savingsBalance !== undefined ? Number(savingsBalance) : Number(budgetMonth.opening_savings_balance);
        const nextDebt = debtBalance !== undefined ? Number(debtBalance) : Number(budgetMonth.opening_debt_balance);

        if ([nextCash, nextSavings, nextDebt].some((n) => !Number.isFinite(n))) {
            return res.status(400).json({ message: 'Los saldos deben ser números' });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const updated = await client.query(
            `
            UPDATE budget_months
            SET opening_cash_balance = $1, opening_savings_balance = $2, opening_debt_balance = $3
            WHERE id = $4
            RETURNING *
            `,
            [nextCash, nextSavings, nextDebt, budgetMonth.id]
        );

        await recomputeForwardChainForMonth(client, budgetMonth.id);

        await client.query('COMMIT');

        return res.status(200).json({
            message: 'Saldos iniciales actualizados',
            opening: {
                cash_balance: Number(updated.rows[0].opening_cash_balance),
                savings_balance: Number(updated.rows[0].opening_savings_balance),
                debt_balance: Number(updated.rows[0].opening_debt_balance),
            },
        });
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('Error en updateOpening:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

module.exports = {
    getMonth,
    createItem,
    updateItem,
    addContribution,
    deleteItem,
    updateOpening,
};
