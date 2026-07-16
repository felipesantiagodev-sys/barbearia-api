# Fundação Multi-Tenant — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o `barbearia-api` (hoje mono-tenant, com vazamento de dados garantido entre barbearias) em uma base multi-tenant segura, com isolamento de dados por `barbearia_id` reforçado por Row-Level Security no PostgreSQL, JWT escopado por tenant, e todas as queries existentes corrigidas.

**Architecture:** Banco compartilhado + coluna `barbearia_id` desnormalizada em toda tabela + RLS (`FORCE ROW LEVEL SECURITY`) como defesa em profundidade. Middleware por requisição abre uma transação dedicada, seta `app.tenant_id` via `SET LOCAL`, e injeta o client escopado em `req.db`. Migrations com `node-pg-migrate` em SQL puro. Novo papel `usuario_plataforma` (super-admin) fora da hierarquia de tenant, com bypass de RLS explícito e auditável.

**Tech Stack:** Node.js, Express 5, `pg` (driver puro), PostgreSQL 16, `node-pg-migrate` (novo), Jest + Supertest (novo, para testes de integração contra banco real).

**Referência:** spec completo em `docs/superpowers/specs/2026-07-15-fundacao-multi-tenant-design.md`.

---

## Antes de começar — schema real do banco (`barbearia_db`)

Confirmado por inspeção direta via `information_schema` (não por leitura de código, já que não há DDL versionado):

```
barbearia(id SERIAL PK, nome, cnpj, criado_em)
unidade(id SERIAL PK, barbearia_id FK->barbearia, nome, endereco, telefone, ativo, criado_em)
barbeiro(id SERIAL PK, unidade_id FK->unidade, nome, email, telefone, foto_url, ativo, criado_em)
barbeiro_disponibilidade(id SERIAL PK, barbeiro_id FK->barbeiro, dia_semana, hora_inicio, hora_fim)
barbeiro_excecao(id SERIAL PK, barbeiro_id FK->barbeiro, data, tipo, hora_inicio, hora_fim, motivo)
barbeiro_servico(barbeiro_id FK->barbeiro, servico_id FK->servico)  -- sem PK própria, ON CONFLICT DO NOTHING
servico(id SERIAL PK, barbearia_id FK->barbearia, nome, categoria, duracao_minutos, valor, ativo, criado_em)
plano(id SERIAL PK, barbearia_id FK->barbearia, nome, valor_mensal, intervalo_minimo_dias, ativo, criado_em, desconto_servico_fora_plano)
plano_servico(plano_id FK->plano, servico_id FK->servico)
cliente(id SERIAL PK, nome, email, telefone, senha_hash, criado_em)  -- SEM barbearia_id hoje
usuario_admin(id SERIAL PK, barbearia_id FK->barbearia, nome, email, senha_hash, papel default 'dono', ativo, criado_em)
assinatura(id SERIAL PK, cliente_id FK->cliente, plano_id FK->plano, status, data_inicio, proxima_cobranca, gateway_subscription_id, criado_em)
agendamento(id SERIAL PK, cliente_id FK->cliente, barbeiro_id FK->barbeiro, unidade_id FK->unidade, data_hora_inicio, data_hora_fim, status, criado_em, reagendado_de_id FK->agendamento nullable)
agendamento_servico(id SERIAL PK, agendamento_id FK->agendamento, servico_id FK->servico, coberto_pelo_plano, valor_cobrado)
notificacao(id SERIAL PK, agendamento_id FK->agendamento, tipo, status, enviado_em, criado_em)
pagamento(id SERIAL PK, agendamento_id FK->agendamento nullable, assinatura_id FK->assinatura nullable, valor, status, gateway_payment_id, criado_em)
```

Views:
```sql
-- vw_faturamento_mensal
SELECT date_trunc('month', criado_em)::date AS mes,
    sum(CASE WHEN assinatura_id IS NOT NULL THEN valor ELSE 0 END) AS receita_planos,
    sum(CASE WHEN agendamento_id IS NOT NULL THEN valor ELSE 0 END) AS receita_avulso,
    sum(valor) AS receita_total
FROM pagamento p
WHERE status = 'pago'
GROUP BY date_trunc('month', criado_em)
ORDER BY date_trunc('month', criado_em);

-- vw_desempenho_barbeiro_mensal
SELECT b.id AS barbeiro_id, b.nome AS barbeiro_nome,
    date_trunc('month', a.data_hora_inicio)::date AS mes,
    count(DISTINCT a.id) AS total_atendimentos,
    count(DISTINCT a.cliente_id) AS clientes_distintos,
    string_agg(DISTINCT s.nome, ', ') AS procedimentos_realizados,
    sum(asv.valor_cobrado) AS faturamento_gerado
FROM agendamento a
JOIN barbeiro b ON b.id = a.barbeiro_id
JOIN agendamento_servico asv ON asv.agendamento_id = a.id
JOIN servico s ON s.id = asv.servico_id
WHERE a.status = 'concluido'
GROUP BY b.id, b.nome, date_trunc('month', a.data_hora_inicio)
ORDER BY date_trunc('month', a.data_hora_inicio), b.nome;
```

Hoje existe **1 barbearia** cadastrada no banco de desenvolvimento.

---

## File Structure

```
Criar:
  migrations/                                    (nova pasta, node-pg-migrate)
    001_criar_tabela_usuario_plataforma.sql
    002_adicionar_barbearia_id.sql
    003_backfill_barbearia_id.sql
    004_constraints_not_null_e_unique.sql
    005_habilitar_rls.sql
    006_indices_compostos.sql
    007_recriar_views_com_tenant.sql
  .node-pg-migraterc.json
  src/app.js                                       (Express app sem listen, para testes com Supertest)
  src/middlewares/tenant.js                        (escoparTenant, apenasPlataforma)
  src/controllers/plataformaController.js          (loginPlataforma)
  src/routes/plataformaRoutes.js
  jest.config.js
  tests/setup.js
  tests/helpers/db.js                              (conecta banco de teste, limpa entre testes)
  tests/helpers/factories.js                       (cria barbearia de teste)
  tests/integration/tenant-isolation.test.js        (o teste mais importante do plano — prova que RLS bloqueia cross-tenant)
  tests/integration/plataforma.test.js
  tests/integration/auth.test.js
  tests/integration/cliente.test.js
  tests/integration/agendamento.test.js

Modificar:
  package.json                                     (scripts de migration/teste, devDependencies)
  .env                                              (novas vars DB_NAME_TEST, DATABASE_URL)
  .gitignore                                        (garantir que .env está listado)
  src/server.js                                     (fica só com app.listen; app.js assume o resto)
  src/controllers/authController.js                 (loginCliente inclui barbearia_id; cadastrarAdmin exige contexto autenticado)
  src/routes/authRoutes.js                          (nova rota /plataforma/login via plataformaRoutes; cadastro de admin exige token)
  src/controllers/barbeariaController.js            (criarBarbearia protegido por apenasPlataforma)
  src/routes/barbeariaRoutes.js                     (POST protegido; nova sub-rota de cadastro de cliente)
  src/controllers/clienteController.js              (usa req.db; criarClientePublico escopado pela URL, não pelo body)
  src/routes/clienteRoutes.js
  src/controllers/unidadeController.js, barbeiroController.js, servicoController.js, planoController.js, financeiroController.js, agendamentoController.js, notificacaoController.js  (trocam pool/client próprio por req.db)
  src/routes/unidadeRoutes.js, barbeiroRoutes.js, servicoRoutes.js, planoRoutes.js, financeiroRoutes.js, agendamentoRoutes.js, notificacaoRoutes.js  (adicionam escoparTenant)
  src/services/notificacaoService.js                (enviarLembretes recebe client já escopado)
  src/jobs/lembretes.js                             (itera todas as barbearias ativas, escopando cada execução)
```

Justificativa da decomposição: migrations separadas por preocupação (schema → dados → constraints → segurança → performance → views) permitem revisar e, se necessário, reverter cada camada isoladamente — crítico numa mudança que toca RLS em produção. `tenant.js` fica separado de `autenticacao.js` porque são preocupações distintas (autenticação vs. escopo de dados) que podem evoluir independentemente.

---

## Task 0: Instalar dependências novas e configurar ambiente de teste

**Files:**
- Modify: `package.json`
- Modify: `.env`
- Create: `jest.config.js`

- [ ] **Step 1: Instalar node-pg-migrate, jest e supertest**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npm install --save-dev node-pg-migrate jest supertest
```

Expected: as três libs aparecem em `devDependencies` no `package.json`.

- [ ] **Step 2: Criar banco de teste dedicado**

O RLS e o isolamento entre tenants só podem ser verdadeiramente testados contra um PostgreSQL real (mocks não capturam comportamento de RLS). Criar um segundo banco, `barbearia_db_test`, para não poluir os dados de desenvolvimento a cada rodada de teste.

Criar um script utilitário reaproveitável em vez de escrever o mesmo `node -e "..."` várias vezes ao longo do plano:

`scripts/db-admin.js`:
```javascript
require('dotenv').config();
const { Pool } = require('pg');

const acao = process.argv[2];
const alvo = process.argv[3];

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });

  try {
    if (acao === 'criar') {
      await pool.query(`CREATE DATABASE ${alvo}`);
      console.log(`Banco ${alvo} criado.`);
    } else if (acao === 'apagar') {
      await pool.query(`DROP DATABASE IF EXISTS ${alvo}`);
      console.log(`Banco ${alvo} removido.`);
    } else {
      console.error('Uso: node scripts/db-admin.js <criar|apagar> <nome_do_banco>');
      process.exitCode = 1;
    }
  } catch (erro) {
    console.error('Erro:', erro.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
```

`alvo` é sempre um literal escolhido por quem executa o comando neste plano (nunca input de usuário final da API), então não há risco de injeção de identificador SQL neste contexto de script de desenvolvimento — mesmo assim, para manter o hábito seguro, validar que `alvo` só contém `[a-z0-9_]` antes do `CREATE`/`DROP`:

Ajustar `main()` adicionando logo após ler `alvo`:
```javascript
if (!/^[a-z0-9_]+$/.test(alvo || '')) {
  console.error('Nome de banco inválido — use apenas letras minúsculas, números e underscore.');
  process.exitCode = 1;
  return;
}
```

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node scripts/db-admin.js criar barbearia_db_test
```

Expected: `Banco barbearia_db_test criado.` (ou erro "already exists" se rodado de novo — tratar como não-fatal).

- [ ] **Step 3: Adicionar `DB_NAME_TEST` e `DATABASE_URL` ao `.env`**

Adicionar ao final do arquivo `.env`:
```
DB_NAME_TEST=barbearia_db_test
DATABASE_URL=postgresql://postgres:080518@localhost:5432/barbearia_db
```

- [ ] **Step 4: Criar `jest.config.js`**

```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testTimeout: 15000,
  maxWorkers: 1,
  setupFiles: ['<rootDir>/tests/setup.js'],
};
```

`maxWorkers: 1` é proposital: os testes de integração compartilham o mesmo banco de teste e fazem `TRUNCATE` entre casos — rodar em paralelo causaria testes interferindo uns nos outros.

- [ ] **Step 5: Criar `tests/setup.js`**

```javascript
process.env.NODE_ENV = 'test';
```

Precisa ser setado antes de qualquer `require('dotenv').config()` rodar dentro dos módulos da aplicação, para que `src/middlewares/tenant.js` (Task 9) resolva `DB_NAME_TEST` em vez de `DB_NAME`.

- [ ] **Step 6: Atualizar o script de teste no `package.json`**

Trocar:
```json
"test": "echo \"Error: no test specified\" && exit 1"
```
Por:
```json
"test": "jest --runInBand"
```

- [ ] **Step 7: Commit**

Lembrete: por instrução do usuário, **não commitar nesta etapa nem nas seguintes** — todas as mudanças ficam no working tree e um único commit é feito ao final de todo o plano (ver Task 12).

---

## Task 1: Configurar node-pg-migrate

**Files:**
- Create: `.node-pg-migraterc.json`
- Modify: `package.json`

- [ ] **Step 1: Criar arquivo de configuração**

`.node-pg-migraterc.json`:
```json
{
  "migrations-dir": "migrations",
  "migration-file-language": "sql",
  "schema": "public",
  "migrations-table": "pgmigrations"
}
```

- [ ] **Step 2: Adicionar scripts de migration ao `package.json`**

Adicionar em `"scripts"`:
```json
"migrate:up": "node-pg-migrate up",
"migrate:down": "node-pg-migrate down",
"migrate:create": "node-pg-migrate create"
```

- [ ] **Step 3: Verificar que node-pg-migrate conecta corretamente**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx node-pg-migrate up --dry-run
```

Expected: comando executa sem erro de conexão (mesmo sem migrations ainda, deve reportar "No migrations to run" ou criar a tabela `pgmigrations` vazia).

---

## Task 2: Migration 001 — tabela `usuario_plataforma`

**Files:**
- Create: `migrations/001_criar_tabela_usuario_plataforma.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Up Migration
CREATE TABLE usuario_plataforma (
  id SERIAL PRIMARY KEY,
  nome VARCHAR NOT NULL,
  email VARCHAR NOT NULL UNIQUE,
  senha_hash VARCHAR NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE usuario_plataforma;
```

`usuario_plataforma` não tem `barbearia_id` — é estruturalmente fora da hierarquia de tenant, por definição (super-admin da plataforma, não de uma barbearia específica).

- [ ] **Step 2: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: saída confirma `001_criar_tabela_usuario_plataforma` migrada com sucesso.

- [ ] **Step 3: Adicionar comando de inspeção ao `scripts/db-admin.js`**

Adicionar uma terceira ação, `colunas`, útil em várias tasks seguintes para verificar o schema após cada migration:

```javascript
} else if (acao === 'colunas') {
  const poolAlvo = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const r = await poolAlvo.query(
    'SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position',
    [alvo]
  );
  console.log(r.rows.map((x) => x.column_name));
  await poolAlvo.end();
}
```

(Esse bloco entra como mais um `else if` dentro do `main()` do Step 2 da Task 0, antes do `else` final de uso inválido.)

- [ ] **Step 4: Verificar a tabela foi criada**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node scripts/db-admin.js colunas usuario_plataforma
```

Expected: `[ 'id', 'nome', 'email', 'senha_hash', 'ativo', 'criado_em' ]`

---

## Task 3: Migration 002 — adicionar `barbearia_id` em todas as tabelas

**Files:**
- Create: `migrations/002_adicionar_barbearia_id.sql`

- [ ] **Step 1: Escrever a migration**

Adiciona `barbearia_id` (nullable por enquanto — vira `NOT NULL` só depois do backfill na migration 004) em toda tabela que não tem hoje.

```sql
-- Up Migration
ALTER TABLE cliente ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro_disponibilidade ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro_excecao ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro_servico ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE plano_servico ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE assinatura ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE agendamento ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE agendamento_servico ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE notificacao ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE pagamento ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);

-- Down Migration
ALTER TABLE pagamento DROP COLUMN barbearia_id;
ALTER TABLE notificacao DROP COLUMN barbearia_id;
ALTER TABLE agendamento_servico DROP COLUMN barbearia_id;
ALTER TABLE agendamento DROP COLUMN barbearia_id;
ALTER TABLE assinatura DROP COLUMN barbearia_id;
ALTER TABLE plano_servico DROP COLUMN barbearia_id;
ALTER TABLE barbeiro_servico DROP COLUMN barbearia_id;
ALTER TABLE barbeiro_excecao DROP COLUMN barbearia_id;
ALTER TABLE barbeiro_disponibilidade DROP COLUMN barbearia_id;
ALTER TABLE barbeiro DROP COLUMN barbearia_id;
ALTER TABLE cliente DROP COLUMN barbearia_id;
```

- [ ] **Step 2: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: `002_adicionar_barbearia_id` migrada com sucesso, sem erro (coluna nullable, não quebra linhas existentes).

- [ ] **Step 3: Confirmar colunas foram criadas**

Run, para cada tabela nova (repetir com o nome de cada uma):
```bash
node scripts/db-admin.js colunas cliente
node scripts/db-admin.js colunas agendamento
node scripts/db-admin.js colunas pagamento
```

Expected: `barbearia_id` aparece na lista de colunas de cada uma.

---

## Task 4: Migration 003 — backfill de `barbearia_id`

**Files:**
- Create: `migrations/003_backfill_barbearia_id.sql`
- Create: `scripts/verificar-backfill.js`

- [ ] **Step 1: Escrever a migration de backfill**

Popula `barbearia_id` em cada tabela seguindo a cadeia de FK real até `barbearia`. Ordem importa: tabelas que dependem de outras recém-populadas (ex: `agendamento_servico` depende de `agendamento.barbearia_id` já estar preenchido) vêm depois.

```sql
-- Up Migration

-- barbeiro: via unidade
UPDATE barbeiro b SET barbearia_id = u.barbearia_id
FROM unidade u WHERE u.id = b.unidade_id AND b.barbearia_id IS NULL;

-- barbeiro_disponibilidade: via barbeiro
UPDATE barbeiro_disponibilidade bd SET barbearia_id = b.barbearia_id
FROM barbeiro b WHERE b.id = bd.barbeiro_id AND bd.barbearia_id IS NULL;

-- barbeiro_excecao: via barbeiro
UPDATE barbeiro_excecao be SET barbearia_id = b.barbearia_id
FROM barbeiro b WHERE b.id = be.barbeiro_id AND be.barbearia_id IS NULL;

-- barbeiro_servico: via barbeiro
UPDATE barbeiro_servico bs SET barbearia_id = b.barbearia_id
FROM barbeiro b WHERE b.id = bs.barbeiro_id AND bs.barbearia_id IS NULL;

-- plano_servico: via plano
UPDATE plano_servico ps SET barbearia_id = p.barbearia_id
FROM plano p WHERE p.id = ps.plano_id AND ps.barbearia_id IS NULL;

-- assinatura: via plano
UPDATE assinatura a SET barbearia_id = p.barbearia_id
FROM plano p WHERE p.id = a.plano_id AND a.barbearia_id IS NULL;

-- agendamento: via unidade
UPDATE agendamento ag SET barbearia_id = u.barbearia_id
FROM unidade u WHERE u.id = ag.unidade_id AND ag.barbearia_id IS NULL;

-- cliente: via primeiro agendamento existente do cliente (heurística necessária porque cliente hoje é global;
-- clientes sem nenhum agendamento ficam NULL aqui e precisam ser resolvidos manualmente antes da migration 004)
UPDATE cliente c SET barbearia_id = sub.barbearia_id
FROM (
  SELECT DISTINCT ON (cliente_id) cliente_id, barbearia_id
  FROM agendamento
  ORDER BY cliente_id, criado_em ASC
) sub
WHERE sub.cliente_id = c.id AND c.barbearia_id IS NULL;

-- agendamento_servico: via agendamento
UPDATE agendamento_servico asv SET barbearia_id = ag.barbearia_id
FROM agendamento ag WHERE ag.id = asv.agendamento_id AND asv.barbearia_id IS NULL;

-- notificacao: via agendamento
UPDATE notificacao n SET barbearia_id = ag.barbearia_id
FROM agendamento ag WHERE ag.id = n.agendamento_id AND n.barbearia_id IS NULL;

-- pagamento: condicional (agendamento OU assinatura, conforme decisão do spec)
UPDATE pagamento pg SET barbearia_id = ag.barbearia_id
FROM agendamento ag WHERE ag.id = pg.agendamento_id AND pg.agendamento_id IS NOT NULL AND pg.barbearia_id IS NULL;

UPDATE pagamento pg SET barbearia_id = a.barbearia_id
FROM assinatura a WHERE a.id = pg.assinatura_id AND pg.assinatura_id IS NOT NULL AND pg.barbearia_id IS NULL;

-- Down Migration
-- Backfill não é reversível de forma significativa (não há "estado anterior" a restaurar
-- além de NULL, que a migration 002 down já cobre). Down desta migration é um no-op documentado.
SELECT 1;
```

- [ ] **Step 2: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: `003_backfill_barbearia_id` migrada sem erro.

- [ ] **Step 3: Criar script de validação pós-backfill**

Este é o gate de segurança mais importante do plano até aqui — se qualquer linha ficar `NULL`, a migration 004 (que aperta `NOT NULL`) precisa falhar de forma visível, não silenciosa.

`scripts/verificar-backfill.js`:
```javascript
require('dotenv').config();
const { Pool } = require('pg');

const TABELAS = [
  'cliente', 'barbeiro', 'barbeiro_disponibilidade', 'barbeiro_excecao',
  'barbeiro_servico', 'plano_servico', 'assinatura', 'agendamento',
  'agendamento_servico', 'notificacao', 'pagamento',
];

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.NODE_ENV === 'test' ? process.env.DB_NAME_TEST : process.env.DB_NAME,
  });

  let totalOrfaos = 0;

  try {
    for (const tabela of TABELAS) {
      const r = await pool.query(`SELECT COUNT(*) FROM ${tabela} WHERE barbearia_id IS NULL`);
      const count = Number(r.rows[0].count);
      console.log(`${tabela} -> ${count} linhas NULL`);
      totalOrfaos += count;
    }
  } finally {
    await pool.end();
  }

  if (totalOrfaos > 0) {
    console.error(`\nFALHA: ${totalOrfaos} linha(s) órfã(s) sem barbearia_id. Resolver antes de rodar a migration 004.`);
    process.exitCode = 1;
  } else {
    console.log('\nOK: nenhuma linha órfã encontrada.');
  }
}

main();
```

Nomes de tabela vêm de uma lista fixa no código-fonte (`TABELAS`), nunca de input externo — não há superfície de injeção aqui.

- [ ] **Step 4: Rodar a validação**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node scripts/verificar-backfill.js
```

Expected: `OK: nenhuma linha órfã encontrada.` Se reportar `FALHA`, **parar aqui** e resolver manualmente antes de prosseguir — não seguir para a Task 5 com dados órfãos.

---

## Task 5: Migration 004 — `NOT NULL` e constraints

**Files:**
- Create: `migrations/004_constraints_not_null_e_unique.sql`
- Create: `scripts/listar-constraints-unicas.js`

- [ ] **Step 1: Descobrir o nome real das constraints de unicidade antes de escrever a migration**

`scripts/listar-constraints-unicas.js`:
```javascript
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.NODE_ENV === 'test' ? process.env.DB_NAME_TEST : process.env.DB_NAME,
  });

  try {
    const r = await pool.query(`
      SELECT conname, conrelid::regclass AS tabela
      FROM pg_constraint
      WHERE contype = 'u' AND conrelid::regclass::text IN ('cliente', 'usuario_admin')
    `);
    console.log(r.rows);
  } finally {
    await pool.end();
  }
}

main();
```

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node scripts/listar-constraints-unicas.js
```

Expected: retorna os nomes reais das constraints (ex: `cliente_email_key`, `usuario_admin_email_key`, ou nomes diferentes se o schema real usar outra convenção). Usar os nomes exatos retornados no Step 2 abaixo.

- [ ] **Step 2: Escrever a migration usando os nomes confirmados no Step 1**

```sql
-- Up Migration
ALTER TABLE cliente ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro_disponibilidade ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro_excecao ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro_servico ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE plano_servico ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE assinatura ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE agendamento ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE agendamento_servico ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE notificacao ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE pagamento ALTER COLUMN barbearia_id SET NOT NULL;

-- cliente: email único por tenant, não mais globalmente único
-- (substituir <nome_constraint_cliente> pelo nome real confirmado no Step 1)
ALTER TABLE cliente DROP CONSTRAINT IF EXISTS <nome_constraint_cliente>;
ALTER TABLE cliente ADD CONSTRAINT cliente_barbearia_email_key UNIQUE (barbearia_id, email);

-- usuario_admin: mesma regra
-- (substituir <nome_constraint_usuario_admin> pelo nome real confirmado no Step 1)
ALTER TABLE usuario_admin DROP CONSTRAINT IF EXISTS <nome_constraint_usuario_admin>;
ALTER TABLE usuario_admin ADD CONSTRAINT usuario_admin_barbearia_email_key UNIQUE (barbearia_id, email);

-- Down Migration
ALTER TABLE usuario_admin DROP CONSTRAINT IF EXISTS usuario_admin_barbearia_email_key;
ALTER TABLE usuario_admin ADD CONSTRAINT usuario_admin_email_key UNIQUE (email);
ALTER TABLE cliente DROP CONSTRAINT IF EXISTS cliente_barbearia_email_key;
ALTER TABLE cliente ADD CONSTRAINT cliente_email_key UNIQUE (email);

ALTER TABLE pagamento ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE notificacao ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE agendamento_servico ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE agendamento ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE assinatura ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE plano_servico ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro_servico ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro_excecao ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro_disponibilidade ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE cliente ALTER COLUMN barbearia_id DROP NOT NULL;
```

Este é o único ponto do plano com um placeholder textual (`<nome_constraint_...>`) — é inevitável porque o nome real só é conhecido rodando o Step 1 contra o banco de cada ambiente (dev, teste, produção podem ter nomes de constraint diferentes se o schema foi criado por scripts distintos ao longo do tempo). Antes de rodar `npx node-pg-migrate up` neste passo, substituir manualmente pelos nomes retornados no Step 1 — não seguir com o placeholder literal no arquivo.

- [ ] **Step 3: Adicionar trigger de consistência para `pagamento.barbearia_id`**

Diferente das demais tabelas filhas (onde `barbearia_id` é sempre derivável de uma única FK), `pagamento` tem duas origens possíveis (`agendamento_id` ou `assinatura_id`, nunca ambas). O backfill (migration 003) resolveu isso uma vez para os dados existentes, mas nada impede uma futura inserção/atualização de `pagamento` com um `barbearia_id` que não bate com o do `agendamento`/`assinatura` referenciado — um bug de aplicação poderia inserir um pagamento vazando para o tenant errado sem que RLS detecte (RLS só valida que o `barbearia_id` inserido bate com `app.tenant_id` da sessão, não que ele é *consistente* com as FKs da própria linha).

Adicionar ao final do mesmo arquivo `migrations/004_constraints_not_null_e_unique.sql`, dentro do bloco `-- Up Migration` (após as duas constraints de `UNIQUE`, antes do `-- Down Migration`):

```sql
CREATE OR REPLACE FUNCTION validar_barbearia_id_pagamento()
RETURNS TRIGGER AS $$
DECLARE
  barbearia_esperada INTEGER;
BEGIN
  IF NEW.agendamento_id IS NOT NULL THEN
    SELECT barbearia_id INTO barbearia_esperada FROM agendamento WHERE id = NEW.agendamento_id;
  ELSIF NEW.assinatura_id IS NOT NULL THEN
    SELECT barbearia_id INTO barbearia_esperada FROM assinatura WHERE id = NEW.assinatura_id;
  ELSE
    RAISE EXCEPTION 'pagamento precisa referenciar agendamento_id ou assinatura_id';
  END IF;

  IF NEW.barbearia_id != barbearia_esperada THEN
    RAISE EXCEPTION 'barbearia_id do pagamento (%) não corresponde à barbearia da referência (%)', NEW.barbearia_id, barbearia_esperada;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_barbearia_id_pagamento
  BEFORE INSERT OR UPDATE ON pagamento
  FOR EACH ROW EXECUTE FUNCTION validar_barbearia_id_pagamento();
```

E ao `-- Down Migration`, antes das linhas de `DROP NOT NULL`:

```sql
DROP TRIGGER IF EXISTS trg_validar_barbearia_id_pagamento ON pagamento;
DROP FUNCTION IF EXISTS validar_barbearia_id_pagamento();
```

- [ ] **Step 4: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: `004_constraints_not_null_e_unique` migrada sem erro (assumindo Task 4 Step 4 confirmou zero NULLs, e os nomes de constraint foram substituídos corretamente).

- [ ] **Step 5: Confirmar que o trigger rejeita inconsistência**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  try {
    const ag = await pool.query('SELECT id, barbearia_id FROM agendamento LIMIT 1');
    if (ag.rows.length === 0) { console.log('Sem agendamento para testar — pular verificação manual, o teste automatizado da Task 11.4 cobre isso indiretamente.'); await pool.end(); return; }
    const barbeariaErrada = ag.rows[0].barbearia_id + 1000;
    await pool.query('INSERT INTO pagamento (barbearia_id, agendamento_id, valor, status) VALUES (\$1, \$2, 10, \'pago\')', [barbeariaErrada, ag.rows[0].id]);
    console.error('FALHA: o INSERT deveria ter sido rejeitado pelo trigger.');
    process.exitCode = 1;
  } catch (erro) {
    console.log('OK: trigger rejeitou a inconsistência com a mensagem:', erro.message);
  } finally {
    await pool.end();
  }
})();
"
```

Expected: `OK: trigger rejeitou a inconsistência com a mensagem: barbearia_id do pagamento (...) não corresponde à barbearia da referência (...)`.

---

## Task 6: Migration 005 — Row-Level Security

**Files:**
- Create: `migrations/005_habilitar_rls.sql`
- Create: `scripts/testar-rls.js`

- [ ] **Step 1: Escrever a migration**

RLS com `FORCE` em toda tabela com `barbearia_id`, mais a policy de bypass de plataforma. `usuario_plataforma` fica de fora (não tem `barbearia_id`, não precisa de RLS de tenant).

```sql
-- Up Migration

DO $$
DECLARE
  tabelas TEXT[] := ARRAY[
    'unidade', 'servico', 'plano', 'usuario_admin',
    'cliente', 'barbeiro', 'barbeiro_disponibilidade', 'barbeiro_excecao',
    'barbeiro_servico', 'plano_servico', 'assinatura',
    'agendamento', 'agendamento_servico', 'notificacao', 'pagamento'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (barbearia_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::integer
                OR current_setting(''app.is_plataforma'', true) = ''true'')
         WITH CHECK (barbearia_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::integer
                     OR current_setting(''app.is_plataforma'', true) = ''true'')',
      t
    );
  END LOOP;
END $$;

-- Down Migration
DO $$
DECLARE
  tabelas TEXT[] := ARRAY[
    'unidade', 'servico', 'plano', 'usuario_admin',
    'cliente', 'barbeiro', 'barbeiro_disponibilidade', 'barbeiro_excecao',
    'barbeiro_servico', 'plano_servico', 'assinatura',
    'agendamento', 'agendamento_servico', 'notificacao', 'pagamento'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
```

`NULLIF(current_setting(...), '')` trata o caso em que a variável foi setada como string vazia (não apenas nunca setada) — `current_setting(x, true)` retorna `NULL` se nunca setada, mas pode retornar `''` se setada explicitamente como vazia; sem o `NULLIF`, `''::integer` lançaria erro de cast em vez de simplesmente negar acesso.

- [ ] **Step 2: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: `005_habilitar_rls` migrada sem erro.

- [ ] **Step 3: Criar script de teste manual de RLS**

`scripts/testar-rls.js`:
```javascript
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const database = process.env.NODE_ENV === 'test' ? process.env.DB_NAME_TEST : process.env.DB_NAME;
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
  });

  try {
    const semTenant = await pool.query('SELECT COUNT(*) FROM cliente');
    console.log('Linhas visíveis sem tenant_id setado:', semTenant.rows[0].count);
    if (Number(semTenant.rows[0].count) !== 0) {
      console.error('FALHA: RLS não está bloqueando acesso sem tenant_id.');
      process.exitCode = 1;
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', '1', true)");
      const comTenant = await client.query('SELECT COUNT(*) FROM cliente');
      console.log('Linhas visíveis com tenant_id=1:', comTenant.rows[0].count);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    console.log('OK: RLS está funcionando como esperado.');
  } finally {
    await pool.end();
  }
}

main();
```

- [ ] **Step 4: Rodar o teste manual e confirmar bloqueio sem tenant**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node scripts/testar-rls.js
```

Expected: `Linhas visíveis sem tenant_id setado: 0`, seguido de `Linhas visíveis com tenant_id=1: <N>` (contagem real de clientes da barbearia 1) e `OK: RLS está funcionando como esperado.`. **Se a primeira contagem for maior que 0, a migration tem um bug e não deve seguir para a próxima task.**

---

## Task 7: Migration 006 — índices compostos

**Files:**
- Create: `migrations/006_indices_compostos.sql`

- [ ] **Step 1: Escrever a migration**

Índices nas colunas mais consultadas por tenant — sem eles, toda query com RLS ativo faz sequential scan filtrando `barbearia_id` linha a linha, o que não escala para milhares de tenants com milhões de linhas agregadas.

```sql
-- Up Migration
CREATE INDEX idx_cliente_barbearia ON cliente(barbearia_id);
CREATE INDEX idx_barbeiro_barbearia ON barbeiro(barbearia_id);
CREATE INDEX idx_agendamento_barbearia_data ON agendamento(barbearia_id, data_hora_inicio);
CREATE INDEX idx_agendamento_servico_barbearia ON agendamento_servico(barbearia_id);
CREATE INDEX idx_notificacao_barbearia ON notificacao(barbearia_id);
CREATE INDEX idx_pagamento_barbearia_criado ON pagamento(barbearia_id, criado_em);
CREATE INDEX idx_assinatura_barbearia ON assinatura(barbearia_id);
CREATE INDEX idx_unidade_barbearia ON unidade(barbearia_id);
CREATE INDEX idx_servico_barbearia ON servico(barbearia_id);
CREATE INDEX idx_plano_barbearia ON plano(barbearia_id);
CREATE INDEX idx_usuario_admin_barbearia ON usuario_admin(barbearia_id);

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_barbearia;
DROP INDEX IF EXISTS idx_plano_barbearia;
DROP INDEX IF EXISTS idx_servico_barbearia;
DROP INDEX IF EXISTS idx_unidade_barbearia;
DROP INDEX IF EXISTS idx_assinatura_barbearia;
DROP INDEX IF EXISTS idx_pagamento_barbearia_criado;
DROP INDEX IF EXISTS idx_notificacao_barbearia;
DROP INDEX IF EXISTS idx_agendamento_servico_barbearia;
DROP INDEX IF EXISTS idx_agendamento_barbearia_data;
DROP INDEX IF EXISTS idx_barbeiro_barbearia;
DROP INDEX IF EXISTS idx_cliente_barbearia;
```

- [ ] **Step 2: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: `006_indices_compostos` migrada sem erro.

---

## Task 8: Migration 007 — recriar views com filtro de tenant

**Files:**
- Create: `migrations/007_recriar_views_com_tenant.sql`

- [ ] **Step 1: Escrever a migration**

As views precisam expor `barbearia_id` no resultado E respeitar RLS. Views do Postgres, por padrão, rodam com os privilégios do *criador* da view — o que pode contornar RLS dependendo de como a role de aplicação foi configurada. Usar `security_invoker = true` (Postgres 15+, disponível já que o ambiente é PG 16) garante que a view roda com os privilégios de quem a consulta, respeitando RLS da mesma forma que uma query direta nas tabelas base respeitaria.

```sql
-- Up Migration
DROP VIEW IF EXISTS vw_faturamento_mensal;
CREATE VIEW vw_faturamento_mensal WITH (security_invoker = true) AS
SELECT
    p.barbearia_id,
    date_trunc('month', p.criado_em)::date AS mes,
    sum(CASE WHEN p.assinatura_id IS NOT NULL THEN p.valor ELSE 0 END) AS receita_planos,
    sum(CASE WHEN p.agendamento_id IS NOT NULL THEN p.valor ELSE 0 END) AS receita_avulso,
    sum(p.valor) AS receita_total
FROM pagamento p
WHERE p.status = 'pago'
GROUP BY p.barbearia_id, date_trunc('month', p.criado_em)
ORDER BY date_trunc('month', p.criado_em);

DROP VIEW IF EXISTS vw_desempenho_barbeiro_mensal;
CREATE VIEW vw_desempenho_barbeiro_mensal WITH (security_invoker = true) AS
SELECT
    a.barbearia_id,
    b.id AS barbeiro_id,
    b.nome AS barbeiro_nome,
    date_trunc('month', a.data_hora_inicio)::date AS mes,
    count(DISTINCT a.id) AS total_atendimentos,
    count(DISTINCT a.cliente_id) AS clientes_distintos,
    string_agg(DISTINCT s.nome, ', ') AS procedimentos_realizados,
    sum(asv.valor_cobrado) AS faturamento_gerado
FROM agendamento a
JOIN barbeiro b ON b.id = a.barbeiro_id
JOIN agendamento_servico asv ON asv.agendamento_id = a.id
JOIN servico s ON s.id = asv.servico_id
WHERE a.status = 'concluido'
GROUP BY a.barbearia_id, b.id, b.nome, date_trunc('month', a.data_hora_inicio)
ORDER BY date_trunc('month', a.data_hora_inicio), b.nome;

-- Down Migration
DROP VIEW IF EXISTS vw_desempenho_barbeiro_mensal;
CREATE VIEW vw_desempenho_barbeiro_mensal AS
SELECT b.id AS barbeiro_id, b.nome AS barbeiro_nome,
    date_trunc('month', a.data_hora_inicio)::date AS mes,
    count(DISTINCT a.id) AS total_atendimentos,
    count(DISTINCT a.cliente_id) AS clientes_distintos,
    string_agg(DISTINCT s.nome, ', ') AS procedimentos_realizados,
    sum(asv.valor_cobrado) AS faturamento_gerado
FROM agendamento a
JOIN barbeiro b ON b.id = a.barbeiro_id
JOIN agendamento_servico asv ON asv.agendamento_id = a.id
JOIN servico s ON s.id = asv.servico_id
WHERE a.status = 'concluido'
GROUP BY b.id, b.nome, date_trunc('month', a.data_hora_inicio)
ORDER BY date_trunc('month', a.data_hora_inicio), b.nome;

DROP VIEW IF EXISTS vw_faturamento_mensal;
CREATE VIEW vw_faturamento_mensal AS
SELECT date_trunc('month', criado_em)::date AS mes,
    sum(CASE WHEN assinatura_id IS NOT NULL THEN valor ELSE 0 END) AS receita_planos,
    sum(CASE WHEN agendamento_id IS NOT NULL THEN valor ELSE 0 END) AS receita_avulso,
    sum(valor) AS receita_total
FROM pagamento p
WHERE status = 'pago'
GROUP BY date_trunc('month', criado_em)
ORDER BY date_trunc('month', criado_em);
```

- [ ] **Step 2: Rodar a migration**

Run: `npx node-pg-migrate up`
Expected: `007_recriar_views_com_tenant` migrada sem erro.

- [ ] **Step 3: Aplicar as mesmas 7 migrations no banco de teste**

Run (via PowerShell, setando a env var só para este processo):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db_test" npx node-pg-migrate up
```

Expected: as mesmas 7 migrations rodam com sucesso no banco `barbearia_db_test`, deixando os dois bancos com schema idêntico.

---

## Task 9: Middleware de tenant (`escoparTenant` e `apenasPlataforma`)

**Files:**
- Create: `src/middlewares/tenant.js`
- Test: `tests/helpers/db.js`
- Test: `tests/helpers/factories.js`
- Test: `tests/integration/tenant-isolation.test.js`

- [ ] **Step 1: Criar helper de banco de teste**

`tests/helpers/db.js`:
```javascript
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME_TEST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function limparBanco() {
  const tabelas = [
    'pagamento', 'notificacao', 'agendamento_servico', 'agendamento',
    'assinatura', 'plano_servico', 'barbeiro_servico', 'barbeiro_excecao',
    'barbeiro_disponibilidade', 'barbeiro', 'cliente', 'usuario_admin',
    'plano', 'servico', 'unidade', 'barbearia', 'usuario_plataforma',
  ];
  const client = await pool.connect();
  try {
    await client.query(`TRUNCATE ${tabelas.join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    client.release();
  }
}

async function fecharBanco() {
  await pool.end();
}

module.exports = { pool, limparBanco, fecharBanco };
```

- [ ] **Step 2: Criar factory de dados de teste**

`tests/helpers/factories.js`:
```javascript
const bcrypt = require('bcrypt');
const { pool } = require('./db');

async function criarBarbearia(nome = 'Barbearia Teste') {
  const r = await pool.query(
    'INSERT INTO barbearia (nome, cnpj) VALUES ($1, $2) RETURNING *',
    [nome, '00000000000100']
  );
  return r.rows[0];
}

async function criarClienteDireto(barbearia_id, overrides = {}) {
  const senha_hash = await bcrypt.hash(overrides.senha || 'senha123', 10);
  const r = await pool.query(
    'INSERT INTO cliente (barbearia_id, nome, email, telefone, senha_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [
      barbearia_id,
      overrides.nome || 'Cliente Teste',
      overrides.email || `cliente${Date.now()}@teste.com`,
      overrides.telefone || '11999999999',
      senha_hash,
    ]
  );
  return r.rows[0];
}

module.exports = { criarBarbearia, criarClienteDireto };
```

`criarClienteDireto` insere direto no banco (sem passar pela API) — necessário porque este teste (Task 9) valida o middleware isoladamente, antes de qualquer rota HTTP estar migrada para usá-lo (isso só acontece nas Tasks 10+).

- [ ] **Step 3: Escrever o teste de isolamento (falha primeiro — o middleware ainda não existe)**

`tests/integration/tenant-isolation.test.js`:
```javascript
const { limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia, criarClienteDireto } = require('../helpers/factories');
const { escoparTenant } = require('../../src/middlewares/tenant');

describe('escoparTenant', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
  });

  function mockReqRes(barbearia_id) {
    const req = { usuario: { id: 1, tipo: 'admin', barbearia_id } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      on() {},
    };
    return { req, res };
  }

  test('injeta req.db escopado que só enxerga dados da própria barbearia', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');
    await criarClienteDireto(barbeariaA.id, { email: 'clienteA@teste.com' });
    await criarClienteDireto(barbeariaB.id, { email: 'clienteB@teste.com' });

    const { req, res } = mockReqRes(barbeariaA.id);
    const next = jest.fn();

    await new Promise((resolve) => {
      escoparTenant(req, res, () => { next(); resolve(); });
    });

    expect(next).toHaveBeenCalled();
    expect(req.db).toBeDefined();

    const resultado = await req.db.query('SELECT email FROM cliente ORDER BY email');
    expect(resultado.rows).toHaveLength(1);
    expect(resultado.rows[0].email).toBe('clienteA@teste.com');

    await req.db.query('COMMIT');
    req.db.release();
  });

  test('rejeita a requisição se req.usuario não tiver barbearia_id', async () => {
    const req = { usuario: { id: 1, tipo: 'admin' } };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = jest.fn();

    await escoparTenant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha (middleware não existe ainda)**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx jest tests/integration/tenant-isolation.test.js
```

Expected: FAIL com `Cannot find module '../../src/middlewares/tenant'`.

- [ ] **Step 5: Implementar o middleware**

`src/middlewares/tenant.js`:
```javascript
const { Pool } = require('pg');
require('dotenv').config();

const dbName = process.env.NODE_ENV === 'test' ? process.env.DB_NAME_TEST : process.env.DB_NAME;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: dbName,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function escoparTenant(req, res, next) {
  const barbearia_id = req.usuario && req.usuario.barbearia_id;

  if (!barbearia_id) {
    return res.status(403).json({ erro: 'Requisição sem barbearia associada' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);

    req.db = client;

    res.on('finish', async () => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          await client.query('COMMIT');
        } else {
          await client.query('ROLLBACK');
        }
      } catch (erro) {
        console.error('Erro ao finalizar transação de tenant:', erro);
      } finally {
        client.release();
      }
    });

    next();
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao escopar requisição para o tenant' });
  }
}

async function apenasPlataforma(req, res, next) {
  if (!req.usuario || req.usuario.tipo !== 'plataforma') {
    return res.status(403).json({ erro: 'Acesso restrito à plataforma' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.is_plataforma', 'true']);

    req.db = client;

    res.on('finish', async () => {
      try {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          await client.query('COMMIT');
        } else {
          await client.query('ROLLBACK');
        }
      } catch (erro) {
        console.error('Erro ao finalizar transação de plataforma:', erro);
      } finally {
        client.release();
      }
    });

    next();
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao autorizar operação de plataforma' });
  }
}

module.exports = { escoparTenant, apenasPlataforma, pool };
```

Nota de design: o pool deste middleware é o mesmo usado pelos testes (`tests/helpers/db.js` aponta pro mesmo `DB_NAME_TEST` quando `NODE_ENV=test`) — importante para os testes de integração completos (Task 11) rodarem contra o schema real com RLS ativo, não um mock.

- [ ] **Step 6: Rodar o teste de novo**

Run:
```bash
npx jest tests/integration/tenant-isolation.test.js
```

Expected: PASS — os dois testes passam, confirmando que o middleware escopa corretamente e rejeita requisições sem `barbearia_id`.

- [ ] **Step 7: Commit**

Lembrete: não commitar ainda — só ao final (Task 12).

---

## Task 10: Rotas e controllers de plataforma (super-admin)

**Files:**
- Create: `src/app.js`
- Create: `src/controllers/plataformaController.js`
- Create: `src/routes/plataformaRoutes.js`
- Test: `tests/integration/plataforma.test.js`
- Modify: `src/server.js`
- Modify: `src/controllers/barbeariaController.js`
- Modify: `src/routes/barbeariaRoutes.js`

- [ ] **Step 1: Extrair `app.js` do `server.js` (necessário para testar com Supertest sem abrir porta real)**

`server.js` hoje faz `app.listen(...)` no mesmo arquivo que define as rotas — Supertest precisa do `app` sem o `listen`. Criar `src/app.js`:

```javascript
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/database');

const barbeariaRoutes = require('./routes/barbeariaRoutes');
const unidadeRoutes = require('./routes/unidadeRoutes');
const barbeiroRoutes = require('./routes/barbeiroRoutes');
const servicoRoutes = require('./routes/servicoRoutes');
const planoRoutes = require('./routes/planoRoutes');
const clienteRoutes = require('./routes/clienteRoutes');
const agendamentoRoutes = require('./routes/agendamentoRoutes');
const financeiroRoutes = require('./routes/financeiroRoutes');
const authRoutes = require('./routes/authRoutes');
const notificacaoRoutes = require('./routes/notificacaoRoutes');
const plataformaRoutes = require('./routes/plataformaRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ mensagem: 'API da barbearia rodando com sucesso!' });
});

app.use('/barbearias', barbeariaRoutes);
app.use('/unidades', unidadeRoutes);
app.use('/barbeiros', barbeiroRoutes);
app.use('/servicos', servicoRoutes);
app.use('/planos', planoRoutes);
app.use('/clientes', clienteRoutes);
app.use('/agendamentos', agendamentoRoutes);
app.use('/financeiro', financeiroRoutes);
app.use('/auth', authRoutes);
app.use('/notificacoes', notificacaoRoutes);
app.use('/plataforma', plataformaRoutes);

app.get('/teste-banco', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW()');
    res.json({
      mensagem: 'Conexão com o banco funcionando!',
      horario_do_banco: resultado.rows[0].now,
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Falha ao conectar no banco' });
  }
});

module.exports = app;
```

- [ ] **Step 2: Reescrever `server.js` para ficar só com o `listen`**

```javascript
const app = require('./app');
const { iniciarJobLembretes } = require('./jobs/lembretes');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  iniciarJobLembretes();
});
```

- [ ] **Step 3: Escrever o teste de criação de barbearia protegida (falha primeiro)**

`tests/integration/plataforma.test.js`:
```javascript
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');

describe('POST /barbearias (protegido por plataforma)', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
  });

  async function criarUsuarioPlataforma() {
    const senha_hash = await bcrypt.hash('senhaSegura123', 10);
    const r = await pool.query(
      'INSERT INTO usuario_plataforma (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING *',
      ['Super Admin', 'super@plataforma.com', senha_hash]
    );
    const usuario = r.rows[0];
    const token = jwt.sign({ id: usuario.id, tipo: 'plataforma' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return token;
  }

  test('rejeita criação de barbearia sem token', async () => {
    const resposta = await request(app).post('/barbearias').send({ nome: 'Nova Barbearia', cnpj: '11111111000100' });
    expect(resposta.status).toBe(401);
  });

  test('rejeita criação de barbearia com token de admin comum', async () => {
    const token = jwt.sign({ id: 1, tipo: 'admin', barbearia_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const resposta = await request(app)
      .post('/barbearias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Nova Barbearia', cnpj: '11111111000100' });
    expect(resposta.status).toBe(403);
  });

  test('permite criação de barbearia com token de plataforma', async () => {
    const token = await criarUsuarioPlataforma();
    const resposta = await request(app)
      .post('/barbearias')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Nova Barbearia', cnpj: '11111111000100' });

    expect(resposta.status).toBe(201);
    expect(resposta.body.nome).toBe('Nova Barbearia');
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `npx jest tests/integration/plataforma.test.js`
Expected: FAIL (rota ainda não protegida, `app.js`/controllers de plataforma ainda não existem).

- [ ] **Step 5: Criar `plataformaController.js` com `loginPlataforma`**

`src/controllers/plataformaController.js`:
```javascript
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

async function loginPlataforma(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      'SELECT * FROM usuario_plataforma WHERE email = $1 AND ativo = true',
      [email]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    const usuario = resultado.rows[0];
    const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

    if (!senhaValida) {
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    const token = jwt.sign(
      { id: usuario.id, tipo: 'plataforma' },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token, nome: usuario.nome, email: usuario.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}

module.exports = { loginPlataforma };
```

`loginPlataforma` usa `pool` direto (não `req.db`) porque roda antes de qualquer escopo de tenant existir — é a própria porta de entrada.

- [ ] **Step 6: Criar `plataformaRoutes.js`**

`src/routes/plataformaRoutes.js`:
```javascript
const express = require('express');
const router = express.Router();
const { loginPlataforma } = require('../controllers/plataformaController');

router.post('/login', loginPlataforma);

module.exports = router;
```

- [ ] **Step 7: Proteger `POST /barbearias` com `verificarToken` + `apenasPlataforma`**

Ler `src/controllers/barbeariaController.js` atual e ajustar `criarBarbearia` para usar `req.db` (escopado pelo middleware de plataforma, que seta `app.is_plataforma`) em vez de `pool` direto:

```javascript
const pool = require('../config/database');

async function listarBarbearias(req, res) {
  try {
    const resultado = await pool.query('SELECT * FROM barbearia ORDER BY nome');
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar barbearias' });
  }
}

async function criarBarbearia(req, res) {
  const { nome, cnpj } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: 'nome é obrigatório' });
  }

  try {
    const resultado = await req.db.query(
      'INSERT INTO barbearia (nome, cnpj) VALUES ($1, $2) RETURNING *',
      [nome, cnpj]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar barbearia' });
  }
}

module.exports = { listarBarbearias, criarBarbearia };
```

`listarBarbearias` continua usando `pool` direto e sem proteção por enquanto — é uma listagem de todas as barbearias (dado de plataforma, não de tenant); proteger essa rota com `apenasPlataforma` fica registrado como melhoria de escopo futuro (não é um vazamento cross-tenant, já que barbearia não expõe dado sensível de cliente final, mas merece revisão de acesso mais tarde).

`src/routes/barbeariaRoutes.js`:
```javascript
const express = require('express');
const router = express.Router();
const { listarBarbearias, criarBarbearia } = require('../controllers/barbeariaController');
const { verificarToken } = require('../middlewares/autenticacao');
const { apenasPlataforma } = require('../middlewares/tenant');

router.get('/', listarBarbearias);
router.post('/', verificarToken, apenasPlataforma, criarBarbearia);

module.exports = router;
```

- [ ] **Step 8: Rodar os testes**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx jest tests/integration/plataforma.test.js
```

Expected: os 3 testes passam — sem token (401), token de admin comum (403), token de plataforma (201).

- [ ] **Step 9: Commit**

Lembrete: não commitar ainda — só ao final (Task 12).

---

## Task 11: Migrar autenticação e todos os controllers para `req.db`

Esta é a task mais extensa — cada controller precisa (a) usar `req.db` em vez de `pool`/client próprio, e (b) ter suas rotas passando por `verificarToken` + `escoparTenant` quando aplicável. RLS faz o filtro por tenant automaticamente; a mudança de código é mecânica (trocar a fonte da conexão), exceto nos pontos abaixo, que têm lógica de negócio genuinamente afetada.

**Files:**
- Modify: `src/controllers/authController.js`
- Modify: `src/routes/authRoutes.js`
- Modify: `src/controllers/clienteController.js`
- Modify: `src/routes/clienteRoutes.js`
- Modify: `src/controllers/unidadeController.js`, `src/routes/unidadeRoutes.js`
- Modify: `src/controllers/barbeiroController.js`, `src/routes/barbeiroRoutes.js`
- Modify: `src/controllers/servicoController.js`, `src/routes/servicoRoutes.js`
- Modify: `src/controllers/planoController.js`, `src/routes/planoRoutes.js`
- Modify: `src/controllers/financeiroController.js`, `src/routes/financeiroRoutes.js`
- Modify: `src/controllers/agendamentoController.js`, `src/routes/agendamentoRoutes.js`
- Modify: `src/controllers/notificacaoController.js`, `src/services/notificacaoService.js`, `src/jobs/lembretes.js`
- Test: `tests/integration/auth.test.js`
- Test: `tests/integration/cliente.test.js`
- Test: `tests/integration/agendamento.test.js`

### 11.1 — `authController.js`: JWT de cliente ganha `barbearia_id`; cadastro de admin exige contexto

- [ ] **Step 1: Escrever o teste de login (falha primeiro — comportamento atual não inclui `barbearia_id` no token de cliente)**

`tests/integration/auth.test.js`:
```javascript
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia } = require('../helpers/factories');

describe('Autenticação multi-tenant', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
  });

  test('loginCliente inclui barbearia_id no token', async () => {
    const barbearia = await criarBarbearia();
    const senha_hash = await bcrypt.hash('senha123', 10);
    await pool.query(
      'INSERT INTO cliente (barbearia_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4)',
      [barbearia.id, 'Cliente Teste', 'cliente@teste.com', senha_hash]
    );

    const resposta = await request(app)
      .post('/auth/cliente/login')
      .send({ email: 'cliente@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(200);
    const payload = jwt.verify(resposta.body.token, process.env.JWT_SECRET);
    expect(payload.barbearia_id).toBe(barbearia.id);
    expect(payload.tipo).toBe('cliente');
  });

  test('cadastrarAdmin rejeita requisição sem token de admin existente', async () => {
    const barbearia = await criarBarbearia();
    const resposta = await request(app)
      .post('/auth/admin/cadastro')
      .send({ barbearia_id: barbearia.id, nome: 'Novo Admin', email: 'novo@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(401);
  });

  test('cadastrarAdmin autenticado cria admin na mesma barbearia do token, ignorando barbearia_id do body', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');
    const senha_hash = await bcrypt.hash('senha123', 10);
    const adminExistente = await pool.query(
      'INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [barbeariaA.id, 'Admin Existente', 'admin@teste.com', senha_hash]
    );
    const token = jwt.sign(
      { id: adminExistente.rows[0].id, tipo: 'admin', barbearia_id: barbeariaA.id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resposta = await request(app)
      .post('/auth/admin/cadastro')
      .set('Authorization', `Bearer ${token}`)
      .send({ barbearia_id: barbeariaB.id, nome: 'Novo Admin', email: 'novo@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(201);

    const verificacao = await pool.query('SELECT barbearia_id FROM usuario_admin WHERE email = $1', ['novo@teste.com']);
    expect(verificacao.rows[0].barbearia_id).toBe(barbeariaA.id);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx jest tests/integration/auth.test.js`
Expected: FAIL (token de cliente hoje não tem `barbearia_id`; `cadastrarAdmin` hoje não exige token).

- [ ] **Step 3: Reescrever `authController.js`**

```javascript
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

async function cadastrarAdmin(req, res) {
  const { nome, email, senha } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  try {
    const senha_hash = await bcrypt.hash(senha, 10);

    const resultado = await req.db.query(
      `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, nome, email, papel, criado_em`,
      [barbearia_id, nome, email, senha_hash]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar administrador' });
  }
}

async function loginAdmin(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
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

async function loginCliente(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await pool.query('SELECT * FROM cliente WHERE email = $1', [email]);

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

module.exports = { cadastrarAdmin, loginAdmin, loginCliente };
```

Mudanças-chave: `cadastrarAdmin` não lê mais `barbearia_id` do body — usa `req.usuario.barbearia_id` (o tenant de quem está fazendo a requisição autenticada). `loginAdmin`/`loginCliente` continuam usando `pool` direto (correto: login acontece *antes* de haver um tenant escopado — é o próprio mecanismo que descobre qual tenant é), mas agora iteram sobre todas as linhas retornadas pelo email (que deixou de ser globalmente único na migration 004) e testam a senha em cada uma, já que dois tenants diferentes podem ter admins/clientes com o mesmo email.

- [ ] **Step 4: Atualizar `authRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const { cadastrarAdmin, loginAdmin, loginCliente } = require('../controllers/authController');
const { verificarToken } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.post('/admin/cadastro', verificarToken, escoparTenant, cadastrarAdmin);
router.post('/admin/login', loginAdmin);
router.post('/cliente/login', loginCliente);

module.exports = router;
```

A rota `/auth/plataforma/login` que existia numa versão anterior deste plano foi consolidada em `plataformaRoutes.js` (montada em `/plataforma/login`, Task 10) — não duplicar aqui.

- [ ] **Step 5: Rodar os testes**

Run: `npx jest tests/integration/auth.test.js`
Expected: PASS nos 3 testes.

### 11.2 — `clienteController.js`: cadastro público escopado por barbearia na URL

- [ ] **Step 1: Ler o controller atual**

Antes de editar, ler `src/controllers/clienteController.js` por completo para preservar toda validação existente (hash de senha, tratamento de email duplicado) — não reescrever do zero, só adaptar a fonte de conexão e a origem do `barbearia_id`.

- [ ] **Step 2: Escrever teste do cadastro público de cliente**

`tests/integration/cliente.test.js`:
```javascript
const request = require('supertest');
const app = require('../../src/app');
const { limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia } = require('../helpers/factories');

describe('POST /barbearias/:barbearia_id/clientes', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
  });

  test('cadastra cliente vinculado à barbearia da URL, ignorando barbearia_id do body', async () => {
    const barbeariaA = await criarBarbearia('Barbearia A');
    const barbeariaB = await criarBarbearia('Barbearia B');

    const resposta = await request(app)
      .post(`/barbearias/${barbeariaA.id}/clientes`)
      .send({ barbearia_id: barbeariaB.id, nome: 'Cliente Novo', email: 'novo@teste.com', senha: 'senha123' });

    expect(resposta.status).toBe(201);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx jest tests/integration/cliente.test.js`
Expected: FAIL (rota `/barbearias/:barbearia_id/clientes` ainda não existe).

- [ ] **Step 4: Adicionar a rota pública de cadastro escopada por parâmetro de URL**

Nova rota em `src/routes/barbeariaRoutes.js` (o cadastro de cliente é uma sub-rota de barbearia, já que precisa do `barbearia_id` de destino antes de qualquer autenticação existir):

```javascript
const express = require('express');
const router = express.Router();
const { listarBarbearias, criarBarbearia } = require('../controllers/barbeariaController');
const { criarClientePublico } = require('../controllers/clienteController');
const { verificarToken } = require('../middlewares/autenticacao');
const { apenasPlataforma } = require('../middlewares/tenant');

router.get('/', listarBarbearias);
router.post('/', verificarToken, apenasPlataforma, criarBarbearia);
router.post('/:barbearia_id/clientes', criarClientePublico);

module.exports = router;
```

- [ ] **Step 5: Adicionar `criarClientePublico` em `clienteController.js`, mantendo `listarClientes`/`buscarClientePorId` migrados para `req.db`**

```javascript
const bcrypt = require('bcrypt');
const pool = require('../config/database');

async function criarClientePublico(req, res) {
  const { barbearia_id } = req.params;
  const { nome, email, senha, telefone } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  try {
    const senha_hash = await bcrypt.hash(senha, 10);

    const resultado = await pool.query(
      `INSERT INTO cliente (barbearia_id, nome, email, telefone, senha_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, email, telefone, criado_em`,
      [barbearia_id, nome, email, telefone, senha_hash]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado nesta barbearia' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
  }
}

async function listarClientes(req, res) {
  try {
    const resultado = await req.db.query(
      'SELECT id, nome, email, telefone, criado_em FROM cliente ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar clientes' });
  }
}

async function buscarClientePorId(req, res) {
  const { id } = req.params;

  try {
    const resultado = await req.db.query(
      'SELECT id, nome, email, telefone, criado_em FROM cliente WHERE id = $1',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar cliente' });
  }
}

module.exports = { criarClientePublico, listarClientes, buscarClientePorId };
```

`criarClientePublico` usa `pool` direto porque é uma rota pública sem tenant já escopado no request (não passou por `escoparTenant`) — `barbearia_id` vem confiável da URL (não do body), o que é a mitigação correta aqui (o parâmetro de rota identifica QUAL tenant está recebendo o cadastro, sem exigir login prévio).

`listarClientes`/`buscarClientePorId` usam `req.db` — precisam de `verificarToken` + `escoparTenant` na rota.

- [ ] **Step 6: Atualizar `clienteRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const { listarClientes, buscarClientePorId } = require('../controllers/clienteController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, apenasAdmin, listarClientes);
router.get('/:id', verificarToken, escoparTenant, buscarClientePorId);

module.exports = router;
```

A antiga rota `POST /clientes` (cadastro sem contexto de barbearia) é removida — substituída por `POST /barbearias/:barbearia_id/clientes` (Step 4).

- [ ] **Step 7: Rodar os testes**

Run: `npx jest tests/integration/cliente.test.js`
Expected: PASS.

### 11.3 — Controllers restantes: troca mecânica de `pool`/client próprio por `req.db`

Os controllers abaixo não têm lógica de negócio afetada pela migração — a mudança é sempre a mesma: (a) remover `const pool = require('../config/database')` quando não usado mais para nada além das queries que migram para `req.db`, (b) trocar `pool.query(...)` por `req.db.query(...)` nas queries que hoje leem/escrevem dado de tenant, (c) garantir que a rota correspondente tem `verificarToken` + `escoparTenant` antes do controller.

- [ ] **Step 1: `unidadeController.js` + `unidadeRoutes.js`**

Em `src/controllers/unidadeController.js`, trocar todo `pool.query` por `req.db.query` em `listarUnidades` e `criarUnidade`.

`src/routes/unidadeRoutes.js`:
```javascript
const express = require('express');
const router = express.Router();
const { listarUnidades, criarUnidade } = require('../controllers/unidadeController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarUnidades);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarUnidade);

module.exports = router;
```

Nota: `listarUnidades` deixa de ser pública (hoje não exige token) — decisão necessária porque RLS exige `app.tenant_id` setado; sem autenticação não há como saber de qual tenant listar. Isso é uma mudança de comportamento visível para qualquer client atual que chamava essa rota sem token — documentar no changelog da API.

- [ ] **Step 2: `barbeiroController.js` + `barbeiroRoutes.js`**

Mesma troca mecânica em todas as 8 funções exportadas (`listarBarbeiros`, `criarBarbeiro`, `definirDisponibilidade`, `associarServicos`, `criarExcecao`, `listarExcecoes`, `listarDisponibilidade`, `listarServicosDoBarbeiro`).

`src/routes/barbeiroRoutes.js`:
```javascript
const express = require('express');
const router = express.Router();
const {
  listarBarbeiros,
  criarBarbeiro,
  definirDisponibilidade,
  associarServicos,
  criarExcecao,
  listarExcecoes,
  listarDisponibilidade,
  listarServicosDoBarbeiro,
} = require('../controllers/barbeiroController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarBarbeiros);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarBarbeiro);

router.get('/:id/disponibilidade', verificarToken, escoparTenant, listarDisponibilidade);
router.post('/:id/disponibilidade', verificarToken, escoparTenant, apenasAdmin, definirDisponibilidade);

router.get('/:id/servicos', verificarToken, escoparTenant, listarServicosDoBarbeiro);
router.post('/:id/servicos', verificarToken, escoparTenant, apenasAdmin, associarServicos);

router.get('/:id/excecoes', verificarToken, escoparTenant, listarExcecoes);
router.post('/:id/excecoes', verificarToken, escoparTenant, apenasAdmin, criarExcecao);

module.exports = router;
```

Todas as rotas de barbeiro deixam de ser públicas pelo mesmo motivo do Step 1.

- [ ] **Step 3: `servicoController.js` + `servicoRoutes.js`**

Mesma troca em `listarServicos`, `criarServico`.

```javascript
const express = require('express');
const router = express.Router();
const { listarServicos, criarServico } = require('../controllers/servicoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarServicos);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarServico);

module.exports = router;
```

- [ ] **Step 4: `planoController.js` + `planoRoutes.js`**

Mesma troca em `listarPlanos`, `criarPlano`, `associarServicosPlano`, `listarServicosDoPlano`.

```javascript
const express = require('express');
const router = express.Router();
const {
  listarPlanos,
  criarPlano,
  associarServicosPlano,
  listarServicosDoPlano,
} = require('../controllers/planoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/', verificarToken, escoparTenant, listarPlanos);
router.post('/', verificarToken, escoparTenant, apenasAdmin, criarPlano);

router.get('/:id/servicos', verificarToken, escoparTenant, listarServicosDoPlano);
router.post('/:id/servicos', verificarToken, escoparTenant, apenasAdmin, associarServicosPlano);

module.exports = router;
```

- [ ] **Step 5: `financeiroController.js` + `financeiroRoutes.js`**

Mesma troca em `faturamentoMensal`, `desempenhoBarbeiros` — as views já filtram por `barbearia_id` via RLS com `security_invoker` (Task 8), então a query em si não muda além da fonte de conexão. Rotas já exigiam `verificarToken` + `apenasAdmin`; só falta `escoparTenant`.

```javascript
const express = require('express');
const router = express.Router();
const { faturamentoMensal, desempenhoBarbeiros } = require('../controllers/financeiroController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/faturamento-mensal', verificarToken, escoparTenant, apenasAdmin, faturamentoMensal);
router.get('/desempenho-barbeiros', verificarToken, escoparTenant, apenasAdmin, desempenhoBarbeiros);

module.exports = router;
```

- [ ] **Step 6: Rodar os testes existentes para garantir que nada quebrou até aqui**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx jest
```

Expected: todos os testes escritos até agora (`tenant-isolation`, `plataforma`, `auth`, `cliente`) continuam passando.

- [ ] **Step 7: Commit**

Lembrete: não commitar ainda — só ao final (Task 12).

### 11.4 — `agendamentoController.js`: a peça mais complexa

Este controller usa transações manuais (`pool.connect()` + `BEGIN`/`COMMIT`) em 3 das 5 funções. Como `req.db` já É um client dedicado dentro de uma transação (aberta pelo middleware `escoparTenant`), o controller **não deve mais abrir sua própria transação aninhada** — passa a usar `req.db` diretamente para tudo, e o `COMMIT`/`ROLLBACK` final é responsabilidade exclusiva do middleware (`res.on('finish')`).

- [ ] **Step 1: Escrever teste de isolamento de agendamento entre tenants**

`tests/integration/agendamento.test.js`:
```javascript
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');
const { pool, limparBanco, fecharBanco } = require('../helpers/db');
const { criarBarbearia } = require('../helpers/factories');

describe('Isolamento de agendamento entre tenants', () => {
  afterEach(async () => {
    await limparBanco();
  });

  afterAll(async () => {
    await fecharBanco();
  });

  async function montarCenario(nomeBarbearia) {
    const barbearia = await criarBarbearia(nomeBarbearia);
    const unidade = await pool.query(
      'INSERT INTO unidade (barbearia_id, nome) VALUES ($1, $2) RETURNING *',
      [barbearia.id, 'Unidade Principal']
    );
    const barbeiro = await pool.query(
      'INSERT INTO barbeiro (barbearia_id, unidade_id, nome) VALUES ($1, $2, $3) RETURNING *',
      [barbearia.id, unidade.rows[0].id, 'Barbeiro Teste']
    );
    const senha_hash = await bcrypt.hash('senha123', 10);
    const admin = await pool.query(
      'INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [barbearia.id, 'Admin', `admin-${barbearia.id}@teste.com`, senha_hash]
    );
    const token = jwt.sign(
      { id: admin.rows[0].id, tipo: 'admin', barbearia_id: barbearia.id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    return { barbearia, unidade: unidade.rows[0], barbeiro: barbeiro.rows[0], token };
  }

  test('admin de uma barbearia não consegue cancelar agendamento de outra barbearia', async () => {
    const cenarioA = await montarCenario('Barbearia A');
    const cenarioB = await montarCenario('Barbearia B');

    const cliente = await pool.query(
      'INSERT INTO cliente (barbearia_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [cenarioA.barbearia.id, 'Cliente A', 'clienteA@teste.com', 'hash']
    );
    const agendamento = await pool.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status)
       VALUES ($1, $2, $3, $4, now() + interval '1 day', now() + interval '1 day 30 minutes', 'confirmado') RETURNING *`,
      [cenarioA.barbearia.id, cliente.rows[0].id, cenarioA.barbeiro.id, cenarioA.unidade.id]
    );

    const resposta = await request(app)
      .patch(`/agendamentos/${agendamento.rows[0].id}/cancelar`)
      .set('Authorization', `Bearer ${cenarioB.token}`);

    expect(resposta.status).toBe(404);

    const verificacao = await pool.query('SELECT status FROM agendamento WHERE id = $1', [agendamento.rows[0].id]);
    expect(verificacao.rows[0].status).toBe('confirmado');
  });
});
```

Este teste é a prova definitiva de que o bug de segurança original (admin de qualquer barbearia podia cancelar agendamento de qualquer outra) está corrigido — RLS faz o `UPDATE ... WHERE id = $1` não encontrar a linha (porque ela pertence a outro tenant), retornando 404 exatamente como se o agendamento não existisse.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx jest tests/integration/agendamento.test.js`
Expected: FAIL — hoje o cancelamento teria sucesso (200), não 404, porque não há filtro de tenant.

- [ ] **Step 3: Reescrever `agendamentoController.js` usando `req.db` em vez de transações próprias**

Ler o arquivo completo primeiro (já lido nesta sessão — 359 linhas). Reescrever preservando toda a lógica de negócio (cálculo de horários, cálculo de valor com desconto de plano, notificação de lembrete), trocando:
- `pool.connect()` + `client.query('BEGIN')`/`COMMIT`/`ROLLBACK` + `client.release()` → removidos; usa `req.db` diretamente.
- Todo `INSERT` de `agendamento`, `agendamento_servico`, `notificacao`, `pagamento` ganha `barbearia_id` explícito (RLS exige que o valor inserido bata com `app.tenant_id`, então precisa ser passado, não é implícito).

```javascript
const {
  combinarDataHora,
  adicionarMinutos,
  subtrairIntervalo,
  gerarSlotsDisponiveis,
} = require('../utils/agenda');

async function listarHorariosDisponiveis(req, res) {
  const { barbeiro_id, data, duracao_minutos } = req.query;

  if (!barbeiro_id || !data || !duracao_minutos) {
    return res.status(400).json({ erro: 'barbeiro_id, data e duracao_minutos são obrigatórios' });
  }

  try {
    const diaSemana = combinarDataHora(data, '00:00').getDay();

    const dispResultado = await req.db.query(
      'SELECT hora_inicio, hora_fim FROM barbeiro_disponibilidade WHERE barbeiro_id = $1 AND dia_semana = $2',
      [barbeiro_id, diaSemana]
    );

    let janelas = dispResultado.rows.map((linha) => ({
      inicio: combinarDataHora(data, linha.hora_inicio),
      fim: combinarDataHora(data, linha.hora_fim),
    }));

    const excResultado = await req.db.query(
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

    const agResultado = await req.db.query(
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

    const slots = gerarSlotsDisponiveis(janelas, Number(duracao_minutos));

    res.json(
      slots.map((slot) => ({
        inicio: slot.inicio.toISOString(),
        fim_atendimento: slot.fim_atendimento.toISOString(),
      }))
    );
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao calcular horários disponíveis' });
  }
}

async function calcularValorServico(db, clienteId, servicoId) {
  const assinaturaResultado = await db.query(
    `SELECT a.plano_id, p.desconto_servico_fora_plano
     FROM assinatura a
     JOIN plano p ON p.id = a.plano_id
     WHERE a.cliente_id = $1 AND a.status = 'ativa'`,
    [clienteId]
  );

  const servicoResultado = await db.query(
    'SELECT valor FROM servico WHERE id = $1',
    [servicoId]
  );
  const valorCheio = Number(servicoResultado.rows[0].valor);

  if (assinaturaResultado.rows.length === 0) {
    return { valorCobrado: valorCheio, cobertoPeloPlano: false };
  }

  const { plano_id, desconto_servico_fora_plano } = assinaturaResultado.rows[0];

  const coberturaResultado = await db.query(
    'SELECT 1 FROM plano_servico WHERE plano_id = $1 AND servico_id = $2',
    [plano_id, servicoId]
  );

  if (coberturaResultado.rows.length > 0) {
    return { valorCobrado: 0, cobertoPeloPlano: true };
  }

  const valorComDesconto = valorCheio * (1 - Number(desconto_servico_fora_plano) / 100);
  return { valorCobrado: Number(valorComDesconto.toFixed(2)), cobertoPeloPlano: false };
}

async function criarAgendamento(req, res) {
  const { cliente_id, barbeiro_id, unidade_id, data, hora_inicio, servico_ids } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!cliente_id || !barbeiro_id || !unidade_id || !data || !hora_inicio || !Array.isArray(servico_ids) || servico_ids.length === 0) {
    return res.status(400).json({ erro: 'cliente_id, barbeiro_id, unidade_id, data, hora_inicio e servico_ids são obrigatórios' });
  }

  try {
    const servicosResultado = await req.db.query(
      'SELECT id, duracao_minutos FROM servico WHERE id = ANY($1::int[])',
      [servico_ids]
    );

    if (servicosResultado.rows.length !== servico_ids.length) {
      return res.status(400).json({ erro: 'Um ou mais servico_ids são inválidos' });
    }

    const duracaoTotal = servicosResultado.rows.reduce((soma, s) => soma + s.duracao_minutos, 0);

    const dataHoraInicio = combinarDataHora(data, hora_inicio);
    const dataHoraFim = adicionarMinutos(dataHoraInicio, duracaoTotal + 10);

    const agendamentoResultado = await req.db.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmado') RETURNING *`,
      [barbearia_id, cliente_id, barbeiro_id, unidade_id, dataHoraInicio, dataHoraFim]
    );
    const agendamento = agendamentoResultado.rows[0];

    const itens = [];
    for (const servicoId of servico_ids) {
      const { valorCobrado, cobertoPeloPlano } = await calcularValorServico(req.db, cliente_id, servicoId);

      const itemResultado = await req.db.query(
        `INSERT INTO agendamento_servico (barbearia_id, agendamento_id, servico_id, coberto_pelo_plano, valor_cobrado)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [barbearia_id, agendamento.id, servicoId, cobertoPeloPlano, valorCobrado]
      );
      itens.push(itemResultado.rows[0]);
    }

    await req.db.query(
      `INSERT INTO notificacao (barbearia_id, agendamento_id, tipo, status) VALUES ($1, $2, 'lembrete_1_dia', 'pendente')`,
      [barbearia_id, agendamento.id]
    );

    const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);

    res.status(201).json({ ...agendamento, itens, valor_total: valorTotal });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  }
}

async function cancelarAgendamento(req, res) {
  const { id } = req.params;

  try {
    const atualResultado = await req.db.query('SELECT cliente_id FROM agendamento WHERE id = $1', [id]);

    if (atualResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    const donoDoAgendamento = atualResultado.rows[0].cliente_id;

    if (req.usuario.tipo === 'cliente' && req.usuario.id !== donoDoAgendamento) {
      return res.status(403).json({ erro: 'Você só pode cancelar seus próprios agendamentos' });
    }

    const resultado = await req.db.query(
      `UPDATE agendamento SET status = 'cancelado'
       WHERE id = $1 AND status = 'confirmado'
       RETURNING *`,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não pode mais ser cancelado' });
    }

    await req.db.query(
      `UPDATE notificacao SET status = 'cancelado' WHERE agendamento_id = $1 AND status = 'pendente'`,
      [id]
    );

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cancelar agendamento' });
  }
}

async function concluirAgendamento(req, res) {
  const { id } = req.params;
  const barbearia_id = req.usuario.barbearia_id;

  try {
    const agendamentoResultado = await req.db.query(
      `UPDATE agendamento SET status = 'concluido'
       WHERE id = $1 AND status = 'confirmado'
       RETURNING *`,
      [id]
    );

    if (agendamentoResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado ou não pode ser concluído' });
    }

    const itensResultado = await req.db.query(
      'SELECT SUM(valor_cobrado) AS total FROM agendamento_servico WHERE agendamento_id = $1',
      [id]
    );
    const valorTotal = Number(itensResultado.rows[0].total) || 0;

    if (valorTotal > 0) {
      await req.db.query(
        `INSERT INTO pagamento (barbearia_id, agendamento_id, valor, status)
         VALUES ($1, $2, $3, 'pago')`,
        [barbearia_id, id, valorTotal]
      );
    }

    res.json({ ...agendamentoResultado.rows[0], valor_pago: valorTotal });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao concluir agendamento' });
  }
}

async function reagendarAgendamento(req, res) {
  const { id } = req.params;
  const { data, hora_inicio } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!data || !hora_inicio) {
    return res.status(400).json({ erro: 'data e hora_inicio são obrigatórios' });
  }

  try {
    const originalResultado = await req.db.query(
      `SELECT * FROM agendamento WHERE id = $1 AND status = 'confirmado'`,
      [id]
    );

    if (originalResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado ou não pode ser reagendado' });
    }

    const original = originalResultado.rows[0];

    if (req.usuario.tipo === 'cliente' && req.usuario.id !== original.cliente_id) {
      return res.status(403).json({ erro: 'Você só pode reagendar seus próprios agendamentos' });
    }

    const itensOriginaisResultado = await req.db.query(
      'SELECT servico_id FROM agendamento_servico WHERE agendamento_id = $1',
      [id]
    );
    const servicoIds = itensOriginaisResultado.rows.map((linha) => linha.servico_id);

    const servicosResultado = await req.db.query(
      'SELECT id, duracao_minutos FROM servico WHERE id = ANY($1::int[])',
      [servicoIds]
    );
    const duracaoTotal = servicosResultado.rows.reduce((soma, s) => soma + s.duracao_minutos, 0);

    const novaDataHoraInicio = combinarDataHora(data, hora_inicio);
    const novaDataHoraFim = adicionarMinutos(novaDataHoraInicio, duracaoTotal + 10);

    const novoResultado = await req.db.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status, reagendado_de_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmado', $7) RETURNING *`,
      [barbearia_id, original.cliente_id, original.barbeiro_id, original.unidade_id, novaDataHoraInicio, novaDataHoraFim, original.id]
    );
    const novoAgendamento = novoResultado.rows[0];

    const itens = [];
    for (const servicoId of servicoIds) {
      const { valorCobrado, cobertoPeloPlano } = await calcularValorServico(req.db, original.cliente_id, servicoId);
      const itemResultado = await req.db.query(
        `INSERT INTO agendamento_servico (barbearia_id, agendamento_id, servico_id, coberto_pelo_plano, valor_cobrado)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [barbearia_id, novoAgendamento.id, servicoId, cobertoPeloPlano, valorCobrado]
      );
      itens.push(itemResultado.rows[0]);
    }

    await req.db.query(
      `INSERT INTO notificacao (barbearia_id, agendamento_id, tipo, status) VALUES ($1, $2, 'lembrete_1_dia', 'pendente')`,
      [barbearia_id, novoAgendamento.id]
    );

    await req.db.query(
      `UPDATE notificacao SET status = 'cancelado' WHERE agendamento_id = $1 AND status = 'pendente'`,
      [id]
    );

    await req.db.query(`UPDATE agendamento SET status = 'reagendado' WHERE id = $1`, [id]);

    const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);
    res.status(201).json({ ...novoAgendamento, itens, valor_total: valorTotal });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao reagendar agendamento' });
  }
}

module.exports = {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
  reagendarAgendamento,
};
```

Nota crítica de correção colateral: o `ROLLBACK` explícito que existia em cada `catch` (código antigo) desaparece — mas isso é correto e intencional, não uma regressão. O middleware `escoparTenant` já observa `res.statusCode` em `res.on('finish')` e faz `ROLLBACK` automaticamente sempre que a resposta é >= 400 (todo `catch` deste controller responde com status >= 400). Isso resolve, de brinde, o bug de correção identificado na revisão de código anterior desta sessão: `cancelarAgendamento` hoje mistura `pool.query` sem transação — com `req.db`, TUDO nesta requisição roda atomicamente dentro da mesma transação gerenciada pelo middleware.

- [ ] **Step 4: Atualizar `agendamentoRoutes.js`**

`listarHorariosDisponiveis` deixa de ser pública pelo mesmo motivo das demais listagens (RLS precisa de tenant escopado).

```javascript
const express = require('express');
const router = express.Router();
const {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
  reagendarAgendamento,
} = require('../controllers/agendamentoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.get('/horarios-disponiveis', verificarToken, escoparTenant, listarHorariosDisponiveis);
router.post('/', verificarToken, escoparTenant, criarAgendamento);
router.patch('/:id/cancelar', verificarToken, escoparTenant, cancelarAgendamento);
router.patch('/:id/concluir', verificarToken, escoparTenant, apenasAdmin, concluirAgendamento);
router.patch('/:id/reagendar', verificarToken, escoparTenant, reagendarAgendamento);

module.exports = router;
```

- [ ] **Step 5: Rodar o teste de isolamento de agendamento**

Run: `npx jest tests/integration/agendamento.test.js`
Expected: PASS — o cancelamento cross-tenant agora retorna 404 e o agendamento permanece `confirmado`.

- [ ] **Step 6: Commit**

Lembrete: não commitar ainda — só ao final (Task 12).

### 11.5 — `notificacaoService.js` e `jobs/lembretes.js`: cron precisa iterar por tenant

O cron job hoje roda uma única query global. Com RLS ativo, ele precisa abrir uma conexão escopada *por barbearia*, iterando sobre todas as barbearias ativas — não há mais um "modo sem tenant" implícito para operações em lote como essa.

- [ ] **Step 1: Reescrever `notificacaoService.js` para receber um client já escopado**

```javascript
async function enviarLembretes(db) {
  const resultado = await db.query(`
    SELECT n.id AS notificacao_id, a.id AS agendamento_id, a.data_hora_inicio,
           c.nome AS cliente_nome, c.telefone AS cliente_telefone
    FROM notificacao n
    JOIN agendamento a ON a.id = n.agendamento_id
    JOIN cliente c ON c.id = a.cliente_id
    WHERE n.status = 'pendente'
      AND n.tipo = 'lembrete_1_dia'
      AND a.status = 'confirmado'
      AND a.data_hora_inicio::date = (CURRENT_DATE + INTERVAL '1 day')::date
  `);

  let enviados = 0;

  for (const linha of resultado.rows) {
    try {
      console.log(
        `[LEMBRETE] Para ${linha.cliente_nome} (${linha.cliente_telefone}): ` +
        `seu horário está marcado para amanhã, ${new Date(linha.data_hora_inicio).toLocaleString('pt-BR')}.`
      );

      await db.query(
        `UPDATE notificacao SET status = 'enviado', enviado_em = now() WHERE id = $1`,
        [linha.notificacao_id]
      );
      enviados++;
    } catch (erro) {
      console.error(`Falha ao enviar lembrete ${linha.notificacao_id}:`, erro);
      await db.query(`UPDATE notificacao SET status = 'falhou' WHERE id = $1`, [linha.notificacao_id]).catch(() => {});
    }
  }

  return enviados;
}

module.exports = { enviarLembretes };
```

Mudança de assinatura: `enviarLembretes(db)` recebe o client já escopado em vez de importar `pool` — quem escopa por tenant é o chamador (o job ou o controller de disparo manual).

- [ ] **Step 2: Reescrever `jobs/lembretes.js` para iterar todas as barbearias**

```javascript
const cron = require('node-cron');
const pool = require('../config/database');
const { enviarLembretes } = require('../services/notificacaoService');

async function processarTodasAsBarbearias() {
  const barbeariasResultado = await pool.query('SELECT id FROM barbearia');

  let totalGeral = 0;

  for (const { id: barbearia_id } of barbeariasResultado.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);
      const total = await enviarLembretes(client);
      await client.query('COMMIT');
      totalGeral += total;
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`Erro ao processar lembretes da barbearia ${barbearia_id}:`, erro);
    } finally {
      client.release();
    }
  }

  return totalGeral;
}

function iniciarJobLembretes() {
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Verificando lembretes de amanhã...');
    try {
      const total = await processarTodasAsBarbearias();
      console.log(`[CRON] ${total} lembrete(s) enviado(s) no total.`);
    } catch (erro) {
      console.error('[CRON] Falha ao processar lembretes:', erro);
    }
  });

  console.log('[CRON] Job de lembretes agendado para rodar diariamente às 08:00.');
}

module.exports = { iniciarJobLembretes, processarTodasAsBarbearias };
```

Esta reescrita corrige, de brinde, dois bugs de correção já identificados nesta sessão sobre o código pré-multi-tenant: (1) falha isolada de uma barbearia não derruba o processamento das demais (`catch` por barbearia, não um `catch` global); (2) o `catch` externo do `cron.schedule` agora existe (corrige o risco de unhandled rejection derrubando o processo).

- [ ] **Step 3: Atualizar `notificacaoController.js` (disparo manual) para escopar por tenant do admin autenticado**

```javascript
const { enviarLembretes } = require('../services/notificacaoService');

async function dispararLembretesManualmente(req, res) {
  try {
    const total = await enviarLembretes(req.db);
    res.json({ mensagem: `${total} lembrete(s) processado(s)` });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar lembretes' });
  }
}

module.exports = { dispararLembretesManualmente };
```

O disparo manual via API agora processa só a barbearia do admin que chamou (comportamento correto: um admin não deve conseguir disparar lembretes de outras barbearias) — diferente do cron, que itera todas.

- [ ] **Step 4: Atualizar `notificacaoRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const { dispararLembretesManualmente } = require('../controllers/notificacaoController');
const { verificarToken, apenasAdmin } = require('../middlewares/autenticacao');
const { escoparTenant } = require('../middlewares/tenant');

router.post('/enviar-lembretes', verificarToken, escoparTenant, apenasAdmin, dispararLembretesManualmente);

module.exports = router;
```

- [ ] **Step 5: Rodar a suíte completa**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
npx jest
```

Expected: todos os testes passam.

- [ ] **Step 6: Commit**

Lembrete: não commitar ainda — só ao final (Task 12).

---

## Task 12: Verificação final e commit único

**Files:** nenhum arquivo novo — apenas validação e o commit consolidado.

- [ ] **Step 1: Rodar a suíte de testes completa uma última vez**

Run: `npx jest`
Expected: 100% dos testes passando, incluindo o teste crítico de cross-tenant em `agendamento.test.js`.

- [ ] **Step 2: Rodar as migrations do zero em um banco limpo para garantir reprodutibilidade**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node scripts/db-admin.js apagar barbearia_db_migration_check
node scripts/db-admin.js criar barbearia_db_migration_check
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db_migration_check" npx node-pg-migrate up
```

Expected: as 7 migrations rodam do zero sem erro num banco vazio — prova de que a sequência não depende de estado residual do banco de desenvolvimento. Se a migration 004 falhar por causa dos placeholders de nome de constraint (Task 5, Step 2), lembrar que este banco vazio nunca teve as constraints antigas — então `DROP CONSTRAINT IF EXISTS <nome_antigo>` é sempre um no-op seguro aqui (o `IF EXISTS` cobre esse caso), e só a criação da nova constraint (`cliente_barbearia_email_key`) precisa funcionar.

Run para limpar o banco de verificação:
```bash
node scripts/db-admin.js apagar barbearia_db_migration_check
```

- [ ] **Step 3: Confirmar manualmente que o servidor sobe sem erro**

Run:
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
node -e "require('./src/app'); console.log('app.js carregou sem erro de sintaxe/require');"
```

Expected: `app.js carregou sem erro de sintaxe/require`.

- [ ] **Step 4: Revisar o diff completo antes do commit**

Run: `git status` e `git diff --stat` para conferir que todos os arquivos esperados (migrations novas, middlewares, controllers, rotas, testes, scripts) aparecem, e nenhum arquivo sensível foi commitado por engano.

Run: `cat .gitignore` — se `.env` não estiver listado, adicioná-lo ao `.gitignore` antes do commit (não commitar credenciais reais do banco).

- [ ] **Step 5: Commit único de todo o trabalho**

Conforme instrução do usuário — um único commit consolidando toda a fundação multi-tenant:

```bash
git add migrations/ .node-pg-migraterc.json jest.config.js tests/ scripts/ src/ package.json package-lock.json docs/superpowers/
git commit -m "$(cat <<'EOF'
Implementa fundacao multi-tenant com isolamento via RLS

Corrige vazamento de dados cross-tenant identificado na revisao de
codigo: nenhuma query filtrava por barbearia_id, permitindo que um
admin autenticado acessasse/modificasse dados de qualquer barbearia.

- Adiciona barbearia_id a todas as tabelas (migrations 002-004)
- Habilita Row-Level Security com FORCE em todas as tabelas de tenant
  como defesa em profundidade (migration 005)
- Introduz middleware escoparTenant: client dedicado por requisicao
  com SET LOCAL app.tenant_id, compativel com RLS sob connection pool
- Adiciona papel usuario_plataforma (super-admin) para proteger a
  criacao de barbearias, antes uma rota publica sem autenticacao
- Migra todos os controllers de pool/client proprio para req.db
- Corrige de brinde: cancelarAgendamento passa a ser atomico (usava
  pool.query fora de transacao); cron de lembretes ganha tratamento
  de erro por barbearia em vez de falhar tudo de uma vez
- Adiciona Jest + Supertest com testes de integracao contra Postgres
  real, incluindo teste que prova o isolamento cross-tenant

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Confirmar o commit**

Run: `git log -1 --stat`
Expected: commit criado com todos os arquivos listados no Step 4.

---

## Fora de escopo (lembrete)

Conforme seção 11 do spec: onboarding self-service, billing da plataforma, infraestrutura AWS/observabilidade/PgBouncer/read replicas, e RBAC completo usando `usuario_admin.papel` (hoje só populado no JWT, sem middleware de autorização granular) ficam para fases futuras.
