const express = require('express');
const { login, register } = require('../controllers/authController');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', verifyToken, (req, res) => {
	return res.status(200).json({
		message: 'Token válido',
		user: req.user,
	});
});

module.exports = router;
