const pool = require('../config/database');
const {
  combinarDataHora,
  adicionarMinutos,
  subtrairIntervalo,
  gerarSlotsDisponiveis,
} = require('../utils/agenda');

// `listarHorariosDisponiveis` é uma rota pública (sem verificarToken/
// escoparTenant -- ver src/routes/agendamentoRoutes.js): o visitante ainda
// não tem conta, então não existe req.usuario nem req.db escopado para esta
// requisição. Mas `barbeiro_disponibilidade`, `barbeiro_excecao` e
// `agendamento` têm FORCE ROW LEVEL SECURITY (migration 005) -- um
// `pool.query()` comum, sem app.tenant_id/app.is_plataforma setado na sessão,
// não enxergaria NENHUMA linha (a policy bloqueia por padrão).
//
// Resolvemos com o mesmo padrão de `criarClientePublico`
// (src/controllers/clienteController.js): uma transação dedicada numa única
// conexão. A diferença aqui é que não há barbearia_id na URL -- só
// barbeiro_id -- então primeiro descobrimos a barbearia do barbeiro usando
// app.is_plataforma (a única forma de "ver" o barbeiro antes de sabermos seu
// tenant), e then usamos esse barbearia_id para escopar o restante das
// consultas com app.tenant_id. Se o barbeiro não existir, respondemos 404
// sem revelar mais nada.
async function listarHorariosDisponiveis(req, res) {
  const { barbeiro_id, data, duracao_minutos } = req.query;

  if (!barbeiro_id || !data || !duracao_minutos) {
    return res.status(400).json({ erro: 'barbeiro_id, data e duracao_minutos são obrigatórios' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const barbeiroResultado = await client.query('SELECT barbearia_id FROM barbeiro WHERE id = $1', [barbeiro_id]);
    if (barbeiroResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Barbeiro não encontrado' });
    }
    const barbearia_id = barbeiroResultado.rows[0].barbearia_id;

    await client.query("SELECT set_config('app.is_plataforma', '', true)");
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);

    const diaSemana = combinarDataHora(data, '00:00').getDay();

    const dispResultado = await client.query(
      'SELECT hora_inicio, hora_fim FROM barbeiro_disponibilidade WHERE barbeiro_id = $1 AND dia_semana = $2',
      [barbeiro_id, diaSemana]
    );

    let janelas = dispResultado.rows.map((linha) => ({
      inicio: combinarDataHora(data, linha.hora_inicio),
      fim: combinarDataHora(data, linha.hora_fim),
    }));

    const excResultado = await client.query(
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

    const agResultado = await client.query(
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

    await client.query('COMMIT');

    res.json(
      slots.map((slot) => ({
        inicio: slot.inicio.toISOString(),
        fim_atendimento: slot.fim_atendimento.toISOString(),
      }))
    );
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao calcular horários disponíveis' });
  } finally {
    client.release();
  }
}

// Recebe `db` (req.db, já escopado por RLS para o tenant da requisição) em
// vez de abrir sua própria transação -- ver decisão de arquitetura no topo
// deste arquivo (comentário de criarAgendamento).
async function calcularValorServico(db, clienteId, servicoId) {
  const assinaturaResultado = await db.query(
    `SELECT a.plano_id, p.desconto_servico_fora_plano
     FROM assinatura a
     JOIN plano p ON p.id = a.plano_id
     WHERE a.cliente_id = $1 AND a.status = 'ativa'`,
    [clienteId]
  );

  const servicoResultado = await db.query(
    'SELECT valor FROM servico WHERE id = $1',
    [servicoId]
  );
  const valorCheio = Number(servicoResultado.rows[0].valor);

  if (assinaturaResultado.rows.length === 0) {
    return { valorCobrado: valorCheio, cobertoPeloPlano: false };
  }

  const { plano_id, desconto_servico_fora_plano } = assinaturaResultado.rows[0];

  const coberturaResultado = await db.query(
    'SELECT 1 FROM plano_servico WHERE plano_id = $1 AND servico_id = $2',
    [plano_id, servicoId]
  );

  if (coberturaResultado.rows.length > 0) {
    return { valorCobrado: 0, cobertoPeloPlano: true };
  }

  const valorComDesconto = valorCheio * (1 - Number(desconto_servico_fora_plano) / 100);
  return { valorCobrado: Number(valorComDesconto.toFixed(2)), cobertoPeloPlano: false };
}

// DECISÃO DE ARQUITETURA (vale para criarAgendamento, cancelarAgendamento,
// concluirAgendamento e reagendarAgendamento): o código antigo abria sua
// própria transação com `pool.connect()` + BEGIN/COMMIT/ROLLBACK. Isso foi
// removido -- `req.db` já É um client dedicado dentro de uma transação
// aberta pelo middleware `escoparTenant` (com `app.tenant_id` setado via
// SET LOCAL). Abrir uma segunda transação aqui seria uma transação aninhada
// (o `pg` não suporta; um BEGIN dentro de BEGIN é apenas um warning ignorado
// pelo Postgres, e um ROLLBACK/COMMIT local encerraria a transação da
// requisição prematuramente, quebrando o controle de fluxo do middleware).
// Os controllers agora usam `req.db` direto para tudo; o COMMIT/ROLLBACK
// final é responsabilidade exclusiva do middleware (que intercepta
// res.json/res.send e faz COMMIT se status < 400, ROLLBACK caso contrário).
// Isso também corrige de brinde um bug de atomicidade que existia em
// `cancelarAgendamento` (que não tinha transação própria: UPDATE do
// agendamento e UPDATE da notificação podiam ficar inconsistentes se o
// segundo falhasse) -- agora ambos vivem na mesma transação da requisição.
//
// VALIDAÇÃO CROSS-TENANT: barbeiro_id, unidade_id, cliente_id e servico_ids
// vêm todos do body, sem qualquer garantia de que pertencem à barbearia do
// admin autenticado. As FKs (`agendamento.barbeiro_id -> barbeiro.id`, etc.)
// ignoram RLS e "aceitariam" silenciosamente uma referência de outro tenant,
// criando um agendamento inconsistente (barbearia_id correto, mas
// barbeiro/unidade/cliente de OUTRO tenant). Por isso validamos cada uma via
// `req.db` (escopado por RLS) ANTES do INSERT: se a entidade não pertence ao
// tenant do usuário autenticado, RLS a torna invisível e a query não a
// encontra -- respondemos 404 sem revelar se ela existe em outro tenant.
async function criarAgendamento(req, res) {
  const { cliente_id, barbeiro_id, unidade_id, data, hora_inicio, servico_ids } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!cliente_id || !barbeiro_id || !unidade_id || !data || !hora_inicio || !Array.isArray(servico_ids) || servico_ids.length === 0) {
    return res.status(400).json({ erro: 'cliente_id, barbeiro_id, unidade_id, data, hora_inicio e servico_ids são obrigatórios' });
  }

  try {
    const clienteResultado = await req.db.query('SELECT id FROM cliente WHERE id = $1', [cliente_id]);
    if (clienteResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    const barbeiroResultado = await req.db.query('SELECT id FROM barbeiro WHERE id = $1', [barbeiro_id]);
    if (barbeiroResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbeiro não encontrado' });
    }

    const unidadeResultado = await req.db.query('SELECT id FROM unidade WHERE id = $1', [unidade_id]);
    if (unidadeResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Unidade não encontrada' });
    }

    const servicosResultado = await req.db.query(
      'SELECT id, duracao_minutos FROM servico WHERE id = ANY($1::int[])',
      [servico_ids]
    );

    if (servicosResultado.rows.length !== new Set(servico_ids).size) {
      // Mesmo tratamento de cliente_id/barbeiro_id/unidade_id acima: sob RLS,
      // um servico_id de outra barbearia é indistinguível de um id
      // inexistente (a policy o torna invisível) -- por isso 404, não 400,
      // para não revelar se o serviço existe em outro tenant.
      return res.status(404).json({ erro: 'Um ou mais servico_ids não foram encontrados' });
    }

    const duracaoTotal = servicosResultado.rows.reduce((soma, s) => soma + s.duracao_minutos, 0);

    const dataHoraInicio = combinarDataHora(data, hora_inicio);
    const dataHoraFim = adicionarMinutos(dataHoraInicio, duracaoTotal + 10);

    const agendamentoResultado = await req.db.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmado') RETURNING *`,
      [barbearia_id, cliente_id, barbeiro_id, unidade_id, dataHoraInicio, dataHoraFim]
    );
    const agendamento = agendamentoResultado.rows[0];

    const itens = [];
    for (const servicoId of servico_ids) {
      const { valorCobrado, cobertoPeloPlano } = await calcularValorServico(req.db, cliente_id, servicoId);

      const itemResultado = await req.db.query(
        `INSERT INTO agendamento_servico (barbearia_id, agendamento_id, servico_id, coberto_pelo_plano, valor_cobrado)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [barbearia_id, agendamento.id, servicoId, cobertoPeloPlano, valorCobrado]
      );
      itens.push(itemResultado.rows[0]);
    }

    // Cria a notificação de lembrete pendente para esse novo agendamento
    await req.db.query(
      `INSERT INTO notificacao (barbearia_id, agendamento_id, tipo, status) VALUES ($1, $2, 'lembrete_1_dia', 'pendente')`,
      [barbearia_id, agendamento.id]
    );

    const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);

    res.status(201).json({ ...agendamento, itens, valor_total: valorTotal });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar agendamento' });
  }
}

async function cancelarAgendamento(req, res) {
  const { id } = req.params;

  try {
    const atualResultado = await req.db.query('SELECT cliente_id FROM agendamento WHERE id = $1', [id]);

    if (atualResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado' });
    }

    const donoDoAgendamento = atualResultado.rows[0].cliente_id;

    if (req.usuario.tipo === 'cliente' && req.usuario.id !== donoDoAgendamento) {
      return res.status(403).json({ erro: 'Você só pode cancelar seus próprios agendamentos' });
    }

    const resultado = await req.db.query(
      `UPDATE agendamento SET status = 'cancelado'
       WHERE id = $1 AND status = 'confirmado'
       RETURNING *`,
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não pode mais ser cancelado' });
    }

    // Remove o lembrete pendente, já que esse agendamento não vai mais
    // acontecer. Não existe um status 'cancelado' para notificacao (o CHECK
    // constraint só permite 'pendente', 'enviado', 'falhou' -- ver migration
    // 000_schema_base.sql), então DELETE é a forma correta de neutralizar o
    // lembrete, em vez de tentar um UPDATE de status inválido.
    await req.db.query(
      `DELETE FROM notificacao WHERE agendamento_id = $1 AND status = 'pendente'`,
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
  const barbearia_id = req.usuario.barbearia_id;

  try {
    const agendamentoResultado = await req.db.query(
      `UPDATE agendamento SET status = 'concluido'
       WHERE id = $1 AND status = 'confirmado'
       RETURNING *`,
      [id]
    );

    if (agendamentoResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado ou não pode ser concluído' });
    }

    const itensResultado = await req.db.query(
      'SELECT SUM(valor_cobrado) AS total FROM agendamento_servico WHERE agendamento_id = $1',
      [id]
    );
    const valorTotal = Number(itensResultado.rows[0].total) || 0;

    if (valorTotal > 0) {
      await req.db.query(
        `INSERT INTO pagamento (barbearia_id, agendamento_id, valor, status)
         VALUES ($1, $2, $3, 'pago')`,
        [barbearia_id, id, valorTotal]
      );
    }

    res.json({ ...agendamentoResultado.rows[0], valor_pago: valorTotal });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao concluir agendamento' });
  }
}

async function reagendarAgendamento(req, res) {
  const { id } = req.params;
  const { data, hora_inicio } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!data || !hora_inicio) {
    return res.status(400).json({ erro: 'data e hora_inicio são obrigatórios' });
  }

  try {
    const originalResultado = await req.db.query(
      `SELECT * FROM agendamento WHERE id = $1 AND status = 'confirmado'`,
      [id]
    );

    if (originalResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Agendamento não encontrado ou não pode ser reagendado' });
    }

    const original = originalResultado.rows[0];

    if (req.usuario.tipo === 'cliente' && req.usuario.id !== original.cliente_id) {
      return res.status(403).json({ erro: 'Você só pode reagendar seus próprios agendamentos' });
    }

    const itensOriginaisResultado = await req.db.query(
      'SELECT servico_id FROM agendamento_servico WHERE agendamento_id = $1',
      [id]
    );
    const servicoIds = itensOriginaisResultado.rows.map((linha) => linha.servico_id);

    const servicosResultado = await req.db.query(
      'SELECT id, duracao_minutos FROM servico WHERE id = ANY($1::int[])',
      [servicoIds]
    );
    const duracaoTotal = servicosResultado.rows.reduce((soma, s) => soma + s.duracao_minutos, 0);

    const novaDataHoraInicio = combinarDataHora(data, hora_inicio);
    const novaDataHoraFim = adicionarMinutos(novaDataHoraInicio, duracaoTotal + 10);

    const novoResultado = await req.db.query(
      `INSERT INTO agendamento (barbearia_id, cliente_id, barbeiro_id, unidade_id, data_hora_inicio, data_hora_fim, status, reagendado_de_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmado', $7) RETURNING *`,
      [barbearia_id, original.cliente_id, original.barbeiro_id, original.unidade_id, novaDataHoraInicio, novaDataHoraFim, original.id]
    );
    const novoAgendamento = novoResultado.rows[0];

    const itens = [];
    for (const servicoId of servicoIds) {
      const { valorCobrado, cobertoPeloPlano } = await calcularValorServico(req.db, original.cliente_id, servicoId);
      const itemResultado = await req.db.query(
        `INSERT INTO agendamento_servico (barbearia_id, agendamento_id, servico_id, coberto_pelo_plano, valor_cobrado)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [barbearia_id, novoAgendamento.id, servicoId, cobertoPeloPlano, valorCobrado]
      );
      itens.push(itemResultado.rows[0]);
    }

    // Notificação nova para o agendamento reagendado
    await req.db.query(
      `INSERT INTO notificacao (barbearia_id, agendamento_id, tipo, status) VALUES ($1, $2, 'lembrete_1_dia', 'pendente')`,
      [barbearia_id, novoAgendamento.id]
    );

    // Remove a notificação pendente do agendamento antigo (mesmo motivo do
    // DELETE em cancelarAgendamento: não existe status 'cancelado' válido
    // para notificacao).
    await req.db.query(
      `DELETE FROM notificacao WHERE agendamento_id = $1 AND status = 'pendente'`,
      [id]
    );

    await req.db.query(`UPDATE agendamento SET status = 'reagendado' WHERE id = $1`, [id]);

    const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);
    res.status(201).json({ ...novoAgendamento, itens, valor_total: valorTotal });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao reagendar agendamento' });
  }
}

// Lista os agendamentos do próprio cliente autenticado, filtrados por
// status=agendados (confirmados e ainda no futuro) ou status=anteriores
// (qualquer outro status, ou confirmado mas com data já passada). Sem o
// parâmetro `status`, retorna todos os agendamentos do cliente.
//
// `filtroCondicao` é interpolado como string fixa (não vem de input do
// usuário -- `status` só controla qual dos 2 blocos de texto fixo é usado,
// `clienteId` continua parametrizado com $1), então não há risco de SQL
// injection aqui.
//
// Isolamento entre clientes: `req.db` já está escopado por RLS para o tenant
// (barbearia_id) do usuário autenticado, e a query ainda filtra
// explicitamente por `a.cliente_id = $1` usando `req.usuario.id` -- um
// cliente nunca enxerga agendamentos de outro cliente, mesmo da mesma
// barbearia.
async function listarMeusAgendamentos(req, res) {
  const { status } = req.query;
  const clienteId = req.usuario.id;

  try {
    let filtroCondicao;
    let ordem;

    if (status === 'agendados') {
      filtroCondicao = `AND a.status = 'confirmado' AND a.data_hora_inicio > now()`;
      ordem = 'ASC';
    } else if (status === 'anteriores') {
      filtroCondicao = `AND (a.status != 'confirmado' OR a.data_hora_inicio <= now())`;
      ordem = 'DESC';
    } else {
      filtroCondicao = '';
      ordem = 'DESC';
    }

    const agendamentosResultado = await req.db.query(
      `SELECT a.* FROM agendamento a
       WHERE a.cliente_id = $1 ${filtroCondicao}
       ORDER BY a.data_hora_inicio ${ordem}`,
      [clienteId]
    );

    const agendamentosComItens = [];
    for (const agendamento of agendamentosResultado.rows) {
      const itensResultado = await req.db.query(
        'SELECT * FROM agendamento_servico WHERE agendamento_id = $1',
        [agendamento.id]
      );
      const itens = itensResultado.rows;
      const valorTotal = itens.reduce((soma, item) => soma + Number(item.valor_cobrado), 0);
      agendamentosComItens.push({ ...agendamento, itens, valor_total: valorTotal });
    }

    res.json(agendamentosComItens);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar agendamentos' });
  }
}

// Rota pública (Task 3 do plano app-cliente-agendamento): agrega
// disponibilidade de TODOS os barbeiros de uma unidade que atendam,
// simultaneamente, todos os servico_ids pedidos -- para o cliente que não
// tem preferência de barbeiro específico. Mesmo padrão de resolução de
// tenant de `listarHorariosDisponiveis` (transação dedicada com
// app.is_plataforma para descobrir o tenant a partir de um id que não é
// barbearia_id, seguido da troca para app.tenant_id), mas partindo de
// unidade_id em vez de barbeiro_id, e iterando sobre múltiplos barbeiros
// candidatos em vez de um único.
//
// Quando dois ou mais barbeiros candidatos têm o mesmo horário livre, só o
// primeiro (na ordem retornada pela query de candidatos) "vence" aquele
// slot na resposta -- a lista final não duplica horários, só ids de
// barbeiro.
async function listarHorariosDisponiveisQualquerBarbeiro(req, res) {
  const { unidade_id, servico_ids: servicoIdsRaw, data } = req.query;

  if (!unidade_id || !servicoIdsRaw || !data) {
    return res.status(400).json({ erro: 'unidade_id, servico_ids e data são obrigatórios' });
  }

  const servicoIds = servicoIdsRaw.split(',').map((id) => Number(id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");

    const unidadeResultado = await client.query('SELECT barbearia_id FROM unidade WHERE id = $1', [unidade_id]);
    if (unidadeResultado.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Unidade não encontrada' });
    }
    const barbearia_id = unidadeResultado.rows[0].barbearia_id;

    await client.query("SELECT set_config('app.is_plataforma', '', true)");
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(barbearia_id)]);

    // Barbeiros da unidade que atendem TODOS os serviços pedidos.
    const candidatosResultado = await client.query(
      `SELECT b.id, SUM(s.duracao_minutos) AS duracao_total
       FROM barbeiro b
       JOIN barbeiro_servico bs ON bs.barbeiro_id = b.id
       JOIN servico s ON s.id = bs.servico_id
       WHERE b.unidade_id = $1 AND b.ativo = true AND s.id = ANY($2::int[])
       GROUP BY b.id
       HAVING COUNT(DISTINCT bs.servico_id) = $3`,
      [unidade_id, servicoIds, servicoIds.length]
    );

    if (candidatosResultado.rows.length === 0) {
      await client.query('COMMIT');
      return res.json([]);
    }

    const duracaoServicos = Number(candidatosResultado.rows[0].duracao_total);
    const diaSemana = combinarDataHora(data, '00:00').getDay();
    const slotsPorHorario = new Map();

    for (const candidato of candidatosResultado.rows) {
      const barbeiro_id = candidato.id;

      const dispResultado = await client.query(
        'SELECT hora_inicio, hora_fim FROM barbeiro_disponibilidade WHERE barbeiro_id = $1 AND dia_semana = $2',
        [barbeiro_id, diaSemana]
      );

      let janelas = dispResultado.rows.map((linha) => ({
        inicio: combinarDataHora(data, linha.hora_inicio),
        fim: combinarDataHora(data, linha.hora_fim),
      }));

      const excResultado = await client.query(
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

      const agResultado = await client.query(
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

      const slots = gerarSlotsDisponiveis(janelas, duracaoServicos);

      for (const slot of slots) {
        const chave = slot.inicio.toISOString();
        // Primeiro barbeiro disponível encontrado para aquele horário "vence"
        // -- evita duplicar o mesmo horário uma vez por barbeiro candidato.
        if (!slotsPorHorario.has(chave)) {
          slotsPorHorario.set(chave, {
            inicio: slot.inicio.toISOString(),
            fim_atendimento: slot.fim_atendimento.toISOString(),
            barbeiro_id,
          });
        }
      }
    }

    await client.query('COMMIT');

    const slotsOrdenados = Array.from(slotsPorHorario.values()).sort((a, b) => a.inicio.localeCompare(b.inicio));
    res.json(slotsOrdenados);
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao calcular horários disponíveis' });
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
  listarMeusAgendamentos,
  listarHorariosDisponiveisQualquerBarbeiro,
};
