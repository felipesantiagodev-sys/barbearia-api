const pool = require('../config/database');

async function listarBarbeiros(req, res) {
  try {
    const resultado = await pool.query(
      'SELECT id, nome, email, telefone, foto_url, ativo FROM barbeiro WHERE ativo = true ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar barbeiros' });
  }
}

async function criarBarbeiro(req, res) {
  const { unidade_id, nome, email, telefone } = req.body;

  if (!unidade_id || !nome) {
    return res.status(400).json({ erro: 'unidade_id e nome são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      'INSERT INTO barbeiro (unidade_id, nome, email, telefone) VALUES ($1, $2, $3, $4) RETURNING *',
      [unidade_id, nome, email, telefone]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar barbeiro' });
  }
}

async function definirDisponibilidade(req, res) {
  const { id } = req.params;
  const { dia_semana, hora_inicio, hora_fim } = req.body;

  if (dia_semana === undefined || !hora_inicio || !hora_fim) {
    return res.status(400).json({ erro: 'dia_semana, hora_inicio e hora_fim são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO barbeiro_disponibilidade (barbeiro_id, dia_semana, hora_inicio, hora_fim)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, dia_semana, hora_inicio, hora_fim]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao definir disponibilidade' });
  }
}

async function associarServicos(req, res) {
  const { id } = req.params;
  const { servico_ids } = req.body;

  if (!Array.isArray(servico_ids) || servico_ids.length === 0) {
    return res.status(400).json({ erro: 'servico_ids deve ser uma lista com pelo menos um id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const servicoId of servico_ids) {
      await client.query(
        'INSERT INTO barbeiro_servico (barbeiro_id, servico_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, servicoId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ mensagem: 'Serviços associados com sucesso' });
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao associar serviços' });
  } finally {
    client.release();
  }
}

async function criarExcecao(req, res) {
  const { id } = req.params;
  const { data, tipo, hora_inicio, hora_fim, motivo } = req.body;

  if (!data || !tipo) {
    return res.status(400).json({ erro: 'data e tipo são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
      `INSERT INTO barbeiro_excecao (barbeiro_id, data, tipo, hora_inicio, hora_fim, motivo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, data, tipo, hora_inicio, hora_fim, motivo]
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
    const resultado = await pool.query(
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
    const resultado = await pool.query(
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
    const resultado = await pool.query(
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