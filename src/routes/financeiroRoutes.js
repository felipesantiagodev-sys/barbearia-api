const express = require('express');
const router = express.Router();
const { faturamentoMensal, desempenhoBarbeiros } = require('../controllers/financeiroController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/faturamento-mensal', verificarToken, escoparTenant, apenasAdmin, faturamentoMensal);
router.get('/desempenho-barbeiros', verificarToken, escoparTenant, apenasAdmin, desempenhoBarbeiros);

module.exports = router;
