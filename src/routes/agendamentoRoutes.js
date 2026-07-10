const express = require('express');
const router = express.Router();
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
} = require('../controllers/agendamentoController');

router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.post('/', criarAgendamento);
router.patch('/:id/cancelar', cancelarAgendamento);

module.exports = router;