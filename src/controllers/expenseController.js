const db = require('../db/connection');

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

const createExpense = async (req, res) => {
    const client = await db.getClient();

    try {
        const { amount, description, participants } = req.body;
        const paidBy = req.user.id;

        if (!amount || Number(amount) <= 0) {
            return res.status(400).json({ message: 'amount debe ser un número mayor a 0' });
        }

        if (!description || typeof description !== 'string') {
            return res.status(400).json({ message: 'description es requerido' });
        }

        if (!Array.isArray(participants)) {
            return res.status(400).json({ message: 'participants debe ser un array de IDs' });
        }

        const cleanedParticipants = [...new Set(participants.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
            .filter((id) => id !== paidBy);

        if (cleanedParticipants.length > 0) {
            const acceptedFriendsResult = await client.query(
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
                [paidBy]
            );

            const acceptedFriendIds = new Set(acceptedFriendsResult.rows.map((row) => Number(row.friend_id)));
            const invalidParticipants = cleanedParticipants.filter((id) => !acceptedFriendIds.has(id));

            if (invalidParticipants.length > 0) {
                return res.status(400).json({
                    message: 'Solo puedes agregar amigos aceptados como participantes',
                    invalid_participants: invalidParticipants,
                });
            }
        }

        const amountValue = Number(amount);
        const totalPeople = cleanedParticipants.length + 1;
        const amountOwed = amountValue / totalPeople;

        await client.query('BEGIN');

        const expenseResult = await client.query(
            'INSERT INTO expenses (amount, description, paid_by) VALUES ($1, $2, $3) RETURNING id, amount, description, paid_by, created_at',
            [amountValue, description.trim(), paidBy]
        );

        const expense = expenseResult.rows[0];
        const allParticipants = [paidBy, ...cleanedParticipants];

        for (const userId of allParticipants) {
            const isPaid = userId === paidBy;
            await client.query(
                'INSERT INTO expense_participants (expense_id, user_id, amount_owed, is_paid) VALUES ($1, $2, $3, $4)',
                [expense.id, userId, amountOwed, isPaid]
            );
        }

        await client.query('COMMIT');

        return res.status(201).json({
            message: 'Gasto creado correctamente',
            expense,
            split: {
                participants_count: totalPeople,
                amount_owed: amountOwed,
            },
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en createExpense:', error);
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
                COALESCE(
                    json_agg(
                        DISTINCT jsonb_build_object(
                            'user_id', ep.user_id,
                            'email', participant_user.email,
                            'amount_owed', ep.amount_owed,
                            'is_paid', COALESCE(ep.is_paid, false)
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
                    is_paid: participant.is_paid || false,
                }))
                : [],
            created_at: expense.created_at,
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

        const owedToMeResult = await db.query(
            `
            SELECT COALESCE(SUM(ep.amount_owed), 0) AS total
            FROM expense_participants ep
            INNER JOIN expenses e ON e.id = ep.expense_id
            WHERE e.paid_by = $1
              AND ep.user_id <> $1
                            AND ep.is_paid = false
            `,
            [userId]
        );

        const iOweResult = await db.query(
            `
            SELECT COALESCE(SUM(ep.amount_owed), 0) AS total
            FROM expense_participants ep
            INNER JOIN expenses e ON e.id = ep.expense_id
            WHERE ep.user_id = $1
              AND e.paid_by <> $1
                            AND ep.is_paid = false
            `,
            [userId]
        );

        const owedToMe = Number(owedToMeResult.rows[0].total);
        const iOwe = Number(iOweResult.rows[0].total);

        return res.status(200).json({
            owed_to_me: owedToMe,
            i_owe: iOwe,
            net_balance: owedToMe - iOwe,
        });
    } catch (error) {
        console.error('Error en getBalance:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const settleExpenseDebt = async (req, res) => {
    try {
        const paidBy = req.user.id;
        const expenseId = Number(req.body.expense_id);
        const debtorUserId = Number(req.body.user_id);

        if (!Number.isInteger(expenseId) || expenseId <= 0) {
            return res.status(400).json({ message: 'expense_id debe ser un entero positivo' });
        }

        if (!Number.isInteger(debtorUserId) || debtorUserId <= 0) {
            return res.status(400).json({ message: 'user_id debe ser un entero positivo' });
        }

        if (debtorUserId === paidBy) {
            return res.status(400).json({ message: 'No puedes liquidar tu propia deuda' });
        }

        const expenseResult = await db.query('SELECT id, paid_by FROM expenses WHERE id = $1', [expenseId]);
        const expense = expenseResult.rows[0];

        if (!expense) {
            return res.status(404).json({ message: 'Gasto no encontrado' });
        }

        if (expense.paid_by !== paidBy) {
            return res.status(403).json({ message: 'No tienes permiso para liquidar este gasto' });
        }

        const settleResult = await db.query(
            `
            UPDATE expense_participants
            SET is_paid = true
            WHERE expense_id = $1
              AND user_id = $2
              AND is_paid = false
            RETURNING id, expense_id, user_id, amount_owed, is_paid
            `,
            [expenseId, debtorUserId]
        );

        if (settleResult.rows.length === 0) {
            return res.status(404).json({ message: 'Deuda no encontrada o ya estaba liquidada' });
        }

        return res.status(200).json({
            message: 'Deuda marcada como pagada',
            settlement: settleResult.rows[0],
        });
    } catch (error) {
        console.error('Error en settleExpenseDebt:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    createExpense,
    getExpenses,
    getBalance,
    settleExpenseDebt,
    getExpenseContactSuggestions,
};