const { enviarLembretes } = require('../services/notificacaoService');

// Task 11.5: usa req.db (client já escopado para a barbearia do admin
// autenticado pelo middleware escoparTenant), não itera todas as barbearias
// como o cron -- um admin não deve conseguir disparar lembretes de outras
// barbearias.
async function dispararLembretesManualmente(req, res) {
  try {
    const total = await enviarLembretes(req.db);
    res.json({ mensagem: `${total} lembrete(s) processado(s)` });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar lembretes' });
  }
}

module.exports = { dispararLembretesManualmente };