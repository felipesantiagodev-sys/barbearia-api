const { Pool, types } = require('pg');
require('dotenv').config();

// OID 1082 = tipo DATE do Postgres. Por padrão, o driver `pg` parseia DATE
// como um objeto JS Date ancorado em meia-noite LOCAL do processo, o que
// causa um bug de off-by-one-day ao serializar via toISOString() em
// servidores rodando em fusos horários com offset positivo de UTC. Mantendo
// a string crua (já no formato YYYY-MM-DD que o Postgres retorna) evitamos
// essa ambiguidade de fuso por completo.
types.setTypeParser(1082, (valor) => valor);

// Mesmo padrão de `src/middlewares/tenant.js` e `tests/helpers/db.js`:
// em NODE_ENV=test, conecta ao banco de teste (DB_NAME_TEST), não ao de
// desenvolvimento/produção (DB_NAME). Sem isso, controllers que usam este
// pool diretamente (ex.: authController.js) nunca enxergam os dados
// inseridos pelos testes, que rodam contra DB_NAME_TEST.
const dbName = process.env.NODE_ENV === 'test' ? process.env.DB_NAME_TEST : process.env.DB_NAME;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: dbName,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

module.exports = pool;