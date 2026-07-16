// Testes de integração da Task 11.4: migração de agendamentoController de
// transações manuais (pool.connect() + BEGIN/COMMIT próprios) para req.db
// (client escopado por tenant via middleware escoparTenant).
//
// PROVA CENTRAL DE SEGURANÇA: um admin de uma barbearia não pode mais
// cancelar (nem enxergar) agendamentos de outra barbearia. Antes da
// migração, cancelarAgendamento usava `pool.query` sem qualquer filtro de
// tenant -- qualquer admin autenticado conseguia cancelar QUALQUER
// agendamento do sistema, de qualquer barbearia, sabendo apenas o id.
//
// DECISÃO SOBRE RLS NOS INSERTS DIRETOS: `agendamento`, `agendamento_servico`
// e `notificacao` têm FORCE ROW LEVEL SECURITY (migration 005). INSERTs
// diretos via `pool` puro (sem `app.tenant_id`/`app.is_plataforma` setado)
// são bloqueados pela policy WITH CHECK. Por isso os helpers auxiliares deste
// arquivo (`inserirAgendamentoDireto`) seguem o mesmo padrão já usado em
// `tests/helpers/factories.js`: transação dedicada numa única conexão, com
// `set_config('app.tenant_id', ..., true)` antes do INSERT.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const {
  criarBarbearia,
  criarAdminDireto,
  criarUnidadeDireto,
  criarServicoDireto,
  criarBarbeiroDireto,
  criarClienteDireto,
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

// Mesmo padrão de transação dedicada usado em tests/helpers/factories.js:
// `agendamento` tem FORCE ROW LEVEL SECURITY, então o INSERT direto precisa
// rodar numa conexão com `app.tenant_id` setado via SET LOCAL.
async function inserirAgendamentoDireto(barbearia_id, { cliente_id, barbeiro_id, unidade_id, status = 'confirmado', offsetDias = 1 }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, now() + ($5 || ' days')::interval + interval '30 minutes', $6)
       RETURNING *`,
      [barbearia_id, cliente_id, barbeiro_id, unidade_id, String(offsetDias), status]
    );
    await client.query('COMMIT');
    return r.rows[0];
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

// Leitura direta sob RLS usando app.is_plataforma (mesmo padrão de
// tests/helpers/db.js e dos demais testes de integração), necessária porque
// `pool.query()` puro não tem app.tenant_id/app.is_plataforma setado e seria
// bloqueado pela policy de RLS em tabelas com FORCE ROW LEVEL SECURITY.
async function lerComoPlataforma(sql, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const r = await client.query(sql, params);
    await client.query('COMMIT');
    return r;
  } finally {
    client.release();
  }
}

async function montarCenario(nomeBarbearia) {
  const barbearia = await criarBarbearia(nomeBarbearia);
  const unidade = await criarUnidadeDireto(barbearia.id, { nome: 'Unidade Principal' });
  const barbeiro = await criarBarbeiroDireto(barbearia.id, unidade.id, { nome: 'Barbeiro Teste' });
  const admin = await criarAdminDireto(barbearia.id, { email: `admin-${Date.now()}-${Math.random()}@teste.com` });
  const cliente = await criarClienteDireto(barbearia.id, { email: `cliente-${Date.now()}-${Math.random()}@teste.com` });
  const token = tokenAdmin(admin, barbearia.id);
  return { barbearia, unidade, barbeiro, admin, cliente, token };
}

describe('agendamentoController com req.db', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  describe('Isolamento de agendamento entre tenants', () => {
    test('admin de uma barbearia não consegue cancelar agendamento de outra barbearia', async () => {
      const cenarioA = await montarCenario('Barbearia A');
      const cenarioB = await montarCenario('Barbearia B');

      const agendamento = await inserirAgendamentoDireto(cenarioA.barbearia.id, {
        cliente_id: cenarioA.cliente.id,
        barbeiro_id: cenarioA.barbeiro.id,
        unidade_id: cenarioA.unidade.id,
      });

      const resposta = await request(app)
        .patch(`/agendamentos/${agendamento.id}/cancelar`)
        .set('Authorization', `Bearer ${cenarioB.token}`);

      expect(resposta.status).toBe(404);

      const verificacao = await lerComoPlataforma('SELECT status FROM agendamento WHERE id = $1', [agendamento.id]);
      expect(verificacao.rows[0].status).toBe('confirmado');
    });
  });

  describe('POST /agendamentos', () => {
    test('cria agendamento válido com itens de serviço e valor total', async () => {
      const cenario = await montarCenario('Barbearia A');
      const servico = await criarServicoDireto(cenario.barbearia.id, {
        nome: 'Corte',
        duracao_minutos: 30,
        valor: 50,
      });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const resposta = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenario.token}`)
        .send({
          cliente_id: cenario.cliente.id,
          barbeiro_id: cenario.barbeiro.id,
          unidade_id: cenario.unidade.id,
          data,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      expect(resposta.status).toBe(201);
      expect(resposta.body.itens).toHaveLength(1);
      expect(Number(resposta.body.valor_total)).toBe(50);
      expect(resposta.body.status).toBe('confirmado');

      const verificacao = await lerComoPlataforma('SELECT barbearia_id FROM agendamento WHERE id = $1', [resposta.body.id]);
      expect(verificacao.rows[0].barbearia_id).toBe(cenario.barbearia.id);
    });

    // Regressão de segurança: `criarAgendamento` não validava que
    // barbeiro_id/unidade_id/cliente_id/servico_ids (todos vindos do body)
    // pertencem à barbearia do admin autenticado. A FK ignora RLS, então sem
    // essa checagem seria possível criar um agendamento "misturando" tenants.
    test('rejeita criação de agendamento com barbeiro_id de outra barbearia (404)', async () => {
      const cenarioA = await montarCenario('Barbearia A');
      const cenarioB = await montarCenario('Barbearia B');
      const servico = await criarServicoDireto(cenarioA.barbearia.id, { nome: 'Corte', duracao_minutos: 30, valor: 50 });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const resposta = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenarioA.token}`)
        .send({
          cliente_id: cenarioA.cliente.id,
          barbeiro_id: cenarioB.barbeiro.id,
          unidade_id: cenarioA.unidade.id,
          data,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      expect(resposta.status).toBe(404);
    });

    test('rejeita criação de agendamento com unidade_id de outra barbearia (404)', async () => {
      const cenarioA = await montarCenario('Barbearia A');
      const cenarioB = await montarCenario('Barbearia B');
      const servico = await criarServicoDireto(cenarioA.barbearia.id, { nome: 'Corte', duracao_minutos: 30, valor: 50 });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const resposta = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenarioA.token}`)
        .send({
          cliente_id: cenarioA.cliente.id,
          barbeiro_id: cenarioA.barbeiro.id,
          unidade_id: cenarioB.unidade.id,
          data,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      expect(resposta.status).toBe(404);
    });

    test('rejeita criação de agendamento com cliente_id de outra barbearia (404)', async () => {
      const cenarioA = await montarCenario('Barbearia A');
      const cenarioB = await montarCenario('Barbearia B');
      const servico = await criarServicoDireto(cenarioA.barbearia.id, { nome: 'Corte', duracao_minutos: 30, valor: 50 });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const resposta = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenarioA.token}`)
        .send({
          cliente_id: cenarioB.cliente.id,
          barbeiro_id: cenarioA.barbeiro.id,
          unidade_id: cenarioA.unidade.id,
          data,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      expect(resposta.status).toBe(404);
    });

    test('rejeita criação de agendamento com servico_id de outra barbearia (404)', async () => {
      const cenarioA = await montarCenario('Barbearia A');
      const cenarioB = await montarCenario('Barbearia B');
      const servicoB = await criarServicoDireto(cenarioB.barbearia.id, { nome: 'Corte B', duracao_minutos: 30, valor: 50 });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const resposta = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenarioA.token}`)
        .send({
          cliente_id: cenarioA.cliente.id,
          barbeiro_id: cenarioA.barbeiro.id,
          unidade_id: cenarioA.unidade.id,
          data,
          hora_inicio: '10:00',
          servico_ids: [servicoB.id],
        });

      expect(resposta.status).toBe(404);
    });
  });

  describe('PATCH /agendamentos/:id/cancelar', () => {
    test('cliente cancela o próprio agendamento com sucesso', async () => {
      const cenario = await montarCenario('Barbearia A');
      const agendamento = await inserirAgendamentoDireto(cenario.barbearia.id, {
        cliente_id: cenario.cliente.id,
        barbeiro_id: cenario.barbeiro.id,
        unidade_id: cenario.unidade.id,
      });

      const tokenCliente = jwt.sign(
        { id: cenario.cliente.id, tipo: 'cliente', barbearia_id: cenario.barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .patch(`/agendamentos/${agendamento.id}/cancelar`)
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body.status).toBe('cancelado');
    });
  });

  describe('PATCH /agendamentos/:id/concluir', () => {
    test('admin conclui agendamento e registra pagamento', async () => {
      const cenario = await montarCenario('Barbearia A');
      const servico = await criarServicoDireto(cenario.barbearia.id, { nome: 'Corte', duracao_minutos: 30, valor: 40 });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const criacao = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenario.token}`)
        .send({
          cliente_id: cenario.cliente.id,
          barbeiro_id: cenario.barbeiro.id,
          unidade_id: cenario.unidade.id,
          data,
          hora_inicio: '11:00',
          servico_ids: [servico.id],
        });

      expect(criacao.status).toBe(201);

      const resposta = await request(app)
        .patch(`/agendamentos/${criacao.body.id}/concluir`)
        .set('Authorization', `Bearer ${cenario.token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body.status).toBe('concluido');
      expect(Number(resposta.body.valor_pago)).toBe(40);
    });
  });

  describe('PATCH /agendamentos/:id/reagendar', () => {
    test('cliente reagenda o próprio agendamento, criando um novo vinculado ao original', async () => {
      const cenario = await montarCenario('Barbearia A');
      const servico = await criarServicoDireto(cenario.barbearia.id, { nome: 'Corte', duracao_minutos: 30, valor: 40 });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = amanha.toISOString().slice(0, 10);

      const criacao = await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${cenario.token}`)
        .send({
          cliente_id: cenario.cliente.id,
          barbeiro_id: cenario.barbeiro.id,
          unidade_id: cenario.unidade.id,
          data,
          hora_inicio: '11:00',
          servico_ids: [servico.id],
        });

      expect(criacao.status).toBe(201);

      const depois = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const novaData = depois.toISOString().slice(0, 10);

      const tokenCliente = jwt.sign(
        { id: cenario.cliente.id, tipo: 'cliente', barbearia_id: cenario.barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .patch(`/agendamentos/${criacao.body.id}/reagendar`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .send({ data: novaData, hora_inicio: '15:00' });

      expect(resposta.status).toBe(201);
      expect(resposta.body.reagendado_de_id).toBe(criacao.body.id);

      const original = await lerComoPlataforma('SELECT status FROM agendamento WHERE id = $1', [criacao.body.id]);
      expect(original.rows[0].status).toBe('reagendado');
    });

    // Regressão de segurança: `:id` da URL (agendamento original) não era
    // validado contra o tenant do usuário autenticado.
    test('rejeita reagendamento de agendamento de outra barbearia (404)', async () => {
      const cenarioA = await montarCenario('Barbearia A');
      const cenarioB = await montarCenario('Barbearia B');

      const agendamento = await inserirAgendamentoDireto(cenarioA.barbearia.id, {
        cliente_id: cenarioA.cliente.id,
        barbeiro_id: cenarioA.barbeiro.id,
        unidade_id: cenarioA.unidade.id,
      });

      const resposta = await request(app)
        .patch(`/agendamentos/${agendamento.id}/reagendar`)
        .set('Authorization', `Bearer ${cenarioB.token}`)
        .send({ data: '2026-08-01', hora_inicio: '15:00' });

      expect(resposta.status).toBe(404);
    });
  });
});
