const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, register } = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');
const { getMe } = require('../controllers/usersController');

const router = express.Router();

// Limita fuerza bruta en login/registro: 20 intentos cada 15 min por IP.
// No se aplica a /me: se llama en cada refresh de datos con un JWT ya
// válido y no necesita esta protección.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiados intentos, intenta de nuevo más tarde' },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
// Devuelve el perfil real de la DB (nombre, etc.), no solo los claims del
// JWT -- el front lo usa para saludar por nombre.
router.get('/me', verifyToken, getMe);

module.exports = router;
