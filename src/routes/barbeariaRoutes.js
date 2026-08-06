const express = require('express');
const router = express.Router();
const { listarBarbearias, criarBarbearia } = require('../controllers/barbeariaController');
const { criarClientePublico } = require('../controllers/clienteController');
const { buscarTema, salvarTema } = require('../controllers/temaController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { apenasPlataforma } = require('../middlewares/tenant');

router.get('/', listarBarbearias);
router.post('/', verificarToken, apenasPlataforma, criarBarbearia);
router.post('/:barbearia_id/clientes', criarClientePublico);
router.get('/:id/tema', buscarTema);
router.put('/:id/tema', verificarToken, apenasAdmin, salvarTema);

module.exports = router;
