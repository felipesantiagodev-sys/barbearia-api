const express = require('express');
const router = express.Router();
const { cadastrarAdmin, loginAdmin, loginCliente } = require('../controllers/authController');
const { verificarToken } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.post('/admin/cadastro', verificarToken, escoparTenant, cadastrarAdmin);
router.post('/admin/login', loginAdmin);
router.post('/cliente/login', loginCliente);

module.exports = router;