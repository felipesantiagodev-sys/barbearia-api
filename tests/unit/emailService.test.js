jest.mock('resend', () => {
  const enviarMock = jest.fn().mockResolvedValue({ error: null });
  return { Resend: jest.fn().mockImplementation(() => ({ emails: { send: enviarMock } })), __enviarMock: enviarMock };
});

const { Resend } = require('resend');
const { enviarEmailRedefinicaoSenha } = require('../../src/services/emailService');

describe('enviarEmailRedefinicaoSenha', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'chave-fake';
    process.env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    Resend.mock.results[Resend.mock.results.length - 1]?.value.emails.send.mockClear();
  });

  test('envia email com link contendo tipo e token corretos', async () => {
    await enviarEmailRedefinicaoSenha('cliente@teste.com', 'Barbearia Exemplo', 'token-abc-123', 'cliente');

    const instancia = Resend.mock.results[Resend.mock.results.length - 1].value;
    expect(instancia.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['cliente@teste.com'],
        subject: expect.stringContaining('Barbearia Exemplo'),
        html: expect.stringContaining('http://localhost:3000/redefinir-senha?tipo=cliente&token=token-abc-123'),
      })
    );
  });

  test('escapa o nome da barbearia no corpo do email', async () => {
    await enviarEmailRedefinicaoSenha('admin@teste.com', '<script>alert(1)</script>', 'token-xyz', 'admin');

    const instancia = Resend.mock.results[Resend.mock.results.length - 1].value;
    const chamada = instancia.emails.send.mock.calls[0][0];
    expect(chamada.html).not.toContain('<script>');
    expect(chamada.html).toContain('&lt;script&gt;');
  });

  test('lança erro quando o Resend retorna falha', async () => {
    const instancia = Resend.mock.results[Resend.mock.results.length - 1]?.value;
    Resend.mockImplementationOnce(() => ({
      emails: { send: jest.fn().mockResolvedValue({ error: { message: 'falha simulada' } }) },
    }));

    await expect(
      enviarEmailRedefinicaoSenha('cliente@teste.com', 'Barbearia Exemplo', 'token-abc', 'cliente')
    ).rejects.toThrow('falha simulada');
  });
});
