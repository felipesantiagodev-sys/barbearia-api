import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { TemaProvider } from '../contexts/TemaContext';
import * as authApi from '../api/auth';
import * as assinaturaApi from '../api/assinatura';
import * as agendamentoApi from '../api/agendamento';
import * as temaApi from '../api/tema';
import { setToken } from '../api/client';
import { useEffect } from 'react';
import Home from './Home';

const TOKEN_CLIENTE_FALSO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  btoa(JSON.stringify({ id: 1, tipo: 'cliente', barbearia_id: 1 })) +
  '.assinatura-fake';

// Loga automaticamente como cliente assim que o AuthProvider monta, para que
// os testes de Home (que dependem de usuario.tipo === 'cliente') rodem com
// um usuário autenticado, do mesmo jeito que a navegação real funcionaria
// (login em outra tela -> token no contexto -> Home renderizada em seguida).
function LoginAutomatico({ children }: { children: React.ReactNode }) {
  const { usuario, entrarComoCliente } = useAuth();

  useEffect(() => {
    entrarComoCliente('cliente@teste.com', 'senha123');
  }, [entrarComoCliente]);

  if (!usuario) return null;
  return <>{children}</>;
}

function renderHome() {
  vi.spyOn(authApi, 'loginCliente').mockResolvedValue({
    token: TOKEN_CLIENTE_FALSO,
    nome: 'Cliente Teste',
    email: 'cliente@teste.com',
  });

  return render(
    <MemoryRouter>
      <AuthProvider>
        <TemaProvider barbeariaId={1}>
          <LoginAutomatico>
            <Home />
          </LoginAutomatico>
        </TemaProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Home', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setToken(null);
  });

  test('mostra o plano ativo quando o cliente tem assinatura', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue({
      id: 1,
      status: 'ativa',
      data_inicio: '2026-01-01',
      proxima_cobranca: '2026-09-01',
      plano: { nome: 'Plano Premium', valor_mensal: 149.9 },
    });
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Plano Premium')).toBeInTheDocument();
    });
  });

  test('não mostra bloco de plano quando o cliente não tem assinatura', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderHome();

    await waitFor(() => {
      expect(agendamentoApi.listarMeusAgendamentos).toHaveBeenCalled();
    });
    expect(screen.queryByText(/plano/i)).not.toBeInTheDocument();
  });

  test('lista os próximos agendamentos', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([
      {
        id: 1,
        cliente_id: 1,
        barbeiro_id: 2,
        unidade_id: 3,
        data_hora_inicio: '2026-08-10T10:00:00.000Z',
        data_hora_fim: '2026-08-10T10:30:00.000Z',
        status: 'confirmado',
        itens: [],
        valor_total: 50,
      },
    ]);

    renderHome();

    await waitFor(() => {
      expect(agendamentoApi.listarMeusAgendamentos).toHaveBeenCalledWith('agendados');
    });
  });

  test('tem um link para novo agendamento', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#000000',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#6B7280',
    });
    vi.spyOn(assinaturaApi, 'buscarMinhaAssinatura').mockResolvedValue(null);
    vi.spyOn(agendamentoApi, 'listarMeusAgendamentos').mockResolvedValue([]);

    renderHome();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /novo agendamento/i })).toHaveAttribute('href', '/novo-agendamento');
    });
  });
});
