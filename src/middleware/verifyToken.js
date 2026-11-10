const jwt = require('jsonwebtoken');
const db = require('../db/connection');

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }

    try {
        // La sesión se corta al desactivar la cuenta o cambiar la contraseña,
        // no solo cuando el token vence (7 días).
        const result = await db.query('SELECT is_active, token_valid_after FROM users WHERE id = $1', [decoded.id]);
        const user = result.rows[0];
        const revoked = user?.token_valid_after && decoded.iat * 1000 < new Date(user.token_valid_after).getTime();
        if (!user || !user.is_active || revoked) {
            return res.status(401).json({ message: 'Token inválido o expirado' });
        }
    } catch (error) {
        console.error('Error en verifyToken:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    req.user = decoded;
    return next();
};

module.exports = verifyToken;
