const db = require('../db/connection');
const { splitEqually, computePayerShareFromCustomSplit } = require('../utils/splitCalculator');
const budgetSyncService = require('../services/budgetSyncService');

const getExpenseContactSuggestions = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(
            `
            SELECT
                u.id,
                u.email,
                u.username,
                u.first_name,
                u.middle_name,
                u.last_name,
                u.second_last_name,
                u.phone,
                f.created_at AS friendship_since
            FROM friends f
            INNER JOIN users u
                ON u.id = CASE
                    WHEN f.user_id_1 = $1 THEN f.user_id_2
                    ELSE f.user_id_1
                END
            WHERE f.status = 'accepted'
              AND ($1 = f.user_id_1 OR $1 = f.user_id_2)
              AND u.is_active = true
            ORDER BY u.username NULLS LAST, u.first_name NULLS LAST, u.email
            `,
            [userId]
        );

        return res.status(200).json({ suggestions: result.rows });
    } catch (error) {
        console.error('Error en getExpenseContactSuggestions:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Devuelve el set de ids de amigos aceptados y activos de `userId`.
const getAcceptedFriendIds = async (client, userId) => {
    const result = await client.query(
        `
        SELECT
            CASE
                WHEN f.user_id_1 = $1 THEN f.user_id_2
                ELSE f.user_id_1
            END AS friend_id
        FROM friends f
        INNER JOIN users u
            ON u.id = CASE
                WHEN f.user_id_1 = $1 THEN f.user_id_2
                ELSE f.user_id_1
            END
        WHERE f.status = 'accepted'
          AND ($1 = f.user_id_1 OR $1 = f.user_id_2)
          AND u.is_active = true
        `,
        [userId]
    );

    return new Set(result.rows.map((row) => Number(row.friend_id)));
};

// Valida y normaliza el body de creación/edición de un gasto. Devuelve
// { error } si algo es inválido, o { amountValue, description, shares }
// donde `shares` es un Map<userId, amount> que incluye al pagador.
const resolveExpenseSplit = async (client, { paidBy, amount, description, splitType, participants }) => {
    if (!amount || Number(amount) <= 0) {
        return { error: { status: 400, message: 'amount debe ser un número mayor a 0' } };
    }

    if (!description || typeof description !== 'string') {
        return { error: { status: 400, message: 'description es requerido' } };
    }

    const amountValue = Number(amount);
    const normalizedSplitType = splitType === 'custom' ? 'custom' : 'equal';

    if (!Array.isArray(participants)) {
        return { error: { status: 400, message: 'participants debe ser un array' } };
    }

    let otherUserIds;
    let customAmountByUserId = null;

    if (normalizedSplitType === 'custom') {
        customAmountByUserId = new Map();
        for (const entry of participants) {
            const userId = Number(entry?.user_id);
            const entryAmount = Number(entry?.amount);

            if (!Number.isInteger(userId) || userId <= 0) {
                return { error: { status: 400, message: 'Cada participante debe tener un user_id entero positivo' } };
            }
            if (userId === paidBy) {
                return { error: { status: 400, message: 'No incluyas al pagador en participants; su parte se calcula automáticamente' } };
            }
            if (!Number.isFinite(entryAmount) || entryAmount <= 0) {
                return { error: { status: 400, message: `El monto de participants[user_id=${userId}] debe ser mayor a 0` } };
            }

            customAmountByUserId.set(userId, entryAmount);
        }
        otherUserIds = [...customAmountByUserId.keys()];
    } else {
        otherUserIds = [...new Set(
            participants.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
        )].filter((id) => id !== paidBy);
    }

    if (otherUserIds.length > 0) {
        const acceptedFriendIds = await getAcceptedFriendIds(client, paidBy);
        const invalidParticipants = otherUserIds.filter((id) => !acceptedFriendIds.has(id));

        if (invalidParticipants.length > 0) {
            return {
                error: {
                    status: 400,
                    message: 'Solo puedes agregar amigos aceptados como participantes',
                    invalid_participants: invalidParticipants,
                },
            };
        }
    }

    let shares;

    if (normalizedSplitType === 'custom') {
        const otherShares = otherUserIds.map((id) => customAmountByUserId.get(id));
        const payerShare = computePayerShareFromCustomSplit(amountValue, otherShares);

        if (payerShare === null) {
            return { error: { status: 400, message: 'La suma de los participantes supera el monto total' } };
        }

        shares = new Map();
        shares.set(paidBy, payerShare);
        otherUserIds.forEach((id) => shares.set(id, customAmountByUserId.get(id)));
    } else {
        shares = splitEqually(amountValue, [paidBy, ...otherUserIds]);
    }

    return {
        amountValue,
        description: description.trim(),
        splitType: normalizedSplitType,
        shares,
    };
};

const insertParticipants = async (client, expenseId, paidBy, shares) => {
    for (const [userId, amountOwed] of shares.entries()) {
        const isPayer = userId === paidBy;
        await client.query(
            `
            INSERT INTO expense_participants (expense_id, user_id, amount_owed, status, confirmed_at)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [expenseId, userId, amountOwed, isPayer ? 'paid' : 'pending', isPayer ? new Date() : null]
        );
    }
};

const createExpense = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const paidBy = req.user.id;
        const { amount, description, participants, split_type: splitType } = req.body;

        const resolved = await resolveExpenseSplit(client, { paidBy, amount, description, splitType, participants });
        if (resolved.error) {
            const { status, ...body } = resolved.error;
            return res.status(status).json(body);
        }

        await client.query('BEGIN');
        transactionStarted = true;

        const expenseResult = await client.query(
            'INSERT INTO expenses (amount, description, paid_by) VALUES ($1, $2, $3) RETURNING id, amount, description, paid_by, created_at, updated_at',
            [resolved.amountValue, resolved.description, paidBy]
        );

        const expense = expenseResult.rows[0];
        await insertParticipants(client, expense.id, paidBy, resolved.shares);
        await budgetSyncService.onExpenseCreated(client, expense, resolved.shares);

        await client.query('COMMIT');

        return res.status(201).json({
            message: 'Gasto creado correctamente',
            expense,
            split: {
                split_type: resolved.splitType,
                participants_count: resolved.shares.size,
                shares: Object.fromEntries(resolved.shares),
            },
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query('ROLLBACK');
        }
        console.error('Error en createExpense:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const updateExpense = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const expenseId = Number(req.params.id);
        const { amount, description, participants, split_type: splitType } = req.body;

        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const expenseResult = await client.query('SELECT id, paid_by, amount, description FROM expenses WHERE id = $1', [expenseId]);
        const expense = expenseResult.rows[0];

        if (!expense) {
            return res.status(404).json({ message: 'Gasto no encontrado' });
        }

        if (expense.paid_by !== userId) {
            return res.status(403).json({ message: 'No tienes permiso para editar este gasto' });
        }

        const resolved = await resolveExpenseSplit(client, { paidBy: userId, amount, description, splitType, participants });
        if (resolved.error) {
            const { status, ...body } = resolved.error;
            return res.status(status).json(body);
        }

        // Si el monto y la forma de repartirlo no cambian de verdad, no hace
        // falta resetear nada: ni el progreso de pago de los participantes
        // ni los reembolsos que ya cobraste. Solo así evitamos que editar la
        // descripción para corregir una falta de ortografía te borre plata
        // que ya entró de verdad a tu presupuesto.
        const currentParticipantsResult = await client.query(
            'SELECT user_id, amount_owed FROM expense_participants WHERE expense_id = $1',
            [expenseId]
        );
        const currentShares = new Map(currentParticipantsResult.rows.map((r) => [r.user_id, Number(r.amount_owed)]));
        const amountUnchanged = Math.abs(Number(expense.amount) - resolved.amountValue) < 0.01;
        const sharesUnchanged =
            currentShares.size === resolved.shares.size &&
            [...resolved.shares.entries()].every(([uid, amt]) => Math.abs((currentShares.get(uid) ?? NaN) - amt) < 0.01);
        const isStructuralNoOp = amountUnchanged && sharesUnchanged;
        const descriptionChanged = expense.description !== resolved.description;

        await client.query('BEGIN');
        transactionStarted = true;

        let updatedExpenseResult;

        if (isStructuralNoOp) {
            updatedExpenseResult = await client.query(
                `
                UPDATE expenses
                SET description = $1, updated_at = now()
                WHERE id = $2
                RETURNING id, amount, description, paid_by, created_at, updated_at
                `,
                [resolved.description, expenseId]
            );
            if (descriptionChanged) {
                await budgetSyncService.relabelExpenseSync(client, expenseId, resolved.description);
            }
        } else {
            await client.query('DELETE FROM expense_participants WHERE expense_id = $1', [expenseId]);
            await insertParticipants(client, expenseId, userId, resolved.shares);

            updatedExpenseResult = await client.query(
                `
                UPDATE expenses
                SET amount = $1, description = $2, updated_at = now()
                WHERE id = $3
                RETURNING id, amount, description, paid_by, created_at, updated_at
                `,
                [resolved.amountValue, resolved.description, expenseId]
            );

            await budgetSyncService.onExpenseUpdated(client, expenseId, updatedExpenseResult.rows[0], resolved.shares);
        }

        await client.query('COMMIT');

        return res.status(200).json({
            message: isStructuralNoOp
                ? 'Gasto actualizado correctamente.'
                : 'Gasto actualizado correctamente. El estado de pago de los participantes se reinició porque el monto o los participantes cambiaron.',
            expense: updatedExpenseResult.rows[0],
            split: {
                split_type: resolved.splitType,
                participants_count: resolved.shares.size,
                shares: Object.fromEntries(resolved.shares),
            },
        });
    } catch (error) {
        if (transactionStarted) {
            await client.query('ROLLBACK');
        }
        console.error('Error en updateExpense:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const deleteExpense = async (req, res) => {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
        const userId = req.user.id;
        const expenseId = Number(req.params.id);

        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const expenseResult = await client.query('SELECT id, paid_by FROM expenses WHERE id = $1', [expenseId]);
        const expense = expenseResult.rows[0];

        if (!expense) {
            return res.status(404).json({ message: 'Gasto no encontrado' });
        }

        if (expense.paid_by !== userId) {
            return res.status(403).json({ message: 'No tienes permiso para eliminar este gasto' });
        }

        await client.query('BEGIN');
        transactionStarted = true;

        await budgetSyncService.onExpenseDeleted(client, expenseId);
        await client.query('DELETE FROM expense_participants WHERE expense_id = $1', [expenseId]);
        await client.query('DELETE FROM expenses WHERE id = $1', [expenseId]);

        await client.query('COMMIT');

        return res.status(200).json({ message: 'Gasto eliminado correctamente' });
    } catch (error) {
        if (transactionStarted) {
            await client.query('ROLLBACK');
        }
        console.error('Error en deleteExpense:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

const getExpenses = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(
            `
            SELECT
                e.id,
                e.amount,
                e.description,
                e.paid_by,
                payer.email AS paid_by_email,
                e.created_at,
                e.updated_at,
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'user_id', ep.user_id,
                            'email', participant_user.email,
                            'amount_owed', ep.amount_owed,
                            'amount_paid', ep.amount_paid,
                            'pending_claim_amount', ep.pending_claim_amount,
                            'status', ep.status,
                            'paid_claimed_at', ep.paid_claimed_at,
                            'confirmed_at', ep.confirmed_at
                        )
                    ) FILTER (WHERE ep.user_id IS NOT NULL),
                    '[]'::json
                ) AS participants,
                COALESCE(
                    MAX(CASE WHEN ep.user_id = $1 THEN ep.amount_owed END),
                    0
                ) AS my_share_amount
            FROM expenses e
            INNER JOIN users payer ON payer.id = e.paid_by
            LEFT JOIN expense_participants ep ON ep.expense_id = e.id
            LEFT JOIN users participant_user ON participant_user.id = ep.user_id
            WHERE e.paid_by = $1
               OR EXISTS (
                    SELECT 1
                    FROM expense_participants ep_visible
                    WHERE ep_visible.expense_id = e.id
                      AND ep_visible.user_id = $1
               )
            GROUP BY e.id, payer.email
            ORDER BY e.created_at DESC
            `,
            [userId]
        );

        const expenses = result.rows.map((expense) => ({
            id: expense.id,
            amount: Number(expense.amount),
            description: expense.description,
            paid_by: {
                id: expense.paid_by,
                email: expense.paid_by_email,
            },
            paid_by_me: expense.paid_by === userId,
            my_share_amount: Number(expense.my_share_amount),
            participants_count: Array.isArray(expense.participants) ? expense.participants.length : 0,
            participants: Array.isArray(expense.participants)
                ? expense.participants.map((participant) => ({
                    user_id: participant.user_id,
                    email: participant.email,
                    amount_owed: Number(participant.amount_owed),
                    amount_paid: Number(participant.amount_paid || 0),
                    pending_claim_amount: participant.pending_claim_amount !== null ? Number(participant.pending_claim_amount) : null,
                    status: participant.status || 'pending',
                    paid_claimed_at: participant.paid_claimed_at,
                    confirmed_at: participant.confirmed_at,
                }))
                : [],
            created_at: expense.created_at,
            updated_at: expense.updated_at,
        }));

        return res.status(200).json({ expenses });
    } catch (error) {
        console.error('Error en getExpenses:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const getBalance = async (req, res) => {
    try {
        const userId = req.user.id;

        const byFriendResult = await db.query(
            `
            WITH owed_to_me AS (
                SELECT ep.user_id AS friend_id, SUM(ep.amount_owed) AS amount
                FROM expense_participants ep
                INNER JOIN expenses e ON e.id = ep.expense_id
                WHERE e.paid_by = $1
                  AND ep.user_id <> $1
                  AND ep.status <> 'paid'
                GROUP BY ep.user_id
            ),
            i_owe AS (
                SELECT e.paid_by AS friend_id, SUM(ep.amount_owed) AS amount
                FROM expense_participants ep
                INNER JOIN expenses e ON e.id = ep.expense_id
                WHERE ep.user_id = $1
                  AND e.paid_by <> $1
                  AND ep.status <> 'paid'
                GROUP BY e.paid_by
            )
            SELECT
                COALESCE(otm.friend_id, io.friend_id) AS friend_id,
                u.email,
                u.username,
                u.first_name,
                u.last_name,
                COALESCE(otm.amount, 0) AS owed_to_me,
                COALESCE(io.amount, 0) AS i_owe
            FROM owed_to_me otm
            FULL OUTER JOIN i_owe io ON io.friend_id = otm.friend_id
            INNER JOIN users u ON u.id = COALESCE(otm.friend_id, io.friend_id)
            ORDER BY u.username NULLS LAST, u.first_name NULLS LAST, u.email
            `,
            [userId]
        );

        const byFriend = byFriendResult.rows.map((row) => {
            const owedToMe = Number(row.owed_to_me);
            const iOwe = Number(row.i_owe);
            return {
                friend_id: row.friend_id,
                name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || row.email,
                email: row.email,
                owed_to_me: owedToMe,
                i_owe: iOwe,
                net: owedToMe - iOwe,
            };
        });

        const owedToMe = byFriend.reduce((sum, f) => sum + f.owed_to_me, 0);
        const iOwe = byFriend.reduce((sum, f) => sum + f.i_owe, 0);

        return res.status(200).json({
            owed_to_me: owedToMe,
            i_owe: iOwe,
            net_balance: owedToMe - iOwe,
            by_friend: byFriend,
        });
    } catch (error) {
        console.error('Error en getBalance:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// El propio deudor avisa que pagó `amount` de su parte (por defecto, todo lo
// que le queda pendiente — así sigue funcionando igual que antes si no se
// manda el campo). Queda a la espera de que el pagador lo confirme (o lo
// rechace) — ver confirmParticipantPayment / rejectParticipantPayment.
const claimExpenseDebt = async (req, res) => {
    try {
        const userId = req.user.id;
        const expenseId = Number(req.params.id);

        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const participantResult = await db.query(
            `SELECT id, amount_owed, amount_paid, status FROM expense_participants WHERE expense_id = $1 AND user_id = $2`,
            [expenseId, userId]
        );
        const participant = participantResult.rows[0];

        if (!participant || participant.status !== 'pending') {
            return res.status(404).json({ message: 'No se encontró una deuda pendiente tuya en este gasto' });
        }

        const remaining = Number(participant.amount_owed) - Number(participant.amount_paid);
        const claimAmount = req.body?.amount !== undefined ? Number(req.body.amount) : remaining;

        if (!Number.isFinite(claimAmount) || claimAmount <= 0) {
            return res.status(400).json({ message: 'amount debe ser un número mayor a 0' });
        }
        if (claimAmount > remaining + 0.01) {
            return res.status(400).json({ message: `No puedes abonar más de lo que debes (te quedan ${remaining})` });
        }

        const result = await db.query(
            `
            UPDATE expense_participants
            SET status = 'paid_pending_confirmation', paid_claimed_at = now(), pending_claim_amount = $3
            WHERE expense_id = $1
              AND user_id = $2
              AND status = 'pending'
            RETURNING id, expense_id, user_id, amount_owed, amount_paid, pending_claim_amount, status, paid_claimed_at, confirmed_at
            `,
            [expenseId, userId, claimAmount]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No se encontró una deuda pendiente tuya en este gasto' });
        }

        return res.status(200).json({
            message: 'Marcado como pagado, esperando confirmación del pagador',
            participant: result.rows[0],
        });
    } catch (error) {
        console.error('Error en claimExpenseDebt:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// Helper compartido por mark-paid / confirm / reject: valida que quien
// llama sea el dueño del gasto y devuelve el gasto encontrado.
const requireOwnedExpense = async (expenseId, requesterId) => {
    const expenseResult = await db.query('SELECT id, paid_by FROM expenses WHERE id = $1', [expenseId]);
    const expense = expenseResult.rows[0];

    if (!expense) {
        return { error: { status: 404, message: 'Gasto no encontrado' } };
    }

    if (expense.paid_by !== requesterId) {
        return { error: { status: 403, message: 'No tienes permiso para modificar este gasto' } };
    }

    return { expense };
};

// El pagador registra un abono de un participante directamente (ej. pago en
// efectivo), sin pasar por el flujo de confirmación. `amount` es opcional —
// por defecto abona todo lo que falta (mismo comportamiento binario de
// antes). Si el abono no cubre el total, el participante queda 'pending'
// con su amount_paid actualizado, listo para otro abono más adelante.
const markParticipantPaid = async (req, res) => {
    try {
        const paidBy = req.user.id;
        const expenseId = Number(req.params.id);
        const debtorUserId = Number(req.params.userId);

        if (!Number.isInteger(expenseId) || expenseId <= 0 || !Number.isInteger(debtorUserId) || debtorUserId <= 0) {
            return res.status(400).json({ message: 'Parámetros inválidos' });
        }

        const { error } = await requireOwnedExpense(expenseId, paidBy);
        if (error) return res.status(error.status).json({ message: error.message });

        const participantResult = await db.query(
            `SELECT amount_owed, amount_paid, status FROM expense_participants WHERE expense_id = $1 AND user_id = $2`,
            [expenseId, debtorUserId]
        );
        const participant = participantResult.rows[0];

        if (!participant || participant.status === 'paid') {
            return res.status(404).json({ message: 'Participante no encontrado o ya estaba pagado' });
        }

        const remaining = Number(participant.amount_owed) - Number(participant.amount_paid);
        const payAmount = req.body?.amount !== undefined ? Number(req.body.amount) : remaining;

        if (!Number.isFinite(payAmount) || payAmount <= 0) {
            return res.status(400).json({ message: 'amount debe ser un número mayor a 0' });
        }
        if (payAmount > remaining + 0.01) {
            return res.status(400).json({ message: `No puedes marcar más de lo que debe (le quedan ${remaining})` });
        }

        const isFullyPaid = payAmount >= remaining - 0.01;

        const result = await db.query(
            `
            UPDATE expense_participants
            SET amount_paid = amount_paid + $3,
                status = $4,
                pending_claim_amount = NULL,
                confirmed_at = CASE WHEN $4 = 'paid' THEN now() ELSE confirmed_at END
            WHERE expense_id = $1 AND user_id = $2
            RETURNING id, expense_id, user_id, amount_owed, amount_paid, status, paid_claimed_at, confirmed_at
            `,
            [expenseId, debtorUserId, payAmount, isFullyPaid ? 'paid' : 'pending']
        );

        await budgetSyncService.onParticipantSettled(db, expenseId, debtorUserId, payAmount, isFullyPaid);

        return res.status(200).json({
            message: isFullyPaid ? 'Marcado como pagado' : 'Abono registrado',
            participant: result.rows[0],
        });
    } catch (error) {
        console.error('Error en markParticipantPaid:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const confirmParticipantPayment = async (req, res) => {
    try {
        const paidBy = req.user.id;
        const expenseId = Number(req.params.id);
        const debtorUserId = Number(req.params.userId);

        if (!Number.isInteger(expenseId) || expenseId <= 0 || !Number.isInteger(debtorUserId) || debtorUserId <= 0) {
            return res.status(400).json({ message: 'Parámetros inválidos' });
        }

        const { error } = await requireOwnedExpense(expenseId, paidBy);
        if (error) return res.status(error.status).json({ message: error.message });

        const participantResult = await db.query(
            `SELECT amount_owed, amount_paid, pending_claim_amount, status FROM expense_participants WHERE expense_id = $1 AND user_id = $2`,
            [expenseId, debtorUserId]
        );
        const participant = participantResult.rows[0];

        if (!participant || participant.status !== 'paid_pending_confirmation') {
            return res.status(404).json({ message: 'No hay un pago esperando confirmación para este participante' });
        }

        const claimAmount = Number(participant.pending_claim_amount);
        const newAmountPaid = Number(participant.amount_paid) + claimAmount;
        const isFullyPaid = newAmountPaid >= Number(participant.amount_owed) - 0.01;

        const result = await db.query(
            `
            UPDATE expense_participants
            SET amount_paid = $3,
                status = $4,
                pending_claim_amount = NULL,
                confirmed_at = CASE WHEN $4 = 'paid' THEN now() ELSE confirmed_at END
            WHERE expense_id = $1 AND user_id = $2
            RETURNING id, expense_id, user_id, amount_owed, amount_paid, status, paid_claimed_at, confirmed_at
            `,
            [expenseId, debtorUserId, newAmountPaid, isFullyPaid ? 'paid' : 'pending']
        );

        await budgetSyncService.onParticipantSettled(db, expenseId, debtorUserId, claimAmount, isFullyPaid);

        return res.status(200).json({
            message: isFullyPaid ? 'Pago confirmado' : 'Abono confirmado',
            participant: result.rows[0],
        });
    } catch (error) {
        console.error('Error en confirmParticipantPayment:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const rejectParticipantPayment = async (req, res) => {
    try {
        const paidBy = req.user.id;
        const expenseId = Number(req.params.id);
        const debtorUserId = Number(req.params.userId);

        if (!Number.isInteger(expenseId) || expenseId <= 0 || !Number.isInteger(debtorUserId) || debtorUserId <= 0) {
            return res.status(400).json({ message: 'Parámetros inválidos' });
        }

        const { error } = await requireOwnedExpense(expenseId, paidBy);
        if (error) return res.status(error.status).json({ message: error.message });

        const result = await db.query(
            `
            UPDATE expense_participants
            SET status = 'pending', paid_claimed_at = NULL, pending_claim_amount = NULL
            WHERE expense_id = $1
              AND user_id = $2
              AND status = 'paid_pending_confirmation'
            RETURNING id, expense_id, user_id, amount_owed, amount_paid, status, paid_claimed_at, confirmed_at
            `,
            [expenseId, debtorUserId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No hay un pago esperando confirmación para este participante' });
        }

        return res.status(200).json({ message: 'Pago rechazado, vuelve a quedar pendiente', participant: result.rows[0] });
    } catch (error) {
        console.error('Error en rejectParticipantPayment:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    createExpense,
    updateExpense,
    deleteExpense,
    getExpenses,
    getBalance,
    claimExpenseDebt,
    markParticipantPaid,
    confirmParticipantPayment,
    rejectParticipantPayment,
    getExpenseContactSuggestions,
};
