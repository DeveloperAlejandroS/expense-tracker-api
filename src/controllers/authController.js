const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');

const JWT_EXPIRES_IN = '7d';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Hash "señuelo" contra el que comparamos cuando el identificador no existe,
// para que ese camino tarde lo mismo que el de password incorrecta (que sí
// corre bcrypt.compare de verdad). Sin esto, "no existe" respondía
// instantáneo y "existe pero password mal" tardaba lo que tarda bcrypt --
// una diferencia de tiempo medible que permite enumerar qué identificadores
// están registrados aunque el mensaje de error sea siempre el mismo.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', 10);

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

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ message: 'El email no tiene un formato válido' });
        }

        if (String(password).length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ message: `La password debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` });
        }
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
        // El chequeo de "¿ya existe?" de arriba es SELECT-antes-de-INSERT --
        // si dos registros llegan a la vez con el mismo email/username/
        // phone, el segundo puede pasar ese chequeo y solo fallar acá, en
        // el UNIQUE constraint real de la DB. Sin este catch específico caía
        // en el 500 genérico de abajo en vez de un 409 claro.
        if (error.code === '23505') {
            const field = error.constraint?.includes('email') ? 'email'
                : error.constraint?.includes('username') ? 'username'
                : error.constraint?.includes('phone') ? 'phone'
                : 'dato';
            return res.status(409).json({ message: `El ${field} ya está registrado` });
        }
        console.error('Error en register:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

const login = async (req, res) => {
    try {
        // Acepta login con email, username o teléfono. `identifier` es el
        // campo nuevo; `email` se sigue aceptando por compatibilidad con
        // clientes existentes que solo mandan ese campo.
        const { email, identifier, password } = req.body;
        const rawIdentifier = identifier ?? email;

        if (!rawIdentifier || !password) {
            return res.status(400).json({ message: 'Identificador (email, username o teléfono) y password son requeridos' });
        }

        const trimmedIdentifier = String(rawIdentifier).trim();

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
            WHERE email = $1 OR username = $2 OR phone = $2
            `,
            [trimmedIdentifier.toLowerCase(), trimmedIdentifier]
        );
        const user = result.rows[0];

        if (!user) {
            await bcrypt.compare(password, DUMMY_HASH);
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