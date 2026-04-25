const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');

const JWT_EXPIRES_IN = '7d';

const buildUserSelect = `
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

const register = async (req, res) => {
    try {
        const {
            email,
            password,
            username,
            first_name,
            middle_name,
            last_name,
            second_last_name,
            birth_date,
            phone,
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email y password son requeridos' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const normalizedUsername = username ? String(username).trim() : null;
        const normalizedPhone = phone ? String(phone).trim() : null;

        const existingEmail = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (existingEmail.rows.length > 0) {
            return res.status(409).json({ message: 'El email ya está registrado' });
        }

        if (normalizedUsername) {
            const existingUsername = await db.query('SELECT id FROM users WHERE username = $1', [normalizedUsername]);
            if (existingUsername.rows.length > 0) {
                return res.status(409).json({ message: 'El username ya está registrado' });
            }
        }

        if (normalizedPhone) {
            const existingPhone = await db.query('SELECT id FROM users WHERE phone = $1', [normalizedPhone]);
            if (existingPhone.rows.length > 0) {
                return res.status(409).json({ message: 'El phone ya está registrado' });
            }
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await db.query(
            `
            INSERT INTO users (
                email,
                password,
                username,
                first_name,
                middle_name,
                last_name,
                second_last_name,
                birth_date,
                phone
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING ${buildUserSelect}
            `,
            [
                normalizedEmail,
                hashedPassword,
                normalizedUsername,
                first_name || null,
                middle_name || null,
                last_name || null,
                second_last_name || null,
                birth_date || null,
                normalizedPhone,
            ]
        );

        return res.status(201).json({
            message: 'Usuario registrado correctamente',
            user: newUser.rows[0]
        });
    } catch (error) {
        console.error('Error en register:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email y password son requeridos' });
        }

        const result = await db.query(
            `
            SELECT
                id,
                email,
                password,
                username,
                first_name,
                middle_name,
                last_name,
                second_last_name,
                birth_date,
                phone,
                is_active
            FROM users
            WHERE email = $1
            `,
            [String(email).trim().toLowerCase()]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        if (!user.is_active) {
            return res.status(403).json({ message: 'La cuenta está inactiva' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Credenciales inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        return res.status(200).json({
            message: 'Login exitoso',
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                first_name: user.first_name,
                middle_name: user.middle_name,
                last_name: user.last_name,
                second_last_name: user.second_last_name,
                birth_date: user.birth_date,
                phone: user.phone,
                is_active: user.is_active,
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    register,
    login,
};