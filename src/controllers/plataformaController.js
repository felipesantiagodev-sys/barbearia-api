const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

async function loginPlataforma(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      'SELECT * FROM usuario_plataforma WHERE email = $1 AND ativo = true',
      [email]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    const usuario = resultado.rows[0];
    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

    if (!senhaValida) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    const token = jwt.sign(
      { id: usuario.id, tipo: 'plataforma' },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token, nome: usuario.nome, email: usuario.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}

module.exports = { loginPlataforma };
