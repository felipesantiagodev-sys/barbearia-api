const express = require('express');
const router = express.Router();
const { dispararLembretesManualmente } = require('../controllers/notificacaoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.post('/enviar-lembretes', verificarToken, escoparTenant, apenasAdmin, dispararLembretesManualmente);

module.exports = router;