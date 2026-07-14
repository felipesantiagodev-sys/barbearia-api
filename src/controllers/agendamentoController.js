const pool = require('../config/database');
const {
  combinarDataHora,
  adicionarMinutos,
  subtrairIntervalo,
  gerarSlotsDisponiveis,
} = require('../utils/agenda');

async function listarHorariosDisponiveis(req, res) {
  const { barbeiro_id, data, duracao_minutos } = req.query;

  if (!barbeiro_id || !data || !duracao_minutos) {
    return res.status(400).json({ erro: 'barbeiro_id, data e duracao_minutos são obrigatórios' });
  }

  try {
    const diaSemana = combinarDataHora(data, '00:00').getDay();

    const dispResultado = await pool.query(
      'SELECT hora_inicio, hora_fim FROM barbeiro_disponibilidade WHERE barbeiro_id = $1 AND dia_semana = $2',
      [barbeiro_id, diaSemana]
    );

    let janelas = dispResultado.rows.map((linha) => ({
      inicio: combinarDataHora(data, linha.hora_inicio),
      fim: combinarDataHora(data, linha.hora_fim),
    }));

    const excResultado = await pool.query(
      'SELECT tipo, hora_inicio, hora_fim FROM barbeiro_excecao WHERE barbeiro_id = $1 AND data = $2',
      [barbeiro_id, data]
    );

    for (const excecao of excResultado.rows) {
      if (excecao.tipo === 'folga_total') {
        janelas = [];
      } else if (excecao.tipo === 'horario_extra') {
        janelas.push({
          inicio: combinarDataHora(data, excecao.hora_inicio),
          fim: combinarDataHora(data, excecao.hora_fim),
        });
      } else if (excecao.tipo === 'bloqueio_parcial') {
        const bloqueio = {
          inicio: combinarDataHora(data, excecao.hora_inicio),
          fim: combinarDataHora(data, excecao.hora_fim),
        };
        janelas = subtrairIntervalo(janelas, bloqueio);
      }
    }

    const agResultado = await pool.query(
      `SELECT data_hora_inicio, data_hora_fim FROM agendamento
       WHERE barbeiro_id = $1 AND data_hora_inicio::date = $2::date
       AND status IN ('confirmado', 'concluido')
       ORDER BY data_hora_inicio`,
      [barbeiro_id, data]
    );

    for (const agendamento of agResultado.rows) {
      const ocupado = {
        inicio: new Date(agendamento.data_hora_inicio),
        fim: new Date(agendamento.data_hora_fim),
      };
      janelas = subtrairIntervalo(janelas, ocupado);
    }

    const slots = gerarSlotsDisponiveis(janelas, Number(duracao_minutos));

    res.json(
      slots.map((slot) => ({
        inicio: slot.inicio.toISOString(),
        fim_atendimento: slot.fim_atendimento.toISOString(),
      }))
    );
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao calcular horários disponíveis' });
  }
}

async function calcularValorServico(client, clienteId, servicoId) {
  const assinaturaResultado = await client.query(
    `SELECT a.plano_id, p.desconto_servico_fora_plano
     FROM assinatura a
     JOIN plano p ON p.id = a.plano_id
     WHERE a.cliente_id = $1 AND a.status = 'ativa'`,
    [clienteId]
  );

  const servicoResultado = await client.query(
    'SELECT valor FROM servico WHERE id = $1',
    [servicoId]
  );
  const valorCheio = Number(servicoResultado.rows[0].valor);

  if (assinaturaResultado.rows.length === 0) {
    return { valorCobrado: valorCheio, cobertoPeloPlano: false };
  }

  const { plano_id, desconto_servico_fora_plano } = assinaturaResultado.rows[0];

  const coberturaResultado = await client.query(
    'SELECT 1 FROM plano_servico WHERE plano_id = $1 AND servico_id = $2',
    [plano_id, servicoId]
  );

  if (coberturaResultado.rows.length > 0) {
    return { valorCobrado: 0, cobertoPeloPlano: true };
  }

  const valorComDesconto = valorCheio * (1 - Number(desconto_servico_fora_plano) / 100);
  return { valorCobrado: Number(valorComDesconto.toFixed(2)), cobertoPeloPlano: false };
}

async function criarAgendamento(req, res) {
  const { cliente_id, barbeiro_id, unidade_id, data, hora_inicio, servico_ids } = req.body;

  if (!cliente_id || !barbeiro_id || !unidade_id || !data || !hora_inicio || !Array.isArray(servico_ids) || servico_ids.length === 0) {
    return res.status(400).json({ erro: 'cliente_id, barbeiro_id, unidade_id, data, hora_inicio e servico_ids são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const servicosResultado = await client.query(
      'SELECT id, duracao_minutos FROM servico WHERE id = ANY($1::int[])',
      [servico_ids]
    );

    if (servicosResultado.rows.length !== servico_ids.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Um ou mais servico_ids são inválidos' });
    }

    const duracaoTotal = servicosResultado.rows.reduce((soma, s) => soma + s.duracao_minutos, 0);

    const dataHoraInicio = combinarDataHora(data, hora_inicio);
    const dataHoraFim = adicionarMinutos(dataHoraInicio, duracaoTotal + 10);

    const agendamentoResultado = await client.query(
      `INSERT INTO agendamento (cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmado') RETURNING *`,
      [cliente_id, barbeiro_id, unidade_id, dataHoraInicio, dataHoraFim]
    );
    const agendamento = agendamentoResultado.rows[0];

    const itens = [];
    for (const servicoId of servico_ids) {
      const { valorCobrado, cobertoPeloPlano } = await calcularValorServico(client, cliente_id, servicoId);

      const itemResultado = await client.query(
        `INSERT INTO agendamento_servico (agendamento_id, servico_id, coberto_pelo_plano, valor_cobrado)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [agendamento.id, servicoId, cobertoPeloPlano, valorCobrado]
      );
      itens.push(itemResultado.rows[0]);
    }

    // Cria a notificação de lembrete pendente para esse novo agendamento
    await client.query(
      `INSERT INTO notificacao (agendamento_id, tipo, status) VALUES ($1, 'lembrete_1_dia', 'pendente')`,
      [agendamento.id]
    );

    await client.query('COMMIT');

    const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);

    res.status(201).json({ ...agendamento, itens, valor_total: valorTotal });
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  } finally {
    client.release();
  }
}

async function cancelarAgendamento(req, res) {
  const { id } = req.params;

  try {
    const atualResultado = await pool.query('SELECT cliente_id FROM agendamento WHERE id = $1', [id]);

    if (atualResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    const donoDoAgendamento = atualResultado.rows[0].cliente_id;

    if (req.usuario.tipo === 'cliente' && req.usuario.id !== donoDoAgendamento) {
      return res.status(403).json({ erro: 'Você só pode cancelar seus próprios agendamentos' });
    }

    const resultado = await pool.query(
      `UPDATE agendamento SET status = 'cancelado'
       WHERE id = $1 AND status = 'confirmado'
       RETURNING *`,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não pode mais ser cancelado' });
    }

    // Cancela o lembrete pendente, já que esse agendamento não vai mais acontecer
    await pool.query(
      `UPDATE notificacao SET status = 'cancelado' WHERE agendamento_id = $1 AND status = 'pendente'`,
      [id]
    );

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cancelar agendamento' });
  }
}

async function concluirAgendamento(req, res) {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const agendamentoResultado = await client.query(
      `UPDATE agendamento SET status = 'concluido'
       WHERE id = $1 AND status = 'confirmado'
       RETURNING *`,
      [id]
    );

    if (agendamentoResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Agendamento não encontrado ou não pode ser concluído' });
    }

    const itensResultado = await client.query(
      'SELECT SUM(valor_cobrado) AS total FROM agendamento_servico WHERE agendamento_id = $1',
      [id]
    );
    const valorTotal = Number(itensResultado.rows[0].total) || 0;

    if (valorTotal > 0) {
      await client.query(
        `INSERT INTO pagamento (agendamento_id, valor, status)
         VALUES ($1, $2, 'pago')`,
        [id, valorTotal]
      );
    }

    await client.query('COMMIT');
    res.json({ ...agendamentoResultado.rows[0], valor_pago: valorTotal });
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao concluir agendamento' });
  } finally {
    client.release();
  }
}

async function reagendarAgendamento(req, res) {
  const { id } = req.params;
  const { data, hora_inicio } = req.body;

  if (!data || !hora_inicio) {
    return res.status(400).json({ erro: 'data e hora_inicio são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const originalResultado = await client.query(
      `SELECT * FROM agendamento WHERE id = $1 AND status = 'confirmado'`,
      [id]
    );

    if (originalResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Agendamento não encontrado ou não pode ser reagendado' });
    }

    const original = originalResultado.rows[0];

    if (req.usuario.tipo === 'cliente' && req.usuario.id !== original.cliente_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ erro: 'Você só pode reagendar seus próprios agendamentos' });
    }

    const itensOriginaisResultado = await client.query(
      'SELECT servico_id FROM agendamento_servico WHERE agendamento_id = $1',
      [id]
    );
    const servicoIds = itensOriginaisResultado.rows.map((linha) => linha.servico_id);

    const servicosResultado = await client.query(
      'SELECT id, duracao_minutos FROM servico WHERE id = ANY($1::int[])',
      [servicoIds]
    );
    const duracaoTotal = servicosResultado.rows.reduce((soma, s) => soma + s.duracao_minutos, 0);

    const novaDataHoraInicio = combinarDataHora(data, hora_inicio);
    const novaDataHoraFim = adicionarMinutos(novaDataHoraInicio, duracaoTotal + 10);

    const novoResultado = await client.query(
      `INSERT INTO agendamento (cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status, reagendado_de_id)
       VALUES ($1, $2, $3, $4, $5, 'confirmado', $6) RETURNING *`,
      [original.cliente_id, original.barbeiro_id, original.unidade_id, novaDataHoraInicio, novaDataHoraFim, original.id]
    );
    const novoAgendamento = novoResultado.rows[0];

    const itens = [];
    for (const servicoId of servicoIds) {
      const { valorCobrado, cobertoPeloPlano } = await calcularValorServico(client, original.cliente_id, servicoId);
      const itemResultado = await client.query(
        `INSERT INTO agendamento_servico (agendamento_id, servico_id, coberto_pelo_plano, valor_cobrado)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [novoAgendamento.id, servicoId, cobertoPeloPlano, valorCobrado]
      );
      itens.push(itemResultado.rows[0]);
    }

    // Notificação nova para o agendamento reagendado
    await client.query(
      `INSERT INTO notificacao (agendamento_id, tipo, status) VALUES ($1, 'lembrete_1_dia', 'pendente')`,
      [novoAgendamento.id]
    );

    // Cancela a notificação pendente do agendamento antigo
    await client.query(
      `UPDATE notificacao SET status = 'cancelado' WHERE agendamento_id = $1 AND status = 'pendente'`,
      [id]
    );

    await client.query(`UPDATE agendamento SET status = 'reagendado' WHERE id = $1`, [id]);

    await client.query('COMMIT');

    const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);
    res.status(201).json({ ...novoAgendamento, itens, valor_total: valorTotal });
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao reagendar agendamento' });
  } finally {
    client.release();
  }
}

module.exports = {
  listarHorariosDisponiveis,
  criarAgendamento,
  cancelarAgendamento,
  concluirAgendamento,
  reagendarAgendamento,
};