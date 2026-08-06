import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth';
import { setToken } from '../api/client';

function ComponenteDeTeste() {
  const { usuario, entrarComoCliente, sair } = useAuth();
  return (
    <div>
      <span data-testid="usuario">{usuario ? usuario.nome : 'sem-usuario'}</span>
      <button onClick={() => entrarComoCliente('cliente@teste.com', 'senha123')}>Entrar</button>
      <button onClick={sair}>Sair</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    setToken(null);
  });

  test('entrarComoCliente autentica e popula o usuário decodificado do token', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 3 })) +
      '.assinatura-fake';

    vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
      token: tokenFalso,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
    });

    render(
      <AuthProvider>
        <ComponenteDeTeste />
      </AuthProvider>
    );

    expect(screen.getByTestId('usuario').textContent).toBe('sem-usuario');

    await userEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByTestId('usuario').textContent).toBe('Cliente Teste');
    });
  });

  test('sair limpa o usuário e o token', async () => {
    const tokenFalso =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 3 })) +
      '.assinatura-fake';

    vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
      token: tokenFalso,
      nome: 'Cliente Teste',
      email: 'cliente@teste.com',
    });

    render(
      <AuthProvider>
        <ComponenteDeTeste />
      </AuthProvider>
    );

    await userEvent.click(screen.getByText('Entrar'));
    await waitFor(() => expect(screen.getByTestId('usuario').textContent).toBe('Cliente Teste'));

    await userEvent.click(screen.getByText('Sair'));

    await waitFor(() => expect(screen.getByTestId('usuario').textContent).toBe('sem-usuario'));
  });
});
