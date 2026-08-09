const express = require('express');
const rateLimit = require('express-rate-limit');
const { login, register } = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');

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
router.get('/me', verifyToken, (req, res) => {
	return res.status(200).json({
		message: 'Token válido',
		user: req.user,
	});
});

module.exports = router;
