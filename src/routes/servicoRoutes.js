const express = require('express');
const router = express.Router();
const { listarServicos } = require('../controllers/servicoController');

router.get('/', listarServicos);

module.exports = router;