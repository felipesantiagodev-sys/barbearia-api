const request = require('supertest');
const app = require('../../src/app');
const { limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia } = require('../helpers/factories');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const poolApp = require('../../src/config/database');

describe('POST /barbearias/:barbearia_id/clientes', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  test('cadastra cliente vinculado à barbearia da URL, ignorando barbearia_id do body', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ barbearia_id: barbeariaB.id, nome: 'Cliente Novo', email: 'novo@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(201);
    expect(resposta.body.nome).toBe('Cliente Novo');
  });

  test('persiste o cliente com barbearia_id da URL, não do body (verificação direta no banco sob RLS)', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ barbearia_id: barbeariaB.id, nome: 'Cliente Novo', email: 'novo2@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(201);

    // Leitura direta sob RLS, usando app.is_plataforma para enxergar todas as
    // linhas (mesmo padrão de tests/helpers/db.js), a fim de confirmar em
    // qual barbearia o cliente foi de fato persistido.
    const client = await poolTenant.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
      const r = await client.query('SELECT barbearia_id FROM cliente WHERE email = $1', ['novo2@teste.com']);
      await client.query('COMMIT');

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].barbearia_id).toBe(barbeariaA.id);
      expect(r.rows[0].barbearia_id).not.toBe(barbeariaB.id);
    } finally {
      client.release();
    }
  });

  test('retorna 400 quando faltam campos obrigatórios', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ nome: 'Sem email nem senha' });

    expect(resposta.status).toBe(400);
  });

  test('retorna 409 ao tentar cadastrar email já usado na mesma barbearia', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');

    await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ nome: 'Cliente Um', email: 'duplicado@teste.com', senha: 'senha123' });

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ nome: 'Cliente Dois', email: 'duplicado@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(409);
  });

  test('retorna 404 quando a barbearia da URL não existe', async () => {
    const resposta = await request(app)
      .post('/barbearias/999999/clientes')
      .send({ nome: 'Cliente Fantasma', email: 'fantasma@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(404);
  });

  test('retorna 400 quando barbearia_id da URL não é numérico', async () => {
    const resposta = await request(app)
      .post('/barbearias/abc/clientes')
      .send({ nome: 'Cliente Inválido', email: 'invalido@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(400);
  });
});
