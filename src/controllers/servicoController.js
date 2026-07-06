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

module.exports = { listarServicos };