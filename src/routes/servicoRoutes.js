const express = require('express');
const router = express.Router();
const { listarServicos, criarServico } = require('../controllers/servicoController');

router.get('/', listarServicos);
router.post('/', criarServico);

module.exports = router;