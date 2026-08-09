const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const {
	claimExpenseDebt,
	confirmParticipantPayment,
	createExpense,
	deleteExpense,
	getBalance,
	getExpenseContactSuggestions,
	getExpenses,
	markParticipantPaid,
	rejectParticipantPayment,
	updateExpense,
} = require('../controllers/expenseController');

const router = express.Router();

router.use(verifyToken);

router.get('/contacts/suggestions', getExpenseContactSuggestions);
router.get('/balance', getBalance);
router.post('/', createExpense);
router.get('/', getExpenses);
router.patch('/:id', updateExpense);
router.delete('/:id', deleteExpense);
router.patch('/:id/claim', claimExpenseDebt);
router.patch('/:id/participants/:userId/mark-paid', markParticipantPaid);
router.patch('/:id/participants/:userId/confirm', confirmParticipantPayment);
router.patch('/:id/participants/:userId/reject', rejectParticipantPayment);

module.exports = router;
