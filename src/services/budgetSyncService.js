const SECTIONS = ['income', 'fixed_expense', 'tracked_expense', 'saving', 'debt'];

// Normaliza cualquier fecha/string a un DATE de primer-día-de-mes (YYYY-MM-01),
// que es como se guarda `budget_months.month`.
const toMonthDate = (dateLike) => {
    const d = new Date(dateLike);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

const currentMonthDate = () => toMonthDate(new Date());

// Busca (o crea de forma perezosa) el budget_months de `userId` para `monthDate`.
// Al crearlo, copia los saldos de cierre del mes anterior más reciente que
// exista (no necesariamente el mes calendario inmediato, por si hay huecos).
const getOrCreateBudgetMonth = async (client, userId, monthDate) => {
    const normalizedMonth = toMonthDate(monthDate);

    const existing = await client.query(
        'SELECT * FROM budget_months WHERE user_id = $1 AND month = $2',
        [userId, normalizedMonth]
    );
    if (existing.rows.length > 0) {
        return existing.rows[0];
    }

    const previousResult = await client.query(
        'SELECT * FROM budget_months WHERE user_id = $1 AND month < $2 ORDER BY month DESC LIMIT 1',
        [userId, normalizedMonth]
    );

    let opening = { cash: 0, savings: 0, debt: 0 };
    if (previousResult.rows.length > 0) {
        const previousMonth = previousResult.rows[0];
        const { totals } = await computeMonthTotals(client, previousMonth);
        opening = {
            cash: totals.balance,
            savings: totals.savings_balance,
            debt: totals.debt_balance,
        };
    }

    const created = await client.query(
        `
        INSERT INTO budget_months (user_id, month, opening_cash_balance, opening_savings_balance, opening_debt_balance)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [userId, normalizedMonth, opening.cash, opening.savings, opening.debt]
    );

    return created.rows[0];
};

// Trae todos los budget_items de un mes, agrupados por sección, con sus
// totales y los totales generales (presupuestado, saldo semanal, balance).
const computeMonthTotals = async (client, budgetMonth) => {
    const itemsResult = await client.query(
        `
        SELECT bi.*, bs.expense_id AS sync_expense_id, bs.role AS sync_role
        FROM budget_items bi
        LEFT JOIN budget_split_sync bs ON bs.budget_item_id = bi.id
        WHERE bi.budget_month_id = $1
        ORDER BY bi.position, bi.id
        `,
        [budgetMonth.id]
    );

    const sections = {};
    for (const section of SECTIONS) {
        sections[section] = { items: [], budgeted_total: 0, actual_total: 0 };
    }

    for (const row of itemsResult.rows) {
        const item = {
            id: row.id,
            section: row.section,
            label: row.label,
            budgeted_amount: Number(row.budgeted_amount),
            actual_amount: Number(row.actual_amount),
            is_savings_link: row.is_savings_link,
            linked_saving_item_id: row.linked_saving_item_id,
            is_split_synced: row.sync_expense_id != null,
            split_expense_id: row.sync_expense_id,
            position: row.position,
        };
        const bucket = sections[item.section];
        if (!bucket) continue;
        bucket.items.push(item);
        bucket.budgeted_total += item.budgeted_amount;
        bucket.actual_total += item.actual_amount;
    }

    const budgetedNet = sections.income.budgeted_total - sections.fixed_expense.budgeted_total - sections.tracked_expense.budgeted_total;
    const actualNet = sections.income.actual_total - sections.fixed_expense.actual_total - sections.tracked_expense.actual_total;

    const balance =
        Number(budgetMonth.opening_cash_balance) +
        sections.income.actual_total -
        sections.fixed_expense.actual_total -
        sections.tracked_expense.actual_total +
        sections.saving.actual_total -
        sections.debt.actual_total;

    const savingsBalance = Number(budgetMonth.opening_savings_balance) + sections.saving.actual_total;
    const debtBalance = Number(budgetMonth.opening_debt_balance) - sections.debt.actual_total;

    return {
        sections,
        totals: {
            budgeted_net: budgetedNet,
            actual_net: actualNet,
            weekly_budgeted: budgetedNet / 4,
            weekly_actual: actualNet / 4,
            balance,
            savings_balance: savingsBalance,
            debt_balance: debtBalance,
        },
    };
};

// Se llama al crear un gasto compartido: registra la salida completa de
// plata del bolsillo del pagador como un tracked_expense sincronizado.
const onExpenseCreated = async (client, expense) => {
    const budgetMonth = await getOrCreateBudgetMonth(client, expense.paid_by, expense.created_at);
    const amount = Number(expense.amount);

    const itemResult = await client.query(
        `
        INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount)
        VALUES ($1, 'tracked_expense', $2, $3, $3)
        RETURNING id
        `,
        [budgetMonth.id, expense.description, amount]
    );

    await client.query(
        `
        INSERT INTO budget_split_sync (budget_item_id, expense_id, user_id, role)
        VALUES ($1, $2, $3, 'payer')
        `,
        [itemResult.rows[0].id, expense.id, expense.paid_by]
    );
};

// Borra todo lo sincronizado de un gasto (payer + cualquier participante que
// ya haya generado su propio ítem) — usado antes de re-crear en un edit, o
// directamente al borrar el gasto.
const clearExpenseSync = async (client, expenseId) => {
    await client.query(
        `DELETE FROM budget_items WHERE id IN (SELECT budget_item_id FROM budget_split_sync WHERE expense_id = $1)`,
        [expenseId]
    );
};

const onExpenseUpdated = async (client, expenseId, expense) => {
    await clearExpenseSync(client, expenseId);
    await onExpenseCreated(client, expense);
};

const onExpenseDeleted = async (client, expenseId) => {
    await clearExpenseSync(client, expenseId);
};

// Se llama cuando un participante pasa a status='paid' de verdad (mark-paid
// directo, o confirmación de un claim). Le devuelve esa plata al pagador
// (reduce su ítem sincronizado) y registra la salida real de plata del
// bolsillo del deudor, en el mes en que efectivamente pagó.
const onParticipantSettled = async (client, expenseId, debtorUserId) => {
    const participantResult = await client.query(
        `
        SELECT e.id AS expense_id, e.paid_by, e.description, ep.amount_owed
        FROM expenses e
        INNER JOIN expense_participants ep ON ep.expense_id = e.id
        WHERE e.id = $1 AND ep.user_id = $2
        `,
        [expenseId, debtorUserId]
    );

    const row = participantResult.rows[0];
    if (!row) return;

    const amountOwed = Number(row.amount_owed);

    const payerSyncResult = await client.query(
        `SELECT budget_item_id FROM budget_split_sync WHERE expense_id = $1 AND role = 'payer'`,
        [expenseId]
    );
    if (payerSyncResult.rows.length > 0) {
        await client.query(
            'UPDATE budget_items SET actual_amount = actual_amount - $1, updated_at = now() WHERE id = $2',
            [amountOwed, payerSyncResult.rows[0].budget_item_id]
        );
    }

    const debtorBudgetMonth = await getOrCreateBudgetMonth(client, debtorUserId, currentMonthDate());

    const existingParticipantSync = await client.query(
        `SELECT budget_item_id FROM budget_split_sync WHERE expense_id = $1 AND user_id = $2 AND role = 'participant'`,
        [expenseId, debtorUserId]
    );

    if (existingParticipantSync.rows.length > 0) {
        await client.query(
            'UPDATE budget_items SET actual_amount = $1, budgeted_amount = $1, updated_at = now() WHERE id = $2',
            [amountOwed, existingParticipantSync.rows[0].budget_item_id]
        );
        return;
    }

    const itemResult = await client.query(
        `
        INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount)
        VALUES ($1, 'tracked_expense', $2, $3, $3)
        RETURNING id
        `,
        [debtorBudgetMonth.id, row.description, amountOwed]
    );

    await client.query(
        `
        INSERT INTO budget_split_sync (budget_item_id, expense_id, user_id, role)
        VALUES ($1, $2, $3, 'participant')
        `,
        [itemResult.rows[0].id, expenseId, debtorUserId]
    );
};

module.exports = {
    SECTIONS,
    toMonthDate,
    currentMonthDate,
    getOrCreateBudgetMonth,
    computeMonthTotals,
    onExpenseCreated,
    onExpenseUpdated,
    onExpenseDeleted,
    onParticipantSettled,
};
