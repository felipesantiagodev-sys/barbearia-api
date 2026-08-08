import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import * as authApi from '../api/auth';
import * as assinaturaApi from '../api/assinatura';
import { setToken } from '../api/client';
import { useEffect } from 'react';
import Plano from './Plano';

const TOKEN_CLIENTE_FALSO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  btoa(JSON.stringify({ id: 1, tipo: 'cliente', barbearia_id: 1 })) +
  '.assinatura-fake';

// MenuLateral (renderizado por Plano) usa useAuth() -- precisa de um login
// real via AuthProvider para não lançar "useAuth precisa ser usado dentro
// de um AuthProvider", mesmo padrão já usado em Home.test.tsx.
function LoginAutomatico({ children }: { children: React.ReactNode }) {
  const { usuario, entrarComoCliente } = useAuth();

  useEffect(() => {
    entrarComoCliente('cliente@teste.com', 'senha123');
  }, [entrarComoCliente]);

  if (!usuario) return null;
  return <>{children}</>;
}

function renderPlano() {
  vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
    token: TOKEN_CLIENTE_FALSO,
    nome: 'Cliente Teste',
    email: 'cliente@teste.com',
  });

  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginAutomatico>
          <Plano />
        </LoginAutomatico>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Plano', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setToken(null);
  });

  test('mostra nome, valor e vantagens do plano ativo', async () => {
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue({
      id: 1,
      status: 'ativa',
      data_inicio: '2026-01-01',
      proxima_cobranca: '2026-09-01',
      plano: { nome: 'EF Club - Combo Ilimitado', valor_mensal: 119.9, vantagens: 'Cortes ilimitados\nBarba grátis' },
    });

    renderPlano();

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

    renderPlano();

    await waitFor(() => {
      expect(screen.getByText(/você ainda não tem um plano ativo/i)).toBeInTheDocument();
    });
  });
});
