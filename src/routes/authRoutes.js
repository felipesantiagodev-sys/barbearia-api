const express = require('express');
const router = express.Router();
const { cadastrarAdmin, loginAdmin, loginCliente } = require('../controllers/authController');

router.post('/admin/cadastro', cadastrarAdmin);
router.post('/admin/login', loginAdmin);
router.post('/cliente/login', loginCliente);

module.exports = router;