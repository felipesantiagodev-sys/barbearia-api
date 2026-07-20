const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia, criarClienteDireto, criarAdminDireto } = require('../helpers/factories');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const poolApp = require('../../src/config/database');

describe('Autenticação multi-tenant', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  test('loginCliente inclui barbearia_id no token', async () => {
    const barbearia = await criarBarbearia();
    await criarClienteDireto(barbearia.id, { email: 'cliente@teste.com', senha: 'senha123' });

    const resposta = await request(app)
      .post('/auth/cliente/login')
      .send({ email: 'cliente@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(200);
    const payload = jwt.verify(resposta.body.token, process.env.JWT_SECRET);
    expect(payload.barbearia_id).toBe(barbearia.id);
    expect(payload.tipo).toBe('cliente');
  });

  test('cadastrarAdmin rejeita requisição sem token de admin existente', async () => {
    const barbearia = await criarBarbearia();
    const resposta = await request(app)
      .post('/auth/admin/cadastro')
      .send({ barbearia_id: barbearia.id, nome: 'Novo Admin', email: 'novo@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(401);
  });

  test('cadastrarAdmin autenticado cria admin na mesma barbearia do token, ignorando barbearia_id do body', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');
    const adminExistente = await criarAdminDireto(barbeariaA.id, { email: 'admin@teste.com', senha: 'senha123' });

    const token = jwt.sign(
      { id: adminExistente.id, tipo: 'admin', barbearia_id: barbeariaA.id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resposta = await request(app)
      .post('/auth/admin/cadastro')
      .set('Authorization', `Bearer ${token}`)
      .send({ barbearia_id: barbeariaB.id, nome: 'Novo Admin', email: 'novo@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(201);

    // Verificação direta via `pool` também é bloqueada por RLS (FORCE ROW
    // LEVEL SECURITY em `usuario_admin`), então setamos app.is_plataforma
    // numa transação dedicada para poder ler a linha recém-criada.
    const client = await pool.connect();
    let verificacao;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
      verificacao = await client.query('SELECT barbearia_id FROM usuario_admin WHERE email = $1', ['novo@teste.com']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(verificacao.rows[0].barbearia_id).toBe(barbeariaA.id);
  });

  test('loginAdmin rejeita acesso quando email não foi verificado, mesmo com senha correta', async () => {
    const barbearia = await criarBarbearia('Barbearia Não Verificada');
    await criarAdminDireto(barbearia.id, {
      email: 'naoverificado@teste.com',
      senha: 'senha123',
    });

    // criarAdminDireto (factories.js) insere com email_verificado usando o
    // DEFAULT da coluna, que é `true` -- para este teste precisamos de
    // email_verificado = false explicitamente. Ajustar via UPDATE direto,
    // dentro de uma transação dedicada com app.tenant_id setado (RLS).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia.id)]);
      await client.query(
        `UPDATE usuario_admin SET email_verificado = false WHERE email = 'naoverificado@teste.com'`
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const resposta = await request(app)
      .post('/auth/admin/login')
      .send({ email: 'naoverificado@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(403);
    expect(resposta.body.erro).toMatch(/confirme seu email/i);
  });
});
