const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// O login (admin ou cliente) acontece ANTES de sabermos a qual barbearia o
// usuário pertence — não há subdomínio nem contexto de tenant nessa etapa.
// Como `usuario_admin` e `cliente` têm FORCE ROW LEVEL SECURITY (migration
// 005), um SELECT comum via `pool.query()` não enxerga NENHUMA linha sem
// `app.tenant_id` ou `app.is_plataforma` setado na sessão. Por isso usamos
// uma conexão dedicada com `app.is_plataforma` setado apenas para esta
// consulta de busca por email (que pode cruzar tenants, já que agora o
// email é único por barbearia, não globalmente), fazemos ROLLBACK ao final
// (somos apenas leitura) e liberamos a conexão.
async function buscarComoPlataforma(query, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const resultado = await client.query(query, params);
    await client.query('ROLLBACK');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

async function cadastrarAdmin(req, res) {
  const { nome, email, senha } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  try {
    const senha_hash = await bcrypt.hash(senha, 10);

    const resultado = await req.db.query(
      `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, nome, email, papel, criado_em`,
      [barbearia_id, nome, email, senha_hash]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar administrador' });
  }
}

async function loginAdmin(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1 AND ativo = true',
      [email]
    );

    let adminAutenticado = null;
    for (const candidato of resultado.rows) {
      if (await bcrypt.compare(senha, candidato.senha_hash)) {
        adminAutenticado = candidato;
        break;
      }
    }

    if (!adminAutenticado) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    const token = jwt.sign(
      { id: adminAutenticado.id, tipo: 'admin', barbearia_id: adminAutenticado.barbearia_id, papel: adminAutenticado.papel },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nome: adminAutenticado.nome, email: adminAutenticado.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}

async function loginCliente(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma('SELECT * FROM cliente WHERE email = $1', [email]);

    let clienteAutenticado = null;
    for (const candidato of resultado.rows) {
      if (await bcrypt.compare(senha, candidato.senha_hash)) {
        clienteAutenticado = candidato;
        break;
      }
    }

    if (!clienteAutenticado) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    const token = jwt.sign(
      { id: clienteAutenticado.id, tipo: 'cliente', barbearia_id: clienteAutenticado.barbearia_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nome: clienteAutenticado.nome, email: clienteAutenticado.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}

module.exports = { cadastrarAdmin, loginAdmin, loginCliente };