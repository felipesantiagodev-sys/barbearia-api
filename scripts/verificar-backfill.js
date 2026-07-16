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
    console.error(`\nFALHA: ${totalOrfaos} linha(s) órfã(s) sem barbearia_id. Resolver antes de rodar a próxima migration.`);
    process.exitCode = 1;
  } else {
    console.log('\nOK: nenhuma linha órfã encontrada.');
  }
}

main();
