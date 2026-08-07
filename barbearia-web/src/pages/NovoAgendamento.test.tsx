import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import * as authApi from '../api/auth';
import * as catalogoApi from '../api/catalogo';
import * as agendamentoApi from '../api/agendamento';
import { setToken } from '../api/client';
import { useEffect } from 'react';
import NovoAgendamento from './NovoAgendamento';

const TOKEN_CLIENTE_FALSO =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  btoa(JSON.stringify({ id: 7, tipo: 'cliente', barbearia_id: 1 })) +
  '.assinatura-fake';

// Loga automaticamente como cliente assim que o AuthProvider monta, para que
// usuario.id realmente exista no contexto quando NovoAgendamento renderizar
// (mesmo padrão usado em Home.test.tsx) -- sem isso, setToken() sozinho não
// popula o estado `usuario` do AuthContext, e o componente nunca exerceria a
// lógica que depende de usuario.id.
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
          <NovoAgendamento />
        </LoginAutomatico>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('NovoAgendamento', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setToken(null);
  });

  test('percorre os 5 passos e cria o agendamento com o cliente_id correto', async () => {
    vi.spyOn(catalogoApi, 'listarUnidades').mockResolvedValue([
      { id: 1, nome: 'Unidade Centro', endereco: null, telefone: null },
    ]);
    const mockListarBarbeiros = vi.spyOn(catalogoApi, 'listarBarbeiros').mockResolvedValue([
      { id: 2, nome: 'Barbeiro Teste', email: null, telefone: null, foto_url: null },
    ]);
    vi.spyOn(catalogoApi, 'listarServicosDoBarbeiro').mockResolvedValue([
      { id: 3, nome: 'Corte', categoria: 'cabelo', duracao_minutos: 30, valor: 50 },
    ]);
    vi.spyOn(agendamentoApi, 'buscarHorariosDisponiveis').mockResolvedValue([
      { inicio: '2026-08-10T10:00:00.000Z', fim_atendimento: '2026-08-10T10:30:00.000Z' },
    ]);
    const mockCriar = vi.spyOn(agendamentoApi, 'criarAgendamento').mockResolvedValue({
      id: 99,
      cliente_id: 7,
      barbeiro_id: 2,
      unidade_id: 1,
      data_hora_inicio: '2026-08-10T10:00:00.000Z',
      data_hora_fim: '2026-08-10T10:30:00.000Z',
      status: 'confirmado',
      itens: [],
      valor_total: 50,
    });

    renderPagina();

    // Passo 1: unidade
    await waitFor(() => expect(screen.getByText('Unidade Centro')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Unidade Centro'));

    // Passo 2: profissional
    // Finding 2 da revisão final de branch: listarBarbeiros deve ser chamado
    // com a unidade escolhida no passo 1, para listar só os barbeiros dessa
    // unidade (antes, a chamada não recebia nenhum argumento).
    await waitFor(() => expect(screen.getByText('Barbeiro Teste')).toBeInTheDocument());
    expect(mockListarBarbeiros).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByText('Barbeiro Teste'));

    // Passo 3: serviços
    await waitFor(() => expect(screen.getByText(/Corte/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Corte/));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    // Passo 4: horário
    // O rótulo é renderizado via toLocaleString('pt-BR'), que depende do fuso
    // horário do ambiente -- calculamos a mesma string em vez de fixar "10:00"
    // (que só apareceria em UTC) para o teste ser independente de timezone.
    const rotuloHorario = new Date('2026-08-10T10:00:00.000Z').toLocaleString('pt-BR');
    await waitFor(() => expect(screen.getByText(rotuloHorario)).toBeInTheDocument());
    await userEvent.click(screen.getByText(rotuloHorario));

    // Passo 5: confirmação
    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    // Deriva data/hora_inicio esperados em horário LOCAL a partir do mesmo
    // slot.inicio usado acima -- não fixamos "2026-08-10"/"10:00" porque o
    // valor local depende do fuso do ambiente de teste (mesmo raciocínio do
    // rotuloHorario acima). Isso reproduz exatamente o bug do Finding 1: sem
    // essa asserção, um bug de timezone em aoConfirmar (usar toISOString()
    // em vez de horário local) passava despercebido porque o teste só
    // verificava cliente_id/barbeiro_id/unidade_id/servico_ids.
    const inicioEsperado = new Date('2026-08-10T10:00:00.000Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const dataEsperada = `${inicioEsperado.getFullYear()}-${pad(inicioEsperado.getMonth() + 1)}-${pad(inicioEsperado.getDate())}`;
    const horaInicioEsperada = `${pad(inicioEsperado.getHours())}:${pad(inicioEsperado.getMinutes())}`;

    await waitFor(() => {
      expect(mockCriar).toHaveBeenCalledWith(
        expect.objectContaining({
          cliente_id: 7,
          barbeiro_id: 2,
          unidade_id: 1,
          servico_ids: [3],
          data: dataEsperada,
          hora_inicio: horaInicioEsperada,
        })
      );
    });
  });
});
