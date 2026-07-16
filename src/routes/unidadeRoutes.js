const express = require('express');
const router = express.Router();
const { listarUnidades, criarUnidade } = require('../controllers/unidadeController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarUnidades);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarUnidade);

module.exports = router;
