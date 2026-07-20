const { enviarEmailVerificacao } = require('../../src/services/emailService');

describe('emailService', () => {
  const chamadasOriginais = [];
  let ResendMock;

  beforeEach(() => {
    chamadasOriginais.length = 0;
    jest.resetModules();
    jest.doMock('resend', () => ({
      Resend: class {
        constructor(apiKey) {
          this.apiKey = apiKey;
        }
        get emails() {
          return {
            send: async (payload) => {
              chamadasOriginais.push(payload);
              return { data: { id: 'email-fake-id' }, error: null };
            },
          };
        }
      },
    }));
  });

  afterEach(() => {
    jest.dontMock('resend');
  });

  test('envia email com destinatário, remetente e link de verificação corretos', async () => {
    process.env.RESEND_API_KEY = 'chave-de-teste';
    process.env.RESEND_FROM_EMAIL = 'onboarding@resend.dev';
    process.env.APP_BASE_URL = 'http://localhost:3000';

    const { enviarEmailVerificacao: enviarComMock } = require('../../src/services/emailService');
    await enviarComMock('dono@barbearia.com', 'Fulano', 'token-abc-123');

    expect(chamadasOriginais).toHaveLength(1);
    expect(chamadasOriginais[0].to).toEqual(['dono@barbearia.com']);
    expect(chamadasOriginais[0].from).toBe('onboarding@resend.dev');
    expect(chamadasOriginais[0].subject).toMatch(/confirme seu email/i);
    expect(chamadasOriginais[0].html).toContain('http://localhost:3000/onboarding/verificar?token=token-abc-123');
    expect(chamadasOriginais[0].html).toContain('Fulano');
  });

  test('lança erro quando o Resend retorna erro', async () => {
    jest.resetModules();
    jest.doMock('resend', () => ({
      Resend: class {
        get emails() {
          return {
            send: async () => ({ data: null, error: { message: 'Falha simulada' } }),
          };
        }
      },
    }));

    const { enviarEmailVerificacao: enviarComErro } = require('../../src/services/emailService');
    await expect(enviarComErro('dono@barbearia.com', 'Fulano', 'token-abc')).rejects.toThrow(/Falha simulada/);
  });
});
