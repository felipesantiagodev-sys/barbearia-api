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

module.exports = { cadastrarOnboarding };
