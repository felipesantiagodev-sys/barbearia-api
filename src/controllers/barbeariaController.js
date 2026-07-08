const pool = require('../config/database');

async function listarBarbearias(req, res) {
  try {
    const resultado = await pool.query('SELECT * FROM barbearia ORDER BY nome');
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar barbearias' });
  }
}

async function criarBarbearia(req, res) {
  const { nome, cnpj } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: 'nome é obrigatório' });
  }

  try {
    const resultado = await pool.query(
      'INSERT INTO barbearia (nome, cnpj) VALUES ($1, $2) RETURNING *',
      [nome, cnpj]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar barbearia' });
  }
}

module.exports = { listarBarbearias, criarBarbearia };