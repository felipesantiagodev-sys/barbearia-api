async function listarUnidades(req, res) {
  try {
    const resultado = await req.db.query('SELECT * FROM unidade WHERE ativo = true ORDER BY nome');
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar unidades' });
  }
}

// `barbearia_id` vem de `req.usuario.barbearia_id` (JWT, injetado por
// `verificarToken`), nunca do body: um admin autenticado só pode criar
// unidades para a própria barbearia. A rota já exige `apenasAdmin`, então
// `req.usuario` está garantidamente populado.
async function criarUnidade(req, res) {
  const { nome, endereco, telefone } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!nome) {
    return res.status(400).json({ erro: 'nome é obrigatório' });
  }

  try {
    const resultado = await req.db.query(
      'INSERT INTO unidade (barbearia_id, nome, endereco, telefone) VALUES ($1, $2, $3, $4) RETURNING *',
      [barbearia_id, nome, endereco, telefone]
    );
    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar unidade' });
  }
}

module.exports = { listarUnidades, criarUnidade };