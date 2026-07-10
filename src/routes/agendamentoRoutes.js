const express = require('express');
const router = express.Router();
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
} = require('../controllers/agendamentoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.post('/', verificarToken, criarAgendamento);
router.patch('/:id/cancelar', verificarToken, cancelarAgendamento);
router.patch('/:id/concluir', verificarToken, apenasAdmin, concluirAgendamento);

module.exports = router;