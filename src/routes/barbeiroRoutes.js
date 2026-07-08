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

router.get('/', listarBarbeiros);
router.post('/', criarBarbeiro);

router.get('/:id/disponibilidade', listarDisponibilidade);
router.post('/:id/disponibilidade', definirDisponibilidade);

router.get('/:id/servicos', listarServicosDoBarbeiro);
router.post('/:id/servicos', associarServicos);

router.get('/:id/excecoes', listarExcecoes);
router.post('/:id/excecoes', criarExcecao);

module.exports = router;