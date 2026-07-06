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

module.exports = { listarBarbeiros };