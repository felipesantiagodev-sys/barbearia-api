const bcrypt = require('bcrypt');
const pool = require('../config/database');

async function criarCliente(req, res) {
  const { nome, email, telefone, senha } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  try {
    const senha_hash = await bcrypt.hash(senha, 10);
    const resultado = await pool.query(
      `INSERT INTO cliente (nome, email, telefone, senha_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, nome, email, telefone, criado_em`,
      [nome, email, telefone, senha_hash]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
  }
}

async function listarClientes(req, res) {
  try {
    const resultado = await pool.query(
      'SELECT id, nome, email, telefone, criado_em FROM cliente ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar clientes' });
  }
}

async function buscarClientePorId(req, res) {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      'SELECT id, nome, email, telefone, criado_em FROM cliente WHERE id = $1',
      [id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }
    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar cliente' });
  }
}

module.exports = { criarCliente, listarClientes, buscarClientePorId };