const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia, criarClienteDireto, criarAdminDireto } = require('../helpers/factories');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const poolApp = require('../../src/config/database');
const { limitadorEsqueciSenha } = require('../../src/middlewares/rateLimiters');
const { ipKeyGenerator } = require('express-rate-limit');

// `limitadorEsqueciSenha` (3/hora) é um singleton do express-rate-limit com
// estado em memória compartilhado por todos os testes deste processo --
// mesma situação documentada em tests/integration/onboarding.test.js.
// resetKey zera a contagem entre testes sem alterar `max`/`windowMs`.
const CHAVE_IP_TESTE = ipKeyGenerator('::ffff:127.0.0.1');

describe('Autenticação multi-tenant', () => {
  afterEach(async () => {
    await limparBanco();
    limitadorEsqueciSenha.resetKey(CHAVE_IP_TESTE);
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

  describe('POST /auth/admin/esqueci-senha', () => {
    test('responde 200 genérico para email existente e gera token', async () => {
      const barbearia = await criarBarbearia('Barbearia Reset Admin');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin.reset@teste.com' });

      const resposta = await request(app)
        .post('/auth/admin/esqueci-senha')
        .send({ email: 'admin.reset@teste.com' });

      expect(resposta.status).toBe(200);

      const client = await pool.connect();
      let verificacao;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        verificacao = await client.query(
          'SELECT token_reset_senha, token_reset_senha_expira_em FROM usuario_admin WHERE id = $1',
          [admin.id]
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(verificacao.rows[0].token_reset_senha).not.toBeNull();
      expect(new Date(verificacao.rows[0].token_reset_senha_expira_em).getTime()).toBeGreaterThan(Date.now());
    });

    test('responde 200 genérico mesmo para email inexistente', async () => {
      const resposta = await request(app)
        .post('/auth/admin/esqueci-senha')
        .send({ email: 'nao-existe@teste.com' });

      expect(resposta.status).toBe(200);
    });

    test('gera um token por conta quando o email existe em mais de uma barbearia', async () => {
      const barbeariaA = await criarBarbearia('Barbearia Reset A');
      const barbeariaB = await criarBarbearia('Barbearia Reset B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'duplicado.reset@teste.com' });
      const adminB = await criarAdminDireto(barbeariaB.id, { email: 'duplicado.reset@teste.com' });

      await request(app).post('/auth/admin/esqueci-senha').send({ email: 'duplicado.reset@teste.com' });

      const client = await pool.connect();
      let verificacaoA;
      let verificacaoB;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        verificacaoA = await client.query('SELECT token_reset_senha FROM usuario_admin WHERE id = $1', [adminA.id]);
        verificacaoB = await client.query('SELECT token_reset_senha FROM usuario_admin WHERE id = $1', [adminB.id]);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(verificacaoA.rows[0].token_reset_senha).not.toBeNull();
      expect(verificacaoB.rows[0].token_reset_senha).not.toBeNull();
      expect(verificacaoA.rows[0].token_reset_senha).not.toBe(verificacaoB.rows[0].token_reset_senha);
    });
  });

  describe('POST /auth/admin/redefinir-senha', () => {
    async function gerarTokenResetParaAdmin(barbeariaId, overrides = {}) {
      const admin = await criarAdminDireto(barbeariaId, overrides);
      const token = 'a0000000-0000-4000-8000-000000000001';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbeariaId)]);
        await client.query(
          `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '1 hour' WHERE id = $2`,
          [token, admin.id]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      return { admin, token };
    }

    test('redefine a senha com token válido e invalida o token', async () => {
      const barbearia = await criarBarbearia('Barbearia Redefine');
      const { admin, token } = await gerarTokenResetParaAdmin(barbearia.id, { email: 'admin.redefine@teste.com' });

      const resposta = await request(app)
        .post('/auth/admin/redefinir-senha')
        .send({ token, senha_nova: 'novaSenha123' });

      expect(resposta.status).toBe(200);

      const loginComNovaSenha = await request(app)
        .post('/auth/admin/login')
        .send({ email: 'admin.redefine@teste.com', senha: 'novaSenha123' });
      expect(loginComNovaSenha.status).toBe(200);

      const client = await pool.connect();
      let verificacao;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        verificacao = await client.query('SELECT token_reset_senha FROM usuario_admin WHERE id = $1', [admin.id]);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(verificacao.rows[0].token_reset_senha).toBeNull();
    });

    test('rejeita token inexistente', async () => {
      const resposta = await request(app)
        .post('/auth/admin/redefinir-senha')
        .send({ token: 'a0000000-0000-4000-8000-000000000099', senha_nova: 'novaSenha123' });

      expect(resposta.status).toBe(400);
    });

    test('rejeita token expirado', async () => {
      const barbearia = await criarBarbearia('Barbearia Token Expirado');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin.expirado@teste.com' });
      const token = 'a0000000-0000-4000-8000-000000000002';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia.id)]);
        await client.query(
          `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() - interval '1 hour' WHERE id = $2`,
          [token, admin.id]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const resposta = await request(app)
        .post('/auth/admin/redefinir-senha')
        .send({ token, senha_nova: 'novaSenha123' });

      expect(resposta.status).toBe(400);
    });

    test('rejeita token malformado sem retornar 500', async () => {
      const resposta = await request(app)
        .post('/auth/admin/redefinir-senha')
        .send({ token: 'nao-e-um-uuid', senha_nova: 'novaSenha123' });

      expect(resposta.status).toBe(400);
    });
  });

  describe('POST /auth/cliente/esqueci-senha', () => {
    test('responde 200 genérico para email existente e gera token', async () => {
      const barbearia = await criarBarbearia('Barbearia Reset Cliente');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.reset@teste.com' });

      const resposta = await request(app)
        .post('/auth/cliente/esqueci-senha')
        .send({ email: 'cliente.reset@teste.com' });

      expect(resposta.status).toBe(200);

      const client = await pool.connect();
      let verificacao;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        verificacao = await client.query('SELECT token_reset_senha FROM cliente WHERE id = $1', [cliente.id]);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      expect(verificacao.rows[0].token_reset_senha).not.toBeNull();
    });

    test('responde 200 genérico mesmo para email inexistente', async () => {
      const resposta = await request(app)
        .post('/auth/cliente/esqueci-senha')
        .send({ email: 'nao-existe-cliente@teste.com' });

      expect(resposta.status).toBe(200);
    });
  });

  describe('POST /auth/cliente/redefinir-senha', () => {
    test('redefine a senha com token válido e invalida o token', async () => {
      const barbearia = await criarBarbearia('Barbearia Redefine Cliente');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.redefine@teste.com' });
      const token = 'b0000000-0000-4000-8000-000000000001';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia.id)]);
        await client.query(
          `UPDATE cliente SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '1 hour' WHERE id = $2`,
          [token, cliente.id]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const resposta = await request(app)
        .post('/auth/cliente/redefinir-senha')
        .send({ token, senha_nova: 'novaSenhaCliente123' });

      expect(resposta.status).toBe(200);

      const loginComNovaSenha = await request(app)
        .post('/auth/cliente/login')
        .send({ email: 'cliente.redefine@teste.com', senha: 'novaSenhaCliente123' });
      expect(loginComNovaSenha.status).toBe(200);
    });

    test('rejeita token expirado', async () => {
      const barbearia = await criarBarbearia('Barbearia Cliente Token Expirado');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.expirado@teste.com' });
      const token = 'b0000000-0000-4000-8000-000000000002';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia.id)]);
        await client.query(
          `UPDATE cliente SET token_reset_senha = $1, token_reset_senha_expira_em = now() - interval '1 hour' WHERE id = $2`,
          [token, cliente.id]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const resposta = await request(app)
        .post('/auth/cliente/redefinir-senha')
        .send({ token, senha_nova: 'novaSenhaCliente123' });

      expect(resposta.status).toBe(400);
    });
  });

  describe('Bloqueio de login por tentativas (admin)', () => {
    test('bloqueia a conta após 5 senhas incorretas seguidas', async () => {
      const barbearia = await criarBarbearia('Barbearia Bloqueio Admin');
      await criarAdminDireto(barbearia.id, { email: 'admin.bloqueio@teste.com', senha: 'senhaCorreta123' });

      for (let tentativa = 0; tentativa < 5; tentativa++) {
        await request(app)
          .post('/auth/admin/login')
          .send({ email: 'admin.bloqueio@teste.com', senha: 'senhaErrada' });
      }

      const resposta = await request(app)
        .post('/auth/admin/login')
        .send({ email: 'admin.bloqueio@teste.com', senha: 'senhaCorreta123' });

      expect(resposta.status).toBe(423);
      expect(resposta.body.bloqueado).toBe(true);
    });

    test('senha correta antes da 5ª falha zera o contador', async () => {
      const barbearia = await criarBarbearia('Barbearia Zera Contador Admin');
      await criarAdminDireto(barbearia.id, { email: 'admin.zera@teste.com', senha: 'senhaCorreta123' });

      for (let tentativa = 0; tentativa < 3; tentativa++) {
        await request(app)
          .post('/auth/admin/login')
          .send({ email: 'admin.zera@teste.com', senha: 'senhaErrada' });
      }

      const loginCorreto = await request(app)
        .post('/auth/admin/login')
        .send({ email: 'admin.zera@teste.com', senha: 'senhaCorreta123' });
      expect(loginCorreto.status).toBe(200);

      for (let tentativa = 0; tentativa < 4; tentativa++) {
        await request(app)
          .post('/auth/admin/login')
          .send({ email: 'admin.zera@teste.com', senha: 'senhaErrada' });
      }

      const resposta = await request(app)
        .post('/auth/admin/login')
        .send({ email: 'admin.zera@teste.com', senha: 'senhaCorreta123' });
      expect(resposta.status).toBe(200);
    });

    test('redefinir senha desbloqueia a conta', async () => {
      const barbearia = await criarBarbearia('Barbearia Desbloqueio Admin');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin.desbloqueio@teste.com', senha: 'senhaAntiga123' });

      for (let tentativa = 0; tentativa < 5; tentativa++) {
        await request(app)
          .post('/auth/admin/login')
          .send({ email: 'admin.desbloqueio@teste.com', senha: 'senhaErrada' });
      }

      const token = 'c0000000-0000-4000-8000-000000000001';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia.id)]);
        await client.query(
          `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '1 hour' WHERE id = $2`,
          [token, admin.id]
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const redefinicao = await request(app)
        .post('/auth/admin/redefinir-senha')
        .send({ token, senha_nova: 'senhaNovaDesbloqueio123' });
      expect(redefinicao.status).toBe(200);

      const loginPosRedefinicao = await request(app)
        .post('/auth/admin/login')
        .send({ email: 'admin.desbloqueio@teste.com', senha: 'senhaNovaDesbloqueio123' });
      expect(loginPosRedefinicao.status).toBe(200);
    });
  });
});
