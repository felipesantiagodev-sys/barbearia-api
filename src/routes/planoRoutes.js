const express = require('express');
const router = express.Router();
const {
  listarPlanos,
  criarPlano,
  associarServicosPlano,
  listarServicosDoPlano,
} = require('../controllers/planoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.get('/', listarPlanos);
router.post('/', verificarToken, apenasAdmin, criarPlano);

router.get('/:id/servicos', listarServicosDoPlano);
router.post('/:id/servicos', verificarToken, apenasAdmin, associarServicosPlano);

module.exports = router;