const cron = require('node-cron');
const pool = require('../config/database');
const { enviarLembretes } = require('../services/notificacaoService');

// Task 11.5: com RLS ativo (migration 005), não existe mais "modo sem
// tenant" implícito -- uma query no `pool` puro não enxergaria nenhuma linha
// de `notificacao`/`agendamento`/`cliente` (FORCE ROW LEVEL SECURITY). O cron
// precisa abrir uma conexão dedicada por barbearia, setar `app.tenant_id`
// via `set_config(..., true)` (SET LOCAL, mesmo padrão do middleware
// `escoparTenant`) e só então chamar `enviarLembretes`.
//
// Cada barbearia processa numa transação própria: uma falha isolada (erro de
// rede simulado, erro de query, etc.) só faz ROLLBACK da barbearia em
// questão -- o `catch` é por barbearia, não um `catch` global que abortaria
// o processamento das demais.
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
  // Roda todo dia às 08:00
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Verificando lembretes de amanhã...');
    try {
      const total = await processarTodasAsBarbearias();
      console.log(`[CRON] ${total} lembrete(s) enviado(s) no total.`);
    } catch (erro) {
      // Sem este catch, uma rejeição aqui dentro do callback do cron seria
      // um unhandled rejection -- o `cron.schedule` não propaga essa
      // rejeição para lugar nenhum que a capture, e dependendo da versão do
      // Node isso pode derrubar o processo.
      console.error('[CRON] Falha ao processar lembretes:', erro);
    }
  });

  console.log('[CRON] Job de lembretes agendado para rodar diariamente às 08:00.');
}

module.exports = { iniciarJobLembretes, processarTodasAsBarbearias };
