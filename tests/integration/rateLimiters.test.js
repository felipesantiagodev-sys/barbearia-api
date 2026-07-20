const express = require('express');
const request = require('supertest');
const { limitadorCadastro } = require('../../src/middlewares/rateLimiters');

describe('limitadorCadastro', () => {
  test('bloqueia a 6a requisição do mesmo IP dentro da janela', async () => {
    const app = express();
    app.use(express.json());
    app.post('/teste', limitadorCadastro, (req, res) => res.status(201).json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const resposta = await request(app).post('/teste').send({});
      expect(resposta.status).toBe(201);
    }

    const sextaResposta = await request(app).post('/teste').send({});
    expect(sextaResposta.status).toBe(429);
  });
});
