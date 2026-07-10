const express = require('express');
const router = express.Router();
const { criarCliente, listarClientes, buscarClientePorId } = require('../controllers/clienteController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');

router.post('/', criarCliente);
router.get('/', verificarToken, apenasAdmin, listarClientes);
router.get('/:id', verificarToken, buscarClientePorId);

module.exports = router;