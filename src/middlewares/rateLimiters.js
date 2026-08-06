const rateLimit = require('express-rate-limit');

// 5 cadastros por IP por hora -- suficiente para um usuário legítimo que
// erre o formulário algumas vezes, baixo o bastante para tornar cadastro
// em massa por bot impraticável sem múltiplos IPs.
const limitadorCadastro = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de cadastro. Tente novamente mais tarde.' },
});

// Reenvio de verificação: mais restritivo, já que o caso de uso legítimo
// (email não chegou) não deveria precisar de mais de 3 tentativas por hora.
const limitadorReenvio = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de reenvio. Tente novamente mais tarde.' },
});

// Esqueci minha senha: mesmo limite de reenvio de verificação -- o caso de
// uso legítimo (não recebeu o email) não deveria precisar de mais de 3
// tentativas por hora, e o endpoint já responde de forma genérica então
// repetir a tentativa não ajuda a descobrir mais informação.
const limitadorEsqueciSenha = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente mais tarde.' },
});

module.exports = { limitadorCadastro, limitadorReenvio, limitadorEsqueciSenha };
