const express = require('express');
const router = express.Router();
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
  reagendarAgendamento,
} = require('../controllers/agendamentoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.post('/', verificarToken, criarAgendamento);
router.patch('/:id/cancelar', verificarToken, cancelarAgendamento);
router.patch('/:id/concluir', verificarToken, apenasAdmin, concluirAgendamento);
router.patch('/:id/reagendar', verificarToken, reagendarAgendamento);

module.exports = router;