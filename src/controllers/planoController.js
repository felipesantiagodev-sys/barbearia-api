const pool = require('../config/database');

async function listarPlanos(req, res) {
  try {
    const resultado = await pool.query(
      'SELECT * FROM plano WHERE ativo = true ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar planos' });
  }
}

async function criarPlano(req, res) {
  const { barbearia_id, nome, valor_mensal, desconto_servico_fora_plano, intervalo_minimo_dias } = req.body;

  if (!barbearia_id || !nome || valor_mensal === undefined) {
    return res.status(400).json({ erro: 'barbearia_id, nome e valor_mensal são obrigatórios' });
  }

  try {
    const resultado = await pool.query(
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

async function associarServicosPlano(req, res) {
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
        'INSERT INTO plano_servico (plano_id, servico_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, servicoId]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ mensagem: 'Serviços associados ao plano com sucesso' });
  } catch (erro) {
    await client.query('ROLLBACK');
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao associar serviços ao plano' });
  } finally {
    client.release();
  }
}

async function listarServicosDoPlano(req, res) {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
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