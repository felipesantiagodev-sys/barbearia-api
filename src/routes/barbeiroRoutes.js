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

router.get('/', listarBarbeiros);
router.post('/', verificarToken, apenasAdmin, criarBarbeiro);

router.get('/:id/disponibilidade', listarDisponibilidade);
router.post('/:id/disponibilidade', verificarToken, apenasAdmin, definirDisponibilidade);

router.get('/:id/servicos', listarServicosDoBarbeiro);
router.post('/:id/servicos', verificarToken, apenasAdmin, associarServicos);

router.get('/:id/excecoes', listarExcecoes);
router.post('/:id/excecoes', verificarToken, apenasAdmin, criarExcecao);

module.exports = router;