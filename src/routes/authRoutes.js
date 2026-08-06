const express = require('express');
const router = express.Router();
const {
  cadastrarAdmin,
  loginAdmin,
  loginCliente,
  esqueciSenhaAdmin,
  redefinirSenhaAdmin,
  esqueciSenhaCliente,
  redefinirSenhaCliente,
} = require('../controllers/authController');
const { verificarToken } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');
const { limitadorEsqueciSenha } = require('../middlewares/rateLimiters');

router.post('/admin/cadastro', verificarToken, escoparTenant, cadastrarAdmin);
router.post('/admin/login', loginAdmin);
router.post('/cliente/login', loginCliente);
router.post('/admin/esqueci-senha', limitadorEsqueciSenha, esqueciSenhaAdmin);
router.post('/admin/redefinir-senha', redefinirSenhaAdmin);
router.post('/cliente/esqueci-senha', limitadorEsqueciSenha, esqueciSenhaCliente);
router.post('/cliente/redefinir-senha', redefinirSenhaCliente);

module.exports = router;
