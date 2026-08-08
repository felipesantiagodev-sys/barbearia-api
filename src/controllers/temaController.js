const pool = require('../config/database');

const REGEX_COR_HEX = /^#[0-9A-Fa-f]{6}$/;

async function buscarTema(req, res) {
  const { id } = req.params;

  try {
    // Além de existir, a barbearia precisa estar com status 'ativa' para
    // que o link de cadastro público seja considerado válido (usado tanto
    // pelo formulário de cadastro público quanto, após login, pela Home do
    // app do cliente via TemaContext -- na prática só clientes de barbearias
    // já ativas se cadastram, então essa checagem extra não afeta esse
    // segundo uso). Barbearia pendente de verificação ou suspensa responde
    // exatamente como "não encontrada" (mesma mensagem), para não vazar a um
    // visitante não autenticado que a barbearia existe mas está inativa.
    const resultado = await pool.query(
      "SELECT cor_primaria, cor_fundo, cor_secundaria FROM barbearia WHERE id = $1 AND status = 'ativa'",
      [id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao buscar tema' });
  }
}

async function salvarTema(req, res) {
  const { id } = req.params;
  const { cor_primaria, cor_fundo, cor_secundaria } = req.body;

  // `barbearia` não tem RLS (é a raiz do tenant) — a proteção contra um
  // admin editar o tema de OUTRA barbearia precisa ser explícita aqui,
  // comparando o :id da URL com o barbearia_id do próprio token, não
  // apenas confiando em RLS/escoparTenant (que aqui nem está na cadeia
  // desta rota, ver barbeariaRoutes.js).
  if (String(req.usuario.barbearia_id) !== String(id)) {
    return res.status(404).json({ erro: 'Barbearia não encontrada' });
  }

  if (![cor_primaria, cor_fundo, cor_secundaria].every((cor) => REGEX_COR_HEX.test(cor))) {
    return res.status(400).json({ erro: 'Cores devem estar no formato hexadecimal #RRGGBB' });
  }

  try {
    const resultado = await pool.query(
      `UPDATE barbearia SET cor_primaria = $1, cor_fundo = $2, cor_secundaria = $3
       WHERE id = $4 RETURNING cor_primaria, cor_fundo, cor_secundaria`,
      [cor_primaria, cor_fundo, cor_secundaria, id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ erro: 'Barbearia não encontrada' });
    }

    res.json(resultado.rows[0]);
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao salvar tema' });
  }
}

module.exports = { buscarTema, salvarTema };
