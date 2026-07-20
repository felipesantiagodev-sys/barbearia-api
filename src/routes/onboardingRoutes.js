const express = require('express');
const router = express.Router();
const {
  cadastrarOnboarding,
  verificarEmail,
  reenviarVerificacao,
} = require('../controllers/onboardingController');
const { limitadorCadastro, limitadorReenvio } = require('../middlewares/rateLimiters');

router.post('/cadastro', limitadorCadastro, cadastrarOnboarding);
router.get('/verificar', verificarEmail);
router.post('/reenviar-verificacao', limitadorReenvio, reenviarVerificacao);

module.exports = router;
