const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { enviarEmailRedefinicaoSenha } = require('../services/emailService');

const HORAS_EXPIRACAO_TOKEN_RESET = 1;

// Mesmo raciocínio de `buscarComoPlataforma`, mas para escritas: o UPDATE de
// token_reset_senha/senha_hash em usuario_admin/cliente também é bloqueado
// por FORCE ROW LEVEL SECURITY sem app.is_plataforma setado na sessão (o
// pedido de redefinição não conhece o tenant, só o email). Diferente de
// buscarComoPlataforma, aqui fazemos COMMIT em vez de ROLLBACK, pois a
// intenção é persistir a alteração.
async function executarComoPlataforma(query, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const resultado = await client.query(query, params);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

// O login (admin ou cliente) acontece ANTES de sabermos a qual barbearia o
// usuário pertence — não há subdomínio nem contexto de tenant nessa etapa.
// Como `usuario_admin` e `cliente` têm FORCE ROW LEVEL SECURITY (migration
// 005), um SELECT comum via `pool.query()` não enxerga NENHUMA linha sem
// `app.tenant_id` ou `app.is_plataforma` setado na sessão. Por isso usamos
// uma conexão dedicada com `app.is_plataforma` setado apenas para esta
// consulta de busca por email (que pode cruzar tenants, já que agora o
// email é único por barbearia, não globalmente), fazemos ROLLBACK ao final
// (somos apenas leitura) e liberamos a conexão.
async function buscarComoPlataforma(query, params) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.is_plataforma', 'true', true)");
    const resultado = await client.query(query, params);
    await client.query('ROLLBACK');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

async function cadastrarAdmin(req, res) {
  const { nome, email, senha } = req.body;
  const barbearia_id = req.usuario.barbearia_id;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
  }

  try {
    const senha_hash = await bcrypt.hash(senha, 10);

    const resultado = await req.db.query(
      `INSERT INTO usuario_admin (barbearia_id, nome, email, senha_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, nome, email, papel, criado_em`,
      [barbearia_id, nome, email, senha_hash]
    );

    res.status(201).json(resultado.rows[0]);
  } catch (erro) {
    if (erro.code === '23505') {
      return res.status(409).json({ erro: 'Este email já está cadastrado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao cadastrar administrador' });
  }
}

async function loginAdmin(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT * FROM usuario_admin WHERE email = $1 AND ativo = true',
      [email]
    );

    let adminAutenticado = null;
    for (const candidato of resultado.rows) {
      if (await bcrypt.compare(senha, candidato.senha_hash)) {
        adminAutenticado = candidato;
        break;
      }
    }

    if (!adminAutenticado) {
      // DECISÃO DE PRODUTO (consciente, não descuido): nenhuma das contas
      // com esse email bateu a senha informada. Como o login não recebe
      // barbearia_id (é anterior ao contexto de tenant), não há como saber
      // qual conta especificamente o usuário quis acessar — por isso
      // incrementamos tentativas_login_falhas em TODAS as contas candidatas
      // com esse email, não só a pretendida. Efeito colateral aceito: um
      // usuário dono de contas em 2+ barbearias com o mesmo email pode ter
      // a conta B bloqueada mesmo errando a senha só tentando entrar na
      // conta A. Optamos por manter esse comportamento (em vez de, por
      // exemplo, exigir barbearia_id no login ou rastrear tentativas por
      // combinação email+barbearia) porque: (1) é simples e não muda a UX
      // de login; (2) o cenário é raro — poucos usuários têm 2+ barbearias
      // com o mesmo email; (3) quem for afetado ainda consegue desbloquear
      // via "esqueci senha", que já identifica e envia link por conta
      // individualmente. A alternativa (não bloquear nenhuma conta na
      // ambiguidade) abriria brecha de força bruta em contas com email
      // compartilhado entre barbearias.
      // Uma única query/transação para todos os candidatos (em vez de um
      // round-trip por conta): o incremento é feito no próprio SQL
      // (tentativas_login_falhas + 1), então cada linha soma seu valor
      // atual independentemente das demais, e o CASE decide o bloqueio por
      // linha comparando o valor JÁ incrementado — preserva a semântica de
      // "cada conta bloqueia com base no seu próprio contador" sem precisar
      // de uma chamada por candidato.
      const idsCandidatos = resultado.rows.map((candidato) => candidato.id);
      await executarComoPlataforma(
        `UPDATE usuario_admin
         SET tentativas_login_falhas = tentativas_login_falhas + 1,
             bloqueado_ate = CASE
               WHEN tentativas_login_falhas + 1 >= 5 THEN now() + interval '100 years'
               ELSE bloqueado_ate
             END
         WHERE id = ANY($1)`,
        [idsCandidatos]
      );
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    // A checagem de bloqueado_ate fica aqui, depois da verificação de senha,
    // porque a ordem do brief original checava bloqueio ANTES da senha e
    // por isso precisava de um segundo bcrypt.compare duplicado (para não
    // vazar "conta bloqueada" antes de confirmar que a senha estava certa).
    // Nessa versão isso é desnecessário: adminAutenticado só é setado
    // quando a senha já bateu (ver loop acima), então chegar neste ponto já
    // implica senha correta — um único bcrypt.compare é suficiente e a
    // ordem (senha primeiro, bloqueio depois) continua segura porque só
    // avaliamos bloqueado_ate para quem já provou conhecer a senha.
    if (adminAutenticado.bloqueado_ate && new Date(adminAutenticado.bloqueado_ate) > new Date()) {
      return res.status(423).json({
        erro: 'Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.',
        bloqueado: true,
      });
    }

    if (!adminAutenticado.email_verificado) {
      return res.status(403).json({ erro: 'Confirme seu email antes de fazer login' });
    }

    if (adminAutenticado.tentativas_login_falhas > 0) {
      await executarComoPlataforma(
        `UPDATE usuario_admin SET tentativas_login_falhas = 0, bloqueado_ate = NULL WHERE id = $1`,
        [adminAutenticado.id]
      );
    }

    const token = jwt.sign(
      { id: adminAutenticado.id, tipo: 'admin', barbearia_id: adminAutenticado.barbearia_id, papel: adminAutenticado.papel },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nome: adminAutenticado.nome, email: adminAutenticado.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}

async function loginCliente(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'email e senha são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma('SELECT * FROM cliente WHERE email = $1', [email]);

    let clienteAutenticado = null;
    for (const candidato of resultado.rows) {
      if (await bcrypt.compare(senha, candidato.senha_hash)) {
        clienteAutenticado = candidato;
        break;
      }
    }

    if (!clienteAutenticado) {
      // DECISÃO DE PRODUTO (consciente, não descuido) — mesmo raciocínio de
      // loginAdmin: o login não recebe barbearia_id, então não há como saber
      // qual conta o usuário quis acessar quando o email tem múltiplas
      // contas (uma por barbearia). Incrementamos tentativas_login_falhas em
      // TODAS as contas candidatas com esse email numa única query (o
      // incremento é feito no próprio SQL, então cada linha soma seu valor
      // atual independentemente das demais, e o CASE decide o bloqueio por
      // linha com base no valor já incrementado).
      const idsCandidatos = resultado.rows.map((candidato) => candidato.id);
      await executarComoPlataforma(
        `UPDATE cliente
         SET tentativas_login_falhas = tentativas_login_falhas + 1,
             bloqueado_ate = CASE
               WHEN tentativas_login_falhas + 1 >= 5 THEN now() + interval '100 years'
               ELSE bloqueado_ate
             END
         WHERE id = ANY($1)`,
        [idsCandidatos]
      );
      return res.status(401).json({ erro: 'Email ou senha inválidos' });
    }

    // A checagem de bloqueado_ate fica aqui, depois da verificação de senha
    // (ver loop acima), pelo mesmo raciocínio de loginAdmin: só avaliamos
    // bloqueado_ate para quem já provou conhecer a senha.
    if (clienteAutenticado.bloqueado_ate && new Date(clienteAutenticado.bloqueado_ate) > new Date()) {
      return res.status(423).json({
        erro: 'Conta bloqueada por muitas tentativas. Redefina sua senha para continuar.',
        bloqueado: true,
      });
    }

    if (clienteAutenticado.tentativas_login_falhas > 0) {
      await executarComoPlataforma(
        `UPDATE cliente SET tentativas_login_falhas = 0, bloqueado_ate = NULL WHERE id = $1`,
        [clienteAutenticado.id]
      );
    }

    const token = jwt.sign(
      { id: clienteAutenticado.id, tipo: 'cliente', barbearia_id: clienteAutenticado.barbearia_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, nome: clienteAutenticado.nome, email: clienteAutenticado.email });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
}

async function esqueciSenhaAdmin(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT ua.*, b.nome AS nome_barbearia FROM usuario_admin ua JOIN barbearia b ON b.id = ua.barbearia_id WHERE ua.email = $1 AND ua.ativo = true',
      [email]
    );

    for (const admin of resultado.rows) {
      const tokenReset = crypto.randomUUID();
      await executarComoPlataforma(
        `UPDATE usuario_admin SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN_RESET} hours' WHERE id = $2`,
        [tokenReset, admin.id]
      );

      try {
        await enviarEmailRedefinicaoSenha(admin.email, admin.nome_barbearia, tokenReset, 'admin');
      } catch (erroEnvio) {
        console.error('Falha ao enviar email de redefinição de senha (admin):', erroEnvio);
      }
    }

    res.json({ mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar solicitação' });
  }
}

async function redefinirSenhaAdmin(req, res) {
  const { token, senha_nova } = req.body;

  if (!token || !senha_nova) {
    return res.status(400).json({ erro: 'token e senha_nova são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      `SELECT * FROM usuario_admin WHERE token_reset_senha = $1 AND token_reset_senha_expira_em > now()`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const admin = resultado.rows[0];
    const senha_hash = await bcrypt.hash(senha_nova, 10);

    await executarComoPlataforma(
      `UPDATE usuario_admin
       SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL,
           tentativas_login_falhas = 0, bloqueado_ate = NULL
       WHERE id = $2`,
      [senha_hash, admin.id]
    );

    res.json({ mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (erro) {
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir senha' });
  }
}

async function esqueciSenhaCliente(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ erro: 'email é obrigatório' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      'SELECT c.*, b.nome AS nome_barbearia FROM cliente c JOIN barbearia b ON b.id = c.barbearia_id WHERE c.email = $1',
      [email]
    );

    for (const cliente of resultado.rows) {
      const tokenReset = crypto.randomUUID();
      await executarComoPlataforma(
        `UPDATE cliente SET token_reset_senha = $1, token_reset_senha_expira_em = now() + interval '${HORAS_EXPIRACAO_TOKEN_RESET} hours' WHERE id = $2`,
        [tokenReset, cliente.id]
      );

      try {
        await enviarEmailRedefinicaoSenha(cliente.email, cliente.nome_barbearia, tokenReset, 'cliente');
      } catch (erroEnvio) {
        console.error('Falha ao enviar email de redefinição de senha (cliente):', erroEnvio);
      }
    }

    res.json({ mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.' });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao processar solicitação' });
  }
}

async function redefinirSenhaCliente(req, res) {
  const { token, senha_nova } = req.body;

  if (!token || !senha_nova) {
    return res.status(400).json({ erro: 'token e senha_nova são obrigatórios' });
  }

  try {
    const resultado = await buscarComoPlataforma(
      `SELECT * FROM cliente WHERE token_reset_senha = $1 AND token_reset_senha_expira_em > now()`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    const cliente = resultado.rows[0];
    const senha_hash = await bcrypt.hash(senha_nova, 10);

    await executarComoPlataforma(
      `UPDATE cliente
       SET senha_hash = $1, token_reset_senha = NULL, token_reset_senha_expira_em = NULL,
           tentativas_login_falhas = 0, bloqueado_ate = NULL
       WHERE id = $2`,
      [senha_hash, cliente.id]
    );

    res.json({ mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
  } catch (erro) {
    if (erro.code === '22P02') {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }
    console.error(erro);
    res.status(500).json({ erro: 'Erro ao redefinir senha' });
  }
}

module.exports = {
  cadastrarAdmin,
  loginAdmin,
  loginCliente,
  esqueciSenhaAdmin,
  redefinirSenhaAdmin,
  esqueciSenhaCliente,
  redefinirSenhaCliente,
};