const db = require('../db/connection');

const canonicalPair = (userId1, userId2) => {
    const first = Math.min(userId1, userId2);
    const second = Math.max(userId1, userId2);
    return [first, second];
};

const sendFriendRequest = async (req, res) => {
    try {
        const requesterId = req.user.id;
        const targetUserId = Number(req.body.user_id);

        if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
            return res.status(400).json({ message: 'user_id debe ser un entero positivo' });
        }

        if (targetUserId === requesterId) {
            return res.status(400).json({ message: 'No puedes enviarte una solicitud a ti mismo' });
        }

        const targetUserResult = await db.query(
            'SELECT id, is_active FROM users WHERE id = $1',
            [targetUserId]
        );

        const targetUser = targetUserResult.rows[0];

        if (!targetUser || !targetUser.is_active) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const [userId1, userId2] = canonicalPair(requesterId, targetUserId);

        const existingFriendship = await db.query(
            'SELECT id, status FROM friends WHERE user_id_1 = $1 AND user_id_2 = $2',
            [userId1, userId2]
        );

        if (existingFriendship.rows.length > 0) {
            const friendship = existingFriendship.rows[0];

            if (friendship.status === 'accepted') {
                return res.status(409).json({ message: 'Ya son amigos' });
            }

            if (friendship.status === 'pending') {
                return res.status(409).json({ message: 'Ya existe una solicitud pendiente' });
            }

            if (friendship.status === 'blocked') {
                return res.status(409).json({ message: 'La relación está bloqueada' });
            }
        }

        const created = await db.query(
            `
            INSERT INTO friends (user_id_1, user_id_2, status)
            VALUES ($1, $2, 'pending')
            RETURNING id, user_id_1, user_id_2, status, created_at
            `,
            [userId1, userId2]
        );

        return res.status(201).json({
            message: 'Solicitud de amistad enviada',
            friendship: created.rows[0],
        });
    } catch (error) {
        console.error('Error en sendFriendRequest:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const getFriends = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(
            `
            SELECT
                f.id AS friendship_id,
                f.status,
                f.created_at,
                u.id,
                u.email,
                u.username,
                u.first_name,
                u.middle_name,
                u.last_name,
                u.second_last_name,
                u.phone
            FROM friends f
            INNER JOIN users u
                ON u.id = CASE
                    WHEN f.user_id_1 = $1 THEN f.user_id_2
                    ELSE f.user_id_1
                END
            WHERE f.status = 'accepted'
              AND ($1 = f.user_id_1 OR $1 = f.user_id_2)
            ORDER BY f.created_at DESC
            `,
            [userId]
        );

        return res.status(200).json({ friends: result.rows });
    } catch (error) {
        console.error('Error en getFriends:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const getPendingRequests = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(
            `
            SELECT
                f.id AS friendship_id,
                f.status,
                f.created_at,
                u.id,
                u.email,
                u.username,
                u.first_name,
                u.middle_name,
                u.last_name,
                u.second_last_name,
                u.phone
            FROM friends f
            INNER JOIN users u
                ON u.id = CASE
                    WHEN f.user_id_1 = $1 THEN f.user_id_2
                    ELSE f.user_id_1
                END
            WHERE f.status = 'pending'
              AND ($1 = f.user_id_1 OR $1 = f.user_id_2)
            ORDER BY f.created_at DESC
            `,
            [userId]
        );

        return res.status(200).json({ requests: result.rows });
    } catch (error) {
        console.error('Error en getPendingRequests:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const acceptFriendship = async (req, res) => {
    try {
        const userId = req.user.id;
        const friendshipId = Number(req.params.id);

        if (!Number.isInteger(friendshipId) || friendshipId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const friendshipResult = await db.query(
            'SELECT id, user_id_1, user_id_2, status FROM friends WHERE id = $1',
            [friendshipId]
        );

        const friendship = friendshipResult.rows[0];

        if (!friendship) {
            return res.status(404).json({ message: 'Solicitud no encontrada' });
        }

        if (friendship.user_id_1 !== userId && friendship.user_id_2 !== userId) {
            return res.status(403).json({ message: 'No tienes permiso para modificar esta solicitud' });
        }

        if (friendship.status !== 'pending') {
            return res.status(409).json({ message: 'La solicitud ya fue procesada' });
        }

        const updated = await db.query(
            `
            UPDATE friends
            SET status = 'accepted'
            WHERE id = $1
            RETURNING id, user_id_1, user_id_2, status, created_at
            `,
            [friendshipId]
        );

        return res.status(200).json({
            message: 'Solicitud aceptada',
            friendship: updated.rows[0],
        });
    } catch (error) {
        console.error('Error en acceptFriendship:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const blockFriendship = async (req, res) => {
    try {
        const userId = req.user.id;
        const friendshipId = Number(req.params.id);

        if (!Number.isInteger(friendshipId) || friendshipId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const friendshipResult = await db.query(
            'SELECT id, user_id_1, user_id_2, status FROM friends WHERE id = $1',
            [friendshipId]
        );

        const friendship = friendshipResult.rows[0];

        if (!friendship) {
            return res.status(404).json({ message: 'Relación no encontrada' });
        }

        if (friendship.user_id_1 !== userId && friendship.user_id_2 !== userId) {
            return res.status(403).json({ message: 'No tienes permiso para modificar esta relación' });
        }

        const updated = await db.query(
            `
            UPDATE friends
            SET status = 'blocked'
            WHERE id = $1
            RETURNING id, user_id_1, user_id_2, status, created_at
            `,
            [friendshipId]
        );

        return res.status(200).json({
            message: 'Relación bloqueada',
            friendship: updated.rows[0],
        });
    } catch (error) {
        console.error('Error en blockFriendship:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const removeFriendship = async (req, res) => {
    try {
        const userId = req.user.id;
        const friendshipId = Number(req.params.id);

        if (!Number.isInteger(friendshipId) || friendshipId <= 0) {
            return res.status(400).json({ message: 'id debe ser un entero positivo' });
        }

        const friendshipResult = await db.query(
            'SELECT id, user_id_1, user_id_2 FROM friends WHERE id = $1',
            [friendshipId]
        );

        const friendship = friendshipResult.rows[0];

        if (!friendship) {
            return res.status(404).json({ message: 'Relación no encontrada' });
        }

        if (friendship.user_id_1 !== userId && friendship.user_id_2 !== userId) {
            return res.status(403).json({ message: 'No tienes permiso para eliminar esta relación' });
        }

        await db.query('DELETE FROM friends WHERE id = $1', [friendshipId]);

        return res.status(200).json({ message: 'Relación eliminada correctamente' });
    } catch (error) {
        console.error('Error en removeFriendship:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    sendFriendRequest,
    getFriends,
    getPendingRequests,
    acceptFriendship,
    blockFriendship,
    removeFriendship,
};