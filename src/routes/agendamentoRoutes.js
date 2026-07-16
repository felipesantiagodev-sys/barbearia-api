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
const { escoparTenant } = require('../middlewares/tenant');

// Rota pública (sem verificarToken/escoparTenant): visitante ainda não tem
// conta. O escopo de tenant é resolvido dentro do próprio controller a
// partir do barbeiro_id -- ver comentário em listarHorariosDisponiveis.
router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.post('/', verificarToken, escoparTenant, criarAgendamento);
router.patch('/:id/cancelar', verificarToken, escoparTenant, cancelarAgendamento);
router.patch('/:id/concluir', verificarToken, escoparTenant, apenasAdmin, concluirAgendamento);
router.patch('/:id/reagendar', verificarToken, escoparTenant, reagendarAgendamento);

module.exports = router;