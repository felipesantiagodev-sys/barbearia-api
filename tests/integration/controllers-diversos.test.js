// Testes de integração da Task 11.3: migração mecânica de unidadeController,
// barbeiroController, servicoController, planoController e
// financeiroController de `pool` para `req.db` (client escopado por tenant
// via middleware `escoparTenant`).
//
// DECISÃO DE ORGANIZAÇÃO: um único arquivo para os 5 controllers, em vez de
// um arquivo por controller. A mudança em todos eles é idêntica (mecânica) e
// o objetivo dos testes é o mesmo em todos: provar que a troca para `req.db`
// não regrediu nada -- 401 sem token, e isolamento real de dados entre
// tenants via RLS. Não há necessidade de 5 arquivos quase idênticos; agrupar
// reduz duplicação de setup (helpers, app, pools) e deixa mais fácil ver o
// padrão repetido lado a lado.
//
// Não testamos exaustivamente as 8 funções de barbeiroController (seria
// desproporcional para uma task mecânica) -- cobrimos listagem (401 +
// isolamento) e, num teste dedicado, o fluxo de criação (que precisou de uma
// correção real: os INSERTs em barbeiro/barbeiro_disponibilidade/
// barbeiro_excecao/barbeiro_servico não preenchiam barbearia_id, coluna
// NOT NULL com RLS -- ver comentários em src/controllers/barbeiroController.js).

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { limparBanco, fecharBanco } = require('../helpers/db');
const {
  criarBarbearia,
  criarAdminDireto,
  criarUnidadeDireto,
  criarServicoDireto,
  criarPlanoDireto,
  criarBarbeiroDireto,
} = require('../helpers/factories');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const poolApp = require('../../src/config/database');

function tokenAdmin(admin, barbearia_id) {
  return jwt.sign(
    { id: admin.id, tipo: 'admin', barbearia_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

describe('Controllers diversos (unidade, barbeiro, serviço, plano, financeiro) com req.db', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  describe('GET /unidades', () => {
    test('retorna 401 sem token', async () => {
      const resposta = await request(app).get('/unidades');
      expect(resposta.status).toBe(401);
    });

    test('retorna apenas unidades da barbearia do token (isolamento cross-tenant)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      await criarUnidadeDireto(barbeariaA.id, { nome: 'Unidade A' });
      await criarUnidadeDireto(barbeariaB.id, { nome: 'Unidade B' });

      const resposta = await request(app)
        .get('/unidades')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(1);
      expect(resposta.body[0].nome).toBe('Unidade A');
    });
  });

  describe('POST /unidades', () => {
    test('cria unidade quando autenticado como admin', async () => {
      const barbearia = await criarBarbearia('Barbearia A');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin@teste.com' });

      const resposta = await request(app)
        .post('/unidades')
        .set('Authorization', `Bearer ${tokenAdmin(admin, barbearia.id)}`)
        .send({ barbearia_id: barbearia.id, nome: 'Unidade Nova' });

      expect(resposta.status).toBe(201);
      expect(resposta.body.nome).toBe('Unidade Nova');
    });

    // Regressão de segurança: `criarUnidade` chegou a usar `barbearia_id` do
    // body no INSERT, permitindo que um admin de qualquer barbearia criasse
    // uma unidade em nome de OUTRA barbearia arbitrária. Corrigido para usar
    // `req.usuario.barbearia_id` (JWT). Prova, via leitura direta sob RLS
    // (mesmo padrão de `cliente.test.js`), que a unidade foi persistida na
    // barbearia do TOKEN, não na barbearia_id forjada no body.
    test('ignora barbearia_id do body e persiste a unidade na barbearia do token', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      const resposta = await request(app)
        .post('/unidades')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ barbearia_id: barbeariaB.id, nome: 'Unidade Forjada' });

      expect(resposta.status).toBe(201);

      const client = await poolTenant.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        const r = await client.query('SELECT barbearia_id FROM unidade WHERE nome = $1', ['Unidade Forjada']);
        await client.query('COMMIT');

        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].barbearia_id).toBe(barbeariaA.id);
        expect(r.rows[0].barbearia_id).not.toBe(barbeariaB.id);
      } finally {
        client.release();
      }
    });
  });

  describe('GET /servicos', () => {
    test('retorna 401 sem token', async () => {
      const resposta = await request(app).get('/servicos');
      expect(resposta.status).toBe(401);
    });

    test('retorna apenas serviços da barbearia do token (isolamento cross-tenant)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      await criarServicoDireto(barbeariaA.id, { nome: 'Corte A' });
      await criarServicoDireto(barbeariaB.id, { nome: 'Corte B' });

      const resposta = await request(app)
        .get('/servicos')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(1);
      expect(resposta.body[0].nome).toBe('Corte A');
    });
  });

  describe('POST /servicos', () => {
    // Mesma regressão de segurança de `criarUnidade`: `criarServico` usava
    // `barbearia_id` do body. Corrigido para `req.usuario.barbearia_id`.
    test('ignora barbearia_id do body e persiste o serviço na barbearia do token', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      const resposta = await request(app)
        .post('/servicos')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({
          barbearia_id: barbeariaB.id,
          nome: 'Serviço Forjado',
          categoria: 'cabelo',
          duracao_minutos: 30,
          valor: 50,
        });

      expect(resposta.status).toBe(201);

      const client = await poolTenant.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        const r = await client.query('SELECT barbearia_id FROM servico WHERE nome = $1', ['Serviço Forjado']);
        await client.query('COMMIT');

        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].barbearia_id).toBe(barbeariaA.id);
        expect(r.rows[0].barbearia_id).not.toBe(barbeariaB.id);
      } finally {
        client.release();
      }
    });
  });

  describe('GET /planos', () => {
    test('retorna 401 sem token', async () => {
      const resposta = await request(app).get('/planos');
      expect(resposta.status).toBe(401);
    });

    test('retorna apenas planos da barbearia do token (isolamento cross-tenant)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      await criarPlanoDireto(barbeariaA.id, { nome: 'Plano A' });
      await criarPlanoDireto(barbeariaB.id, { nome: 'Plano B' });

      const resposta = await request(app)
        .get('/planos')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(1);
      expect(resposta.body[0].nome).toBe('Plano A');
    });
  });

  describe('POST /planos', () => {
    // Mesma regressão de segurança de `criarUnidade`/`criarServico`:
    // `criarPlano` usava `barbearia_id` do body. Corrigido para
    // `req.usuario.barbearia_id`.
    test('ignora barbearia_id do body e persiste o plano na barbearia do token', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      const resposta = await request(app)
        .post('/planos')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ barbearia_id: barbeariaB.id, nome: 'Plano Forjado', valor_mensal: 99.9 });

      expect(resposta.status).toBe(201);

      const client = await poolTenant.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        const r = await client.query('SELECT barbearia_id FROM plano WHERE nome = $1', ['Plano Forjado']);
        await client.query('COMMIT');

        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].barbearia_id).toBe(barbeariaA.id);
        expect(r.rows[0].barbearia_id).not.toBe(barbeariaB.id);
      } finally {
        client.release();
      }
    });

    // Regressão de segurança: `associarServicosPlano` não validava que
    // `servico_ids` pertence à mesma barbearia do plano/admin -- a FK
    // `plano_servico.servico_id -> servico.id` ignora RLS e "aceitaria" um
    // serviço de outra barbearia silenciosamente. Corrigido para validar via
    // `req.db` (RLS torna o serviço de outro tenant invisível => 404).
    test('rejeita associação de servico_id pertencente a outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      const planoA = await criarPlanoDireto(barbeariaA.id, { nome: 'Plano A' });
      const servicoB = await criarServicoDireto(barbeariaB.id, { nome: 'Serviço B' });

      const resposta = await request(app)
        .post(`/planos/${planoA.id}/servicos`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ servico_ids: [servicoB.id] });

      expect(resposta.status).toBe(404);

      const respostaServicos = await request(app)
        .get(`/planos/${planoA.id}/servicos`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`);

      expect(respostaServicos.body).toHaveLength(0);
    });

    // Regressão de segurança: `associarServicosPlano` também não validava
    // que o `:id` (plano_id) da URL pertence ao tenant do admin autenticado.
    test('rejeita associação de serviços a plano_id de outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      const planoB = await criarPlanoDireto(barbeariaB.id, { nome: 'Plano B' });
      const servicoA = await criarServicoDireto(barbeariaA.id, { nome: 'Serviço A' });

      const resposta = await request(app)
        .post(`/planos/${planoB.id}/servicos`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ servico_ids: [servicoA.id] });

      expect(resposta.status).toBe(404);
    });
  });

  describe('GET /barbeiros', () => {
    test('retorna 401 sem token', async () => {
      const resposta = await request(app).get('/barbeiros');
      expect(resposta.status).toBe(401);
    });

    test('retorna apenas barbeiros da barbearia do token (isolamento cross-tenant)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });

      const unidadeA = await criarUnidadeDireto(barbeariaA.id, { nome: 'Unidade A' });
      const unidadeB = await criarUnidadeDireto(barbeariaB.id, { nome: 'Unidade B' });

      await criarBarbeiroDireto(barbeariaA.id, unidadeA.id, { nome: 'Barbeiro A' });
      await criarBarbeiroDireto(barbeariaB.id, unidadeB.id, { nome: 'Barbeiro B' });

      const resposta = await request(app)
        .get('/barbeiros')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(1);
      expect(resposta.body[0].nome).toBe('Barbeiro A');
    });
  });

  describe('POST /barbeiros e associações (prova que req.db funciona em escrita, sem transação aninhada)', () => {
    test('cria barbeiro e associa serviços, persistindo barbearia_id correto sob RLS', async () => {
      const barbearia = await criarBarbearia('Barbearia A');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin@teste.com' });
      const unidade = await criarUnidadeDireto(barbearia.id);
      const servico = await criarServicoDireto(barbearia.id);

      const token = tokenAdmin(admin, barbearia.id);

      const respostaCriacao = await request(app)
        .post('/barbeiros')
        .set('Authorization', `Bearer ${token}`)
        .send({ unidade_id: unidade.id, nome: 'Barbeiro Novo', email: 'barbeiro@teste.com' });

      expect(respostaCriacao.status).toBe(201);
      const barbeiroId = respostaCriacao.body.id;

      const respostaAssociacao = await request(app)
        .post(`/barbeiros/${barbeiroId}/servicos`)
        .set('Authorization', `Bearer ${token}`)
        .send({ servico_ids: [servico.id] });

      expect(respostaAssociacao.status).toBe(201);

      const respostaServicos = await request(app)
        .get(`/barbeiros/${barbeiroId}/servicos`)
        .set('Authorization', `Bearer ${token}`);

      expect(respostaServicos.status).toBe(200);
      expect(respostaServicos.body).toHaveLength(1);
      expect(respostaServicos.body[0].id).toBe(servico.id);
    });

    // Regressão de segurança: `criarBarbeiro` fixava `barbearia_id` a partir
    // do JWT (correto), mas não validava que `unidade_id` (vindo do body)
    // pertence à mesma barbearia -- a FK `barbeiro.unidade_id -> unidade.id`
    // ignora RLS e "aceitaria" uma unidade de outro tenant silenciosamente,
    // criando um barbeiro com barbearia_id=A mas unidade_id de B. Corrigido
    // para validar a unidade via `req.db` antes do INSERT (RLS torna a
    // unidade de outro tenant invisível => 404).
    test('rejeita criação de barbeiro com unidade_id de outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });
      const unidadeB = await criarUnidadeDireto(barbeariaB.id, { nome: 'Unidade B' });

      const resposta = await request(app)
        .post('/barbeiros')
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ unidade_id: unidadeB.id, nome: 'Barbeiro Intruso' });

      expect(resposta.status).toBe(404);

      const client = await poolTenant.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
        const r = await client.query('SELECT id FROM barbeiro WHERE nome = $1', ['Barbeiro Intruso']);
        await client.query('COMMIT');
        expect(r.rows).toHaveLength(0);
      } finally {
        client.release();
      }
    });

    // Regressão de segurança: mesmo problema de `associarServicosPlano` --
    // `associarServicos` não validava que `servico_ids` (body) nem `:id`
    // (barbeiro_id da URL) pertencem ao tenant do admin autenticado.
    test('rejeita associação de servico_id pertencente a outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });
      const unidadeA = await criarUnidadeDireto(barbeariaA.id);
      const barbeiroA = await criarBarbeiroDireto(barbeariaA.id, unidadeA.id, { nome: 'Barbeiro A' });
      const servicoB = await criarServicoDireto(barbeariaB.id, { nome: 'Serviço B' });

      const resposta = await request(app)
        .post(`/barbeiros/${barbeiroA.id}/servicos`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ servico_ids: [servicoB.id] });

      expect(resposta.status).toBe(404);
    });

    test('rejeita associação de serviços a barbeiro_id de outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });
      const unidadeB = await criarUnidadeDireto(barbeariaB.id);
      const barbeiroB = await criarBarbeiroDireto(barbeariaB.id, unidadeB.id, { nome: 'Barbeiro B' });
      const servicoA = await criarServicoDireto(barbeariaA.id, { nome: 'Serviço A' });

      const resposta = await request(app)
        .post(`/barbeiros/${barbeiroB.id}/servicos`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ servico_ids: [servicoA.id] });

      expect(resposta.status).toBe(404);
    });

    // Regressão de segurança: `definirDisponibilidade` e `criarExcecao`
    // também usam `:id` (barbeiro_id) da URL sem validar contra o tenant.
    test('rejeita definir disponibilidade para barbeiro_id de outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });
      const unidadeB = await criarUnidadeDireto(barbeariaB.id);
      const barbeiroB = await criarBarbeiroDireto(barbeariaB.id, unidadeB.id, { nome: 'Barbeiro B' });

      const resposta = await request(app)
        .post(`/barbeiros/${barbeiroB.id}/disponibilidade`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ dia_semana: 1, hora_inicio: '09:00', hora_fim: '18:00' });

      expect(resposta.status).toBe(404);
    });

    test('rejeita criar exceção de agenda para barbeiro_id de outra barbearia (404)', async () => {
      const barbeariaA = await criarBarbearia('Barbearia A');
      const barbeariaB = await criarBarbearia('Barbearia B');
      const adminA = await criarAdminDireto(barbeariaA.id, { email: 'adminA@teste.com' });
      const unidadeB = await criarUnidadeDireto(barbeariaB.id);
      const barbeiroB = await criarBarbeiroDireto(barbeariaB.id, unidadeB.id, { nome: 'Barbeiro B' });

      const resposta = await request(app)
        .post(`/barbeiros/${barbeiroB.id}/excecoes`)
        .set('Authorization', `Bearer ${tokenAdmin(adminA, barbeariaA.id)}`)
        .send({ data: '2026-08-01', tipo: 'folga_total' });

      expect(resposta.status).toBe(404);
    });
  });

  describe('GET /financeiro/faturamento-mensal e /financeiro/desempenho-barbeiros', () => {
    test('faturamento-mensal retorna 401 sem token', async () => {
      const resposta = await request(app).get('/financeiro/faturamento-mensal');
      expect(resposta.status).toBe(401);
    });

    test('desempenho-barbeiros retorna 401 sem token', async () => {
      const resposta = await request(app).get('/financeiro/desempenho-barbeiros');
      expect(resposta.status).toBe(401);
    });

    test('faturamento-mensal retorna 403 para usuário não-admin', async () => {
      const barbearia = await criarBarbearia('Barbearia A');
      const token = jwt.sign(
        { id: 1, tipo: 'cliente', barbearia_id: barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .get('/financeiro/faturamento-mensal')
        .set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(403);
    });

    test('faturamento-mensal responde 200 (view vazia) para admin autenticado', async () => {
      const barbearia = await criarBarbearia('Barbearia A');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin@teste.com' });

      const resposta = await request(app)
        .get('/financeiro/faturamento-mensal')
        .set('Authorization', `Bearer ${tokenAdmin(admin, barbearia.id)}`);

      expect(resposta.status).toBe(200);
      expect(Array.isArray(resposta.body)).toBe(true);
    });

    test('desempenho-barbeiros responde 200 (view vazia) para admin autenticado', async () => {
      const barbearia = await criarBarbearia('Barbearia A');
      const admin = await criarAdminDireto(barbearia.id, { email: 'admin@teste.com' });

      const resposta = await request(app)
        .get('/financeiro/desempenho-barbeiros')
        .set('Authorization', `Bearer ${tokenAdmin(admin, barbearia.id)}`);

      expect(resposta.status).toBe(200);
      expect(Array.isArray(resposta.body)).toBe(true);
    });
  });
});
