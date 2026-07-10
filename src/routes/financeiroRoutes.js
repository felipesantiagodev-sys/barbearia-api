const express = require('express');
const router = express.Router();
const { faturamentoMensal, desempenhoBarbeiros } = require('../controllers/financeiroController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.get('/faturamento-mensal', verificarToken, apenasAdmin, faturamentoMensal);
router.get('/desempenho-barbeiros', verificarToken, apenasAdmin, desempenhoBarbeiros);

module.exports = router;