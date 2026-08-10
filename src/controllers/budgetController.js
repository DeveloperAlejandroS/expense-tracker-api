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

// Un ítem de Gastos Fijos/Seguimiento puede vincularse a un ahorro que YA
// EXISTE (nunca se crea uno nuevo en automático — "no se puede asignar
// dinero a un ahorro si este no está creado"). El aporte se aplica siempre
// como un INCREMENTO/decremento sobre el ahorro elegido, nunca
// sobreescribiendo su monto total: el mismo ahorro puede recibir dinero de
// más de un gasto vinculado, o de abonos manuales, y todos tienen que
// sumarse entre sí en vez de pisarse.
// GREATEST(..., 0): un ahorro nunca puede quedar en negativo. Si alguien
// edita el ahorro a mano después de vincularlo, y después se borra o
// desvincula el gasto que lo alimentaba, sin este piso el ahorro podía
// terminar con un monto negativo — algo que no tiene sentido para un
// ahorro (no existe "menos que nada" ahorrado).
const applySavingsDelta = async (client, targetItemId, delta) => {
    if (!targetItemId || delta === 0) return;
    await client.query(
        `
        UPDATE budget_items
        SET budgeted_amount = GREATEST(budgeted_amount + $1, 0),
            actual_amount = GREATEST(actual_amount + $1, 0),
            updated_at = now()
        WHERE id = $2
        `,
        [delta, targetItemId]
    );
};

// Valida que `targetItemId` sea un ahorro real: existe, es tuyo, está en la
// sección `saving`, vive en el mismo mes que el gasto que se quiere
// vincular, y no es un ítem sincronizado desde Split.it.
const validateSavingsTarget = async (client, userId, budgetMonthId, targetItemId) => {
    const result = await client.query(
        `
        SELECT bi.id, bi.section, bi.budget_month_id
        FROM budget_items bi
        INNER JOIN budget_months bm ON bm.id = bi.budget_month_id
        WHERE bi.id = $1 AND bm.user_id = $2
        `,
        [targetItemId, userId]
    );
    const target = result.rows[0];
    if (!target || target.section !== 'saving') {
        return { error: { status: 400, message: 'El ahorro seleccionado no existe. Crea el ahorro primero desde la sección Ahorros.' } };
    }
    if (target.budget_month_id !== budgetMonthId) {
        return { error: { status: 400, message: 'El ahorro tiene que estar en el mismo mes que este gasto' } };
    }
    const syncCheck = await client.query('SELECT id FROM budget_split_sync WHERE budget_item_id = $1', [targetItemId]);
    if (syncCheck.rows.length > 0) {
        return { error: { status: 400, message: 'No puedes vincular a un ítem sincronizado con Split.it' } };
    }
    return { item: target };
};

const createItem = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const monthDate = parseMonthParam(req.params.month);
        const { section, label, budgeted_amount: budgetedAmount, actual_amount: actualAmount, link_to_saving_item_id: linkToSavingItemId } = req.body;

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

        let targetSavingItemId = null;
        if (linkToSavingItemId !== undefined && linkToSavingItemId !== null) {
            if (!SAVINGS_LINK_SECTIONS.includes(section)) {
                return res.status(400).json({ message: 'Solo los ítems de Gastos Fijos o Seguimiento pueden vincularse a un ahorro' });
            }
            targetSavingItemId = Number(linkToSavingItemId);
            if (!Number.isInteger(targetSavingItemId) || targetSavingItemId <= 0) {
                return res.status(400).json({ message: 'link_to_saving_item_id debe ser un entero positivo' });
            }
        }

        const budgetMonth = await getOrCreateBudgetMonth(client, userId, monthDate);

        if (targetSavingItemId) {
            const { error: targetError } = await validateSavingsTarget(client, userId, budgetMonth.id, targetSavingItemId);
            if (targetError) return res.status(targetError.status).json({ message: targetError.message });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const positionResult = await client.query(
            'SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM budget_items WHERE budget_month_id = $1 AND section = $2',
            [budgetMonth.id, section]
        );

        const inserted = await client.query(
            `
            INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_savings_link, linked_saving_item_id, position)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            `,
            [budgetMonth.id, section, label.trim(), budgeted, actual, targetSavingItemId != null, targetSavingItemId, positionResult.rows[0].next_position]
        );

        const item = inserted.rows[0];

        if (targetSavingItemId) {
            await applySavingsDelta(client, targetSavingItemId, actual);
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
// que no esté sincronizado desde Split.it (esos no se editan directamente).
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
    if (item.libreta_entry_id) {
        return { error: { status: 400, message: 'Este ítem viene de un abono de la Libreta y no se puede editar directamente' } };
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

        const { label, budgeted_amount: budgetedAmount, actual_amount: actualAmount } = req.body;
        const linkProvided = Object.prototype.hasOwnProperty.call(req.body, 'link_to_saving_item_id');

        const nextLabel = label !== undefined ? String(label).trim() : item.label;
        const nextBudgeted = budgetedAmount !== undefined ? Number(budgetedAmount) || 0 : Number(item.budgeted_amount);
        const nextActual = actualAmount !== undefined ? Number(actualAmount) || 0 : Number(item.actual_amount);

        if (nextBudgeted < 0 || nextActual < 0) {
            return res.status(400).json({ message: 'Los montos no pueden ser negativos' });
        }

        const oldLinkedSavingItemId = item.linked_saving_item_id;
        let nextLinkedSavingItemId = oldLinkedSavingItemId;
        if (linkProvided) {
            const raw = req.body.link_to_saving_item_id;
            nextLinkedSavingItemId = raw === null || raw === undefined ? null : Number(raw);
            if (nextLinkedSavingItemId && !SAVINGS_LINK_SECTIONS.includes(item.section)) {
                return res.status(400).json({ message: 'Solo los ítems de Gastos Fijos o Seguimiento pueden vincularse a un ahorro' });
            }
            if (nextLinkedSavingItemId) {
                const { error: targetError } = await validateSavingsTarget(client, userId, item.budget_month_id, nextLinkedSavingItemId);
                if (targetError) return res.status(targetError.status).json({ message: targetError.message });
            }
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const oldActual = Number(item.actual_amount);

        // Revierte el aporte viejo si se desvinculó o cambió de destino.
        if (oldLinkedSavingItemId && oldLinkedSavingItemId !== nextLinkedSavingItemId) {
            await applySavingsDelta(client, oldLinkedSavingItemId, -oldActual);
        }
        // Aplica el aporte nuevo: si el destino es el mismo de antes, solo la
        // diferencia entre el monto viejo y el nuevo; si es un destino nuevo
        // (o recién se vinculó), el monto completo.
        if (nextLinkedSavingItemId) {
            const delta = oldLinkedSavingItemId === nextLinkedSavingItemId ? nextActual - oldActual : nextActual;
            await applySavingsDelta(client, nextLinkedSavingItemId, delta);
        }

        const updated = await client.query(
            `
            UPDATE budget_items
            SET label = $1, budgeted_amount = $2, actual_amount = $3, is_savings_link = $4, linked_saving_item_id = $5, updated_at = now()
            WHERE id = $6
            RETURNING *
            `,
            [nextLabel, nextBudgeted, nextActual, nextLinkedSavingItemId != null, nextLinkedSavingItemId, itemId]
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

        // El ahorro vinculado ya NO es un espejo que se borra junto con esto
        // — es un ítem independiente que el usuario creó a mano. Borrar este
        // gasto solo revierte el aporte que le había hecho.
        if (item.linked_saving_item_id) {
            await applySavingsDelta(client, item.linked_saving_item_id, -Number(item.actual_amount));
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

// Abono: suma dinero a un ítem existente (típicamente en Ahorros o Deudas)
// en vez de tener que crear una fila nueva cada vez que metes más dinero al
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
