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
