import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as senhaApi from '../api/senha';
import RecuperarSenha from './RecuperarSenha';

describe('RecuperarSenha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('envia solicitação para cliente por padrão e mostra mensagem genérica', async () => {
    const mockEsqueciSenha = vi.spyOn(senhaApi, 'esqueciSenha').mockResolvedValue({
      mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.',
    });

    render(
      <MemoryRouter>
        <RecuperarSenha />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText(/email/i), 'cliente@teste.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(mockEsqueciSenha).toHaveBeenCalledWith('cliente', 'cliente@teste.com');
    });
    await waitFor(() => {
      expect(screen.getByText(/você vai receber um link/i)).toBeInTheDocument();
    });
  });

  test('envia solicitação para admin quando a aba administrador é selecionada', async () => {
    const mockEsqueciSenha = vi.spyOn(senhaApi, 'esqueciSenha').mockResolvedValue({
      mensagem: 'Se esse email estiver cadastrado, você vai receber um link de redefinição.',
    });

    render(
      <MemoryRouter>
        <RecuperarSenha />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /sou administrador/i }));
    await userEvent.type(screen.getByLabelText(/email/i), 'admin@teste.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(mockEsqueciSenha).toHaveBeenCalledWith('admin', 'admin@teste.com');
    });
  });
});
