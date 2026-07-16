async function faturamentoMensal(req, res) {
  try {
    const resultado = await req.db.query('SELECT * FROM vw_faturamento_mensal');
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar faturamento mensal' });
  }
}

async function desempenhoBarbeiros(req, res) {
  const { barbeiro_id } = req.query;

  try {
    let query = 'SELECT * FROM vw_desempenho_barbeiro_mensal';
    const parametros = [];

    if (barbeiro_id) {
      query += ' WHERE barbeiro_id = $1';
      parametros.push(barbeiro_id);
    }

    const resultado = await req.db.query(query, parametros);
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar desempenho dos barbeiros' });
  }
}

module.exports = { faturamentoMensal, desempenhoBarbeiros };