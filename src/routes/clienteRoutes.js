const express = require('express');
const router = express.Router();
const { criarCliente, listarClientes, buscarClientePorId } = require('../controllers/clienteController');

router.get('/', listarClientes);
router.get('/:id', buscarClientePorId);
router.post('/', criarCliente);

module.exports = router;