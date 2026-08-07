# App do Cliente Final — Agendamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o fluxo completo de agendamento do app do cliente final (unidade → profissional → serviços → horário → confirmação), a tela de "Agendamentos" (agendados/anteriores) e a Home com resumo de assinatura, incluindo os 3 endpoints de backend que faltam para viabilizar essas telas.

**Architecture:** Três rotas novas de leitura no backend (`GET /agendamentos/meus`, `GET /clientes/me/assinatura`, `GET /agendamentos/horarios-disponiveis-qualquer-barbeiro`), reaproveitando os middlewares (`verificarToken`, `escoparTenant`) e utilitários (`gerarSlotsDisponiveis`, `subtrairIntervalo`) já existentes. No frontend, três módulos de API novos (`agendamento.ts`, `catalogo.ts`, `assinatura.ts`) e três telas novas (`Home` reescrita, `NovoAgendamento`, `Agendamentos`), consumindo os Contexts de Auth/Tema já estabelecidos.

**Tech Stack:** Backend: Node.js/Express/pg (extensão de `agendamentoController.js`, novo `clienteController` endpoint). Frontend: React/TypeScript/React Router, CSS Modules.

## Global Constraints

- `cliente_id` em requisições de agendamento vindas do app do cliente sempre vem do JWT decodificado (`usuario.id` via `useAuth()`), nunca de input do usuário.
- `GET /agendamentos/meus` sempre filtra por `req.usuario.id` — ignora qualquer `cliente_id` que venha de fora (query/body), mesmo que enviado.
- "Agendados" = `status = 'confirmado' AND data_hora_inicio > now()`. "Anteriores" = qualquer outra combinação (`status != 'confirmado'` OR `data_hora_inicio <= now()`).
- O agendamento só é criado (`POST /agendamentos`) quando o cliente confirma explicitamente na tela de resumo (passo 5) — escolher um horário no passo 4 não cria nada ainda.
- A rota `GET /agendamentos/horarios-disponiveis-qualquer-barbeiro` reaproveita `gerarSlotsDisponiveis`/`subtrairIntervalo` de `src/utils/agenda.js` — não duplica essa lógica.
- Todas as rotas novas seguem o padrão de autorização já estabelecido no projeto: rotas autenticadas usam `verificarToken` + `escoparTenant` (nessa ordem); a rota de disponibilidade agregada é pública, seguindo o padrão de `listarHorariosDisponiveis` (resolve o tenant a partir da `unidade_id`, via conexão dedicada com `app.is_plataforma`).

---

## File Structure

```
Backend (barbearia-api/):
  Modificar:
    src/controllers/agendamentoController.js   -- adiciona listarMeusAgendamentos, listarHorariosDisponiveisQualquerBarbeiro
    src/controllers/clienteController.js        -- adiciona buscarMinhaAssinatura
    src/routes/agendamentoRoutes.js              -- adiciona as 2 rotas novas
    src/routes/clienteRoutes.js                  -- adiciona a rota nova
    tests/helpers/factories.js                   -- adiciona criarAssinaturaDireto, associarBarbeiroServico
    tests/integration/agendamento.test.js        -- testes das rotas novas
    tests/integration/cliente.test.js             -- teste da rota de assinatura

Frontend (barbearia-web/):
  Criar:
    src/api/agendamento.ts
    src/api/catalogo.ts
    src/api/assinatura.ts
    src/pages/NovoAgendamento.tsx
    src/pages/NovoAgendamento.module.css
    src/pages/Agendamentos.tsx
    src/pages/Agendamentos.module.css
  Modificar:
    src/pages/Home.tsx
    src/pages/Home.module.css
    src/App.tsx
```

Justificativa: as rotas novas de backend vivem nos controllers/arquivos de rota já existentes para o mesmo domínio (`agendamentoController.js`/`agendamentoRoutes.js` para agendamento; `clienteController.js`/`clienteRoutes.js` para a rota de assinatura, já que semanticamente é "dados do próprio cliente"). No frontend, cada `api/*.ts` isola um domínio de chamadas HTTP, seguindo o padrão já usado em `api/auth.ts`/`api/tema.ts`/`api/senha.ts`.

---

## Task 1: Backend — `GET /agendamentos/meus`

**Files:**
- Modify: `src/controllers/agendamentoController.js`
- Modify: `src/routes/agendamentoRoutes.js`
- Test: `tests/integration/agendamento.test.js`

**Interfaces:**
- Consumes: `req.db` (já escopado por RLS via `escoparTenant`), `req.usuario.id`/`req.usuario.tipo` (do JWT).
- Produces: `GET /agendamentos/meus?status=agendados|anteriores` (autenticado, cliente) → array de `{ ...agendamento, itens: [...], valor_total }`, mesmo formato de `criarAgendamento`. Consumido pela Task 4 (frontend `api/agendamento.ts`).

- [ ] **Step 1: Ler o teste de integração existente para confirmar o padrão de setup**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
head -40 tests/integration/agendamento.test.js
```

Confirme os imports de `limparBanco`, `criarBarbearia`, `criarClienteDireto`, `criarBarbeiroDireto`, `criarUnidadeDireto`, `criarServicoDireto` de `tests/helpers/db.js` e `tests/helpers/factories.js`, e como um JWT de cliente é montado nos testes já existentes (`jwt.sign({ id, tipo: 'cliente', barbearia_id }, process.env.JWT_SECRET, { expiresIn: '1h' })`).

- [ ] **Step 2: Escrever os testes (falha primeiro)**

Adicionar a `tests/integration/agendamento.test.js`, dentro do describe principal já existente (ou em um novo describe no mesmo arquivo):

```javascript
describe('GET /agendamentos/meus', () => {
  afterEach(async () => {
    await limparBanco();
  });

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
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/agendamento.test.js --detectOpenHandles
```

Expected: FAIL — a rota `/agendamentos/meus` não existe ainda (404 em todos os testes que esperam 200).

- [ ] **Step 4: Implementar `listarMeusAgendamentos` no controller**

Adicionar a `src/controllers/agendamentoController.js`, antes de `module.exports`:

```javascript
async function listarMeusAgendamentos(req, res) {
  const { status } = req.query;
  const clienteId = req.usuario.id;

  try {
    let filtroCondicao;
    let ordem;

    if (status === 'agendados') {
      filtroCondicao = `AND a.status = 'confirmado' AND a.data_hora_inicio > now()`;
      ordem = 'ASC';
    } else if (status === 'anteriores') {
      filtroCondicao = `AND (a.status != 'confirmado' OR a.data_hora_inicio <= now())`;
      ordem = 'DESC';
    } else {
      filtroCondicao = '';
      ordem = 'DESC';
    }

    const agendamentosResultado = await req.db.query(
      `SELECT a.* FROM agendamento a
       WHERE a.cliente_id = $1 ${filtroCondicao}
       ORDER BY a.data_hora_inicio ${ordem}`,
      [clienteId]
    );

    const agendamentosComItens = [];
    for (const agendamento of agendamentosResultado.rows) {
      const itensResultado = await req.db.query(
        'SELECT * FROM agendamento_servico WHERE agendamento_id = $1',
        [agendamento.id]
      );
      const itens = itensResultado.rows;
      const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);
      agendamentosComItens.push({ ...agendamento, itens, valor_total: valorTotal });
    }

    res.json(agendamentosComItens);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar agendamentos' });
  }
}
```

**Nota:** `filtroCondicao` é interpolado como string fixa (não vem de input do usuário — `status` só controla qual dos 2 blocos de texto fixo é usado, `clienteId` continua parametrizado com `$1`), então não há risco de SQL injection aqui.

Atualizar `module.exports` para incluir `listarMeusAgendamentos`.

- [ ] **Step 5: Adicionar a rota**

Editar `src/routes/agendamentoRoutes.js`:
```javascript
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
  reagendarAgendamento,
  listarMeusAgendamentos,
} = require('../controllers/agendamentoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.get('/meus', verificarToken, escoparTenant, listarMeusAgendamentos);
router.post('/', verificarToken, escoparTenant, criarAgendamento);
router.patch('/:id/cancelar', verificarToken, escoparTenant, cancelarAgendamento);
router.patch('/:id/concluir', verificarToken, escoparTenant, apenasAdmin, concluirAgendamento);
router.patch('/:id/reagendar', verificarToken, escoparTenant, reagendarAgendamento);
```

**Nota:** `/meus` precisa vir antes de qualquer rota com `:id` no Express só se houvesse conflito de padrão — aqui não há (`/meus` não colide com `/:id/cancelar` etc.), mas mantenha a ordem acima por clareza.

- [ ] **Step 6: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/agendamento.test.js --detectOpenHandles
```

Expected: todos os testes de `/agendamentos/meus` passam.

- [ ] **Step 7: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando, sem regressão.

- [ ] **Step 8: Commit**

```bash
git add src/controllers/agendamentoController.js src/routes/agendamentoRoutes.js tests/integration/agendamento.test.js
git commit -m "Adiciona rota GET /agendamentos/meus para o cliente"
```

---

## Task 2: Backend — `GET /clientes/me/assinatura`

**Files:**
- Modify: `src/controllers/clienteController.js`
- Modify: `src/routes/clienteRoutes.js`
- Modify: `tests/helpers/factories.js`
- Test: `tests/integration/cliente.test.js`

**Interfaces:**
- Consumes: `req.db`, `req.usuario.id`.
- Produces: `criarAssinaturaDireto(barbeariaId, clienteId, planoId, overrides = {})` em `tests/helpers/factories.js` (cria uma linha em `assinatura` diretamente, mesmo padrão de `criarPlanoDireto`). `GET /clientes/me/assinatura` (autenticado, cliente) → `200 null` ou `200 { id, plano: { nome, valor_mensal }, data_inicio, proxima_cobranca, status }`. Consumido pela Task 4 (frontend `api/assinatura.ts`).

- [ ] **Step 1: Ler `tests/helpers/factories.js` para confirmar o padrão de `criarPlanoDireto`**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
grep -n "criarPlanoDireto" -A 20 tests/helpers/factories.js
```

Confirme a assinatura exata (`barbearia_id`, `overrides` com `nome`, `valor_mensal`, `desconto_servico_fora_plano`, `intervalo_minimo_dias`) e o padrão de transação dedicada com `set_config('app.tenant_id', ...)`.

- [ ] **Step 2: Adicionar `criarAssinaturaDireto` a `tests/helpers/factories.js`**

Adicionar antes de `module.exports`, seguindo exatamente o padrão de `criarPlanoDireto`:

```javascript
// `assinatura` também tem RLS com FORCE ROW LEVEL SECURITY (migration 005).
async function criarAssinaturaDireto(barbearia_id, cliente_id, plano_id, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO assinatura (barbearia_id, cliente_id, plano_id, status, data_inicio, proxima_cobranca)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        barbearia_id,
        cliente_id,
        plano_id,
        overrides.status || 'ativa',
        overrides.data_inicio || new Date().toISOString().slice(0, 10),
        overrides.proxima_cobranca || null,
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
```

Atualizar `module.exports` para incluir `criarAssinaturaDireto`.

- [ ] **Step 3: Escrever os testes (falha primeiro)**

Ler `tests/integration/cliente.test.js` atual para confirmar o describe/imports já existentes, e adicionar:

```javascript
describe('GET /clientes/me/assinatura', () => {
  afterEach(async () => {
    await limparBanco();
  });

  test('retorna a assinatura ativa do cliente logado, com dados do plano', async () => {
    const barbearia = await criarBarbearia('Barbearia Assinatura');
    const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.assinatura@teste.com' });
    const plano = await criarPlanoDireto(barbearia.id, { nome: 'Plano Premium', valor_mensal: 149.9 });
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
```

Adicionar `criarPlanoDireto, criarAssinaturaDireto` ao import de `tests/helpers/factories.js` no topo do arquivo de teste, se ainda não estiverem importados.

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/cliente.test.js --detectOpenHandles
```

Expected: FAIL — a rota `/clientes/me/assinatura` não existe ainda.

- [ ] **Step 5: Implementar `buscarMinhaAssinatura` no controller**

Ler `src/controllers/clienteController.js` atual para confirmar o padrão (`req.db`, tratamento de erro), e adicionar antes de `module.exports`:

```javascript
async function buscarMinhaAssinatura(req, res) {
  const clienteId = req.usuario.id;

  try {
    const resultado = await req.db.query(
      `SELECT a.id, a.status, a.data_inicio, a.proxima_cobranca, p.nome AS plano_nome, p.valor_mensal
       FROM assinatura a
       JOIN plano p ON p.id = a.plano_id
       WHERE a.cliente_id = $1 AND a.status = 'ativa'`,
      [clienteId]
    );

    if (resultado.rows.length === 0) {
      return res.json(null);
    }

    const linha = resultado.rows[0];
    res.json({
      id: linha.id,
      status: linha.status,
      data_inicio: linha.data_inicio,
      proxima_cobranca: linha.proxima_cobranca,
      plano: { nome: linha.plano_nome, valor_mensal: linha.valor_mensal },
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar assinatura' });
  }
}
```

Atualizar `module.exports` para incluir `buscarMinhaAssinatura`.

- [ ] **Step 6: Adicionar a rota**

Editar `src/routes/clienteRoutes.js`:
```javascript
const express = require('express');
const router = express.Router();
const { listarClientes, buscarClientePorId, buscarMinhaAssinatura } = require('../controllers/clienteController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, apenasAdmin, listarClientes);
router.get('/me/assinatura', verificarToken, escoparTenant, buscarMinhaAssinatura);
router.get('/:id', verificarToken, escoparTenant, buscarClientePorId);

module.exports = router;
```

**Nota:** `/me/assinatura` precisa vir ANTES de `/:id` — senão o Express trataria `me` como um valor de `:id` e chamaria `buscarClientePorId` por engano.

- [ ] **Step 7: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/cliente.test.js --detectOpenHandles
```

Expected: todos os testes passam.

- [ ] **Step 8: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando.

- [ ] **Step 9: Commit**

```bash
git add src/controllers/clienteController.js src/routes/clienteRoutes.js tests/helpers/factories.js tests/integration/cliente.test.js
git commit -m "Adiciona rota GET /clientes/me/assinatura"
```

---

## Task 3: Backend — `GET /agendamentos/horarios-disponiveis-qualquer-barbeiro`

**Files:**
- Modify: `src/controllers/agendamentoController.js`
- Modify: `src/routes/agendamentoRoutes.js`
- Modify: `tests/helpers/factories.js`
- Test: `tests/integration/agendamento.test.js`

**Interfaces:**
- Consumes: `gerarSlotsDisponiveis`, `subtrairIntervalo`, `combinarDataHora` (já existentes em `src/utils/agenda.js`).
- Produces: `associarBarbeiroServico(barbeiroId, servicoId)` em `tests/helpers/factories.js` (insere em `barbeiro_servico`, tabela sem RLS própria — depende de `barbeiro_id`/`servico_id` já pertencerem ao tenant certo, sem necessidade de `set_config` já que a tabela não tem `barbearia_id` nem RLS — ver Step 1). `GET /agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=&servico_ids=&data=` (pública) → array de `{ inicio, fim_atendimento, barbeiro_id }`. Consumido pela Task 4 (frontend `api/agendamento.ts`).

- [ ] **Step 1: Confirmar o schema de `barbeiro_servico`**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
grep -n "CREATE TABLE barbeiro_servico" -A 6 migrations/000_schema_base.sql
grep -rn "barbeiro_servico" migrations/005_habilitar_rls.sql
```

Confirme se `barbeiro_servico` tem RLS habilitado (se sim, o helper de teste precisa do padrão de transação dedicada com `set_config`; se não, um INSERT direto via `pool.query` basta).

- [ ] **Step 2: Adicionar `associarBarbeiroServico` a `tests/helpers/factories.js`**

Se `barbeiro_servico` **não tiver** RLS (confirmado no Step 1):
```javascript
async function associarBarbeiroServico(barbeiro_id, servico_id) {
  await pool.query(
    'INSERT INTO barbeiro_servico (barbeiro_id, servico_id) VALUES ($1, $2)',
    [barbeiro_id, servico_id]
  );
}
```

Se **tiver** RLS, seguir o mesmo padrão de `criarBarbeiroDireto` (transação dedicada com `set_config('app.tenant_id', ...)`, recebendo `barbearia_id` como parâmetro adicional). Ajuste a assinatura da função conforme o que o Step 1 revelar — a chamada nos testes desta task assume a primeira forma (sem `barbearia_id`); se precisar da segunda forma, ajuste as chamadas no Step 4 de acordo.

Atualizar `module.exports` para incluir `associarBarbeiroServico`.

- [ ] **Step 3: Escrever os testes (falha primeiro)**

Adicionar a `tests/integration/agendamento.test.js`:

```javascript
describe('GET /agendamentos/horarios-disponiveis-qualquer-barbeiro', () => {
  afterEach(async () => {
    await limparBanco();
  });

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
    await pool.query(
      'INSERT INTO barbeiro_disponibilidade (barbeiro_id, dia_semana, hora_inicio, hora_fim) VALUES ($1, $2, $3, $4)',
      [barbeiroA.id, diaSemana, '08:00', '12:00']
    );

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
    await pool.query(
      'INSERT INTO barbeiro_disponibilidade (barbeiro_id, dia_semana, hora_inicio, hora_fim) VALUES ($1, $2, $3, $4)',
      [barbeiro.id, diaSemana, '08:00', '12:00']
    );

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
```

Adicionar `associarBarbeiroServico` ao import de `tests/helpers/factories.js` no topo de `tests/integration/agendamento.test.js`, e confirmar que `pool` (de `tests/helpers/db.js`) já está importado (necessário para os `INSERT INTO barbeiro_disponibilidade` diretos nos testes acima).

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/agendamento.test.js --detectOpenHandles
```

Expected: FAIL — a rota não existe ainda (404).

- [ ] **Step 5: Implementar `listarHorariosDisponiveisQualquerBarbeiro` no controller**

Adicionar a `src/controllers/agendamentoController.js`, reaproveitando a mesma lógica de janelas/exceções/agendamentos já usada em `listarHorariosDisponiveis`, mas iterando sobre múltiplos barbeiros candidatos:

```javascript
async function listarHorariosDisponiveisQualquerBarbeiro(req, res) {
  const { unidade_id, servico_ids: servicoIdsRaw, data } = req.query;

  if (!unidade_id || !servicoIdsRaw || !data) {
    return res.status(400).json({ erro: 'unidade_id, servico_ids e data são obrigatórios' });
  }

  const servicoIds = servicoIdsRaw.split(',').map((id) => Number(id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const unidadeResultado = await client.query('SELECT barbearia_id FROM unidade WHERE id = $1', [unidade_id]);
    if (unidadeResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Unidade não encontrada' });
    }
    const barbearia_id = unidadeResultado.rows[0].barbearia_id;

    await client.query("SELECT set_config('app.is_plataforma', '', true)");
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);

    // Barbeiros da unidade que atendem TODOS os serviços pedidos.
    const candidatosResultado = await client.query(
      `SELECT b.id, SUM(s.duracao_minutos) AS duracao_total
       FROM barbeiro b
       JOIN barbeiro_servico bs ON bs.barbeiro_id = b.id
       JOIN servico s ON s.id = bs.servico_id
       WHERE b.unidade_id = $1 AND b.ativo = true AND s.id = ANY($2::int[])
       GROUP BY b.id
       HAVING COUNT(DISTINCT bs.servico_id) = $3`,
      [unidade_id, servicoIds, servicoIds.length]
    );

    if (candidatosResultado.rows.length === 0) {
      await client.query('COMMIT');
      return res.json([]);
    }

    const duracaoServicos = Number(candidatosResultado.rows[0].duracao_total);
    const diaSemana = combinarDataHora(data, '00:00').getDay();
    const slotsPorHorario = new Map();

    for (const candidato of candidatosResultado.rows) {
      const barbeiro_id = candidato.id;

      const dispResultado = await client.query(
        'SELECT hora_inicio, hora_fim FROM barbeiro_disponibilidade WHERE barbeiro_id = $1 AND dia_semana = $2',
        [barbeiro_id, diaSemana]
      );

      let janelas = dispResultado.rows.map((linha) => ({
        inicio: combinarDataHora(data, linha.hora_inicio),
        fim: combinarDataHora(data, linha.hora_fim),
      }));

      const excResultado = await client.query(
        'SELECT tipo, hora_inicio, hora_fim FROM barbeiro_excecao WHERE barbeiro_id = $1 AND data = $2',
        [barbeiro_id, data]
      );

      for (const excecao of excResultado.rows) {
        if (excecao.tipo === 'folga_total') {
          janelas = [];
        } else if (excecao.tipo === 'horario_extra') {
          janelas.push({
            inicio: combinarDataHora(data, excecao.hora_inicio),
            fim: combinarDataHora(data, excecao.hora_fim),
          });
        } else if (excecao.tipo === 'bloqueio_parcial') {
          const bloqueio = {
            inicio: combinarDataHora(data, excecao.hora_inicio),
            fim: combinarDataHora(data, excecao.hora_fim),
          };
          janelas = subtrairIntervalo(janelas, bloqueio);
        }
      }

      const agResultado = await client.query(
        `SELECT data_hora_inicio, data_hora_fim FROM agendamento
         WHERE barbeiro_id = $1 AND data_hora_inicio::date = $2::date
         AND status IN ('confirmado', 'concluido')
         ORDER BY data_hora_inicio`,
        [barbeiro_id, data]
      );

      for (const agendamento of agResultado.rows) {
        const ocupado = {
          inicio: new Date(agendamento.data_hora_inicio),
          fim: new Date(agendamento.data_hora_fim),
        };
        janelas = subtrairIntervalo(janelas, ocupado);
      }

      const slots = gerarSlotsDisponiveis(janelas, duracaoServicos);

      for (const slot of slots) {
        const chave = slot.inicio.toISOString();
        // Primeiro barbeiro disponível encontrado para aquele horário "vence"
        // -- evita duplicar o mesmo horário uma vez por barbeiro candidato.
        if (!slotsPorHorario.has(chave)) {
          slotsPorHorario.set(chave, {
            inicio: slot.inicio.toISOString(),
            fim_atendimento: slot.fim_atendimento.toISOString(),
            barbeiro_id,
          });
        }
      }
    }

    await client.query('COMMIT');

    const slotsOrdenados = Array.from(slotsPorHorario.values()).sort((a, b) => a.inicio.localeCompare(b.inicio));
    res.json(slotsOrdenados);
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao calcular horários disponíveis' });
  } finally {
    client.release();
  }
}
```

Atualizar `module.exports` para incluir `listarHorariosDisponiveisQualquerBarbeiro`.

- [ ] **Step 6: Adicionar a rota**

Editar `src/routes/agendamentoRoutes.js`, adicionando ao import e às rotas:
```javascript
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
  reagendarAgendamento,
  listarMeusAgendamentos,
  listarHorariosDisponiveisQualquerBarbeiro,
} = require('../controllers/agendamentoController');

router.get('/horarios-disponiveis', listarHorariosDisponiveis);
router.get('/horarios-disponiveis-qualquer-barbeiro', listarHorariosDisponiveisQualquerBarbeiro);
router.get('/meus', verificarToken, escoparTenant, listarMeusAgendamentos);
```

- [ ] **Step 7: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/agendamento.test.js --detectOpenHandles
```

Expected: todos os testes passam.

- [ ] **Step 8: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando.

- [ ] **Step 9: Commit**

```bash
git add src/controllers/agendamentoController.js src/routes/agendamentoRoutes.js tests/helpers/factories.js tests/integration/agendamento.test.js
git commit -m "Adiciona rota de disponibilidade agregada (sem preferencia de barbeiro)"
```

---

## Task 4: Frontend — módulos de API (agendamento, catálogo, assinatura)

**Files:**
- Create: `barbearia-web/src/api/agendamento.ts`
- Create: `barbearia-web/src/api/catalogo.ts`
- Create: `barbearia-web/src/api/assinatura.ts`
- Test: `barbearia-web/src/api/agendamento.test.ts`

**Interfaces:**
- Consumes: `apiClient` de `api/client.ts` (já existe).
- Produces:
  - `listarMeusAgendamentos(status?: 'agendados' | 'anteriores'): Promise<Agendamento[]>`, `criarAgendamento(dados: NovoAgendamentoInput): Promise<Agendamento>`, `cancelarAgendamento(id: number): Promise<Agendamento>`, `buscarHorariosDisponiveis(barbeiroId: number, data: string, duracaoMinutos: number): Promise<Slot[]>`, `buscarHorariosDisponiveisQualquerBarbeiro(unidadeId: number, servicoIds: number[], data: string): Promise<SlotComBarbeiro[]>` em `api/agendamento.ts`.
  - `listarUnidades(): Promise<Unidade[]>`, `listarBarbeiros(): Promise<Barbeiro[]>`, `listarServicosDoBarbeiro(barbeiroId: number): Promise<Servico[]>`, `listarServicos(): Promise<Servico[]>` em `api/catalogo.ts`.
  - `buscarMinhaAssinatura(): Promise<Assinatura | null>` em `api/assinatura.ts`.
  - Todos os tipos (`Agendamento`, `Slot`, `SlotComBarbeiro`, `Unidade`, `Barbeiro`, `Servico`, `Assinatura`, `NovoAgendamentoInput`) exportados de seus respectivos módulos. Consumidos pelas Tasks 5, 6 e 7.

- [ ] **Step 1: Implementar `api/catalogo.ts`**

```typescript
import { apiClient } from './client';

export interface Unidade {
  id: number;
  nome: string;
  endereco: string | null;
  telefone: string | null;
}

export interface Barbeiro {
  id: number;
  nome: string;
  email: string | null;
  telefone: string | null;
  foto_url: string | null;
}

export interface Servico {
  id: number;
  nome: string;
  categoria: string;
  duracao_minutos: number;
  valor: number;
}

export function listarUnidades(): Promise<Unidade[]> {
  return apiClient.get<Unidade[]>('/unidades');
}

export function listarBarbeiros(): Promise<Barbeiro[]> {
  return apiClient.get<Barbeiro[]>('/barbeiros');
}

export function listarServicosDoBarbeiro(barbeiroId: number): Promise<Servico[]> {
  return apiClient.get<Servico[]>(`/barbeiros/${barbeiroId}/servicos`);
}

export function listarServicos(): Promise<Servico[]> {
  return apiClient.get<Servico[]>('/servicos');
}
```

- [ ] **Step 2: Implementar `api/assinatura.ts`**

```typescript
import { apiClient } from './client';

export interface Assinatura {
  id: number;
  status: string;
  data_inicio: string;
  proxima_cobranca: string | null;
  plano: { nome: string; valor_mensal: number };
}

export function buscarMinhaAssinatura(): Promise<Assinatura | null> {
  return apiClient.get<Assinatura | null>('/clientes/me/assinatura');
}
```

- [ ] **Step 3: Escrever o teste de `api/agendamento.ts` (falha primeiro)**

`barbearia-web/src/api/agendamento.test.ts`:
```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listarMeusAgendamentos,
  criarAgendamento,
  cancelarAgendamento,
  buscarHorariosDisponiveis,
  buscarHorariosDisponiveisQualquerBarbeiro,
} from './agendamento';
import { setToken } from './client';

describe('api/agendamento', () => {
  beforeEach(() => {
    setToken('token-fake');
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('listarMeusAgendamentos monta a query string de status corretamente', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarMeusAgendamentos('agendados');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/meus?status=agendados',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('listarMeusAgendamentos sem status não adiciona query string', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarMeusAgendamentos();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/meus',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('criarAgendamento envia POST com o corpo correto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const dados = {
      cliente_id: 1,
      barbeiro_id: 2,
      unidade_id: 3,
      data: '2026-08-10',
      hora_inicio: '10:00',
      servico_ids: [5, 6],
    };

    await criarAgendamento(dados);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dados) })
    );
  });

  test('cancelarAgendamento envia PATCH para a rota correta', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, status: 'cancelado' }),
    });

    await cancelarAgendamento(1);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/1/cancelar',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  test('buscarHorariosDisponiveis monta a query string correta', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await buscarHorariosDisponiveis(2, '2026-08-10', 30);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/horarios-disponiveis?barbeiro_id=2&data=2026-08-10&duracao_minutos=30',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('buscarHorariosDisponiveisQualquerBarbeiro monta a query string com servico_ids separados por vírgula', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await buscarHorariosDisponiveisQualquerBarbeiro(3, [5, 6], '2026-08-10');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=3&servico_ids=5,6&data=2026-08-10',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/api/agendamento.test.ts
```

Expected: FAIL — `./agendamento` não existe.

- [ ] **Step 5: Estender `apiClient` com o método PATCH**

Ler `barbearia-web/src/api/client.ts` atual (não modifique a lógica de `requisicao`, só o tipo aceito e o objeto exportado):

```typescript
async function requisicao<T>(
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH',
  caminho: string,
  corpo?: unknown
): Promise<T> {
  // ... corpo da função inalterado ...
}

export const apiClient = {
  get: <T>(caminho: string) => requisicao<T>('GET', caminho),
  post: <T>(caminho: string, corpo: unknown) => requisicao<T>('POST', caminho, corpo),
  put: <T>(caminho: string, corpo: unknown) => requisicao<T>('PUT', caminho, corpo),
  patch: <T>(caminho: string) => requisicao<T>('PATCH', caminho),
};
```

**Nota:** `patch` não recebe corpo porque `cancelarAgendamento` (`PATCH /agendamentos/:id/cancelar`) não precisa de body — se uma chamada futura precisar de corpo no PATCH, adicione o parâmetro então.

- [ ] **Step 6: Implementar `api/agendamento.ts`**

```typescript
import { apiClient } from './client';

export interface ItemAgendamento {
  id: number;
  servico_id: number;
  coberto_pelo_plano: boolean;
  valor_cobrado: number;
}

export interface Agendamento {
  id: number;
  cliente_id: number;
  barbeiro_id: number;
  unidade_id: number;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: string;
  itens: ItemAgendamento[];
  valor_total: number;
}

export interface NovoAgendamentoInput {
  cliente_id: number;
  barbeiro_id: number;
  unidade_id: number;
  data: string;
  hora_inicio: string;
  servico_ids: number[];
}

export interface Slot {
  inicio: string;
  fim_atendimento: string;
}

export interface SlotComBarbeiro extends Slot {
  barbeiro_id: number;
}

export function listarMeusAgendamentos(status?: 'agendados' | 'anteriores'): Promise<Agendamento[]> {
  const query = status ? `?status=${status}` : '';
  return apiClient.get<Agendamento[]>(`/agendamentos/meus${query}`);
}

export function criarAgendamento(dados: NovoAgendamentoInput): Promise<Agendamento> {
  return apiClient.post<Agendamento>('/agendamentos', dados);
}

export function cancelarAgendamento(id: number): Promise<Agendamento> {
  return apiClient.patch<Agendamento>(`/agendamentos/${id}/cancelar`);
}

export function buscarHorariosDisponiveis(
  barbeiroId: number,
  data: string,
  duracaoMinutos: number
): Promise<Slot[]> {
  return apiClient.get<Slot[]>(
    `/agendamentos/horarios-disponiveis?barbeiro_id=${barbeiroId}&data=${data}&duracao_minutos=${duracaoMinutos}`
  );
}

export function buscarHorariosDisponiveisQualquerBarbeiro(
  unidadeId: number,
  servicoIds: number[],
  data: string
): Promise<SlotComBarbeiro[]> {
  return apiClient.get<SlotComBarbeiro[]>(
    `/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=${unidadeId}&servico_ids=${servicoIds.join(',')}&data=${data}`
  );
}
```

- [ ] **Step 7: Rodar o teste de novo**

Run:
```bash
npx vitest run src/api/agendamento.test.ts
```

Expected: PASS em todos os testes.

- [ ] **Step 8: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes (novos e existentes) passam — nenhuma chamada anterior a `apiClient.post`/`get`/`put` deve quebrar, já que a mudança em `client.ts` só adiciona `patch`.

- [ ] **Step 9: Commit**

```bash
git add barbearia-web/src/api/agendamento.ts barbearia-web/src/api/agendamento.test.ts barbearia-web/src/api/catalogo.ts barbearia-web/src/api/assinatura.ts barbearia-web/src/api/client.ts
git commit -m "Adiciona modulos de API para agendamento, catalogo e assinatura"
```

---

## Task 5: Frontend — Home com assinatura e próximos agendamentos

**Files:**
- Modify: `barbearia-web/src/pages/Home.tsx`
- Modify: `barbearia-web/src/pages/Home.module.css`
- Test: `barbearia-web/src/pages/Home.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `useTema` (já existentes), `buscarMinhaAssinatura` de `api/assinatura.ts` (Task 4), `listarMeusAgendamentos` de `api/agendamento.ts` (Task 4).
- Produces: `Home` reescrita. Nenhuma interface nova exportada — é uma página, consumida só por `App.tsx` (já roteada).

- [ ] **Step 1: Ler `Home.tsx` e `Home.module.css` atuais**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api\barbearia-web"
cat src/pages/Home.tsx
cat src/pages/Home.module.css
```

Preserve o bloco de tema (`cardTema`/`amostraCor`/`temaRotulo`) e o botão "Sair" já existentes — esta task adiciona, não remove essas partes.

- [ ] **Step 2: Escrever o teste (falha primeiro)**

`barbearia-web/src/pages/Home.test.tsx`:
```tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { TemaProvider } from '../contexts/TemaContext';
import * as assinaturaApi from '../api/assinatura';
import * as agendamentoApi from '../api/agendamento';
import * as temaApi from '../api/tema';
import Home from './Home';

function renderHome() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <TemaProvider barbeariaId={1}>
          <Home />
        </TemaProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Home', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('mostra o plano ativo quando o cliente tem assinatura', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue({
      id: 1,
      status: 'ativa',
      data_inicio: '2026-01-01',
      proxima_cobranca: '2026-09-01',
      plano: { nome: 'Plano Premium', valor_mensal: 149.9 },
    });
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Plano Premium')).toBeInTheDocument();
    });
  });

  test('não mostra bloco de plano quando o cliente não tem assinatura', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderHome();

    await waitFor(() => {
      expect(agendamentoApi.listarMeusAgendamentos).toHaveBeenCalled();
    });
    expect(screen.queryByText(/plano/i)).not.toBeInTheDocument();
  });

  test('lista os próximos agendamentos', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([
      {
        id: 1,
        cliente_id: 1,
        barbeiro_id: 2,
        unidade_id: 3,
        data_hora_inicio: '2026-08-10T10:00:00.000Z',
        data_hora_fim: '2026-08-10T10:30:00.000Z',
        status: 'confirmado',
        itens: [],
        valor_total: 50,
      },
    ]);

    renderHome();

    await waitFor(() => {
      expect(agendamentoApi.listarMeusAgendamentos).toHaveBeenCalledWith('agendados');
    });
  });

  test('tem um link para novo agendamento', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderHome();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /novo agendamento/i })).toHaveAttribute('href', '/novo-agendamento');
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/pages/Home.test.tsx
```

Expected: FAIL — `Home.tsx` ainda não busca assinatura/agendamentos nem tem o link de novo agendamento.

- [ ] **Step 4: Reescrever `Home.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';
import { buscarMinhaAssinatura, type Assinatura } from '../api/assinatura';
import { listarMeusAgendamentos, type Agendamento } from '../api/agendamento';
import styles from './Home.module.css';

export default function Home() {
  const { usuario, sair } = useAuth();
  const { cores } = useTema();
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null);
  const [proximosAgendamentos, setProximosAgendamentos] = useState<Agendamento[]>([]);

  useEffect(() => {
    if (usuario?.tipo !== 'cliente') return;

    buscarMinhaAssinatura()
      .then(setAssinatura)
      .catch(() => setAssinatura(null));

    listarMeusAgendamentos('agendados')
      .then(setProximosAgendamentos)
      .catch(() => setProximosAgendamentos([]));
  }, [usuario]);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <h1 className={styles.saudacao}>Olá, {usuario?.nome}</h1>
        <p className={styles.papel}>{usuario?.tipo === 'admin' ? 'Administrador' : 'Cliente'}</p>
      </div>

      {cores && (
        <div className={styles.cardTema}>
          <span className={styles.amostraCor} style={{ backgroundColor: cores.cor_primaria }} />
          <p className={styles.tema}>
            <span className={styles.temaRotulo}>Cor da sua barbearia </span>
            {cores.cor_primaria}
          </p>
        </div>
      )}

      {usuario?.tipo === 'cliente' && (
        <>
          {assinatura && (
            <div className={styles.cardPlano}>
              <p className={styles.planoRotulo}>Seu plano</p>
              <p className={styles.planoNome}>{assinatura.plano.nome}</p>
              <p className={styles.planoValor}>
                R$ {Number(assinatura.plano.valor_mensal).toFixed(2)}/mês
              </p>
            </div>
          )}

          <div className={styles.secaoAgendamentos}>
            <div className={styles.secaoCabecalho}>
              <h2 className={styles.secaoTitulo}>Próximos agendamentos</h2>
              <Link className={styles.linkNovoAgendamento} to="/novo-agendamento">
                Novo agendamento
              </Link>
            </div>

            {proximosAgendamentos.length === 0 ? (
              <p className={styles.semAgendamentos}>Você ainda não tem agendamentos marcados.</p>
            ) : (
              <ul className={styles.listaAgendamentos}>
                {proximosAgendamentos.map((agendamento) => (
                  <li key={agendamento.id} className={styles.itemAgendamento}>
                    {new Date(agendamento.data_hora_inicio).toLocaleString('pt-BR')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <button className={styles.botaoSair} onClick={sair}>
        Sair
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Adicionar as classes novas a `Home.module.css`**

Adicionar ao final do arquivo (preservando tudo que já existe):
```css
.cardPlano {
  background: var(--plataforma-superficie);
  border: 1px solid var(--plataforma-borda);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}

.planoRotulo {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--plataforma-texto-secundario);
  margin-bottom: 0.375rem;
}

.planoNome {
  font-family: var(--fonte-display);
  font-size: 1.125rem;
  font-weight: 600;
}

.planoValor {
  font-size: 0.875rem;
  color: var(--plataforma-texto-secundario);
  margin-top: 0.25rem;
}

.secaoAgendamentos {
  margin-bottom: 2rem;
}

.secaoCabecalho {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.secaoTitulo {
  font-family: var(--fonte-display);
  font-size: 1rem;
  font-weight: 600;
}

.linkNovoAgendamento {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--plataforma-texto);
  text-decoration: none;
}

.linkNovoAgendamento:hover {
  text-decoration: underline;
}

.semAgendamentos {
  font-size: 0.875rem;
  color: var(--plataforma-texto-secundario);
}

.listaAgendamentos {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.itemAgendamento {
  background: var(--plataforma-superficie);
  border: 1px solid var(--plataforma-borda);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
}
```

- [ ] **Step 6: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/Home.test.tsx
```

Expected: PASS em todos os testes.

- [ ] **Step 7: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes passam.

- [ ] **Step 8: Commit**

```bash
git add barbearia-web/src/pages/Home.tsx barbearia-web/src/pages/Home.module.css barbearia-web/src/pages/Home.test.tsx
git commit -m "Adiciona plano ativo e proximos agendamentos na Home"
```

---

## Task 6: Frontend — Tela de Novo Agendamento (wizard de 5 passos)

**Files:**
- Create: `barbearia-web/src/pages/NovoAgendamento.tsx`
- Create: `barbearia-web/src/pages/NovoAgendamento.module.css`
- Test: `barbearia-web/src/pages/NovoAgendamento.test.tsx`
- Modify: `barbearia-web/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth` (já existe), `listarUnidades`/`listarBarbeiros`/`listarServicosDoBarbeiro`/`listarServicos` de `api/catalogo.ts` (Task 4), `buscarHorariosDisponiveis`/`buscarHorariosDisponiveisQualquerBarbeiro`/`criarAgendamento` de `api/agendamento.ts` (Task 4).
- Produces: rota `/novo-agendamento`. Consumida pela Task 5 (link já criado em `Home.tsx`).

- [ ] **Step 1: Escrever o teste do fluxo completo (falha primeiro)**

`barbearia-web/src/pages/NovoAgendamento.test.tsx`:
```tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import * as catalogoApi from '../api/catalogo';
import * as agendamentoApi from '../api/agendamento';
import { setToken } from '../api/client';
import NovoAgendamento from './NovoAgendamento';

function renderPagina() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <NovoAgendamento />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('NovoAgendamento', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setToken(null);
  });

  test('percorre os 5 passos e cria o agendamento com o cliente_id correto', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 1 })) +
      '.assinatura-fake';
    setToken(tokenFalso);

    vi.spyOn(catalogoApi, 'listarUnidades').mockResolvedValue([
      { id: 1, nome: 'Unidade Centro', endereco: null, telefone: null },
    ]);
    vi.spyOn(catalogoApi, 'listarBarbeiros').mockResolvedValue([
      { id: 2, nome: 'Barbeiro Teste', email: null, telefone: null, foto_url: null },
    ]);
    vi.spyOn(catalogoApi, 'listarServicosDoBarbeiro').mockResolvedValue([
      { id: 3, nome: 'Corte', categoria: 'cabelo', duracao_minutos: 30, valor: 50 },
    ]);
    vi.spyOn(agendamentoApi, 'buscarHorariosDisponiveis').mockResolvedValue([
      { inicio: '2026-08-10T10:00:00.000Z', fim_atendimento: '2026-08-10T10:30:00.000Z' },
    ]);
    const mockCriar = vi.spyOn(agendamentoApi, 'criarAgendamento').mockResolvedValue({
      id: 99,
      cliente_id: 7,
      barbeiro_id: 2,
      unidade_id: 1,
      data_hora_inicio: '2026-08-10T10:00:00.000Z',
      data_hora_fim: '2026-08-10T10:30:00.000Z',
      status: 'confirmado',
      itens: [],
      valor_total: 50,
    });

    renderPagina();

    // Passo 1: unidade
    await waitFor(() => expect(screen.getByText('Unidade Centro')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Unidade Centro'));

    // Passo 2: profissional
    await waitFor(() => expect(screen.getByText('Barbeiro Teste')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Barbeiro Teste'));

    // Passo 3: serviços
    await waitFor(() => expect(screen.getByText('Corte')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Corte'));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    // Passo 4: horário
    await waitFor(() => expect(screen.getByText(/10:00/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/10:00/));

    // Passo 5: confirmação
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    await waitFor(() => {
      expect(mockCriar).toHaveBeenCalledWith(
        expect.objectContaining({
          cliente_id: 7,
          barbeiro_id: 2,
          unidade_id: 1,
          servico_ids: [3],
        })
      );
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/pages/NovoAgendamento.test.tsx
```

Expected: FAIL — `./NovoAgendamento` não existe.

- [ ] **Step 3: Criar `NovoAgendamento.module.css`**

```css
.pagina {
  max-width: 28rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.titulo {
  font-family: var(--fonte-display);
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}

.lista {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.opcao {
  background: var(--plataforma-superficie);
  border: 1px solid var(--plataforma-borda);
  border-radius: 0.5rem;
  padding: 1rem;
  text-align: left;
  cursor: pointer;
  color: var(--plataforma-texto);
  font-size: 0.9375rem;
}

.opcao:hover {
  border-color: var(--plataforma-foco);
}

.opcaoSelecionada {
  border-color: var(--cor-primaria, var(--plataforma-foco));
}

.botao {
  width: 100%;
  background: var(--plataforma-texto);
  color: var(--plataforma-fundo);
  border: none;
  border-radius: 0.5rem;
  padding: 0.75rem;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}

.resumo {
  background: var(--plataforma-superficie);
  border: 1px solid var(--plataforma-borda);
  border-radius: 0.75rem;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}

.resumoLinha {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  padding: 0.375rem 0;
}

.erro {
  font-size: 0.8125rem;
  color: #f87171;
  margin-bottom: 1rem;
}
```

- [ ] **Step 4: Implementar `NovoAgendamento.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listarUnidades, listarBarbeiros, listarServicosDoBarbeiro, listarServicos, type Unidade, type Barbeiro, type Servico } from '../api/catalogo';
import {
  buscarHorariosDisponiveis,
  buscarHorariosDisponiveisQualquerBarbeiro,
  criarAgendamento,
  type Slot,
  type SlotComBarbeiro,
} from '../api/agendamento';
import styles from './NovoAgendamento.module.css';

type Passo = 'unidade' | 'profissional' | 'servicos' | 'horario' | 'confirmacao';

const SEM_PREFERENCIA_ID = -1;

export default function NovoAgendamento() {
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const [passo, setPasso] = useState<Passo>('unidade');
  const [erro, setErro] = useState<string | null>(null);

  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [unidadeId, setUnidadeId] = useState<number | null>(null);

  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [barbeiroId, setBarbeiroId] = useState<number | null>(null);

  const [servicosDisponiveis, setServicosDisponiveis] = useState<Servico[]>([]);
  const [servicoIdsSelecionados, setServicoIdsSelecionados] = useState<number[]>([]);

  const [horarios, setHorarios] = useState<(Slot | SlotComBarbeiro)[]>([]);
  const [horarioEscolhido, setHorarioEscolhido] = useState<Slot | SlotComBarbeiro | null>(null);

  useEffect(() => {
    listarUnidades().then(setUnidades).catch(() => setErro('Erro ao carregar unidades'));
  }, []);

  function aoEscolherUnidade(id: number) {
    setUnidadeId(id);
    setPasso('profissional');
    listarBarbeiros().then(setBarbeiros).catch(() => setErro('Erro ao carregar profissionais'));
  }

  function aoEscolherProfissional(id: number) {
    setBarbeiroId(id);
    setPasso('servicos');
    if (id === SEM_PREFERENCIA_ID) {
      listarServicos().then(setServicosDisponiveis).catch(() => setErro('Erro ao carregar serviços'));
    } else {
      listarServicosDoBarbeiro(id).then(setServicosDisponiveis).catch(() => setErro('Erro ao carregar serviços'));
    }
  }

  function alternarServico(id: number) {
    setServicoIdsSelecionados((atual) =>
      atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id]
    );
  }

  async function aoContinuarServicos() {
    if (!unidadeId || servicoIdsSelecionados.length === 0) return;
    setPasso('horario');
    const hoje = new Date().toISOString().slice(0, 10);
    const duracaoTotal = servicosDisponiveis
      .filter((s) => servicoIdsSelecionados.includes(s.id))
      .reduce((soma, s) => soma + s.duracao_minutos, 0);

    try {
      if (barbeiroId === SEM_PREFERENCIA_ID) {
        const slots = await buscarHorariosDisponiveisQualquerBarbeiro(unidadeId, servicoIdsSelecionados, hoje);
        setHorarios(slots);
      } else if (barbeiroId) {
        const slots = await buscarHorariosDisponiveis(barbeiroId, hoje, duracaoTotal);
        setHorarios(slots);
      }
    } catch {
      setErro('Erro ao buscar horários disponíveis');
    }
  }

  function aoEscolherHorario(slot: Slot | SlotComBarbeiro) {
    setHorarioEscolhido(slot);
    setPasso('confirmacao');
  }

  async function aoConfirmar() {
    if (!usuario || !unidadeId || !horarioEscolhido) return;

    const barbeiroFinal = 'barbeiro_id' in horarioEscolhido ? horarioEscolhido.barbeiro_id : barbeiroId;
    if (!barbeiroFinal) return;

    const dataHora = new Date(horarioEscolhido.inicio);
    const data = dataHora.toISOString().slice(0, 10);
    const horaInicio = dataHora.toISOString().slice(11, 16);

    try {
      await criarAgendamento({
        cliente_id: usuario.id,
        barbeiro_id: barbeiroFinal,
        unidade_id: unidadeId,
        data,
        hora_inicio: horaInicio,
        servico_ids: servicoIdsSelecionados,
      });
      navigate('/');
    } catch {
      setErro('Erro ao confirmar agendamento');
    }
  }

  const valorTotal = servicosDisponiveis
    .filter((s) => servicoIdsSelecionados.includes(s.id))
    .reduce((soma, s) => soma + Number(s.valor), 0);

  return (
    <div className={styles.pagina}>
      {erro && <p className={styles.erro}>{erro}</p>}

      {passo === 'unidade' && (
        <>
          <h1 className={styles.titulo}>Escolha a unidade</h1>
          <div className={styles.lista}>
            {unidades.map((unidade) => (
              <button key={unidade.id} className={styles.opcao} onClick={() => aoEscolherUnidade(unidade.id)}>
                {unidade.nome}
              </button>
            ))}
          </div>
        </>
      )}

      {passo === 'profissional' && (
        <>
          <h1 className={styles.titulo}>Escolha o profissional</h1>
          <div className={styles.lista}>
            <button className={styles.opcao} onClick={() => aoEscolherProfissional(SEM_PREFERENCIA_ID)}>
              Sem preferência
            </button>
            {barbeiros.map((barbeiro) => (
              <button key={barbeiro.id} className={styles.opcao} onClick={() => aoEscolherProfissional(barbeiro.id)}>
                {barbeiro.nome}
              </button>
            ))}
          </div>
        </>
      )}

      {passo === 'servicos' && (
        <>
          <h1 className={styles.titulo}>Escolha os serviços</h1>
          <div className={styles.lista}>
            {servicosDisponiveis.map((servico) => (
              <button
                key={servico.id}
                className={
                  servicoIdsSelecionados.includes(servico.id)
                    ? `${styles.opcao} ${styles.opcaoSelecionada}`
                    : styles.opcao
                }
                onClick={() => alternarServico(servico.id)}
              >
                {servico.nome} — R$ {Number(servico.valor).toFixed(2)}
              </button>
            ))}
          </div>
          <button className={styles.botao} onClick={aoContinuarServicos} disabled={servicoIdsSelecionados.length === 0}>
            Continuar
          </button>
        </>
      )}

      {passo === 'horario' && (
        <>
          <h1 className={styles.titulo}>Escolha o horário</h1>
          <div className={styles.lista}>
            {horarios.map((slot) => (
              <button key={slot.inicio} className={styles.opcao} onClick={() => aoEscolherHorario(slot)}>
                {new Date(slot.inicio).toLocaleString('pt-BR')}
              </button>
            ))}
          </div>
        </>
      )}

      {passo === 'confirmacao' && horarioEscolhido && (
        <>
          <h1 className={styles.titulo}>Confirme seu agendamento</h1>
          <div className={styles.resumo}>
            <div className={styles.resumoLinha}>
              <span>Data e hora</span>
              <span>{new Date(horarioEscolhido.inicio).toLocaleString('pt-BR')}</span>
            </div>
            <div className={styles.resumoLinha}>
              <span>Serviços</span>
              <span>{servicosDisponiveis.filter((s) => servicoIdsSelecionados.includes(s.id)).map((s) => s.nome).join(', ')}</span>
            </div>
            <div className={styles.resumoLinha}>
              <span>Total</span>
              <span>R$ {valorTotal.toFixed(2)}</span>
            </div>
          </div>
          <button className={styles.botao} onClick={aoConfirmar}>
            Confirmar
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Adicionar a rota em `App.tsx`**

Editar `barbearia-web/src/App.tsx`:
```tsx
import NovoAgendamento from './pages/NovoAgendamento';

// dentro de <Routes>, junto às demais rotas protegidas:
            <Route
              path="/novo-agendamento"
              element={
                <RotaProtegida>
                  <NovoAgendamento />
                </RotaProtegida>
              }
            />
```

- [ ] **Step 6: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/NovoAgendamento.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes passam.

- [ ] **Step 8: Type-check e build**

Run:
```bash
npx tsc -b
npx vite build
```

Expected: sem erros. Remova `dist/` depois (`rm -rf dist`).

- [ ] **Step 9: Commit**

```bash
git add barbearia-web/src/pages/NovoAgendamento.tsx barbearia-web/src/pages/NovoAgendamento.module.css barbearia-web/src/pages/NovoAgendamento.test.tsx barbearia-web/src/App.tsx
git commit -m "Adiciona fluxo de novo agendamento em 5 passos"
```

---

## Task 7: Frontend — Tela de Agendamentos (Agendados/Anteriores)

**Files:**
- Create: `barbearia-web/src/pages/Agendamentos.tsx`
- Create: `barbearia-web/src/pages/Agendamentos.module.css`
- Test: `barbearia-web/src/pages/Agendamentos.test.tsx`
- Modify: `barbearia-web/src/App.tsx`

**Interfaces:**
- Consumes: `listarMeusAgendamentos`, `cancelarAgendamento` de `api/agendamento.ts` (Task 4).
- Produces: rota `/agendamentos`.

- [ ] **Step 1: Escrever o teste (falha primeiro)**

`barbearia-web/src/pages/Agendamentos.test.tsx`:
```tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as agendamentoApi from '../api/agendamento';
import Agendamentos from './Agendamentos';

describe('Agendamentos', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('mostra a aba Agendados por padrão e lista os agendamentos', async () => {
    const mockListar = vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([
      {
        id: 1,
        cliente_id: 7,
        barbeiro_id: 2,
        unidade_id: 1,
        data_hora_inicio: '2026-08-10T10:00:00.000Z',
        data_hora_fim: '2026-08-10T10:30:00.000Z',
        status: 'confirmado',
        itens: [],
        valor_total: 50,
      },
    ]);

    render(
      <MemoryRouter>
        <Agendamentos />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockListar).toHaveBeenCalledWith('agendados');
    });
  });

  test('troca para a aba Anteriores ao clicar', async () => {
    const mockListar = vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Agendamentos />
      </MemoryRouter>
    );

    await waitFor(() => expect(mockListar).toHaveBeenCalledWith('agendados'));

    await userEvent.click(screen.getByRole('button', { name: /anteriores/i }));

    await waitFor(() => {
      expect(mockListar).toHaveBeenCalledWith('anteriores');
    });
  });

  test('cancela um agendamento confirmado ao clicar em cancelar', async () => {
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([
      {
        id: 1,
        cliente_id: 7,
        barbeiro_id: 2,
        unidade_id: 1,
        data_hora_inicio: '2026-08-10T10:00:00.000Z',
        data_hora_fim: '2026-08-10T10:30:00.000Z',
        status: 'confirmado',
        itens: [],
        valor_total: 50,
      },
    ]);
    const mockCancelar = vi.spyOn(agendamentoApi, 'cancelarAgendamento').mockResolvedValue({
      id: 1,
      cliente_id: 7,
      barbeiro_id: 2,
      unidade_id: 1,
      data_hora_inicio: '2026-08-10T10:00:00.000Z',
      data_hora_fim: '2026-08-10T10:30:00.000Z',
      status: 'cancelado',
      itens: [],
      valor_total: 50,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <Agendamentos />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await waitFor(() => {
      expect(mockCancelar).toHaveBeenCalledWith(1);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/pages/Agendamentos.test.tsx
```

Expected: FAIL — `./Agendamentos` não existe.

- [ ] **Step 3: Criar `Agendamentos.module.css`**

```css
.pagina {
  max-width: 28rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

.titulo {
  font-family: var(--fonte-display);
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
}

.abas {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.aba {
  flex: 1;
  background: var(--plataforma-fundo);
  border: 1px solid var(--plataforma-borda);
  border-radius: 0.5rem;
  padding: 0.625rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--plataforma-texto-secundario);
  cursor: pointer;
}

.abaAtiva {
  color: var(--plataforma-texto);
  border-color: var(--cor-primaria, var(--plataforma-foco));
}

.lista {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.card {
  background: var(--plataforma-superficie);
  border: 1px solid var(--plataforma-borda);
  border-radius: 0.75rem;
  padding: 1rem;
}

.data {
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.status {
  font-size: 0.75rem;
  color: var(--plataforma-texto-secundario);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.botaoCancelar {
  margin-top: 0.75rem;
  background: transparent;
  border: 1px solid var(--plataforma-borda);
  color: var(--plataforma-texto-secundario);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  cursor: pointer;
}

.vazio {
  font-size: 0.875rem;
  color: var(--plataforma-texto-secundario);
}
```

- [ ] **Step 4: Implementar `Agendamentos.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { listarMeusAgendamentos, cancelarAgendamento, type Agendamento } from '../api/agendamento';
import styles from './Agendamentos.module.css';

type Aba = 'agendados' | 'anteriores';

export default function Agendamentos() {
  const [aba, setAba] = useState<Aba>('agendados');
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);

  const carregar = useCallback((abaAtual: Aba) => {
    listarMeusAgendamentos(abaAtual)
      .then(setAgendamentos)
      .catch(() => setAgendamentos([]));
  }, []);

  useEffect(() => {
    carregar(aba);
  }, [aba, carregar]);

  async function aoCancelar(id: number) {
    if (!window.confirm('Tem certeza que deseja cancelar este agendamento?')) return;
    await cancelarAgendamento(id);
    carregar(aba);
  }

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>Agendamentos</h1>

      <div className={styles.abas}>
        <button
          className={aba === 'agendados' ? `${styles.aba} ${styles.abaAtiva}` : styles.aba}
          onClick={() => setAba('agendados')}
        >
          Agendados
        </button>
        <button
          className={aba === 'anteriores' ? `${styles.aba} ${styles.abaAtiva}` : styles.aba}
          onClick={() => setAba('anteriores')}
        >
          Anteriores
        </button>
      </div>

      {agendamentos.length === 0 ? (
        <p className={styles.vazio}>Nenhum agendamento nesta aba.</p>
      ) : (
        <div className={styles.lista}>
          {agendamentos.map((agendamento) => (
            <div key={agendamento.id} className={styles.card}>
              <p className={styles.data}>{new Date(agendamento.data_hora_inicio).toLocaleString('pt-BR')}</p>
              <p className={styles.status}>{agendamento.status}</p>
              {agendamento.status === 'confirmado' && (
                <button className={styles.botaoCancelar} onClick={() => aoCancelar(agendamento.id)}>
                  Cancelar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Adicionar a rota em `App.tsx`**

Editar `barbearia-web/src/App.tsx`:
```tsx
import Agendamentos from './pages/Agendamentos';

// dentro de <Routes>, junto às demais rotas protegidas:
            <Route
              path="/agendamentos"
              element={
                <RotaProtegida>
                  <Agendamentos />
                </RotaProtegida>
              }
            />
```

- [ ] **Step 6: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/Agendamentos.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes passam.

- [ ] **Step 8: Type-check e build**

Run:
```bash
npx tsc -b
npx vite build
```

Expected: sem erros. Remova `dist/` depois.

- [ ] **Step 9: Commit**

```bash
git add barbearia-web/src/pages/Agendamentos.tsx barbearia-web/src/pages/Agendamentos.module.css barbearia-web/src/pages/Agendamentos.test.tsx barbearia-web/src/App.tsx
git commit -m "Adiciona tela de agendamentos (agendados e anteriores)"
```

---

## Task 8: Verificação manual de ponta a ponta

**Files:** nenhum arquivo novo — task de verificação.

- [ ] **Step 1: Subir backend e frontend localmente**

Run (dois processos em background):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api" && node src/server.js
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api\barbearia-web" && npm run dev
```

- [ ] **Step 2: Popular dados de catálogo via script para a Barbearia Exemplo (id=1)**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(\"SELECT set_config('app.tenant_id', '1', true)\");

  const unidade = await client.query(
    \"INSERT INTO unidade (barbearia_id, nome, endereco, telefone) VALUES (1, 'Unidade Centro', 'Rua Teste, 100', '11999990000') RETURNING id\"
  );
  const unidadeId = unidade.rows[0].id;

  const barbeiro = await client.query(
    \"INSERT INTO barbeiro (barbearia_id, unidade_id, nome, email, telefone) VALUES (1, \$1, 'Barbeiro Teste E2E', 'barbeiro.e2e@teste.com', '11988880000') RETURNING id\",
    [unidadeId]
  );
  const barbeiroId = barbeiro.rows[0].id;

  const servico = await client.query(
    \"INSERT INTO servico (barbearia_id, nome, categoria, duracao_minutos, valor) VALUES (1, 'Corte Masculino', 'cabelo', 30, 50) RETURNING id\"
  );
  const servicoId = servico.rows[0].id;

  await client.query('INSERT INTO barbeiro_servico (barbeiro_id, servico_id) VALUES (\$1, \$2)', [barbeiroId, servicoId]);

  const diaSemana = new Date().getDay();
  await client.query(
    'INSERT INTO barbeiro_disponibilidade (barbeiro_id, dia_semana, hora_inicio, hora_fim) VALUES (\$1, \$2, \$3, \$4)',
    [barbeiroId, diaSemana, '08:00', '18:00']
  );

  await client.query('COMMIT');
  client.release();
  await pool.end();
  console.log({ unidadeId, barbeiroId, servicoId });
})();
"
```

Anote os ids retornados — usados no Step 3.

- [ ] **Step 3: Criar um cliente de teste e obter o token via login**

Run:
```bash
node -e "
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const senha_hash = await bcrypt.hash('senhaTeste123', 10);
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(\"SELECT set_config('app.tenant_id', '1', true)\");
  await client.query(
    \"INSERT INTO cliente (barbearia_id, nome, email, telefone, senha_hash) VALUES (1, 'Cliente E2E', 'cliente.e2e.agendamento@teste.com', '11977770000', \$1) ON CONFLICT (barbearia_id, email) DO UPDATE SET senha_hash = \$1\",
    [senha_hash]
  );
  await client.query('COMMIT');
  client.release();
  await pool.end();
  console.log('cliente pronto');
})();
"

curl -s -X POST http://localhost:3000/auth/cliente/login -H "Content-Type: application/json" -d '{"email":"cliente.e2e.agendamento@teste.com","senha":"senhaTeste123"}'
```

Anote o `token` retornado.

- [ ] **Step 4: Testar as 3 rotas novas via curl**

Run (substituindo `<TOKEN>` pelo token do Step 3):
```bash
curl -s http://localhost:3000/agendamentos/meus?status=agendados -H "Authorization: Bearer <TOKEN>"
curl -s http://localhost:3000/clientes/me/assinatura -H "Authorization: Bearer <TOKEN>"
curl -s "http://localhost:3000/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=<UNIDADE_ID>&servico_ids=<SERVICO_ID>&data=$(date +%Y-%m-%d)"
```

Expected: `/agendamentos/meus` retorna `[]` (nenhum agendamento ainda); `/clientes/me/assinatura` retorna `null`; a rota de disponibilidade agregada retorna uma lista de slots com `barbeiro_id`.

- [ ] **Step 5: Acessar o app no navegador e percorrer o fluxo completo**

Navegar para `http://localhost:5173/login`, logar com `cliente.e2e.agendamento@teste.com` / `senhaTeste123`. Confirmar:
1. A Home mostra "Você ainda não tem agendamentos marcados" e o link "Novo agendamento".
2. Clicar em "Novo agendamento" e percorrer os 5 passos (unidade → profissional → serviço → horário → confirmação).
3. Após confirmar, é redirecionado para a Home, que agora mostra o agendamento criado.
4. Navegar para `/agendamentos`, confirmar que aparece na aba "Agendados".
5. Clicar em "Cancelar", confirmar o modal, e verificar que o agendamento passa a aparecer em "Anteriores".

- [ ] **Step 6: Limpar os dados de teste**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(\"SELECT set_config('app.tenant_id', '1', true)\");
  await client.query(\"DELETE FROM cliente WHERE email = 'cliente.e2e.agendamento@teste.com'\");
  await client.query(\"DELETE FROM barbeiro WHERE email = 'barbeiro.e2e@teste.com'\");
  await client.query(\"DELETE FROM servico WHERE nome = 'Corte Masculino'\");
  await client.query(\"DELETE FROM unidade WHERE nome = 'Unidade Centro'\");
  await client.query('COMMIT');
  client.release();
  await pool.end();
})();
"
```

- [ ] **Step 7: Parar os servidores de dev**

Encerrar os processos `node src/server.js` e `npm run dev` iniciados no Step 1.

## Fora de escopo (lembrete)

Conforme spec: tela de cadastro de unidade/barbeiro/serviço (Fase 3), fluxo de compra/assinatura de plano pelo app, tela de reagendamento, notificações push, upload de foto de perfil, editor de tema com preview (Fase 3).
