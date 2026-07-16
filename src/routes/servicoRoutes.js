const express = require('express');
const router = express.Router();
const { listarServicos, criarServico } = require('../controllers/servicoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarServicos);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarServico);

module.exports = router;
