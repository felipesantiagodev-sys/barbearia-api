import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { loginCliente, loginAdmin } from './auth';
import { setToken } from './client';

describe('auth', () => {
  beforeEach(() => {
    setToken(null);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('loginCliente chama o endpoint correto e retorna os dados', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-fake', nome: 'Cliente Teste', email: 'cliente@teste.com' }),
    });

    const resultado = await loginCliente('cliente@teste.com', 'senha123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/auth/cliente/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'cliente@teste.com', senha: 'senha123' }),
      })
    );
    expect(resultado).toEqual({ token: 'jwt-fake', nome: 'Cliente Teste', email: 'cliente@teste.com' });
  });

  test('loginAdmin chama o endpoint correto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-fake-admin', nome: 'Admin Teste', email: 'admin@teste.com' }),
    });

    await loginAdmin('admin@teste.com', 'senha123');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/auth/admin/login',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('lança erro com a mensagem do backend quando a resposta não é ok', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ erro: 'Email ou senha inválidos' }),
    });

    await expect(loginCliente('errado@teste.com', 'senhaErrada')).rejects.toThrow('Email ou senha inválidos');
  });
});
