const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const {
    acceptFriendship,
    blockFriendship,
    getFriends,
    getPendingRequests,
    removeFriendship,
    sendFriendRequest,
} = require('../controllers/friendsController');

const router = express.Router();

router.use(verifyToken);

router.get('/', getFriends);
router.get('/requests', getPendingRequests);
router.post('/request', sendFriendRequest);
router.patch('/:id/accept', acceptFriendship);
router.patch('/:id/block', blockFriendship);
router.delete('/:id', removeFriendship);

module.exports = router;