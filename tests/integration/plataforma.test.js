const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const poolApp = require('../../src/config/database');

describe('POST /barbearias (protegido por plataforma)', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  async function criarUsuarioPlataforma() {
    const senha_hash = await bcrypt.hash('senhaSegura123', 10);
    const r = await pool.query(
      'INSERT INTO usuario_plataforma (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING *',
      ['Super Admin', 'super@plataforma.com', senha_hash]
    );
    const usuario = r.rows[0];
    const token = jwt.sign({ id: usuario.id, tipo: 'plataforma' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return token;
  }

  test('rejeita criação de barbearia sem token', async () => {
    const resposta = await request(app).post('/barbearias').send({ nome: 'Nova Barbearia', cnpj: '11111111000100' });
    expect(resposta.status).toBe(401);
  });

  test('rejeita criação de barbearia com token de admin comum', async () => {
    const token = jwt.sign({ id: 1, tipo: 'admin', barbearia_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const resposta = await request(app)
      .post('/barbearias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Nova Barbearia', cnpj: '11111111000100' });
    expect(resposta.status).toBe(403);
  });

  test('permite criação de barbearia com token de plataforma', async () => {
    const token = await criarUsuarioPlataforma();
    const resposta = await request(app)
      .post('/barbearias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Nova Barbearia', cnpj: '11111111000100' });

    expect(resposta.status).toBe(201);
    expect(resposta.body.nome).toBe('Nova Barbearia');
  });
});
