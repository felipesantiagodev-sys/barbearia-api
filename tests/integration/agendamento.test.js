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
  associarBarbeiroServico,
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

// `barbeiro_disponibilidade` também tem FORCE ROW LEVEL SECURITY (migration
// 005), com `barbearia_id` próprio (migrations 002/004). Mesmo padrão de
// transação dedicada usado em `inserirAgendamentoDireto` acima.
async function inserirDisponibilidadeDireto(barbearia_id, { barbeiro_id, dia_semana, hora_inicio, hora_fim }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    await client.query(
      'INSERT INTO barbeiro_disponibilidade (barbearia_id, barbeiro_id, dia_semana, hora_inicio, hora_fim) VALUES ($1, $2, $3, $4, $5)',
      [barbearia_id, barbeiro_id, dia_semana, hora_inicio, hora_fim]
    );
    await client.query('COMMIT');
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

  // Testes da Task 1 do plano app-cliente-agendamento: GET /agendamentos/meus
  // permite ao cliente autenticado listar os próprios agendamentos, filtrados
  // por status=agendados (futuros e confirmados) ou status=anteriores
  // (demais). Fica aninhado no describe principal (em vez de um describe
  // top-level irmão) para compartilhar o mesmo afterEach/afterAll e não
  // tentar usar `pool`/`poolTenant`/`poolApp` já encerrados pelo afterAll do
  // describe principal.
  describe('GET /agendamentos/meus', () => {
    async function montarCenarioBasico() {
      const barbearia = await criarBarbearia('Barbearia Meus Agendamentos');
      const unidade = await criarUnidadeDireto(barbearia.id);
      const barbeiro = await criarBarbeiroDireto(barbearia.id, unidade.id);
      const servico = await criarServicoDireto(barbearia.id, { duracao_minutos: 30 });
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.meus@teste.com' });
      const token = jwt.sign(
        { id: cliente.id, tipo: 'cliente', barbearia_id: barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
      return { barbearia, unidade, barbeiro, servico, cliente, token };
    }

    test('retorna só agendamentos futuros e confirmados quando status=agendados', async () => {
      const { unidade, barbeiro, servico, cliente, token } = await montarCenarioBasico();

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cliente_id: cliente.id,
          barbeiro_id: barbeiro.id,
          unidade_id: unidade.id,
          data: amanha,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cliente_id: cliente.id,
          barbeiro_id: barbeiro.id,
          unidade_id: unidade.id,
          data: ontem,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      const resposta = await request(app)
        .get('/agendamentos/meus?status=agendados')
        .set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(1);
      expect(new Date(resposta.body[0].data_hora_inicio).getTime()).toBeGreaterThan(Date.now());
      expect(resposta.body[0].itens).toHaveLength(1);
      expect(resposta.body[0].valor_total).toBeDefined();
    });

    test('retorna agendamento confirmado com data passada em anteriores, não em agendados', async () => {
      const { unidade, barbeiro, servico, cliente, token } = await montarCenarioBasico();
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cliente_id: cliente.id,
          barbeiro_id: barbeiro.id,
          unidade_id: unidade.id,
          data: ontem,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      const respostaAgendados = await request(app)
        .get('/agendamentos/meus?status=agendados')
        .set('Authorization', `Bearer ${token}`);
      expect(respostaAgendados.body).toHaveLength(0);

      const respostaAnteriores = await request(app)
        .get('/agendamentos/meus?status=anteriores')
        .set('Authorization', `Bearer ${token}`);
      expect(respostaAnteriores.body).toHaveLength(1);
    });

    test('um cliente nunca vê agendamentos de outro cliente, mesmo dentro da mesma barbearia', async () => {
      const { barbearia, unidade, barbeiro, servico, cliente, token } = await montarCenarioBasico();
      const outroCliente = await criarClienteDireto(barbearia.id, { email: 'outro.cliente@teste.com' });

      const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      await request(app)
        .post('/agendamentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          cliente_id: outroCliente.id,
          barbeiro_id: barbeiro.id,
          unidade_id: unidade.id,
          data: amanha,
          hora_inicio: '10:00',
          servico_ids: [servico.id],
        });

      const resposta = await request(app)
        .get('/agendamentos/meus?status=agendados')
        .set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(0);
    });

    test('rejeita sem token de autenticação', async () => {
      const resposta = await request(app).get('/agendamentos/meus');
      expect(resposta.status).toBe(401);
    });
  });

  // Testes da Task 3 do plano app-cliente-agendamento: rota pública que
  // agrega disponibilidade de múltiplos barbeiros para quem não tem
  // preferência de barbeiro específico. Segue o mesmo padrão de resolução de
  // tenant de `listarHorariosDisponiveis`, mas partindo de `unidade_id` em
  // vez de `barbeiro_id`.
  describe('GET /agendamentos/horarios-disponiveis-qualquer-barbeiro', () => {
    test('retorna slots de qualquer barbeiro que atenda todos os serviços pedidos', async () => {
      const barbearia = await criarBarbearia('Barbearia Qualquer Barbeiro');
      const unidade = await criarUnidadeDireto(barbearia.id);
      const barbeiroA = await criarBarbeiroDireto(barbearia.id, unidade.id, { nome: 'Barbeiro A' });
      const barbeiroB = await criarBarbeiroDireto(barbearia.id, unidade.id, { nome: 'Barbeiro B' });
      const servico = await criarServicoDireto(barbearia.id, { duracao_minutos: 30 });

      await associarBarbeiroServico(barbeiroA.id, servico.id);
      await associarBarbeiroServico(barbeiroB.id, servico.id);

      // Disponibilidade: barbeiro A trabalha 08h-12h todo dia da semana testado;
      // barbeiro B não tem nenhuma disponibilidade cadastrada (não deve aparecer).
      const diaSemana = new Date().getDay();
      await inserirDisponibilidadeDireto(barbearia.id, {
        barbeiro_id: barbeiroA.id,
        dia_semana: diaSemana,
        hora_inicio: '08:00',
        hora_fim: '12:00',
      });

      const hoje = new Date().toISOString().slice(0, 10);

      const resposta = await request(app).get(
        `/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=${unidade.id}&servico_ids=${servico.id}&data=${hoje}`
      );

      expect(resposta.status).toBe(200);
      expect(resposta.body.length).toBeGreaterThan(0);
      expect(resposta.body[0]).toHaveProperty('inicio');
      expect(resposta.body[0]).toHaveProperty('fim_atendimento');
      expect(resposta.body[0].barbeiro_id).toBe(barbeiroA.id);
    });

    test('não retorna slots de barbeiro que não atende todos os serviços pedidos', async () => {
      const barbearia = await criarBarbearia('Barbearia Parcial');
      const unidade = await criarUnidadeDireto(barbearia.id);
      const barbeiro = await criarBarbeiroDireto(barbearia.id, unidade.id);
      const servicoA = await criarServicoDireto(barbearia.id, { nome: 'Corte', duracao_minutos: 30 });
      const servicoB = await criarServicoDireto(barbearia.id, { nome: 'Barba', duracao_minutos: 20 });

      // Barbeiro só atende servicoA, não servicoB.
      await associarBarbeiroServico(barbeiro.id, servicoA.id);

      const diaSemana = new Date().getDay();
      await inserirDisponibilidadeDireto(barbearia.id, {
        barbeiro_id: barbeiro.id,
        dia_semana: diaSemana,
        hora_inicio: '08:00',
        hora_fim: '12:00',
      });

      const hoje = new Date().toISOString().slice(0, 10);

      const resposta = await request(app).get(
        `/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=${unidade.id}&servico_ids=${servicoA.id},${servicoB.id}&data=${hoje}`
      );

      expect(resposta.status).toBe(200);
      expect(resposta.body).toHaveLength(0);
    });

    test('retorna 400 se faltar algum query param obrigatório', async () => {
      const resposta = await request(app).get('/agendamentos/horarios-disponiveis-qualquer-barbeiro?data=2026-08-10');
      expect(resposta.status).toBe(400);
    });
  });
});
