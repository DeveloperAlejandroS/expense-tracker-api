const express = require('express');
const rateLimit = require('express-rate-limit');
const verifyToken = require('../middleware/verifyToken');
const { getMe, searchUsers, updateMe } = require('../controllers/usersController');

const router = express.Router();

router.use(verifyToken);

// Sin esto, una cuenta válida podía barrer /search con miles de patrones
// por minuto para enumerar usuarios reales (nombre, email parcial, etc.)
// sin ningún freno.
const searchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Demasiadas búsquedas, intenta de nuevo más tarde' },
});

router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/search', searchLimiter, searchUsers);

module.exports = router;