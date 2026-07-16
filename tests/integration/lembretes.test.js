// Testes da Task 11.5: notificacaoService.enviarLembretes(db) e
// jobs/lembretes.js (cron) precisam funcionar sob RLS, escopando por tenant.
//
// DECISÃO SOBRE INSERTS DIRETOS: `agendamento` e `notificacao` têm FORCE ROW
// LEVEL SECURITY (migration 005). Os helpers auxiliares deste arquivo seguem
// o mesmo padrão já usado em tests/helpers/factories.js e
// tests/integration/agendamento.test.js: transação dedicada numa única
// conexão, com `set_config('app.tenant_id', ..., true)` antes do INSERT.
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
const { enviarLembretes } = require('../../src/services/notificacaoService');
const { processarTodasAsBarbearias } = require('../../src/jobs/lembretes');

function tokenAdmin(admin, barbearia_id) {
  return jwt.sign(
    { id: admin.id, tipo: 'admin', barbearia_id },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Mesmo padrão de transação dedicada usado em tests/helpers/factories.js e
// tests/integration/agendamento.test.js.
async function inserirAgendamentoDireto(barbearia_id, { cliente_id, barbeiro_id, unidade_id, status = 'confirmado' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status)
       VALUES ($1, $2, $3, $4, (CURRENT_DATE + INTERVAL '1 day') + TIME '10:00', (CURRENT_DATE + INTERVAL '1 day') + TIME '10:30', $5)
       RETURNING *`,
      [barbearia_id, cliente_id, barbeiro_id, unidade_id, status]
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

// Cria a notificação pendente de lembrete diretamente associada a um
// agendamento (mesmo padrão de transação dedicada com app.tenant_id).
async function inserirNotificacaoDireto(barbearia_id, agendamento_id, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO notificacao (barbearia_id, agendamento_id, tipo, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        barbearia_id,
        agendamento_id,
        overrides.tipo || 'lembrete_1_dia',
        overrides.status || 'pendente',
      ]
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
// tests/helpers/db.js e dos demais testes de integração).
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

async function montarCenarioComNotificacaoPendente(nomeBarbearia) {
  const cenario = await montarCenario(nomeBarbearia);
  const agendamento = await inserirAgendamentoDireto(cenario.barbearia.id, {
    cliente_id: cenario.cliente.id,
    barbeiro_id: cenario.barbeiro.id,
    unidade_id: cenario.unidade.id,
  });
  const notificacao = await inserirNotificacaoDireto(cenario.barbearia.id, agendamento.id);
  return { ...cenario, agendamento, notificacao };
}

// Client escopado por tenant, no mesmo padrão do middleware escoparTenant --
// usado para chamar enviarLembretes(db) diretamente, sem passar pelo cron
// nem pelo HTTP, exercitando só a função de serviço.
async function abrirClientEscopado(barbearia_id) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);
  return client;
}

describe('Task 11.5: notificacaoService e jobs/lembretes sob RLS', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  describe('enviarLembretes(db) com client escopado para UM tenant', () => {
    test('processa notificações pendentes só da barbearia do client escopado', async () => {
      const cenario = await montarCenarioComNotificacaoPendente('Barbearia A');

      const client = await abrirClientEscopado(cenario.barbearia.id);
      let total;
      try {
        total = await enviarLembretes(client);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      expect(total).toBe(1);

      const verificacao = await lerComoPlataforma(
        'SELECT status, enviado_em FROM notificacao WHERE id = $1',
        [cenario.notificacao.id]
      );
      expect(verificacao.rows[0].status).toBe('enviado');
      expect(verificacao.rows[0].enviado_em).not.toBeNull();
    });

    test('não enxerga (nem processa) notificações pendentes de outra barbearia', async () => {
      const cenarioA = await montarCenarioComNotificacaoPendente('Barbearia A');
      const cenarioB = await montarCenarioComNotificacaoPendente('Barbearia B');

      const client = await abrirClientEscopado(cenarioA.barbearia.id);
      let total;
      try {
        total = await enviarLembretes(client);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      expect(total).toBe(1);

      const verificacaoB = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioB.notificacao.id]
      );
      expect(verificacaoB.rows[0].status).toBe('pendente');
    });
  });

  describe('processarTodasAsBarbearias() itera todas as barbearias, sem vazamento cross-tenant', () => {
    test('processa notificações pendentes de 2 barbearias diferentes, cada uma só com as suas', async () => {
      const cenarioA = await montarCenarioComNotificacaoPendente('Barbearia A');
      const cenarioB = await montarCenarioComNotificacaoPendente('Barbearia B');

      const total = await processarTodasAsBarbearias();

      expect(total).toBe(2);

      const verificacaoA = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioA.notificacao.id]
      );
      const verificacaoB = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioB.notificacao.id]
      );

      expect(verificacaoA.rows[0].status).toBe('enviado');
      expect(verificacaoB.rows[0].status).toBe('enviado');
    });
  });

  describe('resiliência: falha isolada numa barbearia não impede as demais', () => {
    test('se uma barbearia falhar durante o processamento, as outras ainda são processadas', async () => {
      const cenarioA = await montarCenarioComNotificacaoPendente('Barbearia A');
      const cenarioFalha = await montarCenarioComNotificacaoPendente('Barbearia Com Falha');
      const cenarioB = await montarCenarioComNotificacaoPendente('Barbearia B');

      // Simula a falha de UMA barbearia específica: espiona pool.connect e,
      // só quando o client resultante tentar setar app.tenant_id para a
      // barbearia-alvo, força a query a rejeitar. Isso reproduz o cenário de
      // "erro de banco/rede isolado para um tenant" sem exigir infraestrutura
      // real de falha, mantendo as outras barbearias no caminho normal.
      //
      // IMPORTANTE: jobs/lembretes.js usa o pool de src/config/database.js
      // (poolApp), não o pool de tests/helpers/db.js -- são instâncias
      // diferentes de `Pool`, então o espião precisa ser no pool certo.
      // ATENÇÃO: `pool.query(...)` (usado internamente, ex. pelo
      // `SELECT id FROM barbearia` no início de processarTodasAsBarbearias)
      // chama `this.connect(callback)` internamente (estilo Node callback,
      // não Promise) -- então o mock PRECISA repassar chamadas com
      // argumentos (callback-style) direto para o connect original, e só
      // interceptar a forma Promise (sem argumentos), que é a usada por
      // `await pool.connect()` em jobs/lembretes.js. Sem essa distinção, o
      // mock quebra o `pool.query` interno e trava a suíte.
      const connectOriginal = poolApp.connect.bind(poolApp);
      const spyConnect = jest.spyOn(poolApp, 'connect').mockImplementation((...connectArgs) => {
        if (connectArgs.length > 0) {
          return connectOriginal(...connectArgs);
        }
        return (async () => {
          const client = await connectOriginal();
          const queryOriginal = client.query.bind(client);
          client.query = (...args) => {
            const [sql, params] = args;
            if (
              typeof sql === 'string' &&
              sql.includes('set_config') &&
              Array.isArray(params) &&
              params[1] === String(cenarioFalha.barbearia.id)
            ) {
              return Promise.reject(new Error('Falha simulada de conexão para esta barbearia'));
            }
            return queryOriginal(...args);
          };
          return client;
        })();
      });

      let total;
      try {
        total = await processarTodasAsBarbearias();
      } finally {
        spyConnect.mockRestore();
      }

      // Só A e B foram efetivamente processadas e enviadas.
      expect(total).toBe(2);

      const verificacaoA = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioA.notificacao.id]
      );
      const verificacaoFalha = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioFalha.notificacao.id]
      );
      const verificacaoB = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioB.notificacao.id]
      );

      expect(verificacaoA.rows[0].status).toBe('enviado');
      expect(verificacaoFalha.rows[0].status).toBe('pendente'); // não processada, continua pendente
      expect(verificacaoB.rows[0].status).toBe('enviado');
    });
  });

  describe('POST /notificacoes/enviar-lembretes', () => {
    test('processa só a barbearia do admin autenticado (não itera todas)', async () => {
      const cenarioA = await montarCenarioComNotificacaoPendente('Barbearia A');
      const cenarioB = await montarCenarioComNotificacaoPendente('Barbearia B');

      const resposta = await request(app)
        .post('/notificacoes/enviar-lembretes')
        .set('Authorization', `Bearer ${cenarioA.token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body.mensagem).toBe('1 lembrete(s) processado(s)');

      const verificacaoA = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioA.notificacao.id]
      );
      const verificacaoB = await lerComoPlataforma(
        'SELECT status FROM notificacao WHERE id = $1',
        [cenarioB.notificacao.id]
      );

      expect(verificacaoA.rows[0].status).toBe('enviado');
      expect(verificacaoB.rows[0].status).toBe('pendente');
    });

    test('rejeita se não for admin (403)', async () => {
      const cenario = await montarCenarioComNotificacaoPendente('Barbearia A');
      const tokenCliente = jwt.sign(
        { id: cenario.cliente.id, tipo: 'cliente', barbearia_id: cenario.barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .post('/notificacoes/enviar-lembretes')
        .set('Authorization', `Bearer ${tokenCliente}`);

      expect(resposta.status).toBe(403);
    });
  });
});
