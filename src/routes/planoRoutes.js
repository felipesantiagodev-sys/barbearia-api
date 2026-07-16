const express = require('express');
const router = express.Router();
const {
  listarPlanos,
  criarPlano,
  associarServicosPlano,
  listarServicosDoPlano,
} = require('../controllers/planoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarPlanos);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarPlano);

router.get('/:id/servicos', verificarToken, escoparTenant, listarServicosDoPlano);
router.post('/:id/servicos', verificarToken, escoparTenant, apenasAdmin, associarServicosPlano);

module.exports = router;
