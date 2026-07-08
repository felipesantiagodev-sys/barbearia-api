const pool = require('../config/database');

async function listarServicos(req, res) {
  try {
    const resultado = await pool.query(
      'SELECT id, nome, categoria, duracao_minutos, valor FROM servico WHERE ativo = true ORDER BY categoria, nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar serviços' });
  }
}

async function criarServico(req, res) {
  const { barbearia_id, nome, categoria, duracao_minutos, valor } = req.body;

  if (!barbearia_id || !nome || !categoria || !duracao_minutos || valor === undefined) {
    return res.status(400).json({ erro: 'Todos os campos são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO servico (barbearia_id, nome, categoria, duracao_minutos, valor)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [barbearia_id, nome, categoria, duracao_minutos, valor]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar serviço' });
  }
}

module.exports = { listarServicos, criarServico };