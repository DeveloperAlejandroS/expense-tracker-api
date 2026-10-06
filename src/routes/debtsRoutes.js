const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { setInstallmentPaid, contributeToEntry, createEntry, deleteEntry, getEntries, updateEntry } = require('../controllers/debtsController');

const router = express.Router();

router.use(verifyToken);

router.get('/', getEntries);
router.post('/', createEntry);
router.patch('/:id', updateEntry);
router.delete('/:id', deleteEntry);
router.patch('/:id/contribute', contributeToEntry);
router.patch('/:id/installments/:number', setInstallmentPaid);

module.exports = router;
