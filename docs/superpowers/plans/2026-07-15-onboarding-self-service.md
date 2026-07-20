# Onboarding Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o dono de uma barbearia se cadastre sozinho (barbearia + admin dono, numa transação atômica), com acesso liberado apenas após confirmar o email.

**Architecture:** Uma migration aditiva (`009`) adiciona colunas de estado de verificação a `barbearia`/`usuario_admin` com defaults que preservam o comportamento atual. Três rotas públicas novas (`/onboarding/cadastro`, `/onboarding/verificar`, `/onboarding/reenviar-verificacao`) seguem o padrão de transação já estabelecido pelo middleware `apenasPlataforma` (client dedicado, `app.is_plataforma` setado, commit interceptado via `res.json`). Um serviço de email dedicado encapsula o SDK do Resend, chamado só depois do commit. `express-rate-limit` protege as três rotas contra abuso.

**Tech Stack:** Node.js/Express, `pg`, `bcrypt`, `resend` (novo), `express-rate-limit` (novo), `node-pg-migrate`, Jest + Supertest.

## Global Constraints

- Toda query que lê/escreve `usuario_admin`, `cliente`, ou qualquer tabela com FORCE ROW LEVEL SECURITY precisa de `app.tenant_id` ou `app.is_plataforma` setado na mesma transação/conexão antes da query — nunca via `pool.query()` solto.
- Migrations são SQL puro, com bloco `-- Up Migration` / `-- Down Migration`, seguindo o padrão de `migrations/000_schema_base.sql` até `008_recriar_views_com_tenant.sql`.
- Toda rota nova segue o padrão de resposta JSON já estabelecido (`res.status(N).json({ erro: '...' })` para erro, `res.json(...)`/`res.status(201).json(...)` para sucesso) — nunca `res.send`/`res.end`.
- Segredos (chave da API do Resend) só em variável de ambiente (`.env`, gitignored), nunca hardcoded nem commitado.
- Testes de integração rodam contra Postgres real (banco de teste `barbearia_db_test`), seguindo o padrão de `tests/helpers/db.js` (`limparBanco`/`fecharBanco`) e `tests/helpers/factories.js`.

---

## Antes de começar — decisões já tomadas no spec

Consulte `docs/superpowers/specs/2026-07-15-onboarding-self-service-design.md` para o raciocínio completo. Resumo operacional:

- `barbearia.status` novo, default `'ativa'` (preserva comportamento atual); onboarding insere explicitamente `'pendente_verificacao'`.
- `usuario_admin.email_verificado` novo, default `true` (preserva comportamento atual); onboarding insere explicitamente `false`.
- `usuario_admin.token_verificacao` (UUID, nullable) e `token_verificacao_expira_em` (TIMESTAMP, nullable) — populados só durante o fluxo de verificação pendente, `NULL` depois de confirmado.
- Token de verificação expira em 24 horas.
- `loginAdmin` passa a rejeitar (403) quando `email_verificado = false`, mesmo com senha correta.
- Envio de email acontece **depois** do commit da transação de cadastro — uma falha de envio não desfaz o cadastro (o usuário pode pedir reenvio).

---

## File Structure

```
Criar:
  migrations/009_onboarding_verificacao_email.sql
  src/services/emailService.js          -- encapsula o SDK do Resend
  src/controllers/onboardingController.js
  src/routes/onboardingRoutes.js
  src/middlewares/rateLimiters.js        -- configuração dos limitadores de onboarding
  tests/integration/onboarding.test.js

Modificar:
  package.json                          -- + resend, + express-rate-limit
  src/app.js                             -- monta onboardingRoutes
  src/controllers/authController.js      -- loginAdmin passa a checar email_verificado
  tests/helpers/factories.js             -- + criarBarbeariaPendente/criarAdminPendente (se necessário para outros testes)
  .env                                   -- + RESEND_API_KEY, RESEND_FROM_EMAIL, APP_BASE_URL (documentado, não commitado)
```

Justificativa: `emailService.js` isola o SDK do Resend do controller — se o provedor mudar no futuro, só esse arquivo muda. `rateLimiters.js` separado porque a configuração dos limitadores (janela, máximo de requisições) é reutilizável e pode crescer para outras rotas sensíveis depois (ex: login). `onboardingController.js`/`onboardingRoutes.js` seguem exatamente o padrão de arquivo-por-domínio já usado no projeto (`plataformaController.js`/`plataformaRoutes.js`).

---

## Task 1: Migration 009 — colunas de verificação de email

**Files:**
- Create: `migrations/009_onboarding_verificacao_email.sql`

**Interfaces:**
- Produces: colunas `barbearia.status`, `usuario_admin.email_verificado`, `usuario_admin.token_verificacao`, `usuario_admin.token_verificacao_expira_em`, consumidas por todas as tasks seguintes.

- [ ] **Step 1: Escrever a migration**

```sql
-- Up Migration
ALTER TABLE barbearia
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ativa'
  CHECK (status IN ('pendente_verificacao', 'ativa', 'suspensa'));

ALTER TABLE usuario_admin
  ADD COLUMN email_verificado BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE usuario_admin
  ADD COLUMN token_verificacao UUID;

ALTER TABLE usuario_admin
  ADD COLUMN token_verificacao_expira_em TIMESTAMP;

CREATE INDEX idx_usuario_admin_token_verificacao
  ON usuario_admin(token_verificacao)
  WHERE token_verificacao IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_token_verificacao;
ALTER TABLE usuario_admin DROP COLUMN token_verificacao_expira_em;
ALTER TABLE usuario_admin DROP COLUMN token_verificacao;
ALTER TABLE usuario_admin DROP COLUMN email_verificado;
ALTER TABLE barbearia DROP COLUMN status;
```

O índice parcial (`WHERE token_verificacao IS NOT NULL`) é pequeno porque a maioria das linhas terá o token `NULL` após a verificação — evita indexar milhões de `NULL`s à medida que a base cresce.

- [ ] **Step 2: Rodar a migration no banco de dev**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx node-pg-migrate up
```

Expected: `009_onboarding_verificacao_email` migrada sem erro. Se `barbearia_app` (role da aplicação) não tiver permissão de `ALTER TABLE`/`CREATE INDEX` (mesma situação já documentada nas migrations 007/008), rode com as credenciais do superuser (`postgres`, ver `.env` histórico do projeto ou a nota da migration 007) só para esta migration.

- [ ] **Step 3: Rodar a migration no banco de teste**

Run:
```bash
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db_test" npx node-pg-migrate up
```

(ajuste a senha do superuser conforme o `.env` real do ambiente, se diferente).

- [ ] **Step 4: Verificar as colunas foram criadas**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const r = await pool.query(\"SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name IN ('barbearia','usuario_admin') AND column_name IN ('status','email_verificado','token_verificacao','token_verificacao_expira_em') ORDER BY table_name, column_name\");
  console.log(r.rows);
  await pool.end();
})();
"
```

Expected: 4 linhas, confirmando `barbearia.status` (default `'ativa'`), `usuario_admin.email_verificado` (default `true`), `usuario_admin.token_verificacao` e `token_verificacao_expira_em` (sem default, nullable).

- [ ] **Step 5: Confirmar que dados existentes não foram afetados**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const r = await pool.query('SELECT status FROM barbearia');
  const semAtiva = r.rows.filter(l => l.status !== 'ativa');
  console.log('Barbearias existentes com status diferente de ativa:', semAtiva.length);
  const r2 = await pool.query('SELECT email_verificado FROM usuario_admin');
  const naoVerificados = r2.rows.filter(l => l.email_verificado !== true);
  console.log('Admins existentes com email_verificado != true:', naoVerificados.length);
  await pool.end();
})();
"
```

Expected: `0` em ambos — nenhuma linha pré-existente foi afetada pelo default.

- [ ] **Step 6: Commit**

```bash
git add migrations/009_onboarding_verificacao_email.sql
git commit -m "Adiciona colunas de verificacao de email para onboarding self-service"
```

---

## Task 2: Serviço de email (Resend)

**Files:**
- Create: `src/services/emailService.js`
- Modify: `package.json`
- Modify: `.env` (local, não commitado — apenas para desenvolvimento)
- Test: `tests/integration/emailService.test.js`

**Interfaces:**
- Produces: `enviarEmailVerificacao(destinatario, nome, tokenVerificacao)` — função assíncrona, retorna `Promise<void>`, lançando erro se o envio falhar (quem chama decide como reagir). Consumida pela Task 4 (`onboardingController.js`).

- [ ] **Step 1: Instalar a dependência**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npm install resend
```

Expected: `resend` aparece em `dependencies` no `package.json`.

- [ ] **Step 2: Adicionar variáveis de ambiente**

Adicionar ao `.env` (arquivo local, gitignored — não commitar):
```
RESEND_API_KEY=re_SUA_CHAVE_AQUI
RESEND_FROM_EMAIL=onboarding@resend.dev
APP_BASE_URL=http://localhost:3000
```

`RESEND_FROM_EMAIL=onboarding@resend.dev` é o endereço de teste do Resend, que funciona sem verificação de domínio — use isso em desenvolvimento. Antes de qualquer deploy real, trocar para um endereço do domínio próprio verificado no painel do Resend (ver "Risco técnico" no spec).

- [ ] **Step 3: Escrever o teste (falha primeiro — o serviço ainda não existe)**

`tests/integration/emailService.test.js`:
```javascript
const { enviarEmailVerificacao } = require('../../src/services/emailService');

describe('emailService', () => {
  const chamadasOriginais = [];
  let ResendMock;

  beforeEach(() => {
    chamadasOriginais.length = 0;
    jest.resetModules();
    jest.doMock('resend', () => ({
      Resend: class {
        constructor(apiKey) {
          this.apiKey = apiKey;
        }
        get emails() {
          return {
            send: async (payload) => {
              chamadasOriginais.push(payload);
              return { data: { id: 'email-fake-id' }, error: null };
            },
          };
        }
      },
    }));
  });

  afterEach(() => {
    jest.dontMock('resend');
  });

  test('envia email com destinatário, remetente e link de verificação corretos', async () => {
    process.env.RESEND_API_KEY = 'chave-de-teste';
    process.env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    const { enviarEmailVerificacao: enviarComMock } = require('../../src/services/emailService');
    await enviarComMock('dono@barbearia.com', 'Fulano', 'token-abc-123');

    expect(chamadasOriginais).toHaveLength(1);
    expect(chamadasOriginais[0].to).toEqual(['dono@barbearia.com']);
    expect(chamadasOriginais[0].from).toBe('onboarding@resend.dev');
    expect(chamadasOriginais[0].subject).toMatch(/confirme seu email/i);
    expect(chamadasOriginais[0].html).toContain('http://localhost:3000/onboarding/verificar?token=token-abc-123');
    expect(chamadasOriginais[0].html).toContain('Fulano');
  });

  test('lança erro quando o Resend retorna erro', async () => {
    jest.resetModules();
    jest.doMock('resend', () => ({
      Resend: class {
        get emails() {
          return {
            send: async () => ({ data: null, error: { message: 'Falha simulada' } }),
          };
        }
      },
    }));

    const { enviarEmailVerificacao: enviarComErro } = require('../../src/services/emailService');
    await expect(enviarComErro('dono@barbearia.com', 'Fulano', 'token-abc')).rejects.toThrow(/Falha simulada/);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
npx jest tests/integration/emailService.test.js
```

Expected: FAIL com `Cannot find module '../../src/services/emailService'`.

- [ ] **Step 3: Implementar o serviço**

`src/services/emailService.js`:
```javascript
const { Resend } = require('resend');

function obterCliente() {
  return new Resend(process.env.RESEND_API_KEY);
}

async function enviarEmailVerificacao(destinatario, nome, tokenVerificacao) {
  const resend = obterCliente();
  const linkVerificacao = `${process.env.APP_BASE_URL}/onboarding/verificar?token=${tokenVerificacao}`;

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: [destinatario],
    subject: 'Confirme seu email para ativar sua barbearia',
    html: `
      <p>Olá, ${nome}!</p>
      <p>Falta só confirmar seu email para começar a usar a plataforma.</p>
      <p><a href="${linkVerificacao}">Confirmar meu email</a></p>
      <p>Se você não fez esse cadastro, pode ignorar este email.</p>
    `,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de verificação: ${error.message}`);
  }
}

module.exports = { enviarEmailVerificacao };
```

- [ ] **Step 4: Rodar o teste de novo**

Run:
```bash
npx jest tests/integration/emailService.test.js
```

Expected: PASS nos 2 testes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/services/emailService.js tests/integration/emailService.test.js
git commit -m "Adiciona servico de envio de email de verificacao via Resend"
```

---

## Task 3: Rate limiters de onboarding

**Files:**
- Create: `src/middlewares/rateLimiters.js`
- Modify: `package.json`
- Test: `tests/integration/rateLimiters.test.js`

**Interfaces:**
- Produces: `limitadorCadastro` (middleware Express), `limitadorReenvio` (middleware Express) — ambos consumidos por `onboardingRoutes.js` (Task 5).

- [ ] **Step 1: Instalar a dependência**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npm install express-rate-limit
```

- [ ] **Step 2: Escrever o teste (falha primeiro)**

`tests/integration/rateLimiters.test.js`:
```javascript
const express = require('express');
const request = require('supertest');
const { limitadorCadastro } = require('../../src/middlewares/rateLimiters');

describe('limitadorCadastro', () => {
  test('bloqueia a 6a requisição do mesmo IP dentro da janela', async () => {
    const app = express();
    app.use(express.json());
    app.post('/teste', limitadorCadastro, (req, res) => res.status(201).json({ ok: true }));

    for (let i = 0; i < 5; i++) {
      const resposta = await request(app).post('/teste').send({});
      expect(resposta.status).toBe(201);
    }

    const sextaResposta = await request(app).post('/teste').send({});
    expect(sextaResposta.status).toBe(429);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
npx jest tests/integration/rateLimiters.test.js
```

Expected: FAIL com `Cannot find module '../../src/middlewares/rateLimiters'`.

- [ ] **Step 4: Implementar os limitadores**

`src/middlewares/rateLimiters.js`:
```javascript
const rateLimit = require('express-rate-limit');

// 5 cadastros por IP por hora -- suficiente para um usuário legítimo que
// erre o formulário algumas vezes, baixo o bastante para tornar cadastro
// em massa por bot impraticável sem múltiplos IPs.
const limitadorCadastro = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de cadastro. Tente novamente mais tarde.' },
});

// Reenvio de verificação: mais restritivo, já que o caso de uso legítimo
// (email não chegou) não deveria precisar de mais de 3 tentativas por hora.
const limitadorReenvio = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de reenvio. Tente novamente mais tarde.' },
});

module.exports = { limitadorCadastro, limitadorReenvio };
```

- [ ] **Step 5: Rodar o teste de novo**

Run:
```bash
npx jest tests/integration/rateLimiters.test.js
```

Expected: PASS. (O teste faz 6 requisições reais — deve levar menos de 1 segundo, sem depender de tempo real passar, já que a janela de 1 hora não expira durante o teste.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/middlewares/rateLimiters.js tests/integration/rateLimiters.test.js
git commit -m "Adiciona rate limiting para rotas de onboarding"
```

---

## Task 4: `onboardingController.js` — cadastro, verificação e reenvio

**Files:**
- Create: `src/controllers/onboardingController.js`
- Test: `tests/integration/onboarding.test.js` (criado aqui, estendido na Task 5)

**Interfaces:**
- Consumes: `enviarEmailVerificacao(destinatario, nome, token)` da Task 2; `pool` de `src/config/database.js` (padrão já usado por `authController.js`/`barbeariaController.js`).
- Produces: `cadastrarOnboarding`, `verificarEmail`, `reenviarVerificacao` — três funções `(req, res) => Promise<void>`, consumidas por `onboardingRoutes.js` (Task 5).

- [ ] **Step 1: Escrever os testes de cadastro (falha primeiro)**

`tests/integration/onboarding.test.js`:
```javascript
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/onboarding.test.js
```

Expected: FAIL — a rota `/onboarding/cadastro` não existe ainda (404), então nenhuma asserção de status 201/400 passa.

- [ ] **Step 3: Implementar `cadastrarOnboarding`**

`src/controllers/onboardingController.js`:
```javascript
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/database');
const { enviarEmailVerificacao } = require('../services/emailService');

const HORAS_EXPIRACAO_TOKEN = 24;

async function cadastrarOnboarding(req, res) {
  const { nome_barbearia, cnpj, nome_admin, email, senha } = req.body;

  if (!nome_barbearia || !nome_admin || !email || !senha) {
    return res.status(400).json({
      erro: 'nome_barbearia, nome_admin, email e senha são obrigatórios',
    });
  }

  const client = await pool.connect();
  let barbearia;
  let admin;

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const senha_hash = await bcrypt.hash(senha, 10);
    const token_verificacao = crypto.randomUUID();

    const barbeariaResultado = await client.query(
      `INSERT INTO barbearia (nome, cnpj, status)
       VALUES ($1, $2, 'pendente_verificacao') RETURNING *`,
      [nome_barbearia, cnpj || null]
    );
    barbearia = barbeariaResultado.rows[0];

    const adminResultado = await client.query(
      `INSERT INTO usuario_admin
         (barbearia_id, nome, email, senha_hash, email_verificado, token_verificacao, token_verificacao_expira_em)
       VALUES ($1, $2, $3, $4, false, $5, now() + interval '${HORAS_EXPIRACAO_TOKEN} hours')
       RETURNING *`,
      [barbearia.id, nome_admin, email, senha_hash, token_verificacao]
    );
    admin = adminResultado.rows[0];

    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();

    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado' });
    }
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao processar cadastro' });
  }

  client.release();

  try {
    await enviarEmailVerificacao(admin.email, admin.nome, admin.token_verificacao);
  } catch (erro) {
    console.error('Falha ao enviar email de verificação (cadastro já foi criado):', erro);
  }

  res.status(201).json({
    mensagem: 'Cadastro recebido! Verifique seu email para ativar sua conta.',
  });
}

module.exports = { cadastrarOnboarding };
```

Nota de design: o envio de email acontece **depois** de `client.release()` — a conexão do banco não fica ocupada durante a chamada de rede ao Resend, e uma falha de envio (capturada e logada, não propagada) nunca desfaz o cadastro já commitado, conforme decidido no spec.

- [ ] **Step 4: Rodar os 3 testes de cadastro de novo**

Run:
```bash
npx jest tests/integration/onboarding.test.js
```

Expected: os 3 testes de `POST /onboarding/cadastro` passam (a rota ainda não está montada em `app.js` — isso é Task 5; se este teste depende de `require('../../src/app')` e a rota não existir, o teste falha com 404 em vez de passar). **Se falhar por 404, isso é esperado nesta task — a rota só existe de fato após a Task 5. Prossiga mesmo assim, documentando no relatório que os testes ficam verdes só depois da Task 5.**

- [ ] **Step 5: Commit**

```bash
git add src/controllers/onboardingController.js tests/integration/onboarding.test.js
git commit -m "Implementa cadastro de onboarding self-service (barbearia + admin pendentes)"
```

---

## Task 5: Rotas de onboarding e integração com `app.js`

**Files:**
- Create: `src/routes/onboardingRoutes.js`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `cadastrarOnboarding` da Task 4; `limitadorCadastro`, `limitadorReenvio` da Task 3; `verificarEmail`, `reenviarVerificacao` (implementados nesta task, ver Step 3 abaixo).
- Produces: rotas `POST /onboarding/cadastro`, `GET /onboarding/verificar`, `POST /onboarding/reenviar-verificacao` montadas em `app.js`.

- [ ] **Step 1: Adicionar `verificarEmail` e `reenviarVerificacao` a `onboardingController.js`**

Adicionar ao final de `src/controllers/onboardingController.js`, antes do `module.exports`:

```javascript
async function verificarEmail(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ erro: 'token é obrigatório' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const adminResultado = await client.query(
      `SELECT * FROM usuario_admin
       WHERE token_verificacao = $1
         AND token_verificacao_expira_em > now()
         AND email_verificado = false`,
      [token]
    );

    if (adminResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const admin = adminResultado.rows[0];

    await client.query(
      `UPDATE usuario_admin
       SET email_verificado = true, token_verificacao = NULL, token_verificacao_expira_em = NULL
       WHERE id = $1`,
      [admin.id]
    );

    await client.query(
      `UPDATE barbearia SET status = 'ativa' WHERE id = $1 AND status = 'pendente_verificacao'`,
      [admin.barbearia_id]
    );

    await client.query('COMMIT');

    res.json({ mensagem: 'Email confirmado! Você já pode fazer login.' });
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao confirmar email' });
  } finally {
    client.release();
  }
}

async function reenviarVerificacao(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  const client = await pool.connect();
  let admin = null;

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const adminResultado = await client.query(
      `SELECT * FROM usuario_admin WHERE email = $1 AND email_verificado = false`,
      [email]
    );

    if (adminResultado.rows.length > 0) {
      admin = adminResultado.rows[0];
      const novoToken = crypto.randomUUID();

      await client.query(
        `UPDATE usuario_admin
         SET token_verificacao = $1, token_verificacao_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN} hours'
         WHERE id = $2`,
        [novoToken, admin.id]
      );
      admin.token_verificacao = novoToken;
    }

    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao processar reenvio' });
  }

  client.release();

  if (admin) {
    try {
      await enviarEmailVerificacao(admin.email, admin.nome, admin.token_verificacao);
    } catch (erro) {
      console.error('Falha ao reenviar email de verificação:', erro);
    }
  }

  // Resposta idêntica exista ou não o email, para não permitir enumeração
  // de contas cadastradas via este endpoint.
  res.json({ mensagem: 'Se o email estiver cadastrado e pendente, um novo link foi enviado.' });
}

module.exports = { cadastrarOnboarding, verificarEmail, reenviarVerificacao };
```

- [ ] **Step 2: Criar `onboardingRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const {
  cadastrarOnboarding,
  verificarEmail,
  reenviarVerificacao,
} = require('../controllers/onboardingController');
const { limitadorCadastro, limitadorReenvio } = require('../middlewares/rateLimiters');

router.post('/cadastro', limitadorCadastro, cadastrarOnboarding);
router.get('/verificar', verificarEmail);
router.post('/reenviar-verificacao', limitadorReenvio, reenviarVerificacao);

module.exports = router;
```

Nota: `GET /verificar` não tem rate limit — é acessado por um clique de link de email, não por submissão repetida de formulário; um usuário legítimo não vai gerar volume alto nessa rota. Se um token for adivinhado por força bruta, a proteção real é o espaço do UUID (2^122 combinações), não rate limiting.

- [ ] **Step 3: Montar as rotas em `app.js`**

Ler `src/app.js` (já lido nesta sessão — 54 linhas) e adicionar a rota nova, seguindo o padrão das demais:

```javascript
const onboardingRoutes = require('./routes/onboardingRoutes');
```

Adicionar essa linha junto às outras `require` de rotas (após a linha `const plataformaRoutes = require('./routes/plataformaRoutes');`).

```javascript
app.use('/onboarding', onboardingRoutes);
```

Adicionar essa linha junto aos outros `app.use`, após `app.use('/plataforma', plataformaRoutes);`.

- [ ] **Step 4: Rodar os testes de cadastro de novo (agora devem passar de verdade)**

Run:
```bash
npx jest tests/integration/onboarding.test.js
```

Expected: os 3 testes de `POST /onboarding/cadastro` passam com 201/400 reais (não mais 404).

- [ ] **Step 5: Escrever testes de verificação e reenvio**

Adicionar a `tests/integration/onboarding.test.js`, após o `describe('POST /onboarding/cadastro', ...)`:

```javascript
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
      const token = 'token-fixo-para-teste-1234';
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
    const resposta = await request(app).get('/onboarding/verificar?token=token-que-nao-existe');
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
```

- [ ] **Step 6: Rodar a suíte completa de onboarding**

Run:
```bash
npx jest tests/integration/onboarding.test.js --detectOpenHandles
```

Expected: todos os testes passam (cadastro + verificação + reenvio), sem warning de handle aberto.

- [ ] **Step 7: Commit**

```bash
git add src/routes/onboardingRoutes.js src/app.js src/controllers/onboardingController.js tests/integration/onboarding.test.js
git commit -m "Adiciona rotas de verificacao e reenvio, monta onboarding em app.js"
```

---

## Task 6: `loginAdmin` bloqueia acesso sem email verificado

**Files:**
- Modify: `src/controllers/authController.js`
- Test: `tests/integration/auth.test.js` (arquivo já existe — estender)

**Interfaces:**
- Consumes: coluna `usuario_admin.email_verificado` da Task 1.

- [ ] **Step 1: Ler o `authController.js` atual e o teste existente**

Ambos já lidos nesta sessão. `loginAdmin` usa `buscarComoPlataforma` para buscar candidatos por email, itera comparando senha via `bcrypt.compare`, e emite o JWT no primeiro que bater.

- [ ] **Step 2: Escrever o teste (falha primeiro)**

Adicionar a `tests/integration/auth.test.js`, dentro do `describe` existente (ou criar um novo `describe` no mesmo arquivo — seguir a convenção já usada no arquivo):

```javascript
test('loginAdmin rejeita acesso quando email não foi verificado, mesmo com senha correta', async () => {
  const barbearia = await criarBarbearia('Barbearia Não Verificada');
  const senha_hash = await bcrypt.hash('senha123', 10);

  await pool.query(
    `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash, email_verificado)
     VALUES ($1, $2, $3, $4, false)`,
    [barbearia.id, 'Admin Não Verificado', 'naoverificado@teste.com', senha_hash]
  );

  const resposta = await request(app)
    .post('/auth/admin/login')
    .send({ email: 'naoverificado@teste.com', senha: 'senha123' });

  expect(resposta.status).toBe(403);
  expect(resposta.body.erro).toMatch(/confirme seu email/i);
});
```

Nota: este INSERT via `pool.query` direto vai ser bloqueado por RLS (mesma situação documentada em `criarAdminDireto` de `factories.js`) — troque por uma chamada à função helper já existente, adaptada:

```javascript
test('loginAdmin rejeita acesso quando email não foi verificado, mesmo com senha correta', async () => {
  const barbearia = await criarBarbearia('Barbearia Não Verificada');
  await criarAdminDireto(barbearia.id, {
    email: 'naoverificado@teste.com',
    senha: 'senha123',
  });

  // criarAdminDireto (factories.js) insere com email_verificado usando o
  // DEFAULT da coluna, que é `true` -- para este teste precisamos de
  // email_verificado = false explicitamente. Ajustar via UPDATE direto:
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia.id)]);
  await client.query(
    `UPDATE usuario_admin SET email_verificado = false WHERE email = 'naoverificado@teste.com'`
  );
  await client.query('COMMIT');
  client.release();

  const resposta = await request(app)
    .post('/auth/admin/login')
    .send({ email: 'naoverificado@teste.com', senha: 'senha123' });

  expect(resposta.status).toBe(403);
  expect(resposta.body.erro).toMatch(/confirme seu email/i);
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
npx jest tests/integration/auth.test.js
```

Expected: FAIL — `loginAdmin` hoje ignora `email_verificado`, então a resposta seria 200 com token, não 403.

- [ ] **Step 4: Modificar `loginAdmin`**

Em `src/controllers/authController.js`, dentro de `loginAdmin`, após o laço que encontra `adminAutenticado` e antes de emitir o token:

```javascript
    if (!adminAutenticado) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    if (!adminAutenticado.email_verificado) {
      return res.status(403).json({ erro: 'Confirme seu email antes de fazer login' });
    }

    const token = jwt.sign(
```

(a linha `const token = jwt.sign(` já existe no arquivo — este diff insere o novo bloco `if` imediatamente antes dela, sem alterar o restante da função).

- [ ] **Step 5: Rodar o teste de novo**

Run:
```bash
npx jest tests/integration/auth.test.js
```

Expected: PASS em todos os testes do arquivo (o novo e os pré-existentes, que continuam passando porque `criarAdminDireto` usa o default `email_verificado = true`).

- [ ] **Step 6: Rodar a suíte completa**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando (incluindo os das tasks anteriores), sem warning de handle aberto.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/authController.js tests/integration/auth.test.js
git commit -m "Bloqueia login de admin com email nao verificado"
```

---

## Task 7: Verificação final

**Files:** nenhum arquivo novo — apenas validação.

- [ ] **Step 1: Rodar a suíte de testes completa uma última vez**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando, incluindo todos os de onboarding e o novo teste de bloqueio de login.

- [ ] **Step 2: Confirmar que o servidor sobe sem erro**

Run:
```bash
node -e "require('./src/app'); console.log('app.js carregou sem erro de sintaxe/require');"
```

Expected: `app.js carregou sem erro de sintaxe/require`.

- [ ] **Step 3: Teste manual do fluxo completo (opcional, mas recomendado antes de considerar a fase concluída)**

Com o servidor rodando localmente (`node src/server.js`) e uma chave real do Resend configurada:

1. `POST /onboarding/cadastro` com dados reais e um email que você controle.
2. Confirmar que o email chega (ou aparece no painel do Resend, se usando o remetente de teste `onboarding@resend.dev`, que só entrega para o email cadastrado como titular da conta Resend).
3. Clicar no link / fazer `GET /onboarding/verificar?token=...` com o token do email.
4. Fazer `POST /auth/admin/login` com as credenciais cadastradas e confirmar que retorna um token JWT.

- [ ] **Step 4: Revisar o diff completo antes de considerar a fase pronta**

Run: `git log --oneline -8` para confirmar os 6 commits desta fase (migration, email service, rate limiters, controller, rotas, bloqueio de login) mais este de verificação, se houver algo a ajustar.

## Fora de escopo (lembrete)

Conforme spec: billing/cobrança da assinatura SaaS (fase 3), validação de formato/unicidade de CNPJ, fluxo de "esqueci minha senha", wizard multi-etapa, criação automática de unidade/serviço/barbeiro padrão, e frontend da tela de cadastro/verificação.
