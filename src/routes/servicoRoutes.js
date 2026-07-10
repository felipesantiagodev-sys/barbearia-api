const express = require('express');
const router = express.Router();
const { listarServicos, criarServico } = require('../controllers/servicoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.get('/', listarServicos);
router.post('/', verificarToken, apenasAdmin, criarServico);

module.exports = router;