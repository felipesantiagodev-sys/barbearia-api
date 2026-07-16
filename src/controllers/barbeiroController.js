async function listarBarbeiros(req, res) {
  try {
    const resultado = await req.db.query(
      'SELECT id, nome, email, telefone, foto_url, ativo FROM barbeiro WHERE ativo = true ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar barbeiros' });
  }
}

// `barbeiro` tem `barbearia_id` NOT NULL com RLS FORCE ROW LEVEL SECURITY
// (migrations 002/004/005): o INSERT precisa preencher a coluna, e o valor
// tem que ser o da barbearia do admin autenticado (req.usuario, injetado por
// `verificarToken`) -- nunca algo vindo do body, que poderia ser forjado
// para apontar a outro tenant.
//
// VALIDAÇÃO ADICIONAL de `unidade_id`: mesmo com `barbearia_id` correto,
// `unidade_id` vem do body e poderia apontar para uma unidade de OUTRA
// barbearia. A FK `barbeiro.unidade_id -> unidade.id` sozinha não impede
// isso -- constraints de FK no Postgres são verificadas com privilégios
// internos do sistema e ignoram RLS, então uma unidade de outro tenant
// "passa" na FK silenciosamente, gerando uma inconsistência real (barbeiro
// da barbearia A fisicamente vinculado à unidade da barbearia B). Por isso
// validamos explicitamente via `req.db` (já escopado por RLS): se a unidade
// não pertencer à barbearia do admin autenticado, RLS a torna invisível
// nessa query e o SELECT retorna 0 linhas -- respondemos 404 sem vazar se a
// unidade existe em outro tenant.
async function criarBarbeiro(req, res) {
  const { unidade_id, nome, email, telefone } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!unidade_id || !nome) {
    return res.status(400).json({ erro: 'unidade_id e nome são obrigatórios' });
  }

  try {
    const unidadeResultado = await req.db.query(
      'SELECT id FROM unidade WHERE id = $1',
      [unidade_id]
    );

    if (unidadeResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Unidade não encontrada' });
    }

    const resultado = await req.db.query(
      'INSERT INTO barbeiro (barbearia_id, unidade_id, nome, email, telefone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [barbearia_id, unidade_id, nome, email, telefone]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar barbeiro' });
  }
}

// VALIDAÇÃO de `id` (barbeiro_id) na URL: mesmo risco documentado em
// `criarBarbeiro`/`associarServicos` -- o `:id` da rota não é validado
// contra o tenant do admin autenticado antes do INSERT, e a FK
// `barbeiro_disponibilidade.barbeiro_id -> barbeiro.id` ignora RLS. Sem essa
// checagem, um admin poderia definir disponibilidade para um barbeiro de
// OUTRA barbearia (barbearia_id da linha ficaria correta, mas barbeiro_id
// apontaria para o tenant errado). Validamos via `req.db` (escopado por
// RLS): se o barbeiro não pertence ao tenant, a query não o encontra.
async function definirDisponibilidade(req, res) {
  const { id } = req.params;
  const { dia_semana, hora_inicio, hora_fim } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (dia_semana === undefined || !hora_inicio || !hora_fim) {
    return res.status(400).json({ erro: 'dia_semana, hora_inicio e hora_fim são obrigatórios' });
  }

  try {
    const barbeiroResultado = await req.db.query('SELECT id FROM barbeiro WHERE id = $1', [id]);
    if (barbeiroResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbeiro não encontrado' });
    }

    const resultado = await req.db.query(
      `INSERT INTO barbeiro_disponibilidade (barbearia_id, barbeiro_id, dia_semana, hora_inicio, hora_fim)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [barbearia_id, id, dia_semana, hora_inicio, hora_fim]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao definir disponibilidade' });
  }
}

// Antes usava um client próprio (`pool.connect()`) com BEGIN/COMMIT dedicado
// para inserir múltiplas linhas em `barbeiro_servico`. Isso foi removido:
// `req.db` já é um client dentro de uma transação gerenciada pelo middleware
// `escoparTenant` (BEGIN/COMMIT feitos lá, com `app.tenant_id` setado) --
// abrir uma segunda transação aqui seria uma transação aninhada, que o `pg`
// não suporta (BEGIN dentro de BEGIN apenas emite um warning e é ignorado
// pelo Postgres, mas o ROLLBACK/COMMIT locais desfariam o controle de fluxo
// do middleware). O loop de INSERTs roda direto em `req.db`; se algum
// INSERT falhar, o erro propaga e o middleware faz ROLLBACK da transação
// inteira da requisição.
// VALIDAÇÃO de `id` (barbeiro_id) e `servico_ids`: mesmo risco documentado em
// `criarBarbeiro`/`definirDisponibilidade` -- tanto o `:id` da URL quanto os
// `servico_ids` do body vêm sem checagem de tenant, e as FKs envolvidas
// (`barbeiro_servico.barbeiro_id -> barbeiro.id`,
// `barbeiro_servico.servico_id -> servico.id`) ignoram RLS. Sem essa
// validação, um admin poderia associar ao SEU barbeiro um `servico_id` de
// outra barbearia, ou (com um `:id` forjado) associar serviços a um
// barbeiro de outra barbearia. Validamos ambos via `req.db` (escopado por
// RLS): buscamos o barbeiro e os serviços informados e comparamos a
// quantidade encontrada com a esperada -- qualquer id de outro tenant fica
// invisível para `req.db` e a contagem não bate, respondendo 404.
async function associarServicos(req, res) {
  const { id } = req.params;
  const { servico_ids } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!Array.isArray(servico_ids) || servico_ids.length === 0) {
    return res.status(400).json({ erro: 'servico_ids deve ser uma lista com pelo menos um id' });
  }

  try {
    const barbeiroResultado = await req.db.query('SELECT id FROM barbeiro WHERE id = $1', [id]);
    if (barbeiroResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbeiro não encontrado' });
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
        'INSERT INTO barbeiro_servico (barbearia_id, barbeiro_id, servico_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [barbearia_id, id, servicoId]
      );
    }
    res.status(201).json({ mensagem: 'Serviços associados com sucesso' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao associar serviços' });
  }
}

// VALIDAÇÃO de `id` (barbeiro_id) na URL: mesmo motivo de
// `definirDisponibilidade` -- `barbeiro_excecao.barbeiro_id -> barbeiro.id`
// é uma FK que ignora RLS, então sem checagem explícita via `req.db` um
// admin poderia criar uma exceção de agenda para um barbeiro de outra
// barbearia.
async function criarExcecao(req, res) {
  const { id } = req.params;
  const { data, tipo, hora_inicio, hora_fim, motivo } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!data || !tipo) {
    return res.status(400).json({ erro: 'data e tipo são obrigatórios' });
  }

  try {
    const barbeiroResultado = await req.db.query('SELECT id FROM barbeiro WHERE id = $1', [id]);
    if (barbeiroResultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbeiro não encontrado' });
    }

    const resultado = await req.db.query(
      `INSERT INTO barbeiro_excecao (barbearia_id, barbeiro_id, data, tipo, hora_inicio, hora_fim, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [barbearia_id, id, data, tipo, hora_inicio, hora_fim, motivo]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao criar exceção de agenda' });
  }
}

async function listarExcecoes(req, res) {
  const { id } = req.params;
  try {
    const resultado = await req.db.query(
      'SELECT * FROM barbeiro_excecao WHERE barbeiro_id = $1 ORDER BY data',
      [id]
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar exceções' });
  }
}

async function listarDisponibilidade(req, res) {
  const { id } = req.params;
  try {
    const resultado = await req.db.query(
      'SELECT * FROM barbeiro_disponibilidade WHERE barbeiro_id = $1 ORDER BY dia_semana',
      [id]
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar disponibilidade' });
  }
}

async function listarServicosDoBarbeiro(req, res) {
  const { id } = req.params;
  try {
    const resultado = await req.db.query(
      `SELECT s.id, s.nome, s.categoria, s.duracao_minutos, s.valor
       FROM barbeiro_servico bs
       JOIN servico s ON s.id = bs.servico_id
       WHERE bs.barbeiro_id = $1`,
      [id]
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar serviços do barbeiro' });
  }
}

module.exports = {
  listarBarbeiros,
  criarBarbeiro,
  definirDisponibilidade,
  associarServicos,
  criarExcecao,
  listarExcecoes,
  listarDisponibilidade,
  listarServicosDoBarbeiro,
};
