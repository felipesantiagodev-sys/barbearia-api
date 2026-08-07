const express = require('express');
const router = express.Router();
const { listarClientes, buscarClientePorId, buscarMinhaAssinatura } = require('../controllers/clienteController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, apenasAdmin, listarClientes);
// `/me/assinatura` precisa vir ANTES de `/:id` -- senão o Express trataria
// "me" como valor de `:id` e chamaria buscarClientePorId por engano.
router.get('/me/assinatura', verificarToken, escoparTenant, buscarMinhaAssinatura);
router.get('/:id', verificarToken, escoparTenant, buscarClientePorId);

module.exports = router;
