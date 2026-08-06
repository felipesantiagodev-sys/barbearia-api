# Frontend — Fundação e Tema por Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a base do frontend React (novo projeto `barbearia-web/`) com autenticação (login cliente + admin) e um sistema de tema dinâmico por barbearia, com proteção de contraste automática, consumindo a API `barbearia-api` já existente.

**Architecture:** Backend ganha uma migration aditiva (3 colunas de cor em `barbearia`) e 2 endpoints novos (`GET`/`PUT /barbearias/:id/tema`). O frontend é um projeto Vite+React+TypeScript separado, com Context API para autenticação e tema, aplicando cores via CSS custom properties no elemento raiz. Login busca o tema do tenant imediatamente após autenticar.

**Tech Stack:** Backend: Node.js/Express/pg (já existente, só extensão). Frontend: Vite, React 18, TypeScript, React Router (SPA com rotas protegidas). Sem dependências de UI pesadas (sem Material UI/Tailwind nesta fase — CSS puro com custom properties).

## Global Constraints

- Toda cor é armazenada e trafega em formato hexadecimal de 7 caracteres (`#RRGGBB`), validado no backend antes de salvar (rejeitar com 400 se não bater o formato).
- O endpoint `PUT /barbearias/:id/tema` segue o padrão de autorização já usado no projeto: `verificarToken` + `escoparTenant` + `apenasAdmin`, nesta ordem exata (mesmo padrão de `src/routes/authRoutes.js` e outras rotas administrativas).
- `GET /barbearias/:id/tema` é público (sem middleware de autenticação) — necessário para uso futuro sem login (subdomínio), e não expõe nenhum dado sensível (só 3 cores).
- O cálculo de contraste usa a fórmula de luminância relativa padrão WCAG, sem biblioteca externa — função pura, testável isoladamente.
- O JWT já retornado pelos endpoints de login (`POST /auth/cliente/login`, `POST /auth/admin/login`) tem o formato `{ token, nome, email }`, e o `token` decodificado contém `{ id, tipo, barbearia_id, papel? }` — não é modificado por este plano, apenas consumido pelo frontend.
- CORS no backend já está aberto (`cors()` sem restrição) — nenhuma configuração adicional de CORS é necessária.
- Migrations seguem o padrão SQL puro com bloco `-- Up Migration` / `-- Down Migration`, mesmo estilo de `migrations/000_schema_base.sql` até `010_indice_unico_email_pendente.sql`.

---

## File Structure

```
Backend (barbearia-api/):
  Criar:
    migrations/011_adicionar_tema_barbearia.sql
    src/controllers/temaController.js
    tests/integration/tema.test.js
  Modificar:
    src/routes/barbeariaRoutes.js       -- adiciona as 2 rotas de tema

Frontend (novo projeto barbearia-web/, criado dentro do repositório barbearia-api como subdiretório):
  Criar:
    barbearia-web/package.json, vite.config.ts, tsconfig.json, index.html
    barbearia-web/src/main.tsx                    -- entrypoint, monta o App
    barbearia-web/src/App.tsx                       -- define as rotas (React Router)
    barbearia-web/src/api/client.ts                 -- fetch wrapper com JWT automático
    barbearia-web/src/api/auth.ts                    -- loginCliente(), loginAdmin()
    barbearia-web/src/api/tema.ts                    -- buscarTema(), salvarTema()
    barbearia-web/src/contexts/AuthContext.tsx       -- estado de usuário logado, login/logout
    barbearia-web/src/contexts/TemaContext.tsx       -- estado de cores, aplica CSS custom properties
    barbearia-web/src/utils/contraste.ts             -- calcularCorTexto(corFundo): '#000000' | '#FFFFFF'
    barbearia-web/src/utils/contraste.test.ts
    barbearia-web/src/pages/LoginCliente.tsx
    barbearia-web/src/pages/LoginAdmin.tsx
    barbearia-web/src/pages/Home.tsx                 -- página pós-login mínima (prova que auth+tema funcionam)
    barbearia-web/src/components/RotaProtegida.tsx   -- wrapper de rota que exige login
    barbearia-web/src/index.css                       -- CSS custom properties base + estilos globais
```

Justificativa: `api/` isola toda comunicação HTTP (se a URL base ou formato de resposta mudar, só esses arquivos mudam). `contexts/` separa auth de tema — são dois estados independentes que não precisam saber um do outro (tema só depende de `barbearia_id`, que vem de auth, mas a lógica interna é distinta). `utils/contraste.ts` fica isolado porque é a única peça de lógica pura sem dependência de React, e precisa ser testável sem montar componentes.

---

## Task 1: Migration e endpoints de tema no backend

**Files:**
- Create: `migrations/011_adicionar_tema_barbearia.sql`
- Create: `src/controllers/temaController.js`
- Modify: `src/routes/barbeariaRoutes.js`
- Test: `tests/integration/tema.test.js`

**Interfaces:**
- Produces: `GET /barbearias/:id/tema` → `200 { cor_primaria, cor_fundo, cor_secundaria }` (todas string hex `#RRGGBB`) ou `404 { erro }` se a barbearia não existir. `PUT /barbearias/:id/tema` (autenticado, admin) → `200 { cor_primaria, cor_fundo, cor_secundaria }` com os valores salvos, ou `400 { erro }` se algum valor não for hex válido. Consumido por `barbearia-web/src/api/tema.ts` (Task 3).

- [ ] **Step 1: Escrever a migration**

```sql
-- Up Migration
ALTER TABLE barbearia
  ADD COLUMN cor_primaria VARCHAR(7) NOT NULL DEFAULT '#000000',
  ADD COLUMN cor_fundo VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN cor_secundaria VARCHAR(7) NOT NULL DEFAULT '#6B7280';

-- Down Migration
ALTER TABLE barbearia
  DROP COLUMN cor_primaria,
  DROP COLUMN cor_fundo,
  DROP COLUMN cor_secundaria;
```

- [ ] **Step 2: Rodar a migration no banco de dev**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx node-pg-migrate up
```

Expected: `011_adicionar_tema_barbearia` migrada sem erro. Se `barbearia_app` (role da aplicação) não tiver permissão de `ALTER TABLE` (mesma situação já documentada nas migrations 007-010), rode com credenciais de superuser só para esta migration:
```bash
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db" npx node-pg-migrate up
```

- [ ] **Step 3: Rodar a migration no banco de teste**

Run:
```bash
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db_test" npx node-pg-migrate up
```

- [ ] **Step 4: Verificar as colunas foram criadas com os defaults certos**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const r = await pool.query(\"SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'barbearia' AND column_name LIKE 'cor_%' ORDER BY column_name\");
  console.log(r.rows);
  await pool.end();
})();
"
```

Expected: 3 linhas — `cor_fundo` default `'#FFFFFF'::character varying`, `cor_primaria` default `'#000000'::character varying`, `cor_secundaria` default `'#6B7280'::character varying`.

- [ ] **Step 5: Escrever o teste dos endpoints (falha primeiro)**

`tests/integration/tema.test.js`:
```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { pool: poolTenant } = require('../../src/middlewares/tenant');
const { criarBarbearia, criarAdminDireto } = require('../helpers/factories');

describe('GET /barbearias/:id/tema', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
  });

  test('retorna as cores padrão de uma barbearia recém-criada', async () => {
    const barbearia = await criarBarbearia('Barbearia Padrão');

    const resposta = await request(app).get(`/barbearias/${barbearia.id}/tema`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
  });

  test('retorna 404 para barbearia inexistente', async () => {
    const resposta = await request(app).get('/barbearias/999999/tema');
    expect(resposta.status).toBe(404);
  });
});

describe('PUT /barbearias/:id/tema', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
    await poolTenant.end();
  });

  async function criarTokenAdmin(barbeariaId) {
    const admin = await criarAdminDireto(barbeariaId, { email: `admin-tema-${barbeariaId}@teste.com` });
    return jwt.sign(
      { id: admin.id, tipo: 'admin', barbearia_id: barbeariaId, papel: admin.papel },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  test('admin autenticado salva novas cores válidas', async () => {
    const barbearia = await criarBarbearia('Barbearia Colorida');
    const token = await criarTokenAdmin(barbearia.id);

    const resposta = await request(app)
      .put(`/barbearias/${barbearia.id}/tema`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cor_primaria: '#FF5733', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      cor_primaria: '#FF5733',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#3357FF',
    });

    const confirmacao = await request(app).get(`/barbearias/${barbearia.id}/tema`);
    expect(confirmacao.body.cor_primaria).toBe('#FF5733');
  });

  test('rejeita cor em formato inválido', async () => {
    const barbearia = await criarBarbearia('Barbearia Inválida');
    const token = await criarTokenAdmin(barbearia.id);

    const resposta = await request(app)
      .put(`/barbearias/${barbearia.id}/tema`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cor_primaria: 'vermelho', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

    expect(resposta.status).toBe(400);
  });

  test('rejeita sem token de autenticação', async () => {
    const barbearia = await criarBarbearia('Barbearia Sem Token');

    const resposta = await request(app)
      .put(`/barbearias/${barbearia.id}/tema`)
      .send({ cor_primaria: '#FF5733', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

    expect(resposta.status).toBe(401);
  });

  test('admin de uma barbearia não consegue alterar tema de outra', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');
    const tokenAdminA = await criarTokenAdmin(barbeariaA.id);

    const resposta = await request(app)
      .put(`/barbearias/${barbeariaB.id}/tema`)
      .set('Authorization', `Bearer ${tokenAdminA}`)
      .send({ cor_primaria: '#FF5733', cor_fundo: '#FFFFFF', cor_secundaria: '#3357FF' });

    expect(resposta.status).toBe(404);

    const confirmacao = await request(app).get(`/barbearias/${barbeariaB.id}/tema`);
    expect(confirmacao.body.cor_primaria).toBe('#000000');
  });
});
```

**Nota sobre o último teste**: `barbearia` não tem RLS (é a raiz do tenant), então um filtro de `barbearia_id` puro no `WHERE` da query não bloquearia sozinho um admin de A editar a barbearia B — a proteção precisa vir de uma checagem explícita no controller (`WHERE id = $1 AND id = <barbearia_id do token>` ou comparação direta), não de RLS. Implemente essa checagem explicitamente no Step 6 abaixo.

- [ ] **Step 6: Rodar o teste e confirmar que falha**

Run:
```bash
npx jest tests/integration/tema.test.js
```

Expected: FAIL — as rotas `/barbearias/:id/tema` não existem ainda (404 em todos os testes que esperam 200/400/409).

- [ ] **Step 7: Implementar `temaController.js`**

```javascript
const pool = require('../config/database');

const REGEX_COR_HEX = /^#[0-9A-Fa-f]{6}$/;

async function buscarTema(req, res) {
  const { id } = req.params;

  try {
    const resultado = await pool.query(
      'SELECT cor_primaria, cor_fundo, cor_secundaria FROM barbearia WHERE id = $1',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar tema' });
  }
}

async function salvarTema(req, res) {
  const { id } = req.params;
  const { cor_primaria, cor_fundo, cor_secundaria } = req.body;

  // `barbearia` não tem RLS (é a raiz do tenant) — a proteção contra um
  // admin editar o tema de OUTRA barbearia precisa ser explícita aqui,
  // comparando o :id da URL com o barbearia_id do próprio token, não
  // apenas confiando em RLS/escoparTenant (que aqui nem está na cadeia
  // desta rota, ver barbeariaRoutes.js).
  if (String(req.usuario.barbearia_id) !== String(id)) {
    return res.status(404).json({ erro: 'Barbearia não encontrada' });
  }

  if (![cor_primaria, cor_fundo, cor_secundaria].every((cor) => REGEX_COR_HEX.test(cor))) {
    return res.status(400).json({ erro: 'Cores devem estar no formato hexadecimal #RRGGBB' });
  }

  try {
    const resultado = await pool.query(
      `UPDATE barbearia SET cor_primaria = $1, cor_fundo = $2, cor_secundaria = $3
       WHERE id = $4 RETURNING cor_primaria, cor_fundo, cor_secundaria`,
      [cor_primaria, cor_fundo, cor_secundaria, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar tema' });
  }
}

module.exports = { buscarTema, salvarTema };
```

**Nota**: como `barbearia` não tem RLS, este controller usa `pool` diretamente (não `req.db`), consistente com `listarBarbearias` em `barbeariaController.js`, que já faz o mesmo. A checagem de posse (linha do `if (String(req.usuario.barbearia_id) !== String(id))`) é o que substitui a proteção que RLS daria em tabelas com tenant_id — sem ela, qualquer admin autenticado poderia alterar o tema de qualquer barbearia só sabendo o ID.

- [ ] **Step 8: Adicionar `verificarToken` e `apenasAdmin` na rota, e as 2 rotas em `barbeariaRoutes.js`**

Ler `src/routes/barbeariaRoutes.js` atual (já lido nesta sessão) e adicionar:

```javascript
const express = require('express');
const router = express.Router();
const { listarBarbearias, criarBarbearia } = require('../controllers/barbeariaController');
const { criarClientePublico } = require('../controllers/clienteController');
const { buscarTema, salvarTema } = require('../controllers/temaController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { apenasPlataforma } = require('../middlewares/tenant');

router.get('/', listarBarbearias);
router.post('/', verificarToken, apenasPlataforma, criarBarbearia);
router.post('/:barbearia_id/clientes', criarClientePublico);
router.get('/:id/tema', buscarTema);
router.put('/:id/tema', verificarToken, apenasAdmin, salvarTema);

module.exports = router;
```

**Nota**: não usa `escoparTenant` aqui (diferente do que o Global Constraints menciona como padrão geral do projeto) porque `escoparTenant` seta `app.tenant_id` para RLS, e `barbearia` não tem RLS — seria middleware sem efeito nesta rota específica. A proteção real de posse já está no controller (Step 7). `apenasAdmin` ainda é necessário para garantir que só admins (não clientes) chamem esta rota.

- [ ] **Step 9: Rodar o teste de novo**

Run:
```bash
npx jest tests/integration/tema.test.js --detectOpenHandles
```

Expected: todos os testes passam.

- [ ] **Step 10: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando (incluindo os já existentes), sem warning de handle aberto.

- [ ] **Step 11: Commit**

```bash
git add migrations/011_adicionar_tema_barbearia.sql src/controllers/temaController.js src/routes/barbeariaRoutes.js tests/integration/tema.test.js
git commit -m "Adiciona colunas de tema em barbearia e endpoints GET/PUT de tema"
```

---

## Task 2: Cálculo de contraste (função pura)

**Files:**
- Create: `barbearia-web/src/utils/contraste.ts`
- Test: `barbearia-web/src/utils/contraste.test.ts`

**Interfaces:**
- Produces: `calcularCorTexto(corFundoHex: string): '#000000' | '#FFFFFF'`. Consumido pela Task 5 (`TemaContext.tsx`) e por qualquer componente futuro (fase 3) que precise decidir a cor de texto sobre uma cor de fundo escolhida pelo usuário.

Esta task não depende de nenhuma outra e pode ser feita antes do projeto React existir tecnicamente — mas como precisa rodar dentro do projeto Vite (para usar o mesmo test runner), a Task 3 (setup do projeto) deve vir primeiro na ordem de execução real. Esta task assume que `barbearia-web/` já existe com Vitest configurado (ver Task 3).

- [ ] **Step 1: Escrever o teste (falha primeiro)**

`barbearia-web/src/utils/contraste.test.ts`:
```typescript
import { describe, test, expect } from 'vitest';
import { calcularCorTexto } from './contraste';

describe('calcularCorTexto', () => {
  test('retorna branco para fundo escuro', () => {
    expect(calcularCorTexto('#000000')).toBe('#FFFFFF');
    expect(calcularCorTexto('#1A1A1A')).toBe('#FFFFFF');
  });

  test('retorna preto para fundo claro', () => {
    expect(calcularCorTexto('#FFFFFF')).toBe('#000000');
    expect(calcularCorTexto('#F0F0F0')).toBe('#000000');
  });

  test('funciona com cores saturadas de luminância intermediária', () => {
    // Amarelo puro tem luminância alta -- texto deve ser escuro sobre ele.
    expect(calcularCorTexto('#FFFF00')).toBe('#000000');
    // Azul puro tem luminância baixa -- texto deve ser claro sobre ele.
    expect(calcularCorTexto('#0000FF')).toBe('#FFFFFF');
  });

  test('aceita hex em minúsculas', () => {
    expect(calcularCorTexto('#ffffff')).toBe('#000000');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/utils/contraste.test.ts
```

Expected: FAIL com `Cannot find module './contraste'` ou erro de import.

- [ ] **Step 3: Implementar a função**

`barbearia-web/src/utils/contraste.ts`:
```typescript
// Calcula a luminância relativa de uma cor (fórmula padrão WCAG 2.0:
// https://www.w3.org/TR/WCAG20/#relativeluminancedef) e decide entre preto
// e branco para o texto sobre ela, garantindo contraste mínimo legível
// mesmo quando o usuário escolhe a cor de fundo livremente.
export function calcularCorTexto(corFundoHex: string): '#000000' | '#FFFFFF' {
  const hex = corFundoHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const linearizar = (canal: number) =>
    canal <= 0.03928 ? canal / 12.92 : Math.pow((canal + 0.055) / 1.055, 2.4);

  const luminancia = 0.2126 * linearizar(r) + 0.7152 * linearizar(g) + 0.0722 * linearizar(b);

  // Limiar de 0.5 é uma aproximação padrão e simples: luminâncias acima
  // disso indicam fundo claro (texto escuro fica mais legível), abaixo
  // indicam fundo escuro (texto claro fica mais legível).
  return luminancia > 0.5 ? '#000000' : '#FFFFFF';
}
```

- [ ] **Step 4: Rodar o teste de novo**

Run:
```bash
npx vitest run src/utils/contraste.test.ts
```

Expected: PASS nos 4 testes.

- [ ] **Step 5: Commit**

```bash
git add barbearia-web/src/utils/contraste.ts barbearia-web/src/utils/contraste.test.ts
git commit -m "Adiciona calculo de contraste WCAG para cor de texto automatica"
```

---

## Task 3: Setup do projeto React (Vite + TypeScript + React Router)

**Files:**
- Create: `barbearia-web/package.json`, `barbearia-web/vite.config.ts`, `barbearia-web/tsconfig.json`, `barbearia-web/index.html`
- Create: `barbearia-web/src/main.tsx`
- Create: `barbearia-web/src/App.tsx`
- Create: `barbearia-web/src/index.css`

**Interfaces:**
- Produces: um projeto Vite funcional, rodando em `npm run dev`, com Vitest configurado para testes (`npm test`), e uma rota raiz `/` renderizando um placeholder. Todas as tasks seguintes (4-7) dependem deste setup existir.

- [ ] **Step 1: Criar o projeto Vite**

Run (a partir da raiz do repositório `barbearia-api/`):
```bash
npm create vite@latest barbearia-web -- --template react-ts
cd barbearia-web
npm install
```

Expected: diretório `barbearia-web/` criado com a estrutura padrão do template `react-ts` do Vite (inclui `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, entre outros).

- [ ] **Step 2: Instalar React Router e Vitest**

Run (dentro de `barbearia-web/`):
```bash
npm install react-router-dom
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Configurar Vitest em `vite.config.ts`**

Ler o `vite.config.ts` gerado pelo template (contém a config padrão do plugin React) e adicionar a seção `test`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Adicionar script de teste ao `package.json`**

Adicionar em `"scripts"` (preservando os scripts já gerados pelo Vite — `dev`, `build`, `preview`, `lint`):
```json
"test": "vitest run"
```

- [ ] **Step 5: Limpar o boilerplate padrão do Vite e criar uma rota mínima**

Substituir o conteúdo de `barbearia-web/src/App.tsx` (removendo o contador/logo padrão do template):

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function Placeholder() {
  return <div>Barbearia Web — em construção</div>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Placeholder />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

Substituir `barbearia-web/src/index.css` por um reset mínimo (o conteúdo padrão do Vite não é necessário):

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--cor-texto-sobre-fundo, #000000);
  background-color: var(--cor-fundo, #FFFFFF);
}
```

As variáveis `--cor-fundo`/`--cor-texto-sobre-fundo` já aparecem aqui com fallback, mesmo antes de o `TemaContext` (Task 5) existir — isso garante que a página nunca fica sem estilo básico caso o contexto ainda não tenha rodado.

- [ ] **Step 6: Rodar o projeto e confirmar que sobe**

Run:
```bash
npm run dev
```

Expected: servidor de desenvolvimento inicia (tipicamente em `http://localhost:5173`), sem erro no terminal. Pare o servidor (Ctrl+C) após confirmar.

- [ ] **Step 7: Rodar o teste (vazio, mas confirma que o runner funciona)**

Run:
```bash
npm test
```

Expected: Vitest executa sem encontrar nenhum arquivo de teste ainda (`No test files found` ou similar) — isso é esperado, a Task 2 (contraste.test.ts) e as tasks seguintes é que vão adicionar testes reais. Se a Task 2 já foi executada antes desta (ordem alternativa), o teste de contraste deve passar aqui.

- [ ] **Step 8: Commit**

```bash
git add barbearia-web/
git commit -m "Cria projeto React (Vite + TypeScript + React Router) para o frontend"
```

---

## Task 4: Cliente de API e módulo de autenticação

**Files:**
- Create: `barbearia-web/src/api/client.ts`
- Create: `barbearia-web/src/api/auth.ts`
- Test: `barbearia-web/src/api/auth.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores diretamente (usa apenas a API HTTP do backend).
- Produces: `apiClient.get<T>(caminho: string): Promise<T>`, `apiClient.post<T>(caminho: string, corpo: unknown): Promise<T>`, `apiClient.put<T>(caminho: string, corpo: unknown): Promise<T>` (todas lançam erro se a resposta não for 2xx, incluindo a mensagem `erro` do corpo da resposta quando disponível). `setToken(token: string | null): void` e `getToken(): string | null` (gerenciam o JWT em `localStorage`). `loginCliente(email: string, senha: string): Promise<{ token: string; nome: string; email: string }>`, `loginAdmin(email: string, senha: string): Promise<{ token: string; nome: string; email: string }>`. Consumido pela Task 5 (`AuthContext.tsx`) e Task 6 (`TemaContext.tsx`, via `apiClient`).

- [ ] **Step 1: Implementar o cliente de API**

`barbearia-web/src/api/client.ts`:
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
    throw new Error(mensagemErro);
  }

  return dados as T;
}

export const apiClient = {
  get: <T>(caminho: string) => requisicao<T>('GET', caminho),
  post: <T>(caminho: string, corpo: unknown) => requisicao<T>('POST', caminho, corpo),
  put: <T>(caminho: string, corpo: unknown) => requisicao<T>('PUT', caminho, corpo),
};
```

Nota: `URL_BASE` fixo em `http://localhost:3000` é aceitável para esta fase (desenvolvimento local) — uma variável de ambiente (`import.meta.env.VITE_API_URL`) é uma melhoria natural quando houver deploy real, mas está fora do escopo desta fase (nenhuma infraestrutura de deploy existe ainda para o backend também).

- [ ] **Step 2: Implementar o módulo de autenticação**

`barbearia-web/src/api/auth.ts`:
```typescript
import { apiClient } from './client';

interface RespostaLogin {
  token: string;
  nome: string;
  email: string;
}

export function loginCliente(email: string, senha: string): Promise<RespostaLogin> {
  return apiClient.post<RespostaLogin>('/auth/cliente/login', { email, senha });
}

export function loginAdmin(email: string, senha: string): Promise<RespostaLogin> {
  return apiClient.post<RespostaLogin>('/auth/admin/login', { email, senha });
}
```

- [ ] **Step 3: Escrever teste do cliente de API usando mock do `fetch` global**

`barbearia-web/src/api/auth.test.ts`:
```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { loginCliente, loginAdmin } from './auth';
import { setToken } from './client';

describe('auth', () => {
  beforeEach(() => {
    setToken(null);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('loginCliente chama o endpoint correto e retorna os dados', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-fake', nome: 'Cliente Teste', email: 'cliente@teste.com' }),
    });

    const resultado = await loginCliente('cliente@teste.com', 'senha123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/auth/cliente/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'cliente@teste.com', senha: 'senha123' }),
      })
    );
    expect(resultado).toEqual({ token: 'jwt-fake', nome: 'Cliente Teste', email: 'cliente@teste.com' });
  });

  test('loginAdmin chama o endpoint correto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-fake-admin', nome: 'Admin Teste', email: 'admin@teste.com' }),
    });

    await loginAdmin('admin@teste.com', 'senha123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/auth/admin/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('lança erro com a mensagem do backend quando a resposta não é ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ erro: 'Email ou senha inválidos' }),
    });

    await expect(loginCliente('errado@teste.com', 'senhaErrada')).rejects.toThrow('Email ou senha inválidos');
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/api/auth.test.ts
```

Expected: PASS nos 3 testes. (Este teste não precisa de fase "falha primeiro" separada, pois `client.ts`/`auth.ts` já foram escritos no Step 1-2 — a ordem aqui é implementação seguida de teste, aceitável para módulos de infraestrutura sem lógica de negócio complexa; a Task 2 e as tasks seguintes com lógica real seguem TDD completo.)

- [ ] **Step 5: Commit**

```bash
git add barbearia-web/src/api/
git commit -m "Adiciona cliente de API e modulo de autenticacao (login cliente e admin)"
```

---

## Task 5: `AuthContext` — estado de autenticação

**Files:**
- Create: `barbearia-web/src/contexts/AuthContext.tsx`
- Test: `barbearia-web/src/contexts/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `loginCliente`, `loginAdmin` de `api/auth.ts` (Task 4); `setToken`, `getToken` de `api/client.ts` (Task 4).
- Produces: `AuthProvider` (componente React), hook `useAuth()` retornando `{ usuario: { id: number; tipo: 'cliente' | 'admin'; barbearia_id: number; nome: string; email: string } | null; entrarComoCliente(email: string, senha: string): Promise<void>; entrarComoAdmin(email: string, senha: string): Promise<void>; sair(): void; carregando: boolean }`. Consumido pela Task 7 (páginas de login) e Task 8 (rota protegida).

- [ ] **Step 1: Escrever o teste (falha primeiro)**

`barbearia-web/src/contexts/AuthContext.test.tsx`:
```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth';
import { setToken } from '../api/client';

function ComponenteDeTeste() {
  const { usuario, entrarComoCliente, sair } = useAuth();
  return (
    <div>
      <span data-testid="usuario">{usuario ? usuario.nome : 'sem-usuario'}</span>
      <button onClick={() => entrarComoCliente('cliente@teste.com', 'senha123')}>Entrar</button>
      <button onClick={sair}>Sair</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    setToken(null);
  });

  test('entrarComoCliente autentica e popula o usuário decodificado do token', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 3 })) +
      '.assinatura-fake';

    vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
      token: tokenFalso,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
    });

    render(
      <AuthProvider>
        <ComponenteDeTeste />
      </AuthProvider>
    );

    expect(screen.getByTestId('usuario').textContent).toBe('sem-usuario');

    await userEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByTestId('usuario').textContent).toBe('Cliente Teste');
    });
  });

  test('sair limpa o usuário e o token', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 3 })) +
      '.assinatura-fake';

    vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
      token: tokenFalso,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
    });

    render(
      <AuthProvider>
        <ComponenteDeTeste />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('Entrar'));
    await waitFor(() => expect(screen.getByTestId('usuario').textContent).toBe('Cliente Teste'));

    await userEvent.click(screen.getByText('Sair'));

    await waitFor(() => expect(screen.getByTestId('usuario').textContent).toBe('sem-usuario'));
  });
});
```

- [ ] **Step 2: Instalar `@testing-library/user-event` se ainda não estiver instalado**

Run (dentro de `barbearia-web/`):
```bash
npm install --save-dev @testing-library/user-event
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/contexts/AuthContext.test.tsx
```

Expected: FAIL com erro de módulo não encontrado (`./AuthContext` não existe ainda).

- [ ] **Step 4: Implementar `AuthContext.tsx`**

```tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { loginCliente, loginAdmin } from '../api/auth';
import { setToken } from '../api/client';

interface UsuarioAutenticado {
  id: number;
  tipo: 'cliente' | 'admin';
  barbearia_id: number;
  nome: string;
  email: string;
}

interface ContextoAuth {
  usuario: UsuarioAutenticado | null;
  entrarComoCliente(email: string, senha: string): Promise<void>;
  entrarComoAdmin(email: string, senha: string): Promise<void>;
  sair(): void;
  carregando: boolean;
}

const AuthContext = createContext<ContextoAuth | null>(null);

// O JWT tem 3 partes separadas por ".": cabeçalho, payload, assinatura.
// Decodificamos só o payload (base64) para extrair id/tipo/barbearia_id --
// isso NUNCA é usado para decisões de autorização (o backend já validou a
// assinatura antes de aceitar a requisição); é só para saber quem está
// logado e montar a UI/roteamento no cliente.
function decodificarPayloadJwt(token: string): { id: number; tipo: 'cliente' | 'admin'; barbearia_id: number } {
  const [, payloadBase64] = token.split('.');
  return JSON.parse(atob(payloadBase64));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioAutenticado | null>(null);
  const [carregando, setCarregando] = useState(false);

  const entrarComoCliente = useCallback(async (email: string, senha: string) => {
    setCarregando(true);
    try {
      const resposta = await loginCliente(email, senha);
      const payload = decodificarPayloadJwt(resposta.token);
      setToken(resposta.token);
      setUsuario({ ...payload, nome: resposta.nome, email: resposta.email });
    } finally {
      setCarregando(false);
    }
  }, []);

  const entrarComoAdmin = useCallback(async (email: string, senha: string) => {
    setCarregando(true);
    try {
      const resposta = await loginAdmin(email, senha);
      const payload = decodificarPayloadJwt(resposta.token);
      setToken(resposta.token);
      setUsuario({ ...payload, nome: resposta.nome, email: resposta.email });
    } finally {
      setCarregando(false);
    }
  }, []);

  const sair = useCallback(() => {
    setToken(null);
    setUsuario(null);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, entrarComoCliente, entrarComoAdmin, sair, carregando }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): ContextoAuth {
  const contexto = useContext(AuthContext);
  if (!contexto) {
    throw new Error('useAuth precisa ser usado dentro de um AuthProvider');
  }
  return contexto;
}
```

- [ ] **Step 5: Rodar o teste de novo**

Run:
```bash
npx vitest run src/contexts/AuthContext.test.tsx
```

Expected: PASS nos 2 testes.

- [ ] **Step 6: Commit**

```bash
git add barbearia-web/src/contexts/AuthContext.tsx barbearia-web/src/contexts/AuthContext.test.tsx barbearia-web/package.json barbearia-web/package-lock.json
git commit -m "Adiciona AuthContext com login cliente/admin e decodificacao de JWT"
```

---

## Task 6: API e `TemaContext` — busca e aplicação de cores

**Files:**
- Create: `barbearia-web/src/api/tema.ts`
- Create: `barbearia-web/src/contexts/TemaContext.tsx`
- Test: `barbearia-web/src/contexts/TemaContext.test.tsx`

**Interfaces:**
- Consumes: `apiClient` de `api/client.ts` (Task 4); `calcularCorTexto` de `utils/contraste.ts` (Task 2); `useAuth` de `contexts/AuthContext.tsx` (Task 5, para saber o `barbearia_id` atual).
- Produces: `buscarTema(barbeariaId: number): Promise<{ cor_primaria: string; cor_fundo: string; cor_secundaria: string }>`, `salvarTema(barbeariaId: number, cores: { cor_primaria: string; cor_fundo: string; cor_secundaria: string }): Promise<{ cor_primaria: string; cor_fundo: string; cor_secundaria: string }>` (ambas em `api/tema.ts`). `TemaProvider` (componente React) e hook `useTema()` retornando `{ cores: { cor_primaria: string; cor_fundo: string; cor_secundaria: string } | null; recarregarTema(): Promise<void> }`. Consumido pela Task 7 (aplicado no `App.tsx` via `TemaProvider` envolvendo as rotas autenticadas) e pela fase 3 (editor de tema no painel admin).

- [ ] **Step 1: Implementar `api/tema.ts`**

```typescript
import { apiClient } from './client';

export interface CoresTema {
  cor_primaria: string;
  cor_fundo: string;
  cor_secundaria: string;
}

export function buscarTema(barbeariaId: number): Promise<CoresTema> {
  return apiClient.get<CoresTema>(`/barbearias/${barbeariaId}/tema`);
}

export function salvarTema(barbeariaId: number, cores: CoresTema): Promise<CoresTema> {
  return apiClient.put<CoresTema>(`/barbearias/${barbeariaId}/tema`, cores);
}
```

- [ ] **Step 2: Escrever o teste do `TemaContext` (falha primeiro)**

`barbearia-web/src/contexts/TemaContext.test.tsx`:
```tsx
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TemaProvider, useTema } from './TemaContext';
import * as temaApi from '../api/tema';

function ComponenteDeTeste() {
  const { cores } = useTema();
  return <span data-testid="cor-primaria">{cores ? cores.cor_primaria : 'sem-tema'}</span>;
}

describe('TemaContext', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('busca o tema da barbearia e aplica as CSS custom properties no documento', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#FF5733',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#3357FF',
    });

    render(
      <TemaProvider barbeariaId={5}>
        <ComponenteDeTeste />
      </TemaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cor-primaria').textContent).toBe('#FF5733');
    });

    expect(document.documentElement.style.getPropertyValue('--cor-primaria')).toBe('#FF5733');
    expect(document.documentElement.style.getPropertyValue('--cor-fundo')).toBe('#FFFFFF');
    expect(document.documentElement.style.getPropertyValue('--cor-secundaria')).toBe('#3357FF');
  });

  test('calcula e aplica a cor de texto sobre o fundo automaticamente', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#FF5733',
      cor_fundo: '#000000', // fundo escuro -- texto deve ficar branco
      cor_secundaria: '#3357FF',
    });

    render(
      <TemaProvider barbeariaId={5}>
        <ComponenteDeTeste />
      </TemaProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--cor-texto-sobre-fundo')).toBe('#FFFFFF');
    });
  });

  test('não quebra se barbeariaId for null (usuário deslogado)', () => {
    render(
      <TemaProvider barbeariaId={null}>
        <ComponenteDeTeste />
      </TemaProvider>
    );

    expect(screen.getByTestId('cor-primaria').textContent).toBe('sem-tema');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/contexts/TemaContext.test.tsx
```

Expected: FAIL com erro de módulo não encontrado.

- [ ] **Step 4: Implementar `TemaContext.tsx`**

```tsx
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { buscarTema, type CoresTema } from '../api/tema';
import { calcularCorTexto } from '../utils/contraste';

interface ContextoTema {
  cores: CoresTema | null;
  recarregarTema(): Promise<void>;
}

const TemaContext = createContext<ContextoTema | null>(null);

function aplicarCoresNoDocumento(cores: CoresTema): void {
  const raiz = document.documentElement;
  raiz.style.setProperty('--cor-primaria', cores.cor_primaria);
  raiz.style.setProperty('--cor-fundo', cores.cor_fundo);
  raiz.style.setProperty('--cor-secundaria', cores.cor_secundaria);
  raiz.style.setProperty('--cor-texto-sobre-fundo', calcularCorTexto(cores.cor_fundo));
  raiz.style.setProperty('--cor-texto-sobre-primaria', calcularCorTexto(cores.cor_primaria));
}

export function TemaProvider({
  barbeariaId,
  children,
}: {
  barbeariaId: number | null;
  children: ReactNode;
}) {
  const [cores, setCores] = useState<CoresTema | null>(null);

  const recarregarTema = useCallback(async () => {
    if (barbeariaId === null) {
      setCores(null);
      return;
    }
    const dados = await buscarTema(barbeariaId);
    setCores(dados);
    aplicarCoresNoDocumento(dados);
  }, [barbeariaId]);

  useEffect(() => {
    recarregarTema();
  }, [recarregarTema]);

  return (
    <TemaContext.Provider value={{ cores, recarregarTema }}>
      {children}
    </TemaContext.Provider>
  );
}

export function useTema(): ContextoTema {
  const contexto = useContext(TemaContext);
  if (!contexto) {
    throw new Error('useTema precisa ser usado dentro de um TemaProvider');
  }
  return contexto;
}
```

- [ ] **Step 5: Rodar o teste de novo**

Run:
```bash
npx vitest run src/contexts/TemaContext.test.tsx
```

Expected: PASS nos 3 testes.

- [ ] **Step 6: Commit**

```bash
git add barbearia-web/src/api/tema.ts barbearia-web/src/contexts/TemaContext.tsx barbearia-web/src/contexts/TemaContext.test.tsx
git commit -m "Adiciona TemaContext: busca cores da barbearia e aplica CSS custom properties"
```

---

## Task 7: Páginas de login e integração final em `App.tsx`

**Files:**
- Create: `barbearia-web/src/pages/LoginCliente.tsx`
- Create: `barbearia-web/src/pages/LoginAdmin.tsx`
- Create: `barbearia-web/src/pages/Home.tsx`
- Create: `barbearia-web/src/components/RotaProtegida.tsx`
- Modify: `barbearia-web/src/App.tsx`
- Test: `barbearia-web/src/pages/LoginCliente.test.tsx`

**Interfaces:**
- Consumes: `useAuth` de `contexts/AuthContext.tsx` (Task 5); `TemaProvider`, `useTema` de `contexts/TemaContext.tsx` (Task 6).
- Produces: rotas `/login` (cliente), `/admin/login` (admin), `/` (home protegida). Esta é a última task da fase — entrega o fluxo completo testável manualmente: acessar `/login`, autenticar, ver a home com o tema da barbearia aplicado.

- [ ] **Step 1: Escrever o teste da página de login de cliente (falha primeiro)**

`barbearia-web/src/pages/LoginCliente.test.tsx`:
```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import * as authApi from '../api/auth';
import { setToken } from '../api/client';
import LoginCliente from './LoginCliente';

describe('LoginCliente', () => {
  beforeEach(() => {
    setToken(null);
  });

  test('envia email e senha preenchidos ao submeter o formulário', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 1, tipo: 'cliente', barbearia_id: 1 })) +
      '.assinatura-fake';

    const mockLogin = vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
      token: tokenFalso,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginCliente />
        </AuthProvider>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'cliente@teste.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'senha123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('cliente@teste.com', 'senha123');
    });
  });

  test('exibe mensagem de erro quando o login falha', async () => {
    vi.spyOn(authApi, 'loginCliente').mockRejectedValue(new Error('Email ou senha inválidos'));

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
      expect(screen.getByText('Email ou senha inválidos')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/pages/LoginCliente.test.tsx
```

Expected: FAIL — `./LoginCliente` não existe ainda.

- [ ] **Step 3: Implementar `LoginCliente.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginCliente() {
  const { entrarComoCliente } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await entrarComoCliente(email, senha);
      navigate('/');
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao fazer login');
    }
  }

  return (
    <form onSubmit={aoSubmeter}>
      <h1>Entrar</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

      <label htmlFor="senha">Senha</label>
      <input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />

      {erro && <p role="alert">{erro}</p>}

      <button type="submit">Entrar</button>
    </form>
  );
}
```

- [ ] **Step 4: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/LoginCliente.test.tsx
```

Expected: PASS nos 2 testes.

- [ ] **Step 5: Implementar `LoginAdmin.tsx` (estrutura idêntica, trocando o método de auth)**

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginAdmin() {
  const { entrarComoAdmin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await entrarComoAdmin(email, senha);
      navigate('/');
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao fazer login');
    }
  }

  return (
    <form onSubmit={aoSubmeter}>
      <h1>Entrar como administrador</h1>
      <label htmlFor="email-admin">Email</label>
      <input id="email-admin" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

      <label htmlFor="senha-admin">Senha</label>
      <input id="senha-admin" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />

      {erro && <p role="alert">{erro}</p>}

      <button type="submit">Entrar</button>
    </form>
  );
}
```

- [ ] **Step 6: Implementar `RotaProtegida.tsx`**

```tsx
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RotaProtegida({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();

  if (!usuario) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 7: Implementar `Home.tsx` (prova mínima de que auth + tema funcionam juntos)**

```tsx
import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';

export default function Home() {
  const { usuario, sair } = useAuth();
  const { cores } = useTema();

  return (
    <div>
      <h1>Olá, {usuario?.nome}</h1>
      <p>Tipo: {usuario?.tipo}</p>
      {cores && (
        <p>
          Cor primária da sua barbearia: <span style={{ color: cores.cor_primaria }}>{cores.cor_primaria}</span>
        </p>
      )}
      <button onClick={sair}>Sair</button>
    </div>
  );
}
```

- [ ] **Step 8: Integrar tudo em `App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TemaProvider } from './contexts/TemaContext';
import LoginCliente from './pages/LoginCliente';
import LoginAdmin from './pages/LoginAdmin';
import Home from './pages/Home';
import RotaProtegida from './components/RotaProtegida';

function AreaComTema({ children }: { children: React.ReactNode }) {
  const { usuario } = useAuth();
  return <TemaProvider barbeariaId={usuario?.barbearia_id ?? null}>{children}</TemaProvider>;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AreaComTema>
          <Routes>
            <Route path="/login" element={<LoginCliente />} />
            <Route path="/admin/login" element={<LoginAdmin />} />
            <Route
              path="/"
              element={
                <RotaProtegida>
                  <Home />
                </RotaProtegida>
              }
            />
          </Routes>
        </AreaComTema>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

Nota de design: `TemaProvider` envolve TODAS as rotas (inclusive as de login) para que `useTema` nunca lance erro de "fora do provider" em nenhuma página — mas como `barbeariaId` é `null` antes do login, o tema fica em branco/neutro até autenticar, conforme decidido no spec (seção 3: "antes do login, a tela é neutra").

- [ ] **Step 9: Rodar a suíte completa do frontend**

Run (dentro de `barbearia-web/`):
```bash
npm test
```

Expected: todos os testes de todas as tasks (contraste, auth, AuthContext, TemaContext, LoginCliente) passam.

- [ ] **Step 10: Teste manual do fluxo completo**

Com o backend rodando (`node src/server.js` na raiz do `barbearia-api/`) e o frontend rodando (`npm run dev` em `barbearia-web/`):

1. Acesse `http://localhost:5173/login` no navegador.
2. Tente logar com um cliente de teste já existente no banco (ou crie um via API/onboarding primeiro).
3. Confirme que, após o login, a página `/` mostra "Olá, <nome>" e a cor primária da barbearia.
4. Repita o processo em `/admin/login` com um admin de teste.

- [ ] **Step 11: Commit**

```bash
git add barbearia-web/src/pages/ barbearia-web/src/components/ barbearia-web/src/App.tsx
git commit -m "Adiciona paginas de login, rota protegida e integra AuthContext+TemaContext"
```

## Fora de escopo (lembrete)

Conforme spec: telas de agendamento/serviços/histórico (fase 2), painel completo de cadastro/financeiro e o editor visual de tema com preview (fase 3), subdomínio por tenant, upload de logo, fluxo de "esqueci minha senha".
