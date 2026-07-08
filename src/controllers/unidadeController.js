const pool = require('../config/database');

async function listarUnidades(req, res) {
  try {
    const resultado = await pool.query('SELECT * FROM unidade WHERE ativo = true ORDER BY nome');
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar unidades' });
  }
}

async function criarUnidade(req, res) {
  const { barbearia_id, nome, endereco, telefone } = req.body;

  if (!barbearia_id || !nome) {
    return res.status(400).json({ erro: 'barbearia_id e nome são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      'INSERT INTO unidade (barbearia_id, nome, endereco, telefone) VALUES ($1, $2, $3, $4) RETURNING *',
      [barbearia_id, nome, endereco, telefone]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar unidade' });
  }
}

module.exports = { listarUnidades, criarUnidade };