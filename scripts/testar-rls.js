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
