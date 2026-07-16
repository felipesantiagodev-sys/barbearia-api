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

// Padrão "client dedicado por requisição + transação": RLS depende da
// variável de sessão `app.tenant_id` (ou `app.is_plataforma`). Com
// `pool.query()` comum, cada chamada pode pegar uma conexão diferente do
// pool -- sem uma transação explícita numa única conexão, não há garantia
// de que a variável setada continua valendo na query seguinte. Por isso
// pegamos um client dedicado (`pool.connect()`), abrimos uma transação,
// setamos a variável com `set_config(..., true)` (escopo de transação) e
// entregamos esse mesmo client via `req.db` para os controllers usarem
// durante toda a requisição.
//
// DECISÃO: o COMMIT/ROLLBACK precisa ser aguardado ANTES de enviar a
// resposta HTTP, não depois (via `res.on('finish')` fire-and-forget). Um
// listener `res.on('finish')` assíncrono dispara depois que a resposta já
// foi despachada ao cliente -- o `await client.query('COMMIT')` dentro dele
// não é esperado por ninguém, então o processo continua (e uma segunda
// requisição pode chegar) antes do commit ser durável no banco. Isso é uma
// race condition real (não só de teste): sob carga, um cliente que faz
// POST seguido de GET pode não ver o dado que acabou de criar. A correção
// é interceptar `res.json`/`res.send` (os métodos que os controllers usam
// para finalizar a resposta) e fazer o COMMIT/ROLLBACK terminar antes de
// efetivamente escrever a resposta HTTP.
function envolverRespostaComCommit(req, res, next, client) {
  let finalizando = false;

  async function finalizarTransacao() {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
  }

  async function interceptar(metodoOriginal, args) {
    if (finalizando) {
      return metodoOriginal(...args);
    }
    finalizando = true;

    try {
      await finalizarTransacao();
    } catch (erro) {
      console.error('Erro ao finalizar transação de tenant:', erro);
    } finally {
      client.release();
    }

    return metodoOriginal(...args);
  }

  // Só envolve os métodos que o objeto `res` realmente expõe -- o Express
  // real sempre tem `json` e `send`, mas mocks de teste que exercitam o
  // middleware isoladamente (sem passar pelo Express) podem ter só um
  // subconjunto. Envolver um método inexistente quebraria esses testes;
  // nesse caso o fallback via `res.on('finish')` abaixo garante o commit.
  if (typeof res.json === 'function') {
    const jsonOriginal = res.json.bind(res);
    res.json = (...args) => interceptar(jsonOriginal, args);
  }
  if (typeof res.send === 'function') {
    const sendOriginal = res.send.bind(res);
    res.send = (...args) => interceptar(sendOriginal, args);
  }

  // Fallback: se a resposta terminar por outro caminho (ex: res.end direto,
  // ou a conexão sendo fechada sem um json/send explícito), garante que o
  // client não fique preso sem liberar -- não deveria acontecer nos
  // controllers atuais (todos usam res.json), mas é uma rede de segurança
  // contra vazamento de conexão do pool.
  res.on('finish', async () => {
    if (finalizando) return;
    finalizando = true;
    try {
      await finalizarTransacao();
    } catch (erro) {
      console.error('Erro ao finalizar transação de tenant (fallback finish):', erro);
    } finally {
      client.release();
    }
  });

  next();
}

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

    envolverRespostaComCommit(req, res, next, client);
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

    envolverRespostaComCommit(req, res, next, client);
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao autorizar operação de plataforma' });
  }
}

module.exports = { escoparTenant, apenasPlataforma, pool };
