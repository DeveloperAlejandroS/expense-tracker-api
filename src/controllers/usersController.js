const db = require('../db/connection');

const userSelectFields = `
    id,
    email,
    username,
    first_name,
    middle_name,
    last_name,
    second_last_name,
    birth_date,
    phone,
    is_active,
    created_at,
    updated_at
`;

const normalizeNullableText = (value) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized === '' ? null : normalized;
};

const getMe = async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await db.query(
            `SELECT ${userSelectFields} FROM users WHERE id = $1`,
            [userId]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        return res.status(200).json({ user });
    } catch (error) {
        console.error('Error en getMe:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const updateMe = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            username,
            first_name,
            middle_name,
            last_name,
            second_last_name,
            birth_date,
            phone,
        } = req.body;

        const fields = [];
        const values = [];

        const pushField = (column, value) => {
            if (value !== undefined) {
                values.push(value === '' ? null : value);
                fields.push(`${column} = $${values.length}`);
            }
        };

        const normalizedUsername = normalizeNullableText(username);
        const normalizedPhone = normalizeNullableText(phone);

        if (normalizedUsername) {
            const existingUsername = await db.query(
                'SELECT id FROM users WHERE username = $1 AND id <> $2',
                [normalizedUsername, userId]
            );

            if (existingUsername.rows.length > 0) {
                return res.status(409).json({ message: 'El username ya está registrado' });
            }
        }

        if (normalizedPhone) {
            const existingPhone = await db.query(
                'SELECT id FROM users WHERE phone = $1 AND id <> $2',
                [normalizedPhone, userId]
            );

            if (existingPhone.rows.length > 0) {
                return res.status(409).json({ message: 'El phone ya está registrado' });
            }
        }

        pushField('username', normalizedUsername);
        pushField('first_name', first_name);
        pushField('middle_name', middle_name);
        pushField('last_name', last_name);
        pushField('second_last_name', second_last_name);
        pushField('birth_date', birth_date);
        pushField('phone', normalizedPhone);

        if (fields.length === 0) {
            return res.status(400).json({ message: 'No hay campos para actualizar' });
        }

        values.push(userId);

        const result = await db.query(
            `
            UPDATE users
            SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${values.length}
            RETURNING ${userSelectFields}
            `,
            values
        );

        return res.status(200).json({
            message: 'Usuario actualizado correctamente',
            user: result.rows[0],
        });
    } catch (error) {
        console.error('Error en updateMe:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const searchUsers = async (req, res) => {
    try {
        const userId = req.user.id;
        const q = String(req.query.q || '').trim();
        const onlyFriends = String(req.query.onlyFriends || 'false').toLowerCase() === 'true';

        if (!q) {
            return res.status(400).json({ message: 'El parámetro q es requerido' });
        }

        const pattern = `%${q}%`;

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
                u.is_active,
                COALESCE(f.status, 'none') AS friendship_status,
                COALESCE(f.status = 'accepted', false) AS is_friend_accepted
            FROM users u
            LEFT JOIN friends f
                ON (
                    (f.user_id_1 = $1 AND f.user_id_2 = u.id)
                    OR
                    (f.user_id_2 = $1 AND f.user_id_1 = u.id)
                )
            WHERE u.id <> $1
              AND u.is_active = true
              AND (
                u.email ILIKE $2
                OR u.username ILIKE $2
                OR u.first_name ILIKE $2
                OR u.last_name ILIKE $2
                OR u.phone ILIKE $2
              )
              AND ($3::boolean = false OR f.status = 'accepted')
            ORDER BY
                CASE
                    WHEN f.status = 'accepted' THEN 0
                    WHEN f.status = 'pending' THEN 1
                    WHEN f.status IS NULL THEN 2
                    ELSE 3
                END,
                u.username NULLS LAST,
                u.first_name NULLS LAST,
                u.email
            LIMIT 20
            `,
            [userId, pattern, onlyFriends]
        );

        return res.status(200).json({ users: result.rows });
    } catch (error) {
        console.error('Error en searchUsers:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    getMe,
    updateMe,
    searchUsers,
};