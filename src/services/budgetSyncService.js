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
            cash: totals.carry_forward_cash,
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
//
// Los ítems con is_pending=true (obligaciones de un gasto compartido que
// todavía no pagaste de verdad) se listan igual dentro de cada sección para
// que sean visibles, pero NO suman en budgeted_total/actual_total ni en
// ningún total global — esos solo reflejan dinero que ya se movió de
// verdad. Se exponen aparte en `pending_total` por sección.
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
        sections[section] = { items: [], budgeted_total: 0, actual_total: 0, pending_total: 0 };
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
            split_role: row.sync_role,
            is_pending: row.is_pending,
            libreta_entry_id: row.libreta_entry_id,
            debt_entry_id: row.debt_entry_id,
            position: row.position,
        };
        const bucket = sections[item.section];
        if (!bucket) continue;
        bucket.items.push(item);
        if (item.is_pending) {
            bucket.pending_total += item.actual_amount;
        } else {
            bucket.budgeted_total += item.budgeted_amount;
            bucket.actual_total += item.actual_amount;
        }
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

    // `balance` es "patrimonio líquido" del mes: incluye lo que se apartó a
    // Ahorros (con el `+Ahorros` cancelando la resta que ese mismo monto ya
    // generó en Gastos Fijos/Seguimiento cuando el ítem está vinculado a un
    // ahorro). Pero ese dinero NO es caja disponible para gastar — vive en
    // `savings_balance`, aparte. Si el mes siguiente arranca su
    // `opening_cash_balance` copiando `balance` tal cual, el dinero ahorrado
    // este mes queda contada DOS VECES hacia adelante: una en el saldo de
    // caja del mes que viene, y otra en `opening_savings_balance` (que
    // también arrastra `savings_balance`). `carryForwardCash` es la versión
    // correcta para heredar: la caja realmente disponible, sin la parte que
    // ya está separada como ahorro.
    const carryForwardCash = balance - sections.saving.actual_total;

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
            carry_forward_cash: carryForwardCash,
        },
    };
};

// Recalcula en cascada los `opening_*` de todos los meses de `userId` que ya
// existan DESPUÉS de `monthDate`, encadenando el cierre de cada mes con la
// apertura del siguiente. Sin esto, si abonas a un ahorro/deuda o corriges
// un saldo inicial DESPUÉS de que el mes siguiente ya se había creado (por
// haberlo abierto una vez), ese mes queda con una apertura vieja — el saldo
// no fluye de un mes al otro como debería. Se corta apenas encuentra un mes
// cuya apertura ya está al día (el resto de la cadena, si la hay, ya lo
// estará también) o cuando no hay más meses siguientes creados.
const recomputeForwardChain = async (client, userId, monthDate) => {
    let cursor = toMonthDate(monthDate);

    for (let i = 0; i < 240; i += 1) {
        const currentResult = await client.query(
            'SELECT * FROM budget_months WHERE user_id = $1 AND month = $2',
            [userId, cursor]
        );
        const currentMonth = currentResult.rows[0];
        if (!currentMonth) return;

        const { totals } = await computeMonthTotals(client, currentMonth);

        const nextResult = await client.query(
            'SELECT * FROM budget_months WHERE user_id = $1 AND month > $2 ORDER BY month ASC LIMIT 1',
            [userId, cursor]
        );
        const nextMonth = nextResult.rows[0];
        if (!nextMonth) return;

        const alreadyUpToDate =
            Number(nextMonth.opening_cash_balance) === totals.carry_forward_cash &&
            Number(nextMonth.opening_savings_balance) === totals.savings_balance &&
            Number(nextMonth.opening_debt_balance) === totals.debt_balance;

        if (alreadyUpToDate) return;

        await client.query(
            'UPDATE budget_months SET opening_cash_balance = $1, opening_savings_balance = $2, opening_debt_balance = $3 WHERE id = $4',
            [totals.carry_forward_cash, totals.savings_balance, totals.debt_balance, nextMonth.id]
        );

        cursor = toMonthDate(nextMonth.month);
    }
};

// Atajo para cuando lo que se tiene a mano es un budget_month_id (o el id de
// un ítem que pertenece a ese mes) en vez de (userId, monthDate) directo.
const recomputeForwardChainForMonth = async (client, budgetMonthId) => {
    const monthResult = await client.query('SELECT user_id, month FROM budget_months WHERE id = $1', [budgetMonthId]);
    const row = monthResult.rows[0];
    if (!row) return;
    await recomputeForwardChain(client, row.user_id, row.month);
};

// Se llama al crear (o re-crear en un edit) un gasto compartido:
// - El pagador recibe un ítem CONFIRMADO por SU PROPIA parte (shares.get
//   (paid_by)), no por el monto total — lo que otros le deben no es un
//   gasto suyo, es dinero que va a recuperar. Antes esto se creaba por el
//   monto completo, lo que inflaba "Gastos" incluso cuando la parte del
//   pagador era $0 (ej. le prestaste/vendiste algo a alguien y te debe
//   el 100%): no gastaste nada, pero igual aparecía como si lo hubieras
//   hecho.
// - Cada otro participante recibe un ítem PENDIENTE por su parte, en su
//   propio mes actual — visible como obligación, pero no cuenta en su
//   Balance hasta que la pague de verdad y se confirme.
// - Lo que te devuelvan después (ver onParticipantSettled) entra como
//   Ingreso en el mes en que de verdad lo recibes, no como una resta a
//   este ítem.
const onExpenseCreated = async (client, expense, shares) => {
    const payerMonth = await getOrCreateBudgetMonth(client, expense.paid_by, expense.created_at);
    const payerOwnShare = shares?.get(expense.paid_by) ?? Number(expense.amount);

    const payerItemResult = await client.query(
        `
        INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending)
        VALUES ($1, 'tracked_expense', $2, $3, $3, false)
        RETURNING id
        `,
        [payerMonth.id, expense.description, Number(payerOwnShare)]
    );

    await client.query(
        `INSERT INTO budget_split_sync (budget_item_id, expense_id, user_id, role) VALUES ($1, $2, $3, 'payer')`,
        [payerItemResult.rows[0].id, expense.id, expense.paid_by]
    );

    // El ítem del pagador ya cuenta desde ya (no es pending) — si su mes
    // siguiente ya existía, su apertura queda vieja hasta que se recalcula.
    await recomputeForwardChainForMonth(client, payerMonth.id);

    if (!shares) return;

    for (const [userId, shareAmount] of shares.entries()) {
        if (userId === expense.paid_by) continue;

        const participantMonth = await getOrCreateBudgetMonth(client, userId, currentMonthDate());

        const itemResult = await client.query(
            `
            INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending)
            VALUES ($1, 'tracked_expense', $2, $3, $3, true)
            RETURNING id
            `,
            [participantMonth.id, expense.description, Number(shareAmount)]
        );

        await client.query(
            `INSERT INTO budget_split_sync (budget_item_id, expense_id, user_id, role) VALUES ($1, $2, $3, 'participant')`,
            [itemResult.rows[0].id, expense.id, userId]
        );
    }
};

// Borra lo sincronizado de un gasto que ya no corresponde (payer +
// participantes) — usado antes de re-crear en un edit, o directamente al
// borrar el gasto. A propósito NO toca los ítems 'payer_income': esos son
// reembolsos que YA cobraste de verdad, y editar o borrar el gasto que los
// originó no debería hacer que esa plata desaparezca de tu presupuesto.
const clearExpenseSync = async (client, expenseId) => {
    const affectedMonths = await client.query(
        `
        SELECT DISTINCT bi.budget_month_id
        FROM budget_items bi
        INNER JOIN budget_split_sync bs ON bs.budget_item_id = bi.id
        WHERE bs.expense_id = $1 AND bs.role IN ('payer', 'participant')
        `,
        [expenseId]
    );

    await client.query(
        `
        DELETE FROM budget_items WHERE id IN (
            SELECT budget_item_id FROM budget_split_sync WHERE expense_id = $1 AND role IN ('payer', 'participant')
        )
        `,
        [expenseId]
    );

    for (const row of affectedMonths.rows) {
        await recomputeForwardChainForMonth(client, row.budget_month_id);
    }
};

const onExpenseUpdated = async (client, expenseId, expense, shares) => {
    await clearExpenseSync(client, expenseId);
    await onExpenseCreated(client, expense, shares);
};

const onExpenseDeleted = async (client, expenseId) => {
    await clearExpenseSync(client, expenseId);
};

// Se llama cuando se edita SOLO la descripción de un gasto (el monto y los
// participantes quedan exactamente igual) — no hace falta resetear nada de
// lo ya pagado, pero sí conviene que las etiquetas de los ítems ya
// sincronizados (el gasto del pagador, el de cada participante, y
// cualquier reembolso ya cobrado) reflejen el texto nuevo.
const relabelExpenseSync = async (client, expenseId, newDescription) => {
    const syncedResult = await client.query(
        `SELECT budget_item_id, role FROM budget_split_sync WHERE expense_id = $1`,
        [expenseId]
    );

    for (const row of syncedResult.rows) {
        const label = row.role === 'payer_income' ? `Reembolso: ${newDescription}` : newDescription;
        await client.query('UPDATE budget_items SET label = $1, updated_at = now() WHERE id = $2', [label, row.budget_item_id]);
    }
};

// Se llama con cada abono (parcial o total) que un participante paga de
// verdad — `incrementAmount` es lo que se acaba de pagar en esta pasada, no
// el total de la deuda. Al pagador ese dinero le entra como INGRESO (un
// "Reembolso: <descripción>") en su mes actual — no como una resta a su
// ítem de Gastos, que ya solo representa su propia parte y no debería
// moverse por esto. Y, solo si con este abono la deuda queda 100% saldada,
// confirma el ítem pendiente del deudor (is_pending → false). Mientras
// quede algo por pagar, el ítem del deudor se mantiene pendiente tal cual.
const onParticipantSettled = async (client, expenseId, debtorUserId, incrementAmount, isFullyPaid) => {
    const payerSyncResult = await client.query(
        `
        SELECT bs.user_id AS payer_user_id, e.description
        FROM budget_split_sync bs
        INNER JOIN expenses e ON e.id = bs.expense_id
        WHERE bs.expense_id = $1 AND bs.role = 'payer'
        `,
        [expenseId]
    );
    if (payerSyncResult.rows.length > 0) {
        const { payer_user_id: payerUserId, description } = payerSyncResult.rows[0];
        const payerMonth = await getOrCreateBudgetMonth(client, payerUserId, currentMonthDate());

        // Puede haber varios abonos del mismo gasto cayendo en meses
        // distintos — buscamos si ya existe el ítem de reembolso PARA ESTE
        // MES puntual antes de crear uno nuevo, para no duplicar filas.
        const existingIncomeResult = await client.query(
            `
            SELECT bi.id AS budget_item_id
            FROM budget_split_sync bs
            INNER JOIN budget_items bi ON bi.id = bs.budget_item_id
            WHERE bs.expense_id = $1 AND bs.user_id = $2 AND bs.role = 'payer_income'
              AND bi.budget_month_id = $3
            `,
            [expenseId, payerUserId, payerMonth.id]
        );

        if (existingIncomeResult.rows.length > 0) {
            await client.query(
                'UPDATE budget_items SET budgeted_amount = budgeted_amount + $1, actual_amount = actual_amount + $1, updated_at = now() WHERE id = $2',
                [incrementAmount, existingIncomeResult.rows[0].budget_item_id]
            );
        } else {
            const createdIncome = await client.query(
                `
                INSERT INTO budget_items (budget_month_id, section, label, budgeted_amount, actual_amount, is_pending)
                VALUES ($1, 'income', $2, $3, $3, false)
                RETURNING id
                `,
                [payerMonth.id, `Reembolso: ${description}`, incrementAmount]
            );
            await client.query(
                `INSERT INTO budget_split_sync (budget_item_id, expense_id, user_id, role) VALUES ($1, $2, $3, 'payer_income')`,
                [createdIncome.rows[0].id, expenseId, payerUserId]
            );
        }

        await recomputeForwardChainForMonth(client, payerMonth.id);
    }

    if (!isFullyPaid) return;

    const existingParticipantSync = await client.query(
        `
        SELECT bi.id AS budget_item_id, bi.budget_month_id
        FROM budget_split_sync bs
        INNER JOIN budget_items bi ON bi.id = bs.budget_item_id
        WHERE bs.expense_id = $1 AND bs.user_id = $2 AND bs.role = 'participant'
        `,
        [expenseId, debtorUserId]
    );

    if (existingParticipantSync.rows.length > 0) {
        const { budget_item_id: participantItemId, budget_month_id: participantMonthId } = existingParticipantSync.rows[0];
        await client.query(
            'UPDATE budget_items SET is_pending = false, updated_at = now() WHERE id = $1',
            [participantItemId]
        );
        // El ítem del deudor recién ahora empieza a contar (is_pending pasó
        // a false) — su Balance de este mes cambió, así que su cadena hacia
        // adelante también puede necesitar recalcularse.
        await recomputeForwardChainForMonth(client, participantMonthId);
    }
};

module.exports = {
    SECTIONS,
    toMonthDate,
    currentMonthDate,
    getOrCreateBudgetMonth,
    computeMonthTotals,
    recomputeForwardChain,
    recomputeForwardChainForMonth,
    onExpenseCreated,
    onExpenseUpdated,
    onExpenseDeleted,
    onParticipantSettled,
    relabelExpenseSync,
};
