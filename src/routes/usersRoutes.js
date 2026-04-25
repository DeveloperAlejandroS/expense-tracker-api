const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { getMe, searchUsers, updateMe } = require('../controllers/usersController');

const router = express.Router();

router.use(verifyToken);

router.get('/me', getMe);
router.patch('/me', updateMe);
router.get('/search', searchUsers);

module.exports = router;