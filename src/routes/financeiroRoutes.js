const express = require('express');
const router = express.Router();
const { faturamentoMensal, desempenhoBarbeiros } = require('../controllers/financeiroController');

router.get('/faturamento-mensal', faturamentoMensal);
router.get('/desempenho-barbeiros', desempenhoBarbeiros);

module.exports = router;