const express = require('express');
const router = express.Router();
const { listarBarbeiros, criarBarbeiro } = require('../controllers/barbeiroController');

router.get('/', listarBarbeiros);
router.post('/', criarBarbeiro);

module.exports = router;