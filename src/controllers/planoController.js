async function listarPlanos(req, res) {
  try {
    const resultado = await req.db.query(
      'SELECT * FROM plano WHERE ativo = true ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar planos' });
  }
}

// `barbearia_id` vem de `req.usuario.barbearia_id` (JWT), nunca do body,
// mesmo motivo de `criarUnidade`/`criarServico`/`criarBarbeiro`.
async function criarPlano(req, res) {
  const { nome, valor_mensal, desconto_servico_fora_plano, intervalo_minimo_dias } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!nome || valor_mensal === undefined) {
    return res.status(400).json({ erro: 'nome e valor_mensal são obrigatórios' });
  }

  try {
    const resultado = await req.db.query(
      `INSERT INTO plano (barbearia_id, nome, valor_mensal, desconto_servico_fora_plano, intervalo_minimo_dias)
       VALUES ($1, $2, $3, COALESCE($4, 10), COALESCE($5, 1)) RETURNING *`,
      [barbearia_id, nome, valor_mensal, desconto_servico_fora_plano, intervalo_minimo_dias]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar plano' });
  }
}

// Antes usava um client próprio (`pool.connect()`) com BEGIN/COMMIT dedicado
// para inserir múltiplas linhas em `plano_servico`. Removido pelo mesmo
// motivo do `associarServicos` em `barbeiroController.js`: `req.db` já roda
// dentro da transação gerenciada pelo middleware `escoparTenant`, então uma
// segunda transação aqui seria aninhada. `plano_servico` também tem
// `barbearia_id` NOT NULL com RLS (migrations 002/004/005), preenchido a
// partir de `req.usuario.barbearia_id` (nunca do body).
//
// VALIDAÇÃO de `id` (plano_id) e `servico_ids`: mesmo risco documentado em
// `barbeiroController.js#associarServicos` -- tanto o `:id` da URL quanto os
// `servico_ids` do body vêm sem checagem de tenant, e as FKs envolvidas
// (`plano_servico.plano_id -> plano.id`, `plano_servico.servico_id ->
// servico.id`) ignoram RLS. Sem essa validação, um admin poderia associar
// serviços de outra barbearia ao seu plano, ou (com um `:id` forjado)
// associar serviços a um plano de outra barbearia. Validamos ambos via
// `req.db` (escopado por RLS).
async function associarServicosPlano(req, res) {
  const { id } = req.params;
  const { servico_ids } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!Array.isArray(servico_ids) || servico_ids.length === 0) {
    return res.status(400).json({ erro: 'servico_ids deve ser uma lista com pelo menos um id' });
  }

  try {
    const planoResultado = await req.db.query('SELECT id FROM plano WHERE id = $1', [id]);
    if (planoResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Plano não encontrado' });
    }

    const servicosResultado = await req.db.query(
      'SELECT id FROM servico WHERE id = ANY($1::int[])',
      [servico_ids]
    );

    if (servicosResultado.rows.length !== new Set(servico_ids).size) {
      return res.status(404).json({ erro: 'Um ou mais serviços não foram encontrados' });
    }

    for (const servicoId of servico_ids) {
      await req.db.query(
        'INSERT INTO plano_servico (barbearia_id, plano_id, servico_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [barbearia_id, id, servicoId]
      );
    }
    res.status(201).json({ mensagem: 'Serviços associados ao plano com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao associar serviços ao plano' });
  }
}

async function listarServicosDoPlano(req, res) {
  const { id } = req.params;
  try {
    const resultado = await req.db.query(
      `SELECT s.id, s.nome, s.categoria, s.duracao_minutos, s.valor
       FROM plano_servico ps
       JOIN servico s ON s.id = ps.servico_id
       WHERE ps.plano_id = $1`,
      [id]
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar serviços do plano' });
  }
}

module.exports = {
  listarPlanos,
  criarPlano,
  associarServicosPlano,
  listarServicosDoPlano,
};
