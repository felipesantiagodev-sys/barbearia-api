const express = require('express');
const router = express.Router();
const { listarClientes, buscarClientePorId } = require('../controllers/clienteController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, apenasAdmin, listarClientes);
router.get('/:id', verificarToken, escoparTenant, buscarClientePorId);

module.exports = router;
