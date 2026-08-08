# Cadastro Público de Cliente por Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um cliente crie sua própria conta acessando um link (`/cadastro/:barbeariaId`) enviado pela barbearia, coletando nome completo, email, telefone, data de nascimento e senha.

**Architecture:** Uma migration aditiva (`data_nascimento` em `cliente`), extensão do controller/rota de cadastro público já existente para aceitar e validar o campo novo, e uma tela nova no frontend que valida a existência da barbearia via `GET /barbearias/:id/tema` (já público) antes de mostrar o formulário.

**Tech Stack:** Backend: Node.js/Express/pg (extensão de `clienteController.js`, já existente). Frontend: React/TypeScript/React Router, CSS Modules (reaproveitando `Auth.module.css` já existente).

## Global Constraints

- `data_nascimento` é opcional no schema (nullable) mas obrigatório no formulário de cadastro público — a coluna existir como nullable só evita quebrar clientes já cadastrados sem esse dado, não torna o campo opcional no fluxo desta tela.
- Validação de `data_nascimento`: precisa ser uma data parseável e não pode estar no futuro. Sem regra de idade mínima nesta fase.
- A rota `POST /barbearias/:barbearia_id/clientes` já ignora qualquer `barbearia_id` vindo do body — o `:barbearia_id` da URL é a única fonte confiável do tenant. Este comportamento já existe e não deve ser alterado.
- A tela `/cadastro/:barbeariaId` é pública — fora de `RotaProtegida`, sem exigir login.
- Antes de mostrar o formulário, a tela verifica que a barbearia existe via `GET /barbearias/:id/tema` (já existente, público). Se 404, mostra "Link de cadastro inválido ou expirado" em vez do formulário.
- Após cadastro bem-sucedido, mostra mensagem de confirmação com link para `/login` — sem login automático.

---

## File Structure

```
Backend (barbearia-api/):
  Criar:
    migrations/017_adicionar_data_nascimento_cliente.sql
  Modificar:
    src/controllers/clienteController.js   -- criarClientePublico aceita e valida data_nascimento
    tests/integration/cliente.test.js       -- testes do campo novo

Frontend (barbearia-web/):
  Criar:
    src/api/cadastro.ts
    src/pages/CadastroCliente.tsx
    src/pages/CadastroCliente.module.css
    src/pages/CadastroCliente.test.tsx
  Modificar:
    src/App.tsx   -- adiciona rota publica /cadastro/:barbeariaId
```

Justificativa: a extensão de backend fica no mesmo controller/arquivo de teste já existentes para `criarClientePublico`, já que é a mesma responsabilidade (cadastro público), só com um campo a mais. No frontend, `CadastroCliente.tsx` reaproveita o CSS já existente em `Auth.module.css` (mesmo cartão/campo/botão usado em `LoginCliente.tsx`) em vez de duplicar estilos.

---

## Task 1: Backend — coluna `data_nascimento` e validação no cadastro público

**Files:**
- Create: `migrations/017_adicionar_data_nascimento_cliente.sql`
- Modify: `src/controllers/clienteController.js`
- Test: `tests/integration/cliente.test.js`

**Interfaces:**
- Consumes: nenhuma interface nova de tasks anteriores.
- Produces: `POST /barbearias/:barbearia_id/clientes` aceita `data_nascimento` (string `YYYY-MM-DD`) no body, retornando `400` se ausente, malformada, ou no futuro. Resposta de sucesso inclui `data_nascimento` no objeto retornado. Consumido pela Task 3 (frontend `api/cadastro.ts`).

- [ ] **Step 1: Escrever a migration**

`migrations/017_adicionar_data_nascimento_cliente.sql`:
```sql
-- Up Migration
ALTER TABLE cliente ADD COLUMN data_nascimento DATE;

-- Down Migration
ALTER TABLE cliente DROP COLUMN data_nascimento;
```

- [ ] **Step 2: Rodar a migration no banco de dev**

Run (usuário `barbearia_app` não é dono das tabelas — precisa de credenciais de superuser, mesmo padrão das migrations anteriores):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api"
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db" npx node-pg-migrate up
```

Expected: `017_adicionar_data_nascimento_cliente` migrada sem erro.

- [ ] **Step 3: Rodar a migration no banco de teste**

Run:
```bash
DATABASE_URL="postgresql://postgres:080518@localhost:5432/barbearia_db_test" npx node-pg-migrate up
```

- [ ] **Step 4: Verificar a coluna foi criada**

Run:
```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
(async () => {
  const r = await pool.query(\"SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'cliente' AND column_name = 'data_nascimento'\");
  console.log(r.rows);
  await pool.end();
})();
"
```

Expected: 1 linha — `data_nascimento`, tipo `date`, `is_nullable = YES`.

- [ ] **Step 5: Escrever os testes de validação (falha primeiro)**

Ler `tests/integration/cliente.test.js` atual (describe `'POST /barbearias/:barbearia_id/clientes'`, linhas 9-98) para confirmar o padrão exato de setup, e adicionar dentro do mesmo describe, após o teste `'retorna 400 quando barbearia_id da URL não é numérico'`:

```javascript
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
```

- [ ] **Step 6: Rodar os testes e confirmar que falham**

Run:
```bash
npx jest tests/integration/cliente.test.js --detectOpenHandles
```

Expected: FAIL nos 4 testes novos — `data_nascimento` ainda não é validada nem persistida (o teste de "cadastra com data válida" falha porque `resposta.body.data_nascimento` é `undefined`; os testes de rejeição falham porque a rota ainda aceita `201` sem validar).

- [ ] **Step 7: Implementar a validação e persistência**

Editar `src/controllers/clienteController.js`, substituindo a função `criarClientePublico` inteira:

```javascript
async function criarClientePublico(req, res) {
  const { barbearia_id } = req.params;
  const { nome, email, senha, telefone, data_nascimento } = req.body;

  if (!nome || !email || !senha || !data_nascimento) {
    return res.status(400).json({ erro: 'nome, email, senha e data_nascimento são obrigatórios' });
  }

  const dataNascimentoParseada = new Date(data_nascimento);
  if (Number.isNaN(dataNascimentoParseada.getTime())) {
    return res.status(400).json({ erro: 'data_nascimento inválida' });
  }
  if (dataNascimentoParseada.getTime() > Date.now()) {
    return res.status(400).json({ erro: 'data_nascimento não pode estar no futuro' });
  }

  const client = await pool.connect();

  try {
    const senha_hash = await bcrypt.hash(senha, 10);

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);

    const resultado = await client.query(
      `INSERT INTO cliente (barbearia_id, nome, email, telefone, senha_hash, data_nascimento)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nome, email, telefone, data_nascimento, criado_em`,
      [barbearia_id, nome, email, telefone, senha_hash, data_nascimento]
    );

    await client.query('COMMIT');

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});

    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado nesta barbearia' });
    }
    if (erro.code === '23503') {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'barbearia_id inválido' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
  } finally {
    client.release();
  }
}
```

**Nota:** o teste `'retorna 400 quando faltam campos obrigatórios'` já existente (linha 60-68 do arquivo atual) envia `{ nome: 'Sem email nem senha' }` — continua retornando `400` normalmente, agora também por faltar `data_nascimento` além de email/senha, então esse teste já existente não quebra.

- [ ] **Step 8: Rodar os testes de novo**

Run:
```bash
npx jest tests/integration/cliente.test.js --detectOpenHandles
```

Expected: todos os testes passam, incluindo os 4 novos.

- [ ] **Step 9: Rodar a suíte completa do backend**

Run:
```bash
npx jest --detectOpenHandles
```

Expected: 100% dos testes passando, sem regressão. (Nota: o teste `tests/integration/agendamento.test.js` — `'data_hora_inicio do agendamento criado bate exatamente...'` e `'retorna slots de qualquer barbeiro...'` — são sensíveis ao horário do relógio local e podem falhar tarde da noite/madrugada; isso é uma fragilidade pré-existente, não relacionada a esta task. Se falharem, confirme rodando `git stash` e testando de novo antes de investigar como regressão.)

- [ ] **Step 10: Commit**

```bash
git add migrations/017_adicionar_data_nascimento_cliente.sql src/controllers/clienteController.js tests/integration/cliente.test.js
git commit -m "Adiciona data_nascimento ao cadastro publico de cliente"
```

---

## Task 2: Frontend — API client e tela de cadastro

**Files:**
- Create: `barbearia-web/src/api/cadastro.ts`
- Create: `barbearia-web/src/pages/CadastroCliente.tsx`
- Create: `barbearia-web/src/pages/CadastroCliente.module.css`
- Create: `barbearia-web/src/pages/CadastroCliente.test.tsx`
- Modify: `barbearia-web/src/App.tsx`

**Interfaces:**
- Consumes: `apiClient` de `api/client.ts` (já existe), `buscarTema` de `api/tema.ts` (já existe, retorna `CoresTema` ou lança `ErroApi` em caso de 404), `Marca` de `components/Marca.tsx` (já existe), classes de `Auth.module.css` (já existe: `.pagina`, `.cabecalho`, `.subtitulo`, `.cartao`, `.titulo`, `.campo`, `.rotulo`, `.entrada`, `.botao`, `.erro`, `.status`, `.rodape`).
- Produces: `cadastrarCliente(barbeariaId: number, dados: CadastroClienteInput): Promise<ClienteCadastrado>` em `api/cadastro.ts`. Rota `/cadastro/:barbeariaId` registrada em `App.tsx`, pública.

- [ ] **Step 1: Implementar `api/cadastro.ts`**

```typescript
import { apiClient } from './client';

export interface CadastroClienteInput {
  nome: string;
  email: string;
  senha: string;
  telefone?: string;
  data_nascimento: string;
}

export interface ClienteCadastrado {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  data_nascimento: string;
  criado_em: string;
}

export function cadastrarCliente(barbeariaId: number, dados: CadastroClienteInput): Promise<ClienteCadastrado> {
  return apiClient.post<ClienteCadastrado>(`/barbearias/${barbeariaId}/clientes`, dados);
}
```

- [ ] **Step 2: Escrever o teste da tela (falha primeiro)**

`barbearia-web/src/pages/CadastroCliente.test.tsx`:
```tsx
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as temaApi from '../api/tema';
import * as cadastroApi from '../api/cadastro';
import { ErroApi } from '../api/client';
import CadastroCliente from './CadastroCliente';

function renderComBarbearia(barbeariaId: string) {
  return render(
    <MemoryRouter initialEntries={[`/cadastro/${barbeariaId}`]}>
      <Routes>
        <Route path="/cadastro/:barbeariaId" element={<CadastroCliente />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CadastroCliente', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('mostra o formulário quando a barbearia existe', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });

    renderComBarbearia('1');

    await waitFor(() => {
      expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument();
    });
  });

  test('mostra mensagem de link inválido quando a barbearia não existe', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockRejectedValue(new ErroApi('Barbearia não encontrada', false));

    renderComBarbearia('9999');

    await waitFor(() => {
      expect(screen.getByText(/link de cadastro inválido ou expirado/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/nome completo/i)).not.toBeInTheDocument();
  });

  test('envia o formulário completo e mostra confirmação com link para login', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    const mockCadastrar = vi.spyOn(cadastroApi, 'cadastrarCliente').mockResolvedValue({
      id: 1,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
      telefone: '11999990000',
      data_nascimento: '1995-05-20',
      criado_em: '2026-08-08T00:00:00.000Z',
    });

    renderComBarbearia('1');

    await waitFor(() => expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/nome completo/i), 'Cliente Teste');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'cliente@teste.com');
    await userEvent.type(screen.getByLabelText(/telefone/i), '11999990000');
    await userEvent.type(screen.getByLabelText(/data de nascimento/i), '1995-05-20');
    await userEvent.type(screen.getByLabelText(/^senha$/i), 'senha123');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(mockCadastrar).toHaveBeenCalledWith(1, {
        nome: 'Cliente Teste',
        email: 'cliente@teste.com',
        telefone: '11999990000',
        data_nascimento: '1995-05-20',
        senha: 'senha123',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/conta criada/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /ir para o login/i })).toHaveAttribute('href', '/login');
  });

  test('mostra erro quando o cadastro falha (ex: email duplicado)', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(cadastroApi, 'cadastrarCliente').mockRejectedValue(
      new ErroApi('Este email já está cadastrado nesta barbearia', false)
    );

    renderComBarbearia('1');

    await waitFor(() => expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/nome completo/i), 'Cliente Duplicado');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'duplicado@teste.com');
    await userEvent.type(screen.getByLabelText(/data de nascimento/i), '1995-05-20');
    await userEvent.type(screen.getByLabelText(/^senha$/i), 'senha123');
    await userEvent.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(screen.getByText('Este email já está cadastrado nesta barbearia')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run (dentro de `barbearia-web/`):
```bash
npx vitest run src/pages/CadastroCliente.test.tsx
```

Expected: FAIL — `./CadastroCliente` não existe.

- [ ] **Step 4: Criar `CadastroCliente.module.css`**

Reaproveita as classes já existentes em `Auth.module.css` para a maior parte do visual — este arquivo só adiciona o que for específico desta tela:

```css
.linkVoltar {
  text-align: center;
  margin-top: 1.5rem;
}

.linkVoltar a {
  color: var(--plataforma-texto);
  font-weight: 500;
  text-decoration: none;
  font-size: 0.8125rem;
}

.linkVoltar a:hover {
  text-decoration: underline;
}
```

- [ ] **Step 5: Implementar `CadastroCliente.tsx`**

```tsx
import { useState, useEffect, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import Marca from '../components/Marca';
import { buscarTema } from '../api/tema';
import { cadastrarCliente } from '../api/cadastro';
import authStyles from './Auth.module.css';
import styles from './CadastroCliente.module.css';

type EstadoBarbearia = 'carregando' | 'valida' | 'invalida';

export default function CadastroCliente() {
  const { barbeariaId } = useParams<{ barbeariaId: string }>();
  const idNumerico = Number(barbeariaId);

  const [estadoBarbearia, setEstadoBarbearia] = useState<EstadoBarbearia>('carregando');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [cadastroConcluido, setCadastroConcluido] = useState(false);

  useEffect(() => {
    buscarTema(idNumerico)
      .then(() => setEstadoBarbearia('valida'))
      .catch(() => setEstadoBarbearia('invalida'));
  }, [idNumerico]);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await cadastrarCliente(idNumerico, {
        nome,
        email,
        telefone: telefone || undefined,
        data_nascimento: dataNascimento,
        senha,
      });
      setCadastroConcluido(true);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao cadastrar');
    }
  }

  if (estadoBarbearia === 'carregando') {
    return (
      <div className={authStyles.pagina}>
        <p className={authStyles.status}>Carregando...</p>
      </div>
    );
  }

  if (estadoBarbearia === 'invalida') {
    return (
      <div className={authStyles.pagina}>
        <div>
          <div className={authStyles.cabecalho}>
            <Marca />
          </div>
          <p className={authStyles.erro} role="alert">
            Link de cadastro inválido ou expirado.
          </p>
        </div>
      </div>
    );
  }

  if (cadastroConcluido) {
    return (
      <div className={authStyles.pagina}>
        <div>
          <div className={authStyles.cabecalho}>
            <Marca />
          </div>
          <div className={authStyles.cartao}>
            <p className={authStyles.status} role="status">
              Conta criada com sucesso!
            </p>
            <div className={styles.linkVoltar}>
              <Link to="/login">Ir para o login</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={authStyles.pagina}>
      <div>
        <div className={authStyles.cabecalho}>
          <Marca />
          <p className={authStyles.subtitulo}>Crie sua conta</p>
        </div>

        <form className={authStyles.cartao} onSubmit={aoSubmeter}>
          <h1 className={authStyles.titulo}>Cadastro</h1>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="nome">
              Nome completo
            </label>
            <input
              className={authStyles.entrada}
              id="nome"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="email">
              Email
            </label>
            <input
              className={authStyles.entrada}
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="telefone">
              Telefone
            </label>
            <input
              className={authStyles.entrada}
              id="telefone"
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="data-nascimento">
              Data de nascimento
            </label>
            <input
              className={authStyles.entrada}
              id="data-nascimento"
              type="date"
              value={dataNascimento}
              onChange={(e) => setDataNascimento(e.target.value)}
              required
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="senha">
              Senha
            </label>
            <input
              className={authStyles.entrada}
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          {erro && (
            <p className={authStyles.erro} role="alert">
              {erro}
            </p>
          )}

          <button className={authStyles.botao} type="submit">
            Cadastrar
          </button>
        </form>

        <p className={authStyles.rodape}>
          Já tem uma conta? <Link to="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
```

**Nota:** o `<label>` "Data de nascimento" usa `htmlFor="data-nascimento"`, o teste busca via `getByLabelText(/data de nascimento/i)` — ambos batem pelo texto visível do label, não pelo `id`, então a associação funciona corretamente.

- [ ] **Step 6: Rodar o teste de novo**

Run:
```bash
npx vitest run src/pages/CadastroCliente.test.tsx
```

Expected: PASS em todos os testes.

- [ ] **Step 7: Adicionar a rota pública em `App.tsx`**

Ler `barbearia-web/src/App.tsx` atual e adicionar:

```tsx
import CadastroCliente from './pages/CadastroCliente';

// dentro de <Routes>, junto às demais rotas públicas (/login, /admin/login, etc.),
// fora de qualquer RotaProtegida:
            <Route path="/cadastro/:barbeariaId" element={<CadastroCliente />} />
```

- [ ] **Step 8: Rodar a suíte completa do frontend**

Run:
```bash
npm test
```

Expected: todos os testes (novos e existentes) passam.

- [ ] **Step 9: Type-check e build**

Run:
```bash
npx tsc -b
npx vite build
```

Expected: sem erros. Remova `dist/` depois (`rm -rf dist`).

- [ ] **Step 10: Commit**

```bash
git add barbearia-web/src/api/cadastro.ts barbearia-web/src/pages/CadastroCliente.tsx barbearia-web/src/pages/CadastroCliente.module.css barbearia-web/src/pages/CadastroCliente.test.tsx barbearia-web/src/App.tsx
git commit -m "Adiciona tela de cadastro publico de cliente por link"
```

---

## Task 3: Verificação manual de ponta a ponta

**Files:** nenhum arquivo novo — task de verificação.

- [ ] **Step 1: Subir backend e frontend localmente**

Run (dois processos em background):
```bash
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api" && node src/server.js
cd "c:\Desenvolvimento\app_barbaearias\barbearia-api\barbearia-web" && npm run dev
```

- [ ] **Step 2: Acessar o link de cadastro de uma barbearia existente**

Navegar para `http://localhost:5173/cadastro/1` (assumindo que a Barbearia Exemplo tem id 1, já usada em sessões anteriores). Confirmar que o formulário aparece com os 5 campos (Nome completo, Email, Telefone, Data de nascimento, Senha) e as cores da barbearia aplicadas.

- [ ] **Step 3: Preencher e submeter o formulário**

Preencher com dados de teste (ex: email `cadastro.e2e@teste.com`) e clicar em "Cadastrar". Confirmar que aparece "Conta criada com sucesso!" com um link "Ir para o login".

- [ ] **Step 4: Confirmar o cadastro via login**

Clicar em "Ir para o login", inserir o email e senha usados no cadastro, confirmar que o login funciona e leva à Home.

- [ ] **Step 5: Testar o link com uma barbearia inexistente**

Navegar para `http://localhost:5173/cadastro/999999`. Confirmar que aparece "Link de cadastro inválido ou expirado", sem mostrar o formulário.

- [ ] **Step 6: Limpar o cliente de teste**

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
  await client.query(\"DELETE FROM cliente WHERE email = 'cadastro.e2e@teste.com'\");
  await client.query('COMMIT');
  client.release();
  await pool.end();
})();
"
```

- [ ] **Step 7: Parar os servidores de dev**

Encerrar os processos `node src/server.js` e `npm run dev` iniciados no Step 1.

## Fora de escopo (lembrete)

Conforme spec: geração/cópia automática do link pelo dono (Fase 3, painel do dono), slug amigável de barbearia, validação de idade mínima, confirmação de email no cadastro de cliente.
