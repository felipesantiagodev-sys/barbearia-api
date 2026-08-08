const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia, criarClienteDireto, criarPlanoDireto, criarAssinaturaDireto } = require('../helpers/factories');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const poolApp = require('../../src/config/database');
const { limitadorCadastro } = require('../../src/middlewares/rateLimiters');
const { ipKeyGenerator } = require('express-rate-limit');

// Mesmo padrão de tests/integration/onboarding.test.js e auth.test.js:
// `limitadorCadastro` é um singleton do express-rate-limit com estado em
// memória compartilhado por TODOS os testes deste processo Jest, chaveado
// por padrão em req.ip (normalizado via ipKeyGenerator). Esta rota
// (POST /barbearias/:barbearia_id/clientes) agora está protegida por esse
// mesmo limitador (5/hora), e este arquivo faz muito mais de 5 requisições
// de cadastro em sequência -- sem resetar entre testes, os testes
// posteriores estourariam o limite e receberiam 429 em vez do status
// esperado.
const CHAVE_IP_TESTE = ipKeyGenerator('::ffff:127.0.0.1');
function resetarLimitadores() {
  limitadorCadastro.resetKey(CHAVE_IP_TESTE);
}

describe('POST /barbearias/:barbearia_id/clientes', () => {
  afterEach(async () => {
    await limparBanco();
    resetarLimitadores();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
    await poolApp.end();
  });

  test('cadastra cliente vinculado à barbearia da URL, ignorando barbearia_id do body', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({
        barbearia_id: barbeariaB.id,
        nome: 'Cliente Novo',
        email: 'novo@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body.nome).toBe('Cliente Novo');
  });

  test('persiste o cliente com barbearia_id da URL, não do body (verificação direta no banco sob RLS)', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({
        barbearia_id: barbeariaB.id,
        nome: 'Cliente Novo',
        email: 'novo2@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    expect(resposta.status).toBe(201);

    // Leitura direta sob RLS, usando app.is_plataforma para enxergar todas as
    // linhas (mesmo padrão de tests/helpers/db.js), a fim de confirmar em
    // qual barbearia o cliente foi de fato persistido.
    const client = await poolTenant.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
      const r = await client.query('SELECT barbearia_id FROM cliente WHERE email = $1', ['novo2@teste.com']);
      await client.query('COMMIT');

      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].barbearia_id).toBe(barbeariaA.id);
      expect(r.rows[0].barbearia_id).not.toBe(barbeariaB.id);
    } finally {
      client.release();
    }
  });

  test('retorna 400 quando faltam campos obrigatórios', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ nome: 'Sem email nem senha' });

    expect(resposta.status).toBe(400);
  });

  test('retorna 409 ao tentar cadastrar email já usado na mesma barbearia', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');

    await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({
        nome: 'Cliente Um',
        email: 'duplicado@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({
        nome: 'Cliente Dois',
        email: 'duplicado@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    expect(resposta.status).toBe(409);
  });

  test('retorna 404 quando a barbearia da URL não existe', async () => {
    const resposta = await request(app)
      .post('/barbearias/999999/clientes')
      .send({
        nome: 'Cliente Fantasma',
        email: 'fantasma@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    expect(resposta.status).toBe(404);
  });

  test('retorna 400 quando barbearia_id da URL não é numérico', async () => {
    const resposta = await request(app)
      .post('/barbearias/abc/clientes')
      .send({ nome: 'Cliente Inválido', email: 'invalido@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(400);
  });

  test('cadastra cliente com data_nascimento válida', async () => {
    const barbearia = await criarBarbearia('Barbearia Data Nascimento');

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Com Data',
        email: 'comdata@teste.com',
        senha: 'senha123',
        data_nascimento: '1995-05-20',
      });

    expect(resposta.status).toBe(201);
    expect(resposta.body.data_nascimento).toBe('1995-05-20');

    // Regressão do bug original de timezone: a coluna `data_nascimento` é
    // DATE no Postgres, e o driver `pg` por padrão parseia DATE como um
    // objeto JS Date ancorado em meia-noite LOCAL do processo -- em
    // servidores com offset positivo de UTC isso desloca a data em um dia
    // ao serializar. A correção foi registrar um type parser para o OID
    // 1082 (DATE) em `src/config/database.js` que mantém a string crua. O
    // assert acima (`resposta.body.data_nascimento`) sozinho NÃO pegaria
    // uma regressão desse type parser: ele só verifica o valor devolvido
    // pelo próprio INSERT ... RETURNING da mesma operação que gerou a
    // resposta HTTP, sem nunca passar pelo código de leitura de fato. Este
    // bloco lê o valor de volta numa query SEPARADA, sob RLS (mesmo padrão
    // de leitura usado no teste acima, com app.is_plataforma), para
    // confirmar que a string retornada por uma leitura independente também
    // é exatamente '1995-05-20', sem deslocamento.
    const client = await poolTenant.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
      const leitura = await client.query(
        'SELECT data_nascimento FROM cliente WHERE email = $1',
        ['comdata@teste.com']
      );
      await client.query('COMMIT');

      expect(leitura.rows).toHaveLength(1);
      expect(leitura.rows[0].data_nascimento).toBe('1995-05-20');
    } finally {
      client.release();
    }
  });

  test('retorna 400 quando data_nascimento está no futuro', async () => {
    const barbearia = await criarBarbearia('Barbearia Data Futura');
    const anoFuturo = new Date().getFullYear() + 1;

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Data Futura',
        email: 'datafutura@teste.com',
        senha: 'senha123',
        data_nascimento: `${anoFuturo}-01-01`,
      });

    expect(resposta.status).toBe(400);
  });

  test('retorna 400 quando data_nascimento é uma string inválida', async () => {
    const barbearia = await criarBarbearia('Barbearia Data Invalida');

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Data Invalida',
        email: 'datainvalida@teste.com',
        senha: 'senha123',
        data_nascimento: 'não-é-uma-data',
      });

    expect(resposta.status).toBe(400);
  });

  test('retorna 400 quando data_nascimento está ausente', async () => {
    const barbearia = await criarBarbearia('Barbearia Sem Data');

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Sem Data',
        email: 'semdata@teste.com',
        senha: 'senha123',
      });

    expect(resposta.status).toBe(400);
  });

  // `new Date("1995")` é uma conversão válida em JS (vira 1995-01-01), mas
  // não está no formato exato YYYY-MM-DD exigido pelo contrato da API --
  // sem a validação de formato via regex, isso passaria pela checagem de
  // "data válida" e só falharia no INSERT (erro 22007 do Postgres), o que
  // antes da correção caía no catch genérico como 500.
  test('retorna 400 quando data_nascimento tem só o ano, sem mês/dia', async () => {
    const barbearia = await criarBarbearia('Barbearia Data Só Ano');

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Data Só Ano',
        email: 'dataanoso@teste.com',
        senha: 'senha123',
        data_nascimento: '1995',
      });

    expect(resposta.status).toBe(400);
  });

  test('retorna 400 quando data_nascimento é um número', async () => {
    const barbearia = await criarBarbearia('Barbearia Data Numero');

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Data Numero',
        email: 'datanumero@teste.com',
        senha: 'senha123',
        data_nascimento: 12345,
      });

    expect(resposta.status).toBe(400);
  });

  test('retorna 404 ao tentar cadastrar em barbearia pendente de verificação', async () => {
    const barbearia = await criarBarbearia('Barbearia Pendente', { status: 'pendente_verificacao' });

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Barbearia Pendente',
        email: 'pendente@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    expect(resposta.status).toBe(404);
  });

  test('retorna 404 ao tentar cadastrar em barbearia suspensa', async () => {
    const barbearia = await criarBarbearia('Barbearia Suspensa', { status: 'suspensa' });

    const resposta = await request(app)
      .post(`/barbearias/${barbearia.id}/clientes`)
      .send({
        nome: 'Cliente Barbearia Suspensa',
        email: 'suspensa@teste.com',
        senha: 'senha123',
        data_nascimento: '1990-01-01',
      });

    expect(resposta.status).toBe(404);
  });

  // Aninhado dentro do describe pai porque o `afterAll` acima fecha os pools
  // compartilhados (poolTenant, poolApp) -- um describe irmão rodaria depois
  // desse afterAll e falharia com "Cannot use a pool after calling end".
  // Mesma situação já resolvida na Task 1.
  describe('GET /clientes/me/assinatura', () => {
    afterEach(async () => {
      await limparBanco();
    });

    test('retorna a assinatura ativa do cliente logado, com dados do plano', async () => {
      const barbearia = await criarBarbearia('Barbearia Assinatura');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.assinatura@teste.com' });
      const plano = await criarPlanoDireto(barbearia.id, {
        nome: 'Plano Premium',
        valor_mensal: 149.9,
        vantagens: 'Cortes ilimitados\nBarba grátis\nDesconto em produtos',
      });
      await criarAssinaturaDireto(barbearia.id, cliente.id, plano.id);

      const token = jwt.sign(
        { id: cliente.id, tipo: 'cliente', barbearia_id: barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .get('/clientes/me/assinatura')
        .set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body.plano.nome).toBe('Plano Premium');
      expect(Number(resposta.body.plano.valor_mensal)).toBe(149.9);
      expect(resposta.body.plano.vantagens).toBe('Cortes ilimitados\nBarba grátis\nDesconto em produtos');
      expect(resposta.body.status).toBe('ativa');
    });

    test('retorna null quando o cliente não tem assinatura ativa', async () => {
      const barbearia = await criarBarbearia('Barbearia Sem Assinatura');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.sem.assinatura@teste.com' });

      const token = jwt.sign(
        { id: cliente.id, tipo: 'cliente', barbearia_id: barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .get('/clientes/me/assinatura')
        .set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toBeNull();
    });

    test('ignora assinatura cancelada, retornando null', async () => {
      const barbearia = await criarBarbearia('Barbearia Assinatura Cancelada');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.cancelada@teste.com' });
      const plano = await criarPlanoDireto(barbearia.id);
      await criarAssinaturaDireto(barbearia.id, cliente.id, plano.id, { status: 'cancelada' });

      const token = jwt.sign(
        { id: cliente.id, tipo: 'cliente', barbearia_id: barbearia.id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const resposta = await request(app)
        .get('/clientes/me/assinatura')
        .set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toBeNull();
    });
  });
});
