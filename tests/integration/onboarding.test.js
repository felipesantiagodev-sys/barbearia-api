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

  // Insere diretamente uma barbearia ativa + admin já verificado, simulando
  // uma conta pré-existente que passou pelo fluxo de verificação com
  // sucesso. Usado para testar que um email JÁ VERIFICADO em uma barbearia
  // não bloqueia um novo cadastro em outra barbearia (mesma pessoa, dono de
  // dois negócios). Precisa persistir de fato (COMMIT), diferente de
  // buscarComoPlataforma, que é somente leitura e faz ROLLBACK.
  async function criarAdminVerificadoComoPlataforma(email) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

      const barbeariaResultado = await client.query(
        `INSERT INTO barbearia (nome, cnpj, status)
         VALUES ('Barbearia Já Verificada', null, 'ativa') RETURNING *`
      );
      const barbearia = barbeariaResultado.rows[0];

      await client.query(
        `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash, email_verificado)
         VALUES ($1, 'Admin Verificado', $2, 'hash-fake', true)`,
        [barbearia.id, email]
      );

      await client.query('COMMIT');
      return barbearia;
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => {});
      throw erro;
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

  test('cria barbearia e admin mesmo se o envio de email falhar (falha só é logada)', async () => {
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

  test('rejeita segundo cadastro com o mesmo email ainda pendente de verificação', async () => {
    const dadosCadastro = {
      nome_barbearia: 'Barbearia Duplicada 1',
      nome_admin: 'Dono Duplicado',
      email: 'duplicado@teste.com',
      senha: 'senhaSegura123',
    };

    const primeiraResposta = await request(app).post('/onboarding/cadastro').send(dadosCadastro);
    expect(primeiraResposta.status).toBe(201);

    const segundaResposta = await request(app).post('/onboarding/cadastro').send({
      ...dadosCadastro,
      nome_barbearia: 'Barbearia Duplicada 2',
    });

    expect(segundaResposta.status).toBe(409);
    expect(segundaResposta.body.erro).toMatch(/cadastro pendente/i);

    const admins = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1',
      ['duplicado@teste.com']
    );
    expect(admins.rows).toHaveLength(1);

    const barbearias = await buscarComoPlataforma(
      "SELECT * FROM barbearia WHERE nome IN ('Barbearia Duplicada 1', 'Barbearia Duplicada 2')"
    );
    expect(barbearias.rows).toHaveLength(1);
    expect(barbearias.rows[0].nome).toBe('Barbearia Duplicada 1');

    expect(enviarEmailVerificacao).toHaveBeenCalledTimes(1);
  });

  test('permite cadastro com email já verificado em outra barbearia (mesma pessoa, outro negócio)', async () => {
    const emailJaVerificado = 'donadedoisnegocios@teste.com';
    await criarAdminVerificadoComoPlataforma(emailJaVerificado);

    const resposta = await request(app).post('/onboarding/cadastro').send({
      nome_barbearia: 'Segundo Negócio',
      nome_admin: 'Dona de Dois Negócios',
      email: emailJaVerificado,
      senha: 'senhaSegura123',
    });

    expect(resposta.status).toBe(201);

    const admins = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1',
      [emailJaVerificado]
    );
    expect(admins.rows).toHaveLength(2);

    const novoAdmin = admins.rows.find((linha) => linha.email_verificado === false);
    expect(novoAdmin).toBeDefined();

    const novaBarbearia = await buscarComoPlataforma(
      "SELECT * FROM barbearia WHERE nome = 'Segundo Negócio'"
    );
    expect(novaBarbearia.rows).toHaveLength(1);
    expect(novoAdmin.barbearia_id).toBe(novaBarbearia.rows[0].id);
  });
});
