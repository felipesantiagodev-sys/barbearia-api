const { enviarLembretes } = require('../services/notificacaoService');

async function dispararLembretesManualmente(req, res) {
  try {
    const total = await enviarLembretes();
    res.json({ mensagem: `${total} lembrete(s) processado(s)` });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar lembretes' });
  }
}

module.exports = { dispararLembretesManualmente };