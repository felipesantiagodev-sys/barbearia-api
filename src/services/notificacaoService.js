// Task 11.5: `enviarLembretes` recebe um client já escopado por tenant (`db`)
// em vez de importar `pool` diretamente. `notificacao`, `agendamento` e
// `cliente` têm FORCE ROW LEVEL SECURITY (migration 005) -- sem uma conexão
// com `app.tenant_id` (ou `app.is_plataforma`) setado, a query abaixo não
// enxergaria nenhuma linha. Quem decide o escopo (uma barbearia específica,
// via cron iterando todas, ou a barbearia do admin autenticado, via disparo
// manual) é o chamador -- este serviço só processa o que a policy de RLS
// deixar visível na conexão recebida.
async function enviarLembretes(db) {
  const resultado = await db.query(`
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

      await db.query(
        `UPDATE notificacao SET status = 'enviado', enviado_em = now() WHERE id = $1`,
        [linha.notificacao_id]
      );
      enviados++;
    } catch (erro) {
      console.error(`Falha ao enviar lembrete ${linha.notificacao_id}:`, erro);
      await db.query(`UPDATE notificacao SET status = 'falhou' WHERE id = $1`, [linha.notificacao_id]).catch(() => {});
    }
  }

  return enviados;
}

module.exports = { enviarLembretes };
