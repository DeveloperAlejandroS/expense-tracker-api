const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const { contributeToEntry, createEntry, deleteEntry, getEntries, updateEntry } = require('../controllers/libretaController');

const router = express.Router();

router.use(verifyToken);

router.get('/', getEntries);
router.post('/', createEntry);
router.patch('/:id', updateEntry);
router.delete('/:id', deleteEntry);
router.patch('/:id/contribute', contributeToEntry);

module.exports = router;
