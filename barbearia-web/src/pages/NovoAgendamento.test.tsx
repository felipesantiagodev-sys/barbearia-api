import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

  test('preenche os 4 cartões em ordem e cria o agendamento com o cliente_id correto', async () => {
    vi.spyOn(catalogoApi, 'listarUnidades').mockResolvedValue([
      { id: 1, nome: 'Unidade Centro', endereco: null, telefone: null },
    ]);
    const mockListarBarbeiros = vi.spyOn(catalogoApi, 'listarBarbeiros').mockResolvedValue([
      { id: 2, nome: 'Barbeiro Teste', email: null, telefone: null, foto_url: null },
    ]);
    vi.spyOn(catalogoApi, 'listarServicosDoBarbeiro').mockResolvedValue([
      { id: 3, nome: 'Corte', categoria: 'cabelo', duracao_minutos: 30, valor: 50 },
    ]);

    // O carrossel de dias mostra os próximos 7 dias a partir de "hoje", então
    // o horário mockado precisa ser calculado dinamicamente (amanhã às 10h
    // locais), não uma data fixa -- senão o dia pode não aparecer no
    // carrossel e o teste ficaria dependente de quando ele é executado.
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(10, 0, 0, 0);
    const inicioSlot = amanha.toISOString();

    vi.spyOn(agendamentoApi, 'buscarHorariosDisponiveis').mockResolvedValue([
      { inicio: inicioSlot, fim_atendimento: inicioSlot },
    ]);
    const mockCriar = vi.spyOn(agendamentoApi, 'criarAgendamento').mockResolvedValue({
      id: 99,
      cliente_id: 7,
      barbeiro_id: 2,
      unidade_id: 1,
      data_hora_inicio: inicioSlot,
      data_hora_fim: inicioSlot,
      status: 'confirmado',
      itens: [],
      valor_total: 50,
    });

    renderPagina();

    // Cartão 1: filial (abre modal)
    await waitFor(() => expect(screen.getByRole('button', { name: /selecione a filial/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /selecione a filial/i }));
    await waitFor(() => expect(screen.getByText('Unidade Centro')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Unidade Centro'));

    // Cartão 2: profissional (abre modal) -- só habilita depois da filial.
    // Finding 2 da revisão final de branch: listarBarbeiros deve ser chamado
    // com a unidade escolhida no cartão 1.
    await waitFor(() => expect(mockListarBarbeiros).toHaveBeenCalledWith(1));
    await userEvent.click(screen.getByRole('button', { name: /profissional/i, hidden: false }).closest('button')!);
    await waitFor(() => expect(screen.getByText('Barbeiro Teste')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Barbeiro Teste'));

    // Cartão 3: serviços (abre modal) -- só habilita depois do profissional.
    await waitFor(() => expect(screen.getByRole('button', { name: /serviços/i })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: /serviços/i }));
    await waitFor(() => expect(screen.getByText(/Corte/)).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Corte/));
    await userEvent.click(screen.getByRole('button', { name: /confirmar serviços/i }));

    // Cartão 4: horário (abre modal) -- só habilita depois dos serviços.
    // Escolhe o dia correspondente ao slot mockado no carrossel, depois o horário.
    await waitFor(() => expect(screen.getByRole('button', { name: /horário/i })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: /horário/i }));
    const rotuloDia = String(amanha.getDate());
    const modalHorario = screen.getByText(/selecione data e hora/i).closest('div')!;
    await userEvent.click(within(modalHorario).getByText(rotuloDia));

    const rotuloHorario = amanha.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    await waitFor(() => expect(screen.getByText(rotuloHorario)).toBeInTheDocument());
    await userEvent.click(screen.getByText(rotuloHorario));

    // Botão "Agendar" (só habilita com os 4 cartões preenchidos) abre o
    // resumo final, que tem seu próprio botão "Confirmar".
    await waitFor(() => expect(screen.getByRole('button', { name: /^agendar$/i })).not.toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: /^agendar$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));

    // Deriva data/hora_inicio esperados em horário LOCAL a partir do mesmo
    // slot.inicio usado acima -- reproduz o Finding 1 da revisão final: sem
    // essa asserção, um bug de timezone em aoConfirmar passava despercebido.
    const pad = (n: number) => String(n).padStart(2, '0');
    const dataEsperada = `${amanha.getFullYear()}-${pad(amanha.getMonth() + 1)}-${pad(amanha.getDate())}`;
    const horaInicioEsperada = `${pad(amanha.getHours())}:${pad(amanha.getMinutes())}`;

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

  test('cartões de profissional, serviços e horário começam desabilitados', async () => {
    vi.spyOn(catalogoApi, 'listarUnidades').mockResolvedValue([]);

    renderPagina();

    await waitFor(() => expect(screen.getByRole('button', { name: /selecione a filial/i })).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /profissional/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /serviços/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /horário/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^agendar$/i })).toBeDisabled();
  });
});
