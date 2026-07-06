const express = require('express');
const router = express.Router();
const { listarBarbeiros } = require('../controllers/barbeiroController');

router.get('/', listarBarbeiros);

module.exports = router;