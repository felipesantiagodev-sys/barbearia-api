# Recuperação de Senha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que admins e clientes recuperem acesso à conta esquecendo a senha, via link de redefinição enviado por email, seguindo exatamente o padrão já usado na verificação de email do onboarding.

**Architecture:** Duas migrations aditivas (colunas de token de reset em `usuario_admin` e `cliente`), quatro endpoints novos em `authController.js`/`authRoutes.js` (esqueci-senha e redefinir-senha, por tipo de usuário), um novo template de email, e duas telas novas no frontend React reaproveitando a identidade visual já criada.

**Tech Stack:** Backend: Node.js/Express/pg, bcrypt, crypto (UUID), Resend (já configurado). Frontend: React/TypeScript, React Router, CSS Modules (`Auth.module.css` já existente).

## Global Constraints

- Token de reset é UUID (`crypto.randomUUID()`), expira em 1 hora, armazenado em colunas próprias (`token_reset_senha`, `token_reset_senha_expira_em`) — nunca reaproveita `token_verificacao`.
- `POST /auth/{admin,cliente}/esqueci-senha` sempre responde `200` com mensagem genérica, exista ou não o email — nunca revela se o email está cadastrado.
- Um email é enviado por conta encontrada (o mesmo email pode ter contas em barbearias diferentes); o assunto de cada email inclui o nome da barbearia correspondente.
- O link do email inclui `tipo` (`admin` ou `cliente`) e `token` na query string: `${APP_BASE_URL}/redefinir-senha?tipo=<tipo>&token=<token>`.
- Rate limiting de 3 requisições/hora por IP nos dois endpoints `/esqueci-senha` (mesmo valor de `limitadorReenvio`), sem rate limit dedicado em `/redefinir-senha`.
- Após redefinir com sucesso, o usuário é levado de volta à tela de login correspondente (cliente ou admin) — nunca autenticado automaticamente.
- Erros de token malformado (código Postgres `22P02`, cast de string inválida para UUID) devem responder `400`, nunca `500` — mesmo padrão de `verificarEmail` em `onboardingController.js`.

---

## File Structure

```
Backend (barbearia-api/):
  Criar:
    migrations/012_reset_senha_usuario_admin.sql
    migrations/013_reset_senha_cliente.sql
  Modificar:
    src/controllers/authController.js   -- adiciona 4 funções novas
    src/routes/authRoutes.js            -- adiciona 4 rotas novas
    src/services/emailService.js        -- adiciona enviarEmailRedefinicaoSenha
    src/middlewares/rateLimiters.js     -- adiciona limitadorEsqueciSenha
    tests/integration/auth.test.js      -- adiciona testes dos 4 endpoints novos

Frontend (barbearia-web/):
  Criar:
    src/api/senha.ts                          -- esqueciSenha(), redefinirSenha()
    src/pages/RecuperarSenha.tsx
    src/pages/RecuperarSenha.test.tsx
    src/pages/RedefinirSenha.tsx
    src/pages/RedefinirSenha.test.tsx
  Modificar:
    src/pages/LoginCliente.tsx    -- adiciona link "Esqueci minha senha"
    src/pages/LoginAdmin.tsx      -- adiciona link "Esqueci minha senha"
    src/App.tsx                   -- adiciona rotas /recuperar-senha e /redefinir-senha
```

Justificativa: as 4 funções novas do backend vivem em `authController.js` porque reaproveitam `buscarComoPlataforma`, que é local a esse módulo (não exportada) — mover para um controller separado exigiria exportar essa função ou duplicar a lógica. No frontend, `api/senha.ts` isola as duas chamadas HTTP novas, seguindo o mesmo padrão de `api/auth.ts` e `api/tema.ts`.

---

## Task 1: Migrations — colunas de token de reset

**Files:**
- Create: `migrations/012_reset_senha_usuario_admin.sql`
- Create: `migrations/013_reset_senha_cliente.sql`

**Interfaces:**
- Produces: colunas `token_reset_senha UUID`, `token_reset_senha_expira_em TIMESTAMP` em `usuario_admin` e `cliente`, cada uma com índice parcial. Consumidas pela Task 2 (controller).

- [ ] **Step 1: Escrever a migration de `usuario_admin`**

`migrations/012_reset_senha_usuario_admin.sql`:
```sql
-- Up Migration
ALTER TABLE usuario_admin
  ADD COLUMN token_reset_senha UUID,
  ADD COLUMN token_reset_senha_expira_em TIMESTAMP;

CREATE INDEX idx_usuario_admin_token_reset_senha
  ON usuario_admin(token_reset_senha)
  WHERE token_reset_senha IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_token_reset_senha;
ALTER TABLE usuario_admin
  DROP COLUMN token_reset_senha_expira_em,
  DROP COLUMN token_reset_senha;
```

- [ ] **Step 2: Escrever a migration de `cliente`**

`migrations/013_reset_senha_cliente.sql`:
```sql
-- Up Migration
ALTER TABLE cliente
  ADD COLUMN token_reset_senha UUID,
  ADD COLUMN token_reset_senha_expira_em TIMESTAMP;

CREATE INDEX idx_cliente_token_reset_senha
  ON cliente(token_reset_senha)
  WHERE token_reset_senha IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_cliente_token_reset_senha;
ALTER TABLE cliente
  DROP COLUMN token_reset_senha_expira_em,
  DROP COLUMN token_reset_senha;
```

- [ ] **Step 3: Rodar as migrations no banco de dev**

Run (usuário `barbearia_app` não é dono das tabelas — precisa de credenciais de superuser, mesmo padrão já usado nas migrations 007-011):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db" npx node-pg-migrate up
```

Expected: `012_reset_senha_usuario_admin` e `013_reset_senha_cliente` migradas sem erro.

- [ ] **Step 4: Rodar as migrations no banco de teste**

Run:
```bash
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db_test" npx node-pg-migrate up
```

- [ ] **Step 5: Verificar as colunas foram criadas**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const r = await pool.query(\"SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE 'token_reset_senha%' ORDER BY table_name, column_name\");
  console.log(r.rows);
  await pool.end();
})();
"
```

Expected: 4 linhas — `cliente.token_reset_senha`, `cliente.token_reset_senha_expira_em`, `usuario_admin.token_reset_senha`, `usuario_admin.token_reset_senha_expira_em`.

- [ ] **Step 6: Commit**

```bash
git add migrations/012_reset_senha_usuario_admin.sql migrations/013_reset_senha_cliente.sql
git commit -m "Adiciona colunas de token de reset de senha em usuario_admin e cliente"
```

---

## Task 2: Serviço de email de redefinição de senha

**Files:**
- Modify: `src/services/emailService.js`
- Test: `tests/unit/emailService.test.js`

**Interfaces:**
- Consumes: `escaparHtml` (já existe no mesmo módulo).
- Produces: `enviarEmailRedefinicaoSenha(destinatario: string, nomeBarbearia: string, tokenReset: string, tipoUsuario: 'admin' | 'cliente'): Promise<void>`. Consumido pela Task 3 (controller).

- [ ] **Step 1: Verificar se já existe teste unitário para `emailService.js`**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
ls tests/unit/ 2>&1 || echo "diretorio nao existe"
```

Se `tests/unit/` não existir, criar o diretório será necessário no próximo passo (o teste abaixo assume que ele pode ser criado livremente).

- [ ] **Step 2: Escrever o teste (falha primeiro)**

`tests/unit/emailService.test.js`:
```javascript
jest.mock('resend', () => {
  const enviarMock = jest.fn().mockResolvedValue({ error: null });
  return { Resend: jest.fn().mockImplementation(() => ({ emails: { send: enviarMock } })), __enviarMock: enviarMock };
});

const { Resend } = require('resend');
const { enviarEmailRedefinicaoSenha } = require('../../src/services/emailService');

describe('enviarEmailRedefinicaoSenha', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'chave-fake';
    process.env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    Resend.mock.results[Resend.mock.results.length - 1]?.value.emails.send.mockClear();
  });

  test('envia email com link contendo tipo e token corretos', async () => {
    await enviarEmailRedefinicaoSenha('cliente@teste.com', 'Barbearia Exemplo', 'token-abc-123', 'cliente');

    const instancia = Resend.mock.results[Resend.mock.results.length - 1].value;
    expect(instancia.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['cliente@teste.com'],
        subject: expect.stringContaining('Barbearia Exemplo'),
        html: expect.stringContaining('http://localhost:3000/redefinir-senha?tipo=cliente&token=token-abc-123'),
      })
    );
  });

  test('escapa o nome da barbearia no corpo do email', async () => {
    await enviarEmailRedefinicaoSenha('admin@teste.com', '<script>alert(1)</script>', 'token-xyz', 'admin');

    const instancia = Resend.mock.results[Resend.mock.results.length - 1].value;
    const chamada = instancia.emails.send.mock.calls[0][0];
    expect(chamada.html).not.toContain('<script>');
    expect(chamada.html).toContain('&lt;script&gt;');
  });

  test('lança erro quando o Resend retorna falha', async () => {
    const instancia = Resend.mock.results[Resend.mock.results.length - 1]?.value;
    Resend.mockImplementationOnce(() => ({
      emails: { send: jest.fn().mockResolvedValue({ error: { message: 'falha simulada' } }) },
    }));

    await expect(
      enviarEmailRedefinicaoSenha('cliente@teste.com', 'Barbearia Exemplo', 'token-abc', 'cliente')
    ).rejects.toThrow('falha simulada');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
npx jest tests/unit/emailService.test.js
```

Expected: FAIL — `enviarEmailRedefinicaoSenha` não está exportada ainda.

- [ ] **Step 4: Implementar a função em `emailService.js`**

Ler o arquivo atual primeiro para preservar `enviarEmailVerificacao` e `escaparHtml` sem alteração, adicionando a nova função e atualizando o `module.exports`:

```javascript
async function enviarEmailRedefinicaoSenha(destinatario, nomeBarbearia, tokenReset, tipoUsuario) {
  const resend = obterCliente();
  const linkRedefinicao = `${process.env.APP_BASE_URL}/redefinir-senha?tipo=${tipoUsuario}&token=${tokenReset}`;
  const nomeSeguro = escaparHtml(nomeBarbearia);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: [destinatario],
    subject: `Redefinir senha — ${nomeSeguro}`,
    html: `
      <p>Olá!</p>
      <p>Recebemos um pedido para redefinir a senha da sua conta em <strong>${nomeSeguro}</strong>.</p>
      <p><a href="${linkRedefinicao}">Redefinir minha senha</a></p>
      <p>Este link expira em 1 hora. Se você não pediu essa redefinição, pode ignorar este email.</p>
    `,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de redefinição de senha: ${error.message}`);
  }
}

module.exports = { enviarEmailVerificacao, enviarEmailRedefinicaoSenha };
```

- [ ] **Step 5: Rodar o teste de novo**

Run:
```bash
npx jest tests/unit/emailService.test.js
```

Expected: PASS nos 3 testes.

- [ ] **Step 6: Commit**

```bash
git add src/services/emailService.js tests/unit/emailService.test.js
git commit -m "Adiciona envio de email de redefinicao de senha"
```

---

## Task 3: Rate limiter de esqueci-senha

**Files:**
- Modify: `src/middlewares/rateLimiters.js`

**Interfaces:**
- Produces: `limitadorEsqueciSenha` (middleware Express). Consumido pela Task 4 (rotas).

- [ ] **Step 1: Adicionar o novo limitador**

Ler `src/middlewares/rateLimiters.js` atual e adicionar, preservando `limitadorCadastro` e `limitadorReenvio`:

```javascript
// Esqueci minha senha: mesmo limite de reenvio de verificação -- o caso de
// uso legítimo (não recebeu o email) não deveria precisar de mais de 3
// tentativas por hora, e o endpoint já responde de forma genérica então
// repetir a tentativa não ajuda a descobrir mais informação.
const limitadorEsqueciSenha = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente mais tarde.' },
});

module.exports = { limitadorCadastro, limitadorReenvio, limitadorEsqueciSenha };
```

- [ ] **Step 2: Commit**

```bash
git add src/middlewares/rateLimiters.js
git commit -m "Adiciona rate limiter para esqueci-senha"
```

---

## Task 4: Endpoints de esqueci-senha e redefinir-senha (admin)

**Files:**
- Modify: `src/controllers/authController.js`
- Modify: `src/routes/authRoutes.js`
- Test: `tests/integration/auth.test.js`

**Interfaces:**
- Consumes: `buscarComoPlataforma` (já existe, local ao módulo), `enviarEmailRedefinicaoSenha` (Task 2), `limitadorEsqueciSenha` (Task 3).
- Produces: `POST /auth/admin/esqueci-senha` (público, rate-limited), `POST /auth/admin/redefinir-senha` (público). Consumidos pela Task 6 (frontend).

- [ ] **Step 1: Ler os testes de integração existentes para confirmar o padrão de setup**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
head -30 tests/integration/auth.test.js
```

Confirme os imports de `limparBanco`, `fecharBanco`, `criarBarbearia`, `criarAdminDireto` de `tests/helpers/db.js` e `tests/helpers/factories.js` (mesmo padrão usado em `tests/integration/tema.test.js`).

- [ ] **Step 2: Escrever os testes (falha primeiro)**

Adicionar ao final de `tests/integration/auth.test.js` (dentro do describe existente ou em um novo describe no mesmo arquivo, seguindo a estrutura já presente):

```javascript
const jwt = require('jsonwebtoken');

describe('POST /auth/admin/esqueci-senha', () => {
  afterEach(async () => {
    await limparBanco();
  });

  test('responde 200 genérico para email existente e gera token', async () => {
    const barbearia = await criarBarbearia('Barbearia Reset Admin');
    const admin = await criarAdminDireto(barbearia.id, { email: 'admin.reset@teste.com' });

    const resposta = await request(app)
      .post('/auth/admin/esqueci-senha')
      .send({ email: 'admin.reset@teste.com' });

    expect(resposta.status).toBe(200);

    const verificacao = await pool.query(
      'SELECT token_reset_senha, token_reset_senha_expira_em FROM usuario_admin WHERE id = $1',
      [admin.id]
    );
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

    const verificacaoA = await pool.query('SELECT token_reset_senha FROM usuario_admin WHERE id = $1', [adminA.id]);
    const verificacaoB = await pool.query('SELECT token_reset_senha FROM usuario_admin WHERE id = $1', [adminB.id]);
    expect(verificacaoA.rows[0].token_reset_senha).not.toBeNull();
    expect(verificacaoB.rows[0].token_reset_senha).not.toBeNull();
    expect(verificacaoA.rows[0].token_reset_senha).not.toBe(verificacaoB.rows[0].token_reset_senha);
  });
});

describe('POST /auth/admin/redefinir-senha', () => {
  afterEach(async () => {
    await limparBanco();
  });

  async function gerarTokenResetParaAdmin(barbeariaId, overrides = {}) {
    const admin = await criarAdminDireto(barbeariaId, overrides);
    const token = 'a0000000-0000-4000-8000-000000000001';
    await pool.query(
      `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '1 hour' WHERE id = $2`,
      [token, admin.id]
    );
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

    const verificacao = await pool.query('SELECT token_reset_senha FROM usuario_admin WHERE id = $1', [admin.id]);
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
    await pool.query(
      `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() - interval '1 hour' WHERE id = $2`,
      [token, admin.id]
    );

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
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: FAIL — rotas `/auth/admin/esqueci-senha` e `/auth/admin/redefinir-senha` não existem (404).

- [ ] **Step 4: Implementar as funções no controller**

Adicionar a `src/controllers/authController.js` (após `loginAdmin`, antes de `loginCliente`, preservando tudo que já existe):

```javascript
const crypto = require('crypto');
const { enviarEmailRedefinicaoSenha } = require('../services/emailService');

const HORAS_EXPIRACAO_TOKEN_RESET = 1;

async function esqueciSenhaAdmin(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT ua.*, b.nome AS nome_barbearia FROM usuario_admin ua JOIN barbearia b ON b.id = ua.barbearia_id WHERE ua.email = $1 AND ua.ativo = true',
      [email]
    );

    for (const admin of resultado.rows) {
      const tokenReset = crypto.randomUUID();
      await pool.query(
        `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN_RESET} hours' WHERE id = $2`,
        [tokenReset, admin.id]
      );

      try {
        await enviarEmailRedefinicaoSenha(admin.email, admin.nome_barbearia, tokenReset, 'admin');
      } catch (erroEnvio) {
        console.error('Falha ao enviar email de redefinição de senha (admin):', erroEnvio);
      }
    }

    res.json({ mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar solicitação' });
  }
}

async function redefinirSenhaAdmin(req, res) {
  const { token, senha_nova } = req.body;

  if (!token || !senha_nova) {
    return res.status(400).json({ erro: 'token e senha_nova são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      `SELECT * FROM usuario_admin WHERE token_reset_senha = $1 AND token_reset_senha_expira_em > now()`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const admin = resultado.rows[0];
    const senha_hash = await bcrypt.hash(senha_nova, 10);

    await pool.query(
      `UPDATE usuario_admin SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL WHERE id = $2`,
      [senha_hash, admin.id]
    );

    res.json({ mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (erro) {
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir senha' });
  }
}
```

Atualizar o `module.exports` no final do arquivo para incluir as duas novas funções junto às já existentes (`cadastrarAdmin, loginAdmin, loginCliente`).

**Nota:** `buscarComoPlataforma` já existe no topo do arquivo e abre sua própria conexão com `app.is_plataforma`, fazendo `ROLLBACK` ao final (é só leitura) — por isso o `UPDATE` de `token_reset_senha` é feito com `pool.query` direto em uma chamada separada, não dentro da transação de leitura de `buscarComoPlataforma`. Isso é seguro porque `usuario_admin` tem RLS mas o `UPDATE` aqui roda fora de qualquer transação com tenant setado — **isso vai falhar por RLS**. Substituir por: abrir uma conexão dedicada com `app.is_plataforma` setado para o UPDATE também, seguindo o mesmo padrão de `buscarComoPlataforma`, mas com COMMIT ao invés de ROLLBACK. Use este helper adicional no mesmo arquivo:

```javascript
async function executarComoPlataforma(query, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const resultado = await client.query(query, params);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}
```

E trocar as chamadas `pool.query(...)` de UPDATE em `esqueciSenhaAdmin` e `redefinirSenhaAdmin` (e nas versões de cliente na Task 5) por `executarComoPlataforma(...)`.

- [ ] **Step 5: Adicionar as rotas**

Editar `src/routes/authRoutes.js`:
```javascript
const express = require('express');
const router = express.Router();
const {
  cadastrarAdmin,
  loginAdmin,
  loginCliente,
  esqueciSenhaAdmin,
  redefinirSenhaAdmin,
} = require('../controllers/authController');
const { verificarToken } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');
const { limitadorEsqueciSenha } = require('../middlewares/rateLimiters');

router.post('/admin/cadastro', verificarToken, escoparTenant, cadastrarAdmin);
router.post('/admin/login', loginAdmin);
router.post('/cliente/login', loginCliente);
router.post('/admin/esqueci-senha', limitadorEsqueciSenha, esqueciSenhaAdmin);
router.post('/admin/redefinir-senha', redefinirSenhaAdmin);

module.exports = router;
```

- [ ] **Step 6: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: todos os testes de admin passam.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/authController.js src/routes/authRoutes.js tests/integration/auth.test.js
git commit -m "Adiciona esqueci-senha e redefinir-senha para admin"
```

---

## Task 5: Endpoints de esqueci-senha e redefinir-senha (cliente)

**Files:**
- Modify: `src/controllers/authController.js`
- Modify: `src/routes/authRoutes.js`
- Test: `tests/integration/auth.test.js`

**Interfaces:**
- Consumes: mesmos helpers da Task 4 (`buscarComoPlataforma`, `executarComoPlataforma`, `enviarEmailRedefinicaoSenha`, `limitadorEsqueciSenha`).
- Produces: `POST /auth/cliente/esqueci-senha`, `POST /auth/cliente/redefinir-senha`. Consumidos pela Task 6 (frontend).

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Adicionar a `tests/integration/auth.test.js`, espelhando a Task 4 mas para `cliente`:

```javascript
describe('POST /auth/cliente/esqueci-senha', () => {
  afterEach(async () => {
    await limparBanco();
  });

  test('responde 200 genérico para email existente e gera token', async () => {
    const barbearia = await criarBarbearia('Barbearia Reset Cliente');
    const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.reset@teste.com' });

    const resposta = await request(app)
      .post('/auth/cliente/esqueci-senha')
      .send({ email: 'cliente.reset@teste.com' });

    expect(resposta.status).toBe(200);

    const verificacao = await pool.query(
      'SELECT token_reset_senha FROM cliente WHERE id = $1',
      [cliente.id]
    );
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
  afterEach(async () => {
    await limparBanco();
  });

  test('redefine a senha com token válido e invalida o token', async () => {
    const barbearia = await criarBarbearia('Barbearia Redefine Cliente');
    const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.redefine@teste.com' });
    const token = 'b0000000-0000-4000-8000-000000000001';
    await pool.query(
      `UPDATE cliente SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '1 hour' WHERE id = $2`,
      [token, cliente.id]
    );

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
    await pool.query(
      `UPDATE cliente SET token_reset_senha = $1, token_reset_senha_expira_em = now() - interval '1 hour' WHERE id = $2`,
      [token, cliente.id]
    );

    const resposta = await request(app)
      .post('/auth/cliente/redefinir-senha')
      .send({ token, senha_nova: 'novaSenhaCliente123' });

    expect(resposta.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: FAIL nos testes de cliente (rotas não existem).

- [ ] **Step 3: Implementar as funções no controller**

Adicionar a `src/controllers/authController.js`, após as funções de admin criadas na Task 4:

```javascript
async function esqueciSenhaCliente(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT c.*, b.nome AS nome_barbearia FROM cliente c JOIN barbearia b ON b.id = c.barbearia_id WHERE c.email = $1',
      [email]
    );

    for (const cliente of resultado.rows) {
      const tokenReset = crypto.randomUUID();
      await executarComoPlataforma(
        `UPDATE cliente SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN_RESET} hours' WHERE id = $2`,
        [tokenReset, cliente.id]
      );

      try {
        await enviarEmailRedefinicaoSenha(cliente.email, cliente.nome_barbearia, tokenReset, 'cliente');
      } catch (erroEnvio) {
        console.error('Falha ao enviar email de redefinição de senha (cliente):', erroEnvio);
      }
    }

    res.json({ mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar solicitação' });
  }
}

async function redefinirSenhaCliente(req, res) {
  const { token, senha_nova } = req.body;

  if (!token || !senha_nova) {
    return res.status(400).json({ erro: 'token e senha_nova são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      `SELECT * FROM cliente WHERE token_reset_senha = $1 AND token_reset_senha_expira_em > now()`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const cliente = resultado.rows[0];
    const senha_hash = await bcrypt.hash(senha_nova, 10);

    await executarComoPlataforma(
      `UPDATE cliente SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL WHERE id = $2`,
      [senha_hash, cliente.id]
    );

    res.json({ mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (erro) {
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir senha' });
  }
}
```

Atualizar `module.exports` para incluir `esqueciSenhaCliente, redefinirSenhaCliente` junto às demais.

- [ ] **Step 4: Adicionar as rotas**

Editar `src/routes/authRoutes.js`, adicionando ao import e às rotas já criadas na Task 4:

```javascript
const {
  cadastrarAdmin,
  loginAdmin,
  loginCliente,
  esqueciSenhaAdmin,
  redefinirSenhaAdmin,
  esqueciSenhaCliente,
  redefinirSenhaCliente,
} = require('../controllers/authController');

// ... (rotas já existentes)
router.post('/cliente/esqueci-senha', limitadorEsqueciSenha, esqueciSenhaCliente);
router.post('/cliente/redefinir-senha', redefinirSenhaCliente);
```

- [ ] **Step 5: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: todos os testes (admin + cliente) passam.

- [ ] **Step 6: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando, sem regressão nos testes já existentes.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/authController.js src/routes/authRoutes.js tests/integration/auth.test.js
git commit -m "Adiciona esqueci-senha e redefinir-senha para cliente"
```

---

## Task 6: API client e telas de recuperação/redefinição no frontend

**Files:**
- Create: `barbearia-web/src/api/senha.ts`
- Create: `barbearia-web/src/pages/RecuperarSenha.tsx`
- Create: `barbearia-web/src/pages/RecuperarSenha.test.tsx`
- Create: `barbearia-web/src/pages/RedefinirSenha.tsx`
- Create: `barbearia-web/src/pages/RedefinirSenha.test.tsx`
- Modify: `barbearia-web/src/pages/LoginCliente.tsx`
- Modify: `barbearia-web/src/pages/LoginAdmin.tsx`
- Modify: `barbearia-web/src/App.tsx`

**Interfaces:**
- Consumes: `apiClient` de `api/client.ts` (já existe), `styles` de `pages/Auth.module.css` (já existe), `Marca` de `components/Marca.tsx` (já existe).
- Produces: `esqueciSenha(tipo: 'admin' | 'cliente', email: string): Promise<{ mensagem: string }>`, `redefinirSenha(tipo: 'admin' | 'cliente', token: string, senhaNova: string): Promise<{ mensagem: string }>` em `api/senha.ts`. Rotas `/recuperar-senha` e `/redefinir-senha` no `App.tsx`.

- [ ] **Step 1: Implementar `api/senha.ts`**

```typescript
import { apiClient } from './client';

interface RespostaMensagem {
  mensagem: string;
}

export function esqueciSenha(tipo: 'admin' | 'cliente', email: string): Promise<RespostaMensagem> {
  return apiClient.post<RespostaMensagem>(`/auth/${tipo}/esqueci-senha`, { email });
}

export function redefinirSenha(
  tipo: 'admin' | 'cliente',
  token: string,
  senhaNova: string
): Promise<RespostaMensagem> {
  return apiClient.post<RespostaMensagem>(`/auth/${tipo}/redefinir-senha`, { token, senha_nova: senhaNova });
}
```

- [ ] **Step 2: Escrever o teste de `RecuperarSenha` (falha primeiro)**

`barbearia-web/src/pages/RecuperarSenha.test.tsx`:
```tsx
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as senhaApi from '../api/senha';
import RecuperarSenha from './RecuperarSenha';

describe('RecuperarSenha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('envia solicitação para cliente por padrão e mostra mensagem genérica', async () => {
    const mockEsqueciSenha = vi.spyOn(senhaApi, 'esqueciSenha').mockResolvedValue({
      mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.',
    });

    render(
      <MemoryRouter>
        <RecuperarSenha />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'cliente@teste.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(mockEsqueciSenha).toHaveBeenCalledWith('cliente', 'cliente@teste.com');
    });
    await waitFor(() => {
      expect(screen.getByText(/você vai receber um link/i)).toBeInTheDocument();
    });
  });

  test('envia solicitação para admin quando a aba administrador é selecionada', async () => {
    const mockEsqueciSenha = vi.spyOn(senhaApi, 'esqueciSenha').mockResolvedValue({
      mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.',
    });

    render(
      <MemoryRouter>
        <RecuperarSenha />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /sou administrador/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@teste.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(mockEsqueciSenha).toHaveBeenCalledWith('admin', 'admin@teste.com');
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/pages/RecuperarSenha.test.tsx
```

Expected: FAIL — `./RecuperarSenha` não existe.

- [ ] **Step 4: Implementar `RecuperarSenha.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Marca from '../components/Marca';
import { esqueciSenha } from '../api/senha';
import styles from './Auth.module.css';

export default function RecuperarSenha() {
  const [tipo, setTipo] = useState<'cliente' | 'admin'>('cliente');
  const [email, setEmail] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setMensagem(null);
    try {
      const resposta = await esqueciSenha(tipo, email);
      setMensagem(resposta.mensagem);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao processar solicitação');
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Recuperar senha</p>
        </div>

        <form className={styles.cartao} onSubmit={aoSubmeter}>
          <h1 className={styles.titulo}>Esqueci minha senha</h1>

          <div className={styles.campo}>
            <button
              type="button"
              onClick={() => setTipo('cliente')}
              aria-pressed={tipo === 'cliente'}
            >
              Sou cliente
            </button>
            <button
              type="button"
              onClick={() => setTipo('admin')}
              aria-pressed={tipo === 'admin'}
            >
              Sou administrador
            </button>
          </div>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="email">
              Email
            </label>
            <input
              className={styles.entrada}
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {erro && (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          )}

          {mensagem && <p role="status">{mensagem}</p>}

          <button className={styles.botao} type="submit">
            Enviar link de recuperação
          </button>
        </form>

        <p className={styles.rodape}>
          Lembrou a senha? <Link to={tipo === 'admin' ? '/admin/login' : '/login'}>Voltar para o login</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/RecuperarSenha.test.tsx
```

Expected: PASS nos 2 testes.

- [ ] **Step 6: Escrever o teste de `RedefinirSenha` (falha primeiro)**

`barbearia-web/src/pages/RedefinirSenha.test.tsx`:
```tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as senhaApi from '../api/senha';
import RedefinirSenha from './RedefinirSenha';

function renderComQuery(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/redefinir-senha${query}`]}>
      <Routes>
        <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RedefinirSenha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('envia token e tipo lidos da URL ao redefinir', async () => {
    const mockRedefinir = vi.spyOn(senhaApi, 'redefinirSenha').mockResolvedValue({
      mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.',
    });

    renderComQuery('?tipo=admin&token=abc-123');

    await userEvent.type(screen.getByLabelText(/nova senha/i), 'minhaNovaSenha123');
    await userEvent.click(screen.getByRole('button', { name: /redefinir/i }));

    await waitFor(() => {
      expect(mockRedefinir).toHaveBeenCalledWith('admin', 'abc-123', 'minhaNovaSenha123');
    });
    await waitFor(() => {
      expect(screen.getByText(/senha redefinida com sucesso/i)).toBeInTheDocument();
    });
  });

  test('mostra erro quando o token é inválido ou expirado', async () => {
    vi.spyOn(senhaApi, 'redefinirSenha').mockRejectedValue(new Error('Token inválido ou expirado'));

    renderComQuery('?tipo=cliente&token=expirado-999');

    await userEvent.type(screen.getByLabelText(/nova senha/i), 'minhaNovaSenha123');
    await userEvent.click(screen.getByRole('button', { name: /redefinir/i }));

    await waitFor(() => {
      expect(screen.getByText('Token inválido ou expirado')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 7: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/pages/RedefinirSenha.test.tsx
```

Expected: FAIL — `./RedefinirSenha` não existe.

- [ ] **Step 8: Implementar `RedefinirSenha.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Marca from '../components/Marca';
import { redefinirSenha } from '../api/senha';
import styles from './Auth.module.css';

export default function RedefinirSenha() {
  const [parametros] = useSearchParams();
  const tipo = parametros.get('tipo') === 'admin' ? 'admin' : 'cliente';
  const token = parametros.get('token') ?? '';

  const [senhaNova, setSenhaNova] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setMensagem(null);
    try {
      const resposta = await redefinirSenha(tipo, token, senhaNova);
      setMensagem(resposta.mensagem);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao redefinir senha');
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Redefinir senha</p>
        </div>

        {mensagem ? (
          <div className={styles.cartao}>
            <p role="status">{mensagem}</p>
            <p className={styles.rodape}>
              <Link to={tipo === 'admin' ? '/admin/login' : '/login'}>Ir para o login</Link>
            </p>
          </div>
        ) : (
          <form className={styles.cartao} onSubmit={aoSubmeter}>
            <h1 className={styles.titulo}>Defina sua nova senha</h1>

            <div className={styles.campo}>
              <label className={styles.rotulo} htmlFor="senha-nova">
                Nova senha
              </label>
              <input
                className={styles.entrada}
                id="senha-nova"
                type="password"
                value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {erro && (
              <p className={styles.erro} role="alert">
                {erro}
              </p>
            )}

            <button className={styles.botao} type="submit">
              Redefinir senha
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/RedefinirSenha.test.tsx
```

Expected: PASS nos 2 testes.

- [ ] **Step 10: Adicionar o link "Esqueci minha senha" em `LoginCliente.tsx` e `LoginAdmin.tsx`**

Em `LoginCliente.tsx`, adicionar dentro do `<form>`, logo antes do botão de submit (após o campo de senha):
```tsx
          <p className={styles.rodape} style={{ marginTop: 0, marginBottom: '1rem', textAlign: 'right' }}>
            <Link to="/recuperar-senha">Esqueci minha senha</Link>
          </p>
```

Em `LoginAdmin.tsx`, o mesmo trecho (mesmo componente `Link`, já importado em ambos os arquivos).

- [ ] **Step 11: Adicionar as rotas em `App.tsx`**

Editar `barbearia-web/src/App.tsx`, adicionando os imports e as duas rotas novas dentro de `<Routes>` (fora de `RotaProtegida`, já que são acessíveis sem login):

```tsx
import RecuperarSenha from './pages/RecuperarSenha';
import RedefinirSenha from './pages/RedefinirSenha';

// ... dentro de <Routes>:
            <Route path="/recuperar-senha" element={<RecuperarSenha />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
```

- [ ] **Step 12: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes (incluindo os já existentes) passam.

- [ ] **Step 13: Type-check e build**

Run:
```bash
npx tsc -b
npx vite build
```

Expected: sem erros; build gera `dist/` com sucesso. Depois, remover `dist/` (`rm -rf dist`) para não deixar artefato de build no working tree.

- [ ] **Step 14: Commit**

```bash
git add barbearia-web/src/api/senha.ts barbearia-web/src/pages/RecuperarSenha.tsx barbearia-web/src/pages/RecuperarSenha.test.tsx barbearia-web/src/pages/RedefinirSenha.tsx barbearia-web/src/pages/RedefinirSenha.test.tsx barbearia-web/src/pages/LoginCliente.tsx barbearia-web/src/pages/LoginAdmin.tsx barbearia-web/src/App.tsx
git commit -m "Adiciona telas de recuperacao e redefinicao de senha"
```

---

## Task 7: Verificação manual de ponta a ponta

**Files:** nenhum arquivo novo — task de verificação.

- [ ] **Step 1: Subir backend e frontend localmente**

Run (dois terminais ou processos em background):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api" && node src/server.js
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api\barbearia-web" && npm run dev
```

- [ ] **Step 2: Criar um admin de teste verificado**

Run:
```bash
node -e "
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const senha_hash = await bcrypt.hash('senhaAntiga123', 10);
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(\"SELECT set_config('app.tenant_id', '1', true)\");
  const r = await client.query(
    \"INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash, email_verificado) VALUES (1, 'Admin Reset E2E', 'admin.reset.e2e@teste.com', \$1, true) RETURNING id\",
    [senha_hash]
  );
  await client.query('COMMIT');
  console.log(r.rows[0]);
  client.release();
  await pool.end();
})();
"
```

- [ ] **Step 3: Solicitar recuperação de senha via API e capturar o token gerado**

Run:
```bash
curl -s -X POST http://localhost:3000/auth/admin/esqueci-senha -H "Content-Type: application/json" -d '{"email":"admin.reset.e2e@teste.com"}'

node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const r = await pool.query(\"SELECT token_reset_senha FROM usuario_admin WHERE email = 'admin.reset.e2e@teste.com'\");
  console.log(r.rows[0].token_reset_senha);
  await pool.end();
})();
"
```

Expected: resposta genérica de sucesso; token não nulo no banco (o envio real do email pode falhar silenciosamente se `RESEND_API_KEY` ainda for placeholder — isso é esperado e não bloqueia o teste, já que o token é gerado antes da tentativa de envio).

- [ ] **Step 4: Acessar a tela de redefinição no navegador com o token capturado**

Navegar para `http://localhost:5173/redefinir-senha?tipo=admin&token=<token capturado>`, preencher nova senha, submeter. Confirmar que a mensagem de sucesso aparece e que o link "Ir para o login" funciona.

- [ ] **Step 5: Confirmar que a nova senha funciona no login**

Run:
```bash
curl -s -X POST http://localhost:3000/auth/admin/login -H "Content-Type: application/json" -d '{"email":"admin.reset.e2e@teste.com","senha":"NOVA_SENHA_DIGITADA_NO_STEP_4"}'
```

Expected: resposta com `token` JWT válido.

- [ ] **Step 6: Limpar o admin de teste**

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
  await client.query(\"DELETE FROM usuario_admin WHERE email = 'admin.reset.e2e@teste.com'\");
  await client.query('COMMIT');
  client.release();
  await pool.end();
})();
"
```

- [ ] **Step 7: Parar os servidores de dev**

Encerrar os processos `node src/server.js` e `npm run dev` iniciados no Step 1.

## Fora de escopo (lembrete)

Conforme spec: alterar senha estando autenticado (dentro do painel), notificação de segurança pós-alteração, invalidação de sessões JWT ativas após reset.
