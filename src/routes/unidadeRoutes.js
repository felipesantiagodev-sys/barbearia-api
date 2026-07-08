const express = require('express');
const router = express.Router();
const { listarUnidades, criarUnidade } = require('../controllers/unidadeController');

router.get('/', listarUnidades);
router.post('/', criarUnidade);

module.exports = router;