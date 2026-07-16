const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME_TEST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Ordem filho -> pai, respeitando FKs (necessário porque usamos DELETE, que,
// diferente de TRUNCATE ... CASCADE, não segue automaticamente as
// dependências de chave estrangeira).
const tabelas = [
  'pagamento', 'notificacao', 'agendamento_servico', 'agendamento',
  'assinatura', 'plano_servico', 'barbeiro_servico', 'barbeiro_excecao',
  'barbeiro_disponibilidade', 'barbeiro', 'cliente', 'usuario_admin',
  'plano', 'servico', 'unidade', 'barbearia', 'usuario_plataforma',
];

// DECISÃO: usamos DELETE em vez de TRUNCATE.
//
// O role `barbearia_app` (usado pelas credenciais do .env) recebeu apenas
// GRANT SELECT, INSERT, UPDATE, DELETE (migration 006_criar_role_aplicacao.sql)
// -- TRUNCATE é um privilégio próprio no Postgres, distinto de DELETE, e não
// foi concedido. Confirmado empiricamente: `TRUNCATE cliente` retorna
// "permissão negada para tabela cliente" com essas credenciais.
//
// Não optamos por conceder GRANT TRUNCATE numa nova migration porque isso
// ampliaria as permissões do role de aplicação em produção só para
// beneficiar os testes -- indo contra o espírito da migration 006, que
// documenta explicitamente a intenção de manter esse role com o mínimo de
// privilégios (sem SUPERUSER, sem BYPASSRLS). DELETE simples resolve o
// mesmo problema sem exigir GRANTs adicionais.
//
// Também não fazemos reset de sequences (`ALTER SEQUENCE ... RESTART` ou
// `SELECT setval(...)`): ambos exigem ser dono do objeto (ALTER SEQUENCE) ou
// privilégio UPDATE na sequence (setval) -- nenhum dos dois foi concedido ao
// role `barbearia_app` (apenas USAGE, SELECT). Isso não é um problema para
// os testes: eles não dependem de IDs previsíveis/reiniciados, apenas de
// que as tabelas estejam vazias entre execuções.
async function limparBanco() {
  const client = await pool.connect();
  try {
    // FORCE ROW LEVEL SECURITY está ativo em todas as tabelas com RLS
    // (migration 005), então um DELETE sem filtro só apaga linhas cuja
    // policy é satisfeita. Setamos app.is_plataforma para enxergar e
    // apagar as linhas de todos os tenants.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    for (const tabela of tabelas) {
      await client.query(`DELETE FROM ${tabela}`);
    }
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

async function fecharBanco() {
  await pool.end();
}

module.exports = { pool, limparBanco, fecharBanco };
