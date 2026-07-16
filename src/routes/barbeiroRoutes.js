const express = require('express');
const router = express.Router();
const {
  listarBarbeiros,
  criarBarbeiro,
  definirDisponibilidade,
  associarServicos,
  criarExcecao,
  listarExcecoes,
  listarDisponibilidade,
  listarServicosDoBarbeiro,
} = require('../controllers/barbeiroController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarBarbeiros);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarBarbeiro);

router.get('/:id/disponibilidade', verificarToken, escoparTenant, listarDisponibilidade);
router.post('/:id/disponibilidade', verificarToken, escoparTenant, apenasAdmin, definirDisponibilidade);

router.get('/:id/servicos', verificarToken, escoparTenant, listarServicosDoBarbeiro);
router.post('/:id/servicos', verificarToken, escoparTenant, apenasAdmin, associarServicos);

router.get('/:id/excecoes', verificarToken, escoparTenant, listarExcecoes);
router.post('/:id/excecoes', verificarToken, escoparTenant, apenasAdmin, criarExcecao);

module.exports = router;
