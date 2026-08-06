const { Resend } = require('resend');

function obterCliente() {
  return new Resend(process.env.RESEND_API_KEY);
}

// `nome` vem de req.body no cadastro (src/controllers/onboardingController.js)
// e é totalmente controlado por quem preenche o formulário -- sem escapar,
// alguém poderia injetar HTML/links arbitrários no corpo do email enviado
// pelo domínio verificado da plataforma. Escapamos os 5 caracteres especiais
// de HTML antes de interpolar.
function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function enviarEmailVerificacao(destinatario, nome, tokenVerificacao) {
  const resend = obterCliente();
  const linkVerificacao = `${process.env.APP_BASE_URL}/onboarding/verificar?token=${tokenVerificacao}`;
  const nomeSeguro = escaparHtml(nome);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: [destinatario],
    subject: 'Confirme seu email para ativar sua barbearia',
    html: `
      <p>Olá, ${nomeSeguro}!</p>
      <p>Falta só confirmar seu email para começar a usar a plataforma.</p>
      <p><a href="${linkVerificacao}">Confirmar meu email</a></p>
      <p>Se você não fez esse cadastro, pode ignorar este email.</p>
    `,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de verificação: ${error.message}`);
  }
}

async function enviarEmailRedefinicaoSenha(destinatario, nomeBarbearia, tokenReset, tipoUsuario) {
  const resend = obterCliente();
  const linkRedefinicao = `${process.env.APP_BASE_URL}/redefinir-senha?tipo=${tipoUsuario}&token=${tokenReset}`;
  const nomeSeguro = escaparHtml(nomeBarbearia);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: [destinatario],
    subject: `Redefinir senha — ${nomeSeguro}`,
    html: `
      <p>Olá!</p>
      <p>Recebemos um pedido para redefinir a senha da sua conta em <strong>${nomeSeguro}</strong>.</p>
      <p><a href="${linkRedefinicao}">Redefinir minha senha</a></p>
      <p>Este link expira em 1 hora. Se você não pediu essa redefinição, pode ignorar este email.</p>
    `,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de redefinição de senha: ${error.message}`);
  }
}

module.exports = { enviarEmailVerificacao, enviarEmailRedefinicaoSenha };
