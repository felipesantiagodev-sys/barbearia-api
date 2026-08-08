import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as assinaturaApi from '../api/assinatura';
import Plano from './Plano';

describe('Plano', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('mostra nome, valor e vantagens do plano ativo', async () => {
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue({
      id: 1,
      status: 'ativa',
      data_inicio: '2026-01-01',
      proxima_cobranca: '2026-09-01',
      plano: { nome: 'EF Club - Combo Ilimitado', valor_mensal: 119.9, vantagens: 'Cortes ilimitados\nBarba grátis' },
    });

    render(
      <MemoryRouter>
        <Plano />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('EF Club - Combo Ilimitado')).toBeInTheDocument();
    });
    expect(screen.getByText(/119\.90/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /confira as vantagens/i }));

    expect(screen.getByText('Cortes ilimitados')).toBeInTheDocument();
    expect(screen.getByText('Barba grátis')).toBeInTheDocument();
  });

  test('mostra mensagem quando não há plano ativo', async () => {
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);

    render(
      <MemoryRouter>
        <Plano />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/você ainda não tem um plano ativo/i)).toBeInTheDocument();
    });
  });
});
