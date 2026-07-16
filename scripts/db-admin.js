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
    if (!/^[a-z0-9_]+$/.test(alvo || '')) {
      console.error('Nome de banco inválido — use apenas letras minúsculas, números e underscore.');
      process.exitCode = 1;
      return;
    }

    if (acao === 'criar') {
      await pool.query(`CREATE DATABASE ${alvo}`);
      console.log(`Banco ${alvo} criado.`);
    } else if (acao === 'apagar') {
      await pool.query(`DROP DATABASE IF EXISTS ${alvo}`);
      console.log(`Banco ${alvo} removido.`);
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
    } else {
      console.error('Uso: node scripts/db-admin.js <criar|apagar|colunas> <nome_do_banco_ou_tabela>');
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
