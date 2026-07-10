const express = require('express');
const router = express.Router();
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
} = require('../controllers/agendamentoController');

router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.post('/', criarAgendamento);
router.patch('/:id/cancelar', cancelarAgendamento);
router.patch('/:id/concluir', concluirAgendamento);

module.exports = router;