const express = require('express');
const router = express.Router();
const { dispararLembretesManualmente } = require('../controllers/notificacaoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.post('/enviar-lembretes', verificarToken, apenasAdmin, dispararLembretesManualmente);

module.exports = router;