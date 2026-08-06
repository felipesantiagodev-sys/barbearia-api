import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import * as authApi from '../api/auth';
import { setToken } from '../api/client';
import LoginCliente from './LoginCliente';

describe('LoginCliente', () => {
  beforeEach(() => {
    setToken(null);
  });

  test('envia email e senha preenchidos ao submeter o formulário', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 1, tipo: 'cliente', barbearia_id: 1 })) +
      '.assinatura-fake';

    const mockLogin = vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
      token: tokenFalso,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginCliente />
        </AuthProvider>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'cliente@teste.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'senha123');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('cliente@teste.com', 'senha123');
    });
  });

  test('exibe mensagem de erro quando o login falha', async () => {
    vi.spyOn(authApi, 'loginCliente').mockRejectedValue(new Error('Email ou senha inválidos'));

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginCliente />
        </AuthProvider>
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'cliente@teste.com');
    await userEvent.type(screen.getByLabelText(/senha/i), 'senhaErrada');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    await waitFor(() => {
      expect(screen.getByText('Email ou senha inválidos')).toBeInTheDocument();
    });
  });
});
