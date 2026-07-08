const express = require('express');
const router = express.Router();
const { listarBarbearias, criarBarbearia } = require('../controllers/barbeariaController');

router.get('/', listarBarbearias);
router.post('/', criarBarbearia);

module.exports = router;