const bcrypt = require('bcrypt');
const pool = require('../config/database');

// Cadastro público de cliente, escopado pela barbearia identificada na URL
// (`/barbearias/:barbearia_id/clientes`). É uma rota sem autenticação
// prévia (o cliente ainda não tem conta), então `barbearia_id` NÃO pode vir
// do body -- um campo livre no corpo permitiria que qualquer um se
// cadastrasse como cliente de uma barbearia arbitrária. O parâmetro da URL
// é a fonte confiável do tenant aqui.
//
// DECISÃO SOBRE RLS: esta rota não passa por `escoparTenant` (não há
// `req.usuario` -- não houve login), então não existe `req.db` já escopado
// para esta requisição. Mas a tabela `cliente` tem FORCE ROW LEVEL SECURITY
// (migration 005): um INSERT via `pool.query()` comum seria bloqueado pela
// policy `WITH CHECK`, pois nenhuma conexão do pool teria `app.tenant_id`
// setado. Resolvemos abrindo aqui uma transação dedicada (`pool.connect()`),
// setando `app.tenant_id` = barbearia_id da URL via `set_config(..., true)`
// (escopo de transação/SET LOCAL) antes do INSERT, e commitando ao final --
// o mesmo padrão usado em `tests/helpers/factories.js` (`criarClienteDireto`)
// e nos middlewares de tenant (`src/middlewares/tenant.js`).
async function criarClientePublico(req, res) {
  const { barbearia_id } = req.params;
  const { nome, email, senha, telefone } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  const client = await pool.connect();

  try {
    const senha_hash = await bcrypt.hash(senha, 10);

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(barbearia_id)]);

    const resultado = await client.query(
      `INSERT INTO cliente (barbearia_id, nome, email, telefone, senha_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nome, email, telefone, criado_em`,
      [barbearia_id, nome, email, telefone, senha_hash]
    );

    await client.query('COMMIT');

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});

    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado nesta barbearia' });
    }
    if (erro.code === '23503') {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'barbearia_id inválido' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
  } finally {
    client.release();
  }
}

// Escopado pelo middleware `escoparTenant` (ver `src/routes/clienteRoutes.js`):
// `req.db` já é o client com `app.tenant_id` setado para a transação, então
// RLS filtra automaticamente as linhas da barbearia do usuário autenticado.
async function listarClientes(req, res) {
  try {
    const resultado = await req.db.query(
      'SELECT id, nome, email, telefone, criado_em FROM cliente ORDER BY nome'
    );
    res.json(resultado.rows);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao listar clientes' });
  }
}

async function buscarClientePorId(req, res) {
  const { id } = req.params;

  try {
    const resultado = await req.db.query(
      'SELECT id, nome, email, telefone, criado_em FROM cliente WHERE id = $1',
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Cliente não encontrado' });
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar cliente' });
  }
}

module.exports = { criarClientePublico, listarClientes, buscarClientePorId };
