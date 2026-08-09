const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { createItem, deleteItem, getMonth, updateItem, updateOpening } = require('../controllers/budgetController');

const router = express.Router();

router.use(verifyToken);

router.get('/:month', getMonth);
router.patch('/:month/opening', updateOpening);
router.post('/:month/items', createItem);
router.patch('/items/:id', updateItem);
router.delete('/items/:id', deleteItem);

module.exports = router;
