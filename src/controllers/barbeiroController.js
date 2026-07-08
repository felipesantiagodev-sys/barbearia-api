const pool = require('../config/database');

async function listarBarbeiros(req, res) {
  try {
    const resultado = await pool.query(
      'SELECT id, nome, email, telefone, foto_url, ativo FROM barbeiro WHERE ativo = true ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar barbeiros' });
  }
}

async function criarBarbeiro(req, res) {
  const { unidade_id, nome, email, telefone } = req.body;

  if (!unidade_id || !nome) {
    return res.status(400).json({ erro: 'unidade_id e nome são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      'INSERT INTO barbeiro (unidade_id, nome, email, telefone) VALUES ($1, $2, $3, $4) RETURNING *',
      [unidade_id, nome, email, telefone]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar barbeiro' });
  }
}

module.exports = { listarBarbeiros, criarBarbeiro };