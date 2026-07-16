const express = require('express');
const router = express.Router();
const { loginPlataforma } = require('../controllers/plataformaController');

router.post('/login', loginPlataforma);

module.exports = router;
