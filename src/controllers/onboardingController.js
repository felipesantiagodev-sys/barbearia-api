const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/database');
const { enviarEmailVerificacao } = require('../services/emailService');

const HORAS_EXPIRACAO_TOKEN = 24;

async function cadastrarOnboarding(req, res) {
  const { nome_barbearia, cnpj, nome_admin, email, senha } = req.body;

  if (!nome_barbearia || !nome_admin || !email || !senha) {
    return res.status(400).json({
      erro: 'nome_barbearia, nome_admin, email e senha são obrigatórios',
    });
  }

  const client = await pool.connect();
  let barbearia;
  let admin;

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    // A constraint única em usuario_admin é composta (barbearia_id, email) —
    // como cada cadastro gera uma barbearia nova, o banco nunca rejeitaria
    // por email duplicado via 23505. Bloqueamos explicitamente aqui se já
    // existir um cadastro PENDENTE (não verificado) com esse email, mas
    // permitimos se o email já pertence a uma conta verificada em outra
    // barbearia (cenário legítimo: mesma pessoa dona de duas barbearias).
    const emailPendenteResultado = await client.query(
      'SELECT id FROM usuario_admin WHERE email = $1 AND email_verificado = false',
      [email]
    );

    if (emailPendenteResultado.rows.length > 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        erro: 'Já existe um cadastro pendente para este email. Verifique seu email ou solicite reenvio da confirmação.',
      });
    }

    const senha_hash = await bcrypt.hash(senha, 10);
    const token_verificacao = crypto.randomUUID();

    const barbeariaResultado = await client.query(
      `INSERT INTO barbearia (nome, cnpj, status)
       VALUES ($1, $2, 'pendente_verificacao') RETURNING *`,
      [nome_barbearia, cnpj || null]
    );
    barbearia = barbeariaResultado.rows[0];

    const adminResultado = await client.query(
      `INSERT INTO usuario_admin
         (barbearia_id, nome, email, senha_hash, email_verificado, token_verificacao, token_verificacao_expira_em)
       VALUES ($1, $2, $3, $4, false, $5, now() + interval '${HORAS_EXPIRACAO_TOKEN} hours')
       RETURNING *`,
      [barbearia.id, nome_admin, email, senha_hash, token_verificacao]
    );
    admin = adminResultado.rows[0];

    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();

    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado' });
    }
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao processar cadastro' });
  }

  client.release();

  try {
    await enviarEmailVerificacao(admin.email, admin.nome, admin.token_verificacao);
  } catch (erro) {
    console.error('Falha ao enviar email de verificação (cadastro já foi criado):', erro);
  }

  res.status(201).json({
    mensagem: 'Cadastro recebido! Verifique seu email para ativar sua conta.',
  });
}

async function verificarEmail(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ erro: 'token é obrigatório' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const adminResultado = await client.query(
      `SELECT * FROM usuario_admin
       WHERE token_verificacao = $1
         AND token_verificacao_expira_em > now()
         AND email_verificado = false`,
      [token]
    );

    if (adminResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const admin = adminResultado.rows[0];

    await client.query(
      `UPDATE usuario_admin
       SET email_verificado = true, token_verificacao = NULL, token_verificacao_expira_em = NULL
       WHERE id = $1`,
      [admin.id]
    );

    await client.query(
      `UPDATE barbearia SET status = 'ativa' WHERE id = $1 AND status = 'pendente_verificacao'`,
      [admin.barbearia_id]
    );

    await client.query('COMMIT');

    res.json({ mensagem: 'Email confirmado! Você já pode fazer login.' });
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao confirmar email' });
  } finally {
    client.release();
  }
}

async function reenviarVerificacao(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  const client = await pool.connect();
  let admin = null;

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const adminResultado = await client.query(
      `SELECT * FROM usuario_admin WHERE email = $1 AND email_verificado = false`,
      [email]
    );

    if (adminResultado.rows.length > 0) {
      admin = adminResultado.rows[0];
      const novoToken = crypto.randomUUID();

      await client.query(
        `UPDATE usuario_admin
         SET token_verificacao = $1, token_verificacao_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN} hours'
         WHERE id = $2`,
        [novoToken, admin.id]
      );
      admin.token_verificacao = novoToken;
    }

    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao processar reenvio' });
  }

  client.release();

  if (admin) {
    try {
      await enviarEmailVerificacao(admin.email, admin.nome, admin.token_verificacao);
    } catch (erro) {
      console.error('Falha ao reenviar email de verificação:', erro);
    }
  }

  // Resposta idêntica exista ou não o email, para não permitir enumeração
  // de contas cadastradas via este endpoint.
  res.json({ mensagem: 'Se o email estiver cadastrado e pendente, um novo link foi enviado.' });
}

module.exports = { cadastrarOnboarding, verificarEmail, reenviarVerificacao };
