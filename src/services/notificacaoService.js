const pool = require('../config/database');

async function enviarLembretes() {
  const resultado = await pool.query(`
    SELECT n.id AS notificacao_id, a.id AS agendamento_id, a.data_hora_inicio,
           c.nome AS cliente_nome, c.telefone AS cliente_telefone
    FROM notificacao n
    JOIN agendamento a ON a.id = n.agendamento_id
    JOIN cliente c ON c.id = a.cliente_id
    WHERE n.status = 'pendente'
      AND n.tipo = 'lembrete_1_dia'
      AND a.status = 'confirmado'
      AND a.data_hora_inicio::date = (CURRENT_DATE + INTERVAL '1 day')::date
  `);

  let enviados = 0;

  for (const linha of resultado.rows) {
    try {
      // SIMULAÇÃO: aqui, futuramente, entraria a chamada real para
      // uma API de WhatsApp/SMS (ex: Twilio, Meta WhatsApp Business API).
      // Por enquanto, só exibimos no console o que seria enviado.
      console.log(
        `[LEMBRETE] Para ${linha.cliente_nome} (${linha.cliente_telefone}): ` +
        `seu horário está marcado para amanhã, ${new Date(linha.data_hora_inicio).toLocaleString('pt-BR')}.`
      );

      await pool.query(
        `UPDATE notificacao SET status = 'enviado', enviado_em = now() WHERE id = $1`,
        [linha.notificacao_id]
      );
      enviados++;
    } catch (erro) {
      console.error(`Falha ao enviar lembrete ${linha.notificacao_id}:`, erro);
      await pool.query(`UPDATE notificacao SET status = 'falhou' WHERE id = $1`, [linha.notificacao_id]);
    }
  }

  return enviados;
}

module.exports = { enviarLembretes };