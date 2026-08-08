const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia, criarAdminDireto } = require('../helpers/factories');

async function criarTokenAdmin(barbeariaId) {
  const admin = await criarAdminDireto(barbeariaId, { email: `admin-tema-${barbeariaId}@teste.com` });
  return jwt.sign(
    { id: admin.id, tipo: 'admin', barbearia_id: barbeariaId, papel: admin.papel },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Tema por tenant', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
  });

  describe('GET /barbearias/:id/tema', () => {
    test('retorna as cores padrão de uma barbearia recém-criada', async () => {
      const barbearia = await criarBarbearia('Barbearia Padrão');

      const resposta = await request(app).get(`/barbearias/${barbearia.id}/tema`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        cor_primaria: '#000000',
        cor_fundo: '#FFFFFF',
        cor_secundaria: '#6B7280',
      });
    });

    test('retorna 404 para barbearia inexistente', async () => {
      const resposta = await request(app).get('/barbearias/999999/tema');
      expect(resposta.status).toBe(404);
    });

    // Decisão de produto: o link de cadastro público só é considerado
    // válido quando a barbearia está com status 'ativa'. Uma barbearia
    // pendente de verificação ou suspensa deve responder exatamente como
    // "não encontrada" (mesmo 404, mesma mensagem) -- não revelar a um
    // visitante não autenticado que a barbearia existe mas está inativa.
    test('retorna 404 para barbearia pendente de verificação', async () => {
      const barbearia = await criarBarbearia('Barbearia Pendente', { status: 'pendente_verificacao' });

      const resposta = await request(app).get(`/barbearias/${barbearia.id}/tema`);

      expect(resposta.status).toBe(404);
    });

    test('retorna 404 para barbearia suspensa', async () => {
      const barbearia = await criarBarbearia('Barbearia Suspensa', { status: 'suspensa' });

      const resposta = await request(app).get(`/barbearias/${barbearia.id}/tema`);

      expect(resposta.status).toBe(404);
    });
  });

  describe('PUT /barbearias/:id/tema', () => {
    test('admin autenticado salva novas cores válidas', async () => {
      const barbearia = await criarBarbearia('Barbearia Colorida');
      const token = await criarTokenAdmin(barbearia.id);

      const resposta = await request(app)
        .put(`/barbearias/${barbearia.id}/tema`)
        .set('Authorization', `Bearer ${token}`)
        .send({ cor_primaria: '#FF5733', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        cor_primaria: '#FF5733',
        cor_fundo: '#FFFFFF',
        cor_secundaria: '#3357FF',
      });

      const confirmacao = await request(app).get(`/barbearias/${barbearia.id}/tema`);
      expect(confirmacao.body.cor_primaria).toBe('#FF5733');
    });

    test('rejeita cor em formato inválido', async () => {
      const barbearia = await criarBarbearia('Barbearia Inválida');
      const token = await criarTokenAdmin(barbearia.id);

      const resposta = await request(app)
        .put(`/barbearias/${barbearia.id}/tema`)
        .set('Authorization', `Bearer ${token}`)
        .send({ cor_primaria: 'vermelho', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

      expect(resposta.status).toBe(400);
    });

    test('rejeita sem token de autenticação', async () => {
      const barbearia = await criarBarbearia('Barbearia Sem Token');

      const resposta = await request(app)
        .put(`/barbearias/${barbearia.id}/tema`)
        .send({ cor_primaria: '#FF5733', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

      expect(resposta.status).toBe(401);
    });

    test('admin de uma barbearia não consegue alterar tema de outra', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const tokenAdminA = await criarTokenAdmin(barbeariaA.id);

      const resposta = await request(app)
        .put(`/barbearias/${barbeariaB.id}/tema`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({ cor_primaria: '#FF5733', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

      expect(resposta.status).toBe(404);

      const confirmacao = await request(app).get(`/barbearias/${barbeariaB.id}/tema`);
      expect(confirmacao.body.cor_primaria).toBe('#000000');
    });
  });
});
