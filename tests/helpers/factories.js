const bcrypt = require('bcrypt');
const { pool } = require('./db');

async function criarBarbearia(nome = 'Barbearia Teste') {
  // `barbearia` não tem barbearia_id (não está entre as 15 tabelas com RLS
  // da migration 005), então este INSERT não é afetado por RLS.
  const r = await pool.query(
    'INSERT INTO barbearia (nome, cnpj) VALUES ($1, $2) RETURNING *',
    [nome, '00000000000100']
  );
  return r.rows[0];
}

// DECISÃO: `cliente` tem RLS com FORCE ROW LEVEL SECURITY (migration 005),
// então um INSERT comum via `pool.query` seria bloqueado pela policy
// `WITH CHECK` a menos que `app.tenant_id` (ou `app.is_plataforma`) esteja
// setado na sessão que executa o INSERT. Como `pool.query()` pega uma
// conexão qualquer do pool para uma única query, abrimos aqui uma transação
// explícita numa única conexão dedicada (`pool.connect()`), setamos
// `app.tenant_id` com `set_config(..., true)` (true = escopo da transação,
// via SET LOCAL) e fazemos o INSERT na mesma transação antes do COMMIT.
// Isso garante que a variável de sessão esteja visível para a policy no
// momento do INSERT.
async function criarClienteDireto(barbearia_id, overrides = {}) {
  const senha_hash = await bcrypt.hash(overrides.senha || 'senha123', 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      'INSERT INTO cliente (barbearia_id, nome, email, telefone, senha_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [
        barbearia_id,
        overrides.nome || 'Cliente Teste',
        overrides.email || `cliente${Date.now()}@teste.com`,
        overrides.telefone || '11999999999',
        senha_hash,
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

// Mesma lógica de `criarClienteDireto`: `usuario_admin` também tem RLS com
// FORCE ROW LEVEL SECURITY (migration 005), então o INSERT direto precisa
// rodar dentro de uma transação numa conexão dedicada com `app.tenant_id`
// setado via `set_config(..., true)` (SET LOCAL) antes do INSERT.
async function criarAdminDireto(barbearia_id, overrides = {}) {
  const senha_hash = await bcrypt.hash(overrides.senha || 'senha123', 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      'INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [
        barbearia_id,
        overrides.nome || 'Admin Teste',
        overrides.email || `admin${Date.now()}@teste.com`,
        senha_hash,
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

// DECISÃO: `unidade` tem RLS com FORCE ROW LEVEL SECURITY (migration 005),
// mesmo padrão de `criarClienteDireto`/`criarAdminDireto`: transação
// dedicada numa única conexão, com `app.tenant_id` setado via
// `set_config(..., true)` (SET LOCAL) antes do INSERT.
async function criarUnidadeDireto(barbearia_id, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      'INSERT INTO unidade (barbearia_id, nome, endereco, telefone) VALUES ($1, $2, $3, $4) RETURNING *',
      [
        barbearia_id,
        overrides.nome || 'Unidade Teste',
        overrides.endereco || 'Rua Teste, 123',
        overrides.telefone || '11988887777',
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

// `servico` também tem RLS com FORCE ROW LEVEL SECURITY (migration 005).
async function criarServicoDireto(barbearia_id, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO servico (barbearia_id, nome, categoria, duracao_minutos, valor)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        barbearia_id,
        overrides.nome || 'Corte Teste',
        overrides.categoria || 'cabelo',
        overrides.duracao_minutos || 30,
        overrides.valor !== undefined ? overrides.valor : 50,
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

// `plano` também tem RLS com FORCE ROW LEVEL SECURITY (migration 005).
async function criarPlanoDireto(barbearia_id, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO plano (barbearia_id, nome, valor_mensal, desconto_servico_fora_plano, intervalo_minimo_dias, vantagens)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        barbearia_id,
        overrides.nome || 'Plano Teste',
        overrides.valor_mensal !== undefined ? overrides.valor_mensal : 99.9,
        overrides.desconto_servico_fora_plano !== undefined ? overrides.desconto_servico_fora_plano : 10,
        overrides.intervalo_minimo_dias !== undefined ? overrides.intervalo_minimo_dias : 1,
        overrides.vantagens !== undefined ? overrides.vantagens : null,
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

// `barbeiro` depende de `unidade_id` (que já carrega a barbearia via FK) e
// também tem `barbearia_id` próprio, NOT NULL, com RLS FORCE ROW LEVEL
// SECURITY (migrations 002/004/005). Mesmo padrão de transação dedicada.
async function criarBarbeiroDireto(barbearia_id, unidade_id, overrides = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);
    const r = await client.query(
      `INSERT INTO barbeiro (barbearia_id, unidade_id, nome, email, telefone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        barbearia_id,
        unidade_id,
        overrides.nome || 'Barbeiro Teste',
        overrides.email || `barbeiro${Date.now()}@teste.com`,
        overrides.telefone || '11977776666',
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

// DECISÃO SOBRE RLS: o brief desta task partiu de uma leitura só de
// migrations/000_schema_base.sql (onde `barbeiro_servico` não tem
// `barbearia_id`), mas migrations posteriores mudam esse quadro:
// migration 002 adiciona a coluna `barbearia_id` a `barbeiro_servico`,
// migration 004 a torna NOT NULL, e migration 005 habilita
// FORCE ROW LEVEL SECURITY com policy baseada nessa coluna. Confirmado
// empiricamente (INSERT direto via pool.query sem set_config falha com
// "viola a política de segurança no nível de linha"). Ou seja, `barbeiro_servico`
// SE COMPORTA como as demais tabelas com RLS -- precisa do mesmo padrão de
// transação dedicada com `set_config('app.tenant_id', ...)`.
//
// Para manter a assinatura de 2 parâmetros (barbeiro_id, servico_id) definida
// no brief -- sem exigir que quem chama já saiba a barbearia_id -- resolvemos
// o tenant a partir do próprio barbeiro_id dentro do helper, no mesmo padrão
// usado por `listarHorariosDisponiveis` no controller: uma consulta inicial
// com `app.is_plataforma` para descobrir a barbearia do barbeiro, seguida da
// troca para `app.tenant_id` antes do INSERT.
async function associarBarbeiroServico(barbeiro_id, servico_id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const barbeiroResultado = await client.query('SELECT barbearia_id FROM barbeiro WHERE id = $1', [barbeiro_id]);
    if (barbeiroResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Barbeiro ${barbeiro_id} não encontrado`);
    }
    const barbearia_id = barbeiroResultado.rows[0].barbearia_id;

    await client.query("SELECT set_config('app.is_plataforma', '', true)");
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);

    await client.query(
      'INSERT INTO barbeiro_servico (barbearia_id, barbeiro_id, servico_id) VALUES ($1, $2, $3)',
      [barbearia_id, barbeiro_id, servico_id]
    );
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

module.exports = {
  criarBarbearia,
  criarClienteDireto,
  criarAdminDireto,
  criarUnidadeDireto,
  criarServicoDireto,
  criarPlanoDireto,
  criarBarbeiroDireto,
  criarAssinaturaDireto,
  associarBarbeiroServico,
};
