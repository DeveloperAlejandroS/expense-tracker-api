const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { addContribution, createItem, deleteItem, getMonth, getOpeningHistory, updateItem, updateOpening } = require('../controllers/budgetController');

const router = express.Router();

router.use(verifyToken);

router.get('/:month', getMonth);
router.get('/:month/opening/history', getOpeningHistory);
router.patch('/:month/opening', updateOpening);
router.post('/:month/items', createItem);
router.patch('/items/:id', updateItem);
router.patch('/items/:id/contribute', addContribution);
router.delete('/items/:id', deleteItem);

module.exports = router;
