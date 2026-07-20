const request = require('supertest');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { pool: poolTenant } = require('../../src/middlewares/tenant');

jest.mock('../../src/services/emailService', () => ({
  enviarEmailVerificacao: jest.fn().mockResolvedValue(undefined),
}));

const { enviarEmailVerificacao } = require('../../src/services/emailService');

describe('POST /onboarding/cadastro', () => {
  afterEach(async () => {
    await limparBanco();
    enviarEmailVerificacao.mockClear();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
  });

  async function buscarComoPlataforma(query, params) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
      const resultado = await client.query(query, params);
      await client.query('ROLLBACK');
      return resultado;
    } finally {
      client.release();
    }
  }

  test('cria barbearia pendente e admin não verificado, envia email, retorna 201 sem token', async () => {
    const resposta = await request(app).post('/onboarding/cadastro').send({
      nome_barbearia: 'Barbearia Nova',
      cnpj: '11222333000144',
      nome_admin: 'Dona Maria',
      email: 'maria@barbearianova.com',
      senha: 'senhaSegura123',
    });

    expect(resposta.status).toBe(201);
    expect(resposta.body.token).toBeUndefined();
    expect(resposta.body.mensagem).toMatch(/verifique seu email/i);

    const barbearias = await buscarComoPlataforma(
      "SELECT * FROM barbearia WHERE nome = 'Barbearia Nova'"
    );
    expect(barbearias.rows).toHaveLength(1);
    expect(barbearias.rows[0].status).toBe('pendente_verificacao');

    const admins = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1',
      ['maria@barbearianova.com']
    );
    expect(admins.rows).toHaveLength(1);
    expect(admins.rows[0].email_verificado).toBe(false);
    expect(admins.rows[0].papel).toBe('dono');
    expect(admins.rows[0].barbearia_id).toBe(barbearias.rows[0].id);
    expect(admins.rows[0].token_verificacao).not.toBeNull();
    expect(admins.rows[0].token_verificacao_expira_em).not.toBeNull();

    expect(enviarEmailVerificacao).toHaveBeenCalledTimes(1);
    expect(enviarEmailVerificacao).toHaveBeenCalledWith(
      'maria@barbearianova.com',
      'Dona Maria',
      admins.rows[0].token_verificacao
    );
  });

  test('rejeita cadastro com campos obrigatórios faltando', async () => {
    const resposta = await request(app).post('/onboarding/cadastro').send({
      nome_barbearia: 'Barbearia Incompleta',
    });

    expect(resposta.status).toBe(400);
    expect(enviarEmailVerificacao).not.toHaveBeenCalled();
  });

  test('não cria barbearia nem admin se o envio de email falhar (falha só é logada, não desfaz o cadastro)', async () => {
    enviarEmailVerificacao.mockRejectedValueOnce(new Error('Falha simulada de envio'));

    const resposta = await request(app).post('/onboarding/cadastro').send({
      nome_barbearia: 'Barbearia Resiliente',
      nome_admin: 'Dono Resiliente',
      email: 'resiliente@teste.com',
      senha: 'senhaSegura123',
    });

    expect(resposta.status).toBe(201);

    const admins = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1',
      ['resiliente@teste.com']
    );
    expect(admins.rows).toHaveLength(1);
  });
});
