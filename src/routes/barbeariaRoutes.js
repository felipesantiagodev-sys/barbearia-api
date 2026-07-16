const express = require('express');
const router = express.Router();
const { listarBarbearias, criarBarbearia } = require('../controllers/barbeariaController');
const { criarClientePublico } = require('../controllers/clienteController');
const { verificarToken } = require('../middlewares/autenticacao');
const { apenasPlataforma } = require('../middlewares/tenant');

router.get('/', listarBarbearias);
router.post('/', verificarToken, apenasPlataforma, criarBarbearia);
router.post('/:barbearia_id/clientes', criarClientePublico);

module.exports = router;
