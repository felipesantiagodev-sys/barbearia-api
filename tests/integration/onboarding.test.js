const request = require('supertest');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { pool: poolTenant } = require('../../src/middlewares/tenant');

jest.mock('../../src/services/emailService', () => ({
  enviarEmailVerificacao: jest.fn().mockResolvedValue(undefined),
}));

const { enviarEmailVerificacao } = require('../../src/services/emailService');
const { limitadorCadastro, limitadorReenvio } = require('../../src/middlewares/rateLimiters');
const { ipKeyGenerator } = require('express-rate-limit');

// `limitadorCadastro` (5/hora) e `limitadorReenvio` (3/hora) são singletons
// do express-rate-limit com estado em memória compartilhado por TODOS os
// testes deste processo Jest, chaveados por padrão em req.ip. O supertest
// sempre bate como '::ffff:127.0.0.1', mas o express-rate-limit normaliza
// IPs via `ipKeyGenerator` antes de usá-los como chave no store (ex.:
// '::ffff:127.0.0.1' vira '127.0.0.1') -- por isso a chave usada no reset
// precisa passar pelo mesmo helper, senão `resetKey` não encontra a entrada
// certa. Os vários describes/testes abaixo (cadastro, verificação, reenvio)
// dividem a mesma contagem e estourariam o limite de produção
// artificialmente. `resetKey` é a API pública do express-rate-limit para
// zerar a contagem de uma chave -- não altera `max`, `windowMs` nem qualquer
// outro comportamento de produção dos limitadores, só reseta o estado entre
// testes.
const CHAVE_IP_TESTE = ipKeyGenerator('::ffff:127.0.0.1');
function resetarLimitadores() {
  limitadorCadastro.resetKey(CHAVE_IP_TESTE);
  limitadorReenvio.resetKey(CHAVE_IP_TESTE);
}

// Os pools de conexão (`pool` de tests/helpers/db.js e `poolTenant` de
// src/middlewares/tenant.js) são singletons compartilhados por TODOS os
// describe blocks deste arquivo. Fechá-los precisa acontecer uma única vez,
// ao final de toda a suíte -- por isso este afterAll fica no escopo raiz do
// arquivo, e não dentro de um describe específico (fechar o pool ao final do
// primeiro describe quebraria os describes seguintes, que ainda precisam
// dele).
afterAll(async () => {
  await fecharBanco();
  await poolTenant.end();
});

describe('POST /onboarding/cadastro', () => {
  afterEach(async () => {
    await limparBanco();
    enviarEmailVerificacao.mockClear();
    resetarLimitadores();
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

  // A checagem de "email já pendente" em cadastrarOnboarding é um SELECT
  // seguido de INSERT (sem lock) -- sozinha, não impede duas requisições
  // CONCORRENTES com o mesmo email de passarem pela checagem antes de
  // qualquer uma commitar (ver migration 010_indice_unico_email_pendente).
  // Este teste ignora a rota HTTP (que serializa via supertest/event loop
  // e não reproduziria a corrida de verdade) e ataca a garantia no nível
  // que realmente importa: duas transações concorrentes tentando inserir
  // o mesmo email pendente diretamente no banco. Se o índice único parcial
  // não existisse, as duas inserções teriam sucesso.
  test('índice único no banco impede duas inserções concorrentes com o mesmo email pendente', async () => {
    const emailConcorrente = 'concorrencia@teste.com';

    async function inserirAdminPendente() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        const barbearia = await client.query(
          `INSERT INTO barbearia (nome, status) VALUES ('Barbearia Concorrente', 'pendente_verificacao') RETURNING *`
        );
        await client.query(
          `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash, email_verificado)
           VALUES ($1, 'Admin Concorrente', $2, 'hash-fake', false)`,
          [barbearia.rows[0].id, emailConcorrente]
        );
        await client.query('COMMIT');
        return { sucesso: true };
      } catch (erro) {
        await client.query('ROLLBACK').catch(() => {});
        return { sucesso: false, codigo: erro.code };
      } finally {
        client.release();
      }
    }

    const [resultadoA, resultadoB] = await Promise.all([
      inserirAdminPendente(),
      inserirAdminPendente(),
    ]);

    const sucessos = [resultadoA, resultadoB].filter((r) => r.sucesso);
    const falhas = [resultadoA, resultadoB].filter((r) => !r.sucesso);

    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].codigo).toBe('23505');

    const admins = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1',
      [emailConcorrente]
    );
    expect(admins.rows).toHaveLength(1);
  });
});

describe('GET /onboarding/verificar', () => {
  afterEach(async () => {
    await limparBanco();
  });

  async function criarBarbeariaPendenteComAdmin() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

      const barbearia = await client.query(
        `INSERT INTO barbearia (nome, status) VALUES ('Barbearia Pendente', 'pendente_verificacao') RETURNING *`
      );

      const senha_hash = await require('bcrypt').hash('senha123', 10);
      // token_verificacao é UUID no banco (migration 009); usamos
      // crypto.randomUUID() em vez de uma string arbitrária para o valor ser
      // aceito pela coluna.
      const token = require('crypto').randomUUID();
      const admin = await client.query(
        `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash, email_verificado, token_verificacao, token_verificacao_expira_em)
         VALUES ($1, 'Admin Pendente', 'pendente@teste.com', $2, false, $3, now() + interval '24 hours')
         RETURNING *`,
        [barbearia.rows[0].id, senha_hash, token]
      );

      await client.query('COMMIT');
      return { barbearia: barbearia.rows[0], admin: admin.rows[0] };
    } finally {
      client.release();
    }
  }

  test('token válido confirma email e ativa a barbearia', async () => {
    const { admin, barbearia } = await criarBarbeariaPendenteComAdmin();

    const resposta = await request(app).get(`/onboarding/verificar?token=${admin.token_verificacao}`);

    expect(resposta.status).toBe(200);

    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const adminAtualizado = await client.query('SELECT * FROM usuario_admin WHERE id = $1', [admin.id]);
    const barbeariaAtualizada = await client.query('SELECT * FROM barbearia WHERE id = $1', [barbearia.id]);
    await client.query('ROLLBACK');
    client.release();

    expect(adminAtualizado.rows[0].email_verificado).toBe(true);
    expect(adminAtualizado.rows[0].token_verificacao).toBeNull();
    expect(barbeariaAtualizada.rows[0].status).toBe('ativa');
  });

  test('token inexistente retorna 400', async () => {
    // Precisa ser um UUID sintaticamente válido (coluna token_verificacao é
    // UUID) para exercer o caminho de "não encontrado", e não um erro de
    // tipo do Postgres.
    const resposta = await request(app).get(
      `/onboarding/verificar?token=${require('crypto').randomUUID()}`
    );
    expect(resposta.status).toBe(400);
  });

  test('token já usado (email já verificado) retorna 400 na segunda tentativa', async () => {
    const { admin } = await criarBarbeariaPendenteComAdmin();

    await request(app).get(`/onboarding/verificar?token=${admin.token_verificacao}`);
    const segundaTentativa = await request(app).get(`/onboarding/verificar?token=${admin.token_verificacao}`);

    expect(segundaTentativa.status).toBe(400);
  });
});

describe('POST /onboarding/reenviar-verificacao', () => {
  afterEach(async () => {
    await limparBanco();
    enviarEmailVerificacao.mockClear();
    resetarLimitadores();
  });

  test('reenvia com novo token quando o email está pendente', async () => {
    await request(app).post('/onboarding/cadastro').send({
      nome_barbearia: 'Barbearia Reenvio',
      nome_admin: 'Admin Reenvio',
      email: 'reenvio@teste.com',
      senha: 'senhaSegura123',
    });
    enviarEmailVerificacao.mockClear();

    const resposta = await request(app).post('/onboarding/reenviar-verificacao').send({ email: 'reenvio@teste.com' });

    expect(resposta.status).toBe(200);
    expect(enviarEmailVerificacao).toHaveBeenCalledTimes(1);
    expect(enviarEmailVerificacao.mock.calls[0][0]).toBe('reenvio@teste.com');
  });

  test('responde com sucesso genérico mesmo se o email não existir (sem enumeração)', async () => {
    const resposta = await request(app).post('/onboarding/reenviar-verificacao').send({ email: 'nao-existe@teste.com' });

    expect(resposta.status).toBe(200);
    expect(enviarEmailVerificacao).not.toHaveBeenCalled();
  });
});
