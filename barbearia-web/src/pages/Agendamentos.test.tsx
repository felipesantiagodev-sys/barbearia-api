import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import * as authApi from '../api/auth';
import * as agendamentoApi from '../api/agendamento';
import { setToken } from '../api/client';
import { useEffect } from 'react';
import Agendamentos from './Agendamentos';

const TOKEN_CLIENTE_FALSO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 1 })) +
  '.assinatura-fake';

// Loga automaticamente como cliente assim que o AuthProvider monta, para que
// usuario.id realmente exista no contexto quando Agendamentos renderizar
// (mesmo padrão usado em Home.test.tsx/NovoAgendamento.test.tsx) -- sem isso,
// setToken() sozinho não popula o estado `usuario` do AuthContext, e o
// componente nunca exerceria a lógica que depende de usuario estar logado.
function LoginAutomatico({ children }: { children: React.ReactNode }) {
  const { usuario, entrarComoCliente } = useAuth();

  useEffect(() => {
    entrarComoCliente('cliente@teste.com', 'senha123');
  }, [entrarComoCliente]);

  if (!usuario) return null;
  return <>{children}</>;
}

function renderPagina() {
  vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
    token: TOKEN_CLIENTE_FALSO,
    nome: 'Cliente Teste',
    email: 'cliente@teste.com',
  });

  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginAutomatico>
          <Agendamentos />
        </LoginAutomatico>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Agendamentos', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setToken(null);
  });

  test('mostra a aba Agendados por padrão e lista os agendamentos', async () => {
    const mockListar = vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([
      {
        id: 1,
        cliente_id: 7,
        barbeiro_id: 2,
        unidade_id: 1,
        data_hora_inicio: '2026-08-10T10:00:00.000Z',
        data_hora_fim: '2026-08-10T10:30:00.000Z',
        status: 'confirmado',
        itens: [],
        valor_total: 50,
      },
    ]);

    renderPagina();

    await waitFor(() => {
      expect(mockListar).toHaveBeenCalledWith('agendados');
    });
  });

  test('troca para a aba Anteriores ao clicar', async () => {
    const mockListar = vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderPagina();

    await waitFor(() => expect(mockListar).toHaveBeenCalledWith('agendados'));

    await userEvent.click(screen.getByRole('button', { name: /anteriores/i }));

    await waitFor(() => {
      expect(mockListar).toHaveBeenCalledWith('anteriores');
    });
  });

  test('cancela um agendamento confirmado ao clicar em cancelar', async () => {
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([
      {
        id: 1,
        cliente_id: 7,
        barbeiro_id: 2,
        unidade_id: 1,
        data_hora_inicio: '2026-08-10T10:00:00.000Z',
        data_hora_fim: '2026-08-10T10:30:00.000Z',
        status: 'confirmado',
        itens: [],
        valor_total: 50,
      },
    ]);
    const mockCancelar = vi.spyOn(agendamentoApi, 'cancelarAgendamento').mockResolvedValue({
      id: 1,
      cliente_id: 7,
      barbeiro_id: 2,
      unidade_id: 1,
      data_hora_inicio: '2026-08-10T10:00:00.000Z',
      data_hora_fim: '2026-08-10T10:30:00.000Z',
      status: 'cancelado',
      itens: [],
      valor_total: 50,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPagina();

    await waitFor(() => expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await waitFor(() => {
      expect(mockCancelar).toHaveBeenCalledWith(1);
    });
  });
});
