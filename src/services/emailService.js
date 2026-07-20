const { Resend } = require('resend');

function obterCliente() {
  return new Resend(process.env.RESEND_API_KEY);
}

async function enviarEmailVerificacao(destinatario, nome, tokenVerificacao) {
  const resend = obterCliente();
  const linkVerificacao = `${process.env.APP_BASE_URL}/onboarding/verificar?token=${tokenVerificacao}`;

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: [destinatario],
    subject: 'Confirme seu email para ativar sua barbearia',
    html: `
      <p>Olá, ${nome}!</p>
      <p>Falta só confirmar seu email para começar a usar a plataforma.</p>
      <p><a href="${linkVerificacao}">Confirmar meu email</a></p>
      <p>Se você não fez esse cadastro, pode ignorar este email.</p>
    `,
  });

  if (error) {
    throw new Error(`Falha ao enviar email de verificação: ${error.message}`);
  }
}

module.exports = { enviarEmailVerificacao };
