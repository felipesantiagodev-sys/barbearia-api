import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as senhaApi from '../api/senha';
import RedefinirSenha from './RedefinirSenha';

function renderComQuery(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/redefinir-senha${query}`]}>
      <Routes>
        <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RedefinirSenha', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('envia token e tipo lidos da URL ao redefinir', async () => {
    const mockRedefinir = vi.spyOn(senhaApi, 'redefinirSenha').mockResolvedValue({
      mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.',
    });

    renderComQuery('?tipo=admin&token=abc-123');

    await userEvent.type(screen.getByLabelText(/nova senha/i), 'minhaNovaSenha123');
    await userEvent.click(screen.getByRole('button', { name: /redefinir/i }));

    await waitFor(() => {
      expect(mockRedefinir).toHaveBeenCalledWith('admin', 'abc-123', 'minhaNovaSenha123');
    });
    await waitFor(() => {
      expect(screen.getByText(/senha redefinida com sucesso/i)).toBeInTheDocument();
    });
  });

  test('mostra erro quando o token é inválido ou expirado', async () => {
    vi.spyOn(senhaApi, 'redefinirSenha').mockRejectedValue(new Error('Token inválido ou expirado'));

    renderComQuery('?tipo=cliente&token=expirado-999');

    await userEvent.type(screen.getByLabelText(/nova senha/i), 'minhaNovaSenha123');
    await userEvent.click(screen.getByRole('button', { name: /redefinir/i }));

    await waitFor(() => {
      expect(screen.getByText('Token inválido ou expirado')).toBeInTheDocument();
    });
  });
});
