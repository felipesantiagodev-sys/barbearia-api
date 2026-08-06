const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { enviarEmailRedefinicaoSenha } = require('../services/emailService');

const HORAS_EXPIRACAO_TOKEN_RESET = 1;

// Mesmo raciocínio de `buscarComoPlataforma`, mas para escritas: o UPDATE de
// token_reset_senha/senha_hash em usuario_admin/cliente também é bloqueado
// por FORCE ROW LEVEL SECURITY sem app.is_plataforma setado na sessão (o
// pedido de redefinição não conhece o tenant, só o email). Diferente de
// buscarComoPlataforma, aqui fazemos COMMIT em vez de ROLLBACK, pois a
// intenção é persistir a alteração.
async function executarComoPlataforma(query, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const resultado = await client.query(query, params);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

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

    if (!adminAutenticado.email_verificado) {
      return res.status(403).json({ erro: 'Confirme seu email antes de fazer login' });
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

async function esqueciSenhaAdmin(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT ua.*, b.nome AS nome_barbearia FROM usuario_admin ua JOIN barbearia b ON b.id = ua.barbearia_id WHERE ua.email = $1 AND ua.ativo = true',
      [email]
    );

    for (const admin of resultado.rows) {
      const tokenReset = crypto.randomUUID();
      await executarComoPlataforma(
        `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN_RESET} hours' WHERE id = $2`,
        [tokenReset, admin.id]
      );

      try {
        await enviarEmailRedefinicaoSenha(admin.email, admin.nome_barbearia, tokenReset, 'admin');
      } catch (erroEnvio) {
        console.error('Falha ao enviar email de redefinição de senha (admin):', erroEnvio);
      }
    }

    res.json({ mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar solicitação' });
  }
}

async function redefinirSenhaAdmin(req, res) {
  const { token, senha_nova } = req.body;

  if (!token || !senha_nova) {
    return res.status(400).json({ erro: 'token e senha_nova são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      `SELECT * FROM usuario_admin WHERE token_reset_senha = $1 AND token_reset_senha_expira_em > now()`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const admin = resultado.rows[0];
    const senha_hash = await bcrypt.hash(senha_nova, 10);

    await executarComoPlataforma(
      `UPDATE usuario_admin SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL WHERE id = $2`,
      [senha_hash, admin.id]
    );

    res.json({ mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (erro) {
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir senha' });
  }
}

module.exports = { cadastrarAdmin, loginAdmin, loginCliente, esqueciSenhaAdmin, redefinirSenhaAdmin };