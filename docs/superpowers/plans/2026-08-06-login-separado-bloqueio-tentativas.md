# Login Separado + Bloqueio por Tentativas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar completamente as telas de login de cliente e admin (sem link cruzado) e bloquear uma conta após 5 tentativas de senha incorretas seguidas, desbloqueável só via redefinição de senha.

**Architecture:** Duas migrations aditivas (colunas de contagem de falhas em `usuario_admin` e `cliente`), lógica de contagem/bloqueio embutida em `loginAdmin`/`loginCliente` e reset embutido em `redefinirSenhaAdmin`/`redefinirSenhaCliente` (todos já existentes em `authController.js`), resposta HTTP `423` tratada de forma especial no frontend, e remoção dos links cruzados nas telas de login.

**Tech Stack:** Backend: Node.js/Express/pg (extensão do `authController.js` já existente). Frontend: React/TypeScript (extensão de `LoginCliente.tsx`, `LoginAdmin.tsx`, `api/client.ts`).

## Global Constraints

- Contador de falhas é por conta (coluna no banco), nunca por IP.
- 5 falhas de senha *consecutivas* bloqueiam a conta; uma senha correta antes da 5ª falha zera o contador.
- `bloqueado_ate` nulo significa não bloqueado; ao bloquear, é setado para uma data distante no futuro (`now() + interval '100 years'`) — não é um bloqueio temporizado, só redefinição de senha limpa o campo.
- Conta bloqueada recebe `423` com corpo `{ erro: '...', bloqueado: true }`, distinto do `401` de credenciais erradas — o front usa o campo `bloqueado` para decidir a UI, não o texto da mensagem.
- Redefinir senha (endpoints já existentes `redefinirSenhaAdmin`/`redefinirSenhaCliente`) zera `tentativas_login_falhas` e `bloqueado_ate` junto com a troca de `senha_hash`.
- `LoginCliente.tsx` e `LoginAdmin.tsx` não têm mais nenhum link ou texto mencionando o outro tipo de conta.

---

## File Structure

```
Backend (barbearia-api/):
  Criar:
    migrations/014_bloqueio_login_usuario_admin.sql
    migrations/015_bloqueio_login_cliente.sql
  Modificar:
    src/controllers/authController.js   -- loginAdmin, loginCliente, redefinirSenhaAdmin, redefinirSenhaCliente
    tests/integration/auth.test.js      -- testes de bloqueio e reset de contador

Frontend (barbearia-web/):
  Modificar:
    src/api/client.ts               -- expõe corpo do erro (não só a mensagem)
    src/api/auth.ts                 -- tipo de erro de login inclui `bloqueado`
    src/pages/LoginCliente.tsx      -- remove link cruzado, trata bloqueio
    src/pages/LoginAdmin.tsx        -- remove link cruzado, trata bloqueio
    src/pages/LoginCliente.test.tsx -- ajusta/adiciona teste de bloqueio
```

Justificativa: toda a lógica de bloqueio vive nas funções de login/redefinição já existentes em `authController.js` — não é um sistema separado, é uma extensão pontual do fluxo que já existe. No frontend, o tratamento de bloqueio é local a cada tela de login, já que as duas telas nunca mais se referenciam.

---

## Task 1: Migrations — colunas de bloqueio por tentativas

**Files:**
- Create: `migrations/014_bloqueio_login_usuario_admin.sql`
- Create: `migrations/015_bloqueio_login_cliente.sql`

**Interfaces:**
- Produces: colunas `tentativas_login_falhas INTEGER NOT NULL DEFAULT 0`, `bloqueado_ate TIMESTAMP` em `usuario_admin` e `cliente`. Consumidas pela Task 2 (controller).

- [ ] **Step 1: Escrever a migration de `usuario_admin`**

`migrations/014_bloqueio_login_usuario_admin.sql`:
```sql
-- Up Migration
ALTER TABLE usuario_admin
  ADD COLUMN tentativas_login_falhas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate TIMESTAMP;

-- Down Migration
ALTER TABLE usuario_admin
  DROP COLUMN bloqueado_ate,
  DROP COLUMN tentativas_login_falhas;
```

- [ ] **Step 2: Escrever a migration de `cliente`**

`migrations/015_bloqueio_login_cliente.sql`:
```sql
-- Up Migration
ALTER TABLE cliente
  ADD COLUMN tentativas_login_falhas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate TIMESTAMP;

-- Down Migration
ALTER TABLE cliente
  DROP COLUMN bloqueado_ate,
  DROP COLUMN tentativas_login_falhas;
```

- [ ] **Step 3: Rodar as migrations no banco de dev**

Run (usuário `barbearia_app` não é dono das tabelas — precisa de credenciais de superuser, mesmo padrão das migrations anteriores):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db" npx node-pg-migrate up
```

Expected: `014_bloqueio_login_usuario_admin` e `015_bloqueio_login_cliente` migradas sem erro.

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
  const r = await pool.query(\"SELECT table_name, column_name FROM information_schema.columns WHERE column_name IN ('tentativas_login_falhas', 'bloqueado_ate') ORDER BY table_name, column_name\");
  console.log(r.rows);
  await pool.end();
})();
"
```

Expected: 4 linhas — `cliente.bloqueado_ate`, `cliente.tentativas_login_falhas`, `usuario_admin.bloqueado_ate`, `usuario_admin.tentativas_login_falhas`.

- [ ] **Step 6: Commit**

```bash
git add migrations/014_bloqueio_login_usuario_admin.sql migrations/015_bloqueio_login_cliente.sql
git commit -m "Adiciona colunas de bloqueio por tentativas de login em usuario_admin e cliente"
```

---

## Task 2: Bloqueio no login e reset no redefinir-senha (admin)

**Files:**
- Modify: `src/controllers/authController.js`
- Test: `tests/integration/auth.test.js`

**Interfaces:**
- Consumes: nenhuma interface nova — modifica `loginAdmin` e `redefinirSenhaAdmin` já existentes.
- Produces: `loginAdmin` agora responde `423 { erro, bloqueado: true }` quando a conta está bloqueada. Consumido pela Task 4 (frontend).

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Adicionar a `tests/integration/auth.test.js`, dentro do describe principal `'Autenticação multi-tenant'` (mesmo arquivo já usado nas tasks de recuperação de senha):

```javascript
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
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: FAIL — o teste de bloqueio espera `423` mas recebe `401` (senha errada sempre) na 6ª tentativa; o teste de zerar contador falha porque a 8ª tentativa (5ª falha desde o reset) já bloquearia sem o reset funcionar; o teste de desbloqueio falha porque `redefinirSenhaAdmin` ainda não zera o contador.

- [ ] **Step 3: Implementar o bloqueio em `loginAdmin`**

Editar `src/controllers/authController.js`, substituindo a função `loginAdmin` inteira:

```javascript
async function loginAdmin(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1 AND ativo = true',
      [email]
    );

    let adminAutenticado = null;
    for (const candidato of resultado.rows) {
      if (await bcrypt.compare(senha, candidato.senha_hash)) {
        adminAutenticado = candidato;
        break;
      }
    }

    if (!adminAutenticado) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    if (adminAutenticado.bloqueado_ate && new Date(adminAutenticado.bloqueado_ate) > new Date()) {
      return res.status(423).json({
        erro: 'Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.',
        bloqueado: true,
      });
    }

    const senhaCorreta = await bcrypt.compare(senha, adminAutenticado.senha_hash);

    if (!senhaCorreta) {
      const novasFalhas = adminAutenticado.tentativas_login_falhas + 1;
      if (novasFalhas >= 5) {
        await executarComoPlataforma(
          `UPDATE usuario_admin SET tentativas_login_falhas = $1, bloqueado_ate = now() + interval '100 years' WHERE id = $2`,
          [novasFalhas, adminAutenticado.id]
        );
        return res.status(423).json({
          erro: 'Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.',
          bloqueado: true,
        });
      }
      await executarComoPlataforma(
        `UPDATE usuario_admin SET tentativas_login_falhas = $1 WHERE id = $2`,
        [novasFalhas, adminAutenticado.id]
      );
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    if (!adminAutenticado.email_verificado) {
      return res.status(403).json({ erro: 'Confirme seu email antes de fazer login' });
    }

    if (adminAutenticado.tentativas_login_falhas > 0) {
      await executarComoPlataforma(
        `UPDATE usuario_admin SET tentativas_login_falhas = 0, bloqueado_ate = NULL WHERE id = $1`,
        [adminAutenticado.id]
      );
    }

    const token = jwt.sign(
      { id: adminAutenticado.id, tipo: 'admin', barbearia_id: adminAutenticado.barbearia_id, papel: adminAutenticado.papel },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nome: adminAutenticado.nome, email: adminAutenticado.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}
```

**Nota:** a checagem de senha aparece duas vezes (no loop de busca do candidato certo entre múltiplas contas com mesmo email, e de novo isolada em `senhaCorreta`) porque o loop original serve para achar QUAL conta corresponde à senha entre várias com o mesmo email — uma vez achada `adminAutenticado`, precisamos saber especificamente se a comparação bateu para decidir entre incrementar falha ou seguir. Isso reaproveita bcrypt.compare uma segunda vez sobre a MESMA conta já identificada, o que é barato o suficiente (bcrypt é sempre uma operação isolada por chamada) e evita reestruturar o loop de busca multi-conta já existente.

- [ ] **Step 4: Implementar o reset de contador em `redefinirSenhaAdmin`**

Editar a função `redefinirSenhaAdmin`, adicionando `tentativas_login_falhas = 0, bloqueado_ate = NULL` ao UPDATE existente:

```javascript
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

    await executarComoPlataforma(
      `UPDATE usuario_admin
       SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL,
           tentativas_login_falhas = 0, bloqueado_ate = NULL
       WHERE id = $2`,
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

- [ ] **Step 5: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: os 3 testes de bloqueio de admin passam, e todos os testes já existentes de admin continuam passando.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/authController.js tests/integration/auth.test.js
git commit -m "Adiciona bloqueio por tentativas de login para admin"
```

---

## Task 3: Bloqueio no login e reset no redefinir-senha (cliente)

**Files:**
- Modify: `src/controllers/authController.js`
- Test: `tests/integration/auth.test.js`

**Interfaces:**
- Consumes: nenhuma interface nova — modifica `loginCliente` e `redefinirSenhaCliente` já existentes.
- Produces: `loginCliente` agora responde `423 { erro, bloqueado: true }` quando a conta está bloqueada. Consumido pela Task 4 (frontend).

- [ ] **Step 1: Escrever os testes (falha primeiro)**

Adicionar a `tests/integration/auth.test.js`, espelhando a Task 2 mas para cliente:

```javascript
  describe('Bloqueio de login por tentativas (cliente)', () => {
    test('bloqueia a conta após 5 senhas incorretas seguidas', async () => {
      const barbearia = await criarBarbearia('Barbearia Bloqueio Cliente');
      await criarClienteDireto(barbearia.id, { email: 'cliente.bloqueio@teste.com', senha: 'senhaCorreta123' });

      for (let tentativa = 0; tentativa < 5; tentativa++) {
        await request(app)
          .post('/auth/cliente/login')
          .send({ email: 'cliente.bloqueio@teste.com', senha: 'senhaErrada' });
      }

      const resposta = await request(app)
        .post('/auth/cliente/login')
        .send({ email: 'cliente.bloqueio@teste.com', senha: 'senhaCorreta123' });

      expect(resposta.status).toBe(423);
      expect(resposta.body.bloqueado).toBe(true);
    });

    test('senha correta antes da 5ª falha zera o contador', async () => {
      const barbearia = await criarBarbearia('Barbearia Zera Contador Cliente');
      await criarClienteDireto(barbearia.id, { email: 'cliente.zera@teste.com', senha: 'senhaCorreta123' });

      for (let tentativa = 0; tentativa < 3; tentativa++) {
        await request(app)
          .post('/auth/cliente/login')
          .send({ email: 'cliente.zera@teste.com', senha: 'senhaErrada' });
      }

      const loginCorreto = await request(app)
        .post('/auth/cliente/login')
        .send({ email: 'cliente.zera@teste.com', senha: 'senhaCorreta123' });
      expect(loginCorreto.status).toBe(200);

      for (let tentativa = 0; tentativa < 4; tentativa++) {
        await request(app)
          .post('/auth/cliente/login')
          .send({ email: 'cliente.zera@teste.com', senha: 'senhaErrada' });
      }

      const resposta = await request(app)
        .post('/auth/cliente/login')
        .send({ email: 'cliente.zera@teste.com', senha: 'senhaCorreta123' });
      expect(resposta.status).toBe(200);
    });

    test('redefinir senha desbloqueia a conta', async () => {
      const barbearia = await criarBarbearia('Barbearia Desbloqueio Cliente');
      const cliente = await criarClienteDireto(barbearia.id, { email: 'cliente.desbloqueio@teste.com', senha: 'senhaAntiga123' });

      for (let tentativa = 0; tentativa < 5; tentativa++) {
        await request(app)
          .post('/auth/cliente/login')
          .send({ email: 'cliente.desbloqueio@teste.com', senha: 'senhaErrada' });
      }

      const token = 'd0000000-0000-4000-8000-000000000001';
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

      const redefinicao = await request(app)
        .post('/auth/cliente/redefinir-senha')
        .send({ token, senha_nova: 'senhaNovaDesbloqueio123' });
      expect(redefinicao.status).toBe(200);

      const loginPosRedefinicao = await request(app)
        .post('/auth/cliente/login')
        .send({ email: 'cliente.desbloqueio@teste.com', senha: 'senhaNovaDesbloqueio123' });
      expect(loginPosRedefinicao.status).toBe(200);
    });
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: FAIL nos 3 testes de bloqueio de cliente, mesma razão da Task 2.

- [ ] **Step 3: Implementar o bloqueio em `loginCliente`**

Editar `src/controllers/authController.js`, substituindo a função `loginCliente` inteira:

```javascript
async function loginCliente(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma('SELECT * FROM cliente WHERE email = $1', [email]);

    let clienteAutenticado = null;
    for (const candidato of resultado.rows) {
      if (await bcrypt.compare(senha, candidato.senha_hash)) {
        clienteAutenticado = candidato;
        break;
      }
    }

    if (!clienteAutenticado) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    if (clienteAutenticado.bloqueado_ate && new Date(clienteAutenticado.bloqueado_ate) > new Date()) {
      return res.status(423).json({
        erro: 'Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.',
        bloqueado: true,
      });
    }

    const senhaCorreta = await bcrypt.compare(senha, clienteAutenticado.senha_hash);

    if (!senhaCorreta) {
      const novasFalhas = clienteAutenticado.tentativas_login_falhas + 1;
      if (novasFalhas >= 5) {
        await executarComoPlataforma(
          `UPDATE cliente SET tentativas_login_falhas = $1, bloqueado_ate = now() + interval '100 years' WHERE id = $2`,
          [novasFalhas, clienteAutenticado.id]
        );
        return res.status(423).json({
          erro: 'Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.',
          bloqueado: true,
        });
      }
      await executarComoPlataforma(
        `UPDATE cliente SET tentativas_login_falhas = $1 WHERE id = $2`,
        [novasFalhas, clienteAutenticado.id]
      );
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    if (clienteAutenticado.tentativas_login_falhas > 0) {
      await executarComoPlataforma(
        `UPDATE cliente SET tentativas_login_falhas = 0, bloqueado_ate = NULL WHERE id = $1`,
        [clienteAutenticado.id]
      );
    }

    const token = jwt.sign(
      { id: clienteAutenticado.id, tipo: 'cliente', barbearia_id: clienteAutenticado.barbearia_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nome: clienteAutenticado.nome, email: clienteAutenticado.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}
```

- [ ] **Step 4: Implementar o reset de contador em `redefinirSenhaCliente`**

Editar a função `redefinirSenhaCliente`, adicionando `tentativas_login_falhas = 0, bloqueado_ate = NULL` ao UPDATE existente:

```javascript
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
      `UPDATE cliente
       SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL,
           tentativas_login_falhas = 0, bloqueado_ate = NULL
       WHERE id = $2`,
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

- [ ] **Step 5: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/auth.test.js --detectOpenHandles
```

Expected: todos os testes de bloqueio (admin + cliente) passam.

- [ ] **Step 6: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando, sem regressão.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/authController.js tests/integration/auth.test.js
git commit -m "Adiciona bloqueio por tentativas de login para cliente"
```

---

## Task 4: Frontend — separar telas de login e tratar bloqueio

**Files:**
- Modify: `barbearia-web/src/api/client.ts`
- Modify: `barbearia-web/src/api/auth.ts`
- Modify: `barbearia-web/src/pages/LoginCliente.tsx`
- Modify: `barbearia-web/src/pages/LoginAdmin.tsx`
- Test: `barbearia-web/src/pages/LoginCliente.test.tsx`

**Interfaces:**
- Consumes: resposta `423 { erro, bloqueado: true }` de `POST /auth/{admin,cliente}/login` (Tasks 2 e 3).
- Produces: `ErroApi` (classe de erro em `api/client.ts`) com propriedade `bloqueado: boolean`, lançada por `apiClient.post` no lugar do `Error` genérico atual. Consumida pelas páginas de login.

- [ ] **Step 1: Estender `api/client.ts` para expor o corpo do erro**

Ler o arquivo atual e substituir a função `requisicao` e adicionar a classe `ErroApi`, preservando `getToken`/`setToken`/`apiClient` como estão:

```typescript
const URL_BASE = 'http://localhost:3000';
const CHAVE_TOKEN = 'barbearia_token';

export function getToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(CHAVE_TOKEN, token);
  } else {
    localStorage.removeItem(CHAVE_TOKEN);
  }
}

export class ErroApi extends Error {
  bloqueado: boolean;

  constructor(mensagem: string, bloqueado: boolean) {
    super(mensagem);
    this.name = 'ErroApi';
    this.bloqueado = bloqueado;
  }
}

async function requisicao<T>(
  metodo: 'GET' | 'POST' | 'PUT',
  caminho: string,
  corpo?: unknown
): Promise<T> {
  const token = getToken();
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    cabecalhos.Authorization = `Bearer ${token}`;
  }

  const resposta = await fetch(`${URL_BASE}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const mensagemErro = dados && typeof dados === 'object' && 'erro' in dados
      ? String((dados as { erro: unknown }).erro)
      : `Erro na requisição (${resposta.status})`;
    const bloqueado = Boolean(dados && typeof dados === 'object' && 'bloqueado' in dados && (dados as { bloqueado: unknown }).bloqueado);
    throw new ErroApi(mensagemErro, bloqueado);
  }

  return dados as T;
}

export const apiClient = {
  get: <T>(caminho: string) => requisicao<T>('GET', caminho),
  post: <T>(caminho: string, corpo: unknown) => requisicao<T>('POST', caminho, corpo),
  put: <T>(caminho: string, corpo: unknown) => requisicao<T>('PUT', caminho, corpo),
};
```

**Nota:** `ErroApi extends Error`, então todo código existente que faz `erro instanceof Error` (ex: `LoginCliente.tsx` atual) continua funcionando sem mudança — `ErroApi` só adiciona a propriedade `bloqueado` em cima disso.

- [ ] **Step 2: Rodar os testes existentes que dependem de `api/client.ts` e `api/auth.ts`**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/api/auth.test.ts
```

Expected: PASS — `ErroApi` é compatível com o `Error` genérico que os testes já esperam (verificam `.message`, não o tipo exato da classe).

- [ ] **Step 3: Escrever o teste de bloqueio em `LoginCliente.test.tsx` (falha primeiro)**

Ler `barbearia-web/src/pages/LoginCliente.test.tsx` atual e adicionar um novo teste ao describe existente:

```tsx
  test('mostra mensagem de bloqueio com link para recuperação quando a conta está bloqueada', async () => {
    vi.spyOn(authApi, 'loginCliente').mockRejectedValue(
      Object.assign(new Error('Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.'), {
        bloqueado: true,
      })
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginCliente />
        </AuthProvider>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'cliente@teste.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'senhaErrada');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(screen.getByText(/conta bloqueada/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /redefinir senha/i })).toHaveAttribute('href', '/recuperar-senha');
  });
```

**Nota:** o mock usa `Object.assign(new Error(...), { bloqueado: true })` em vez de importar `ErroApi` diretamente — isso testa o CONTRATO (um erro com propriedade `bloqueado: true`), não a classe concreta, então o teste não quebra se a implementação de `ErroApi` mudar de forma, só se o contrato mudar.

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/pages/LoginCliente.test.tsx
```

Expected: FAIL — a página ainda mostra o erro genérico, sem link de recuperação distinto.

- [ ] **Step 5: Remover o link cruzado e adicionar tratamento de bloqueio em `LoginCliente.tsx`**

Substituir o arquivo inteiro:

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Marca from '../components/Marca';
import styles from './Auth.module.css';

export default function LoginCliente() {
  const { entrarComoCliente } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setBloqueado(false);
    try {
      await entrarComoCliente(email, senha);
      navigate('/');
    } catch (erroCapturado) {
      const mensagem = erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao fazer login';
      setErro(mensagem);
      setBloqueado(
        erroCapturado instanceof Error && 'bloqueado' in erroCapturado && Boolean((erroCapturado as { bloqueado?: boolean }).bloqueado)
      );
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Gestão para barbearias</p>
        </div>

        <form className={styles.cartao} onSubmit={aoSubmeter}>
          <h1 className={styles.titulo}>Entrar</h1>

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

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="senha">
              Senha
            </label>
            <input
              className={styles.entrada}
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          {erro && !bloqueado && (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          )}

          {bloqueado && (
            <p className={styles.erro} role="alert">
              {erro} <Link to="/recuperar-senha">Redefinir senha</Link>
            </p>
          )}

          <p className={styles.rodape} style={{ marginTop: 0, marginBottom: '1rem', textAlign: 'right' }}>
            <Link to="/recuperar-senha">Esqueci minha senha</Link>
          </p>

          <button className={styles.botao} type="submit">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
```

Mudanças em relação ao arquivo atual: removido o parágrafo final `<p className={styles.rodape}>É o dono da barbearia? ...</p>`; adicionado estado `bloqueado` e o bloco condicional de mensagem de bloqueio com link.

- [ ] **Step 6: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/LoginCliente.test.tsx
```

Expected: PASS em todos os testes (os já existentes + o novo de bloqueio).

- [ ] **Step 7: Aplicar a mesma mudança em `LoginAdmin.tsx`**

Substituir o arquivo inteiro:

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Marca from '../components/Marca';
import styles from './Auth.module.css';

export default function LoginAdmin() {
  const { entrarComoAdmin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setBloqueado(false);
    try {
      await entrarComoAdmin(email, senha);
      navigate('/');
    } catch (erroCapturado) {
      const mensagem = erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao fazer login';
      setErro(mensagem);
      setBloqueado(
        erroCapturado instanceof Error && 'bloqueado' in erroCapturado && Boolean((erroCapturado as { bloqueado?: boolean }).bloqueado)
      );
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Painel do administrador</p>
        </div>

        <form className={styles.cartao} onSubmit={aoSubmeter}>
          <h1 className={styles.titulo}>Entrar como administrador</h1>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="email-admin">
              Email
            </label>
            <input
              className={styles.entrada}
              id="email-admin"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="senha-admin">
              Senha
            </label>
            <input
              className={styles.entrada}
              id="senha-admin"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          {erro && !bloqueado && (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          )}

          {bloqueado && (
            <p className={styles.erro} role="alert">
              {erro} <Link to="/recuperar-senha">Redefinir senha</Link>
            </p>
          )}

          <p className={styles.rodape} style={{ marginTop: 0, marginBottom: '1rem', textAlign: 'right' }}>
            <Link to="/recuperar-senha">Esqueci minha senha</Link>
          </p>

          <button className={styles.botao} type="submit">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
```

Mudanças em relação ao arquivo atual: removido o parágrafo final `<p className={styles.rodape}>É cliente da barbearia? ...</p>`; adicionado estado `bloqueado` e o bloco condicional de mensagem de bloqueio com link.

- [ ] **Step 8: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes passam, incluindo os já existentes.

- [ ] **Step 9: Type-check e build**

Run:
```bash
npx tsc -b
npx vite build
```

Expected: sem erros. Depois, remover `dist/` (`rm -rf dist`) para não deixar artefato de build no working tree.

- [ ] **Step 10: Commit**

```bash
git add barbearia-web/src/api/client.ts barbearia-web/src/pages/LoginCliente.tsx barbearia-web/src/pages/LoginAdmin.tsx barbearia-web/src/pages/LoginCliente.test.tsx
git commit -m "Separa telas de login e trata bloqueio de conta por tentativas"
```

---

## Task 5: Verificação manual de ponta a ponta

**Files:** nenhum arquivo novo — task de verificação.

- [ ] **Step 1: Subir backend e frontend localmente**

Run (dois processos em background):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api" && node src/server.js
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api\barbearia-web" && npm run dev
```

- [ ] **Step 2: Confirmar visualmente que as telas de login não têm mais link cruzado**

Acessar `http://localhost:5173/login` e `http://localhost:5173/admin/login` no navegador. Confirmar que nenhuma das duas menciona a outra.

- [ ] **Step 3: Testar o bloqueio via API com um admin de teste**

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
    \"INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash, email_verificado) VALUES (1, 'Admin Bloqueio E2E', 'admin.bloqueio.e2e@teste.com', \$1, true) ON CONFLICT (barbearia_id, email) DO UPDATE SET senha_hash = \$1, tentativas_login_falhas = 0, bloqueado_ate = NULL\",
    [senha_hash]
  );
  await client.query('COMMIT');
  client.release();
  await pool.end();
  console.log('admin de teste pronto');
})();
"

for i in 1 2 3 4 5; do
  curl -s -X POST http://localhost:3000/auth/admin/login -H "Content-Type: application/json" -d '{"email":"admin.bloqueio.e2e@teste.com","senha":"senhaErrada"}'
  echo
done

curl -s -X POST http://localhost:3000/auth/admin/login -H "Content-Type: application/json" -d '{"email":"admin.bloqueio.e2e@teste.com","senha":"senhaTeste123"}'
```

Expected: as 5 primeiras chamadas retornam `401`; a 6ª (com a senha CORRETA) retorna `423` com `"bloqueado":true`, confirmando que o bloqueio persiste mesmo com a senha certa uma vez atingido o limite.

- [ ] **Step 4: Limpar o admin de teste**

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
  await client.query(\"DELETE FROM usuario_admin WHERE email = 'admin.bloqueio.e2e@teste.com'\");
  await client.query('COMMIT');
  client.release();
  await pool.end();
})();
"
```

- [ ] **Step 5: Parar os servidores de dev**

Encerrar os processos `node src/server.js` e `npm run dev` iniciados no Step 1.

## Fora de escopo (lembrete)

Conforme spec: bloqueio por IP, notificação por email ao bloquear, painel de desbloqueio manual (super-admin), expiração automática de bloqueio por tempo.
