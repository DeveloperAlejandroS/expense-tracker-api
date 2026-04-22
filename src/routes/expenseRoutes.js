const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { createExpense, getBalance, getExpenses, settleExpenseDebt } = require('../controllers/expenseController');

const router = express.Router();

router.use(verifyToken);

router.get('/balance', getBalance);
router.patch('/settle', settleExpenseDebt);
router.post('/', createExpense);
router.get('/', getExpenses);

module.exports = router;