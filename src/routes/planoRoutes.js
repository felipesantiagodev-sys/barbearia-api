const express = require('express');
const router = express.Router();
const {
  listarPlanos,
  criarPlano,
  associarServicosPlano,
  listarServicosDoPlano,
} = require('../controllers/planoController');

router.get('/', listarPlanos);
router.post('/', criarPlano);

router.get('/:id/servicos', listarServicosDoPlano);
router.post('/:id/servicos', associarServicosPlano);

module.exports = router;