const cron = require('node-cron');
const { enviarLembretes } = require('../services/notificacaoService');

function iniciarJobLembretes() {
  // Roda todo dia às 08:00
  cron.schedule('0 8 * * *', async () => {
    console.log('[CRON] Verificando lembretes de amanhã...');
    const total = await enviarLembretes();
    console.log(`[CRON] ${total} lembrete(s) enviado(s).`);
  });

  console.log('[CRON] Job de lembretes agendado para rodar diariamente às 08:00.');
}

module.exports = { iniciarJobLembretes };