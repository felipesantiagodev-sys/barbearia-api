import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listarMeusAgendamentos,
  criarAgendamento,
  cancelarAgendamento,
  buscarHorariosDisponiveis,
  buscarHorariosDisponiveisQualquerBarbeiro,
} from './agendamento';
import { setToken } from './client';

describe('api/agendamento', () => {
  beforeEach(() => {
    setToken('token-fake');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('listarMeusAgendamentos monta a query string de status corretamente', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarMeusAgendamentos('agendados');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/meus?status=agendados',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('listarMeusAgendamentos sem status não adiciona query string', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarMeusAgendamentos();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/meus',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('criarAgendamento envia POST com o corpo correto', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const dados = {
      cliente_id: 1,
      barbeiro_id: 2,
      unidade_id: 3,
      data: '2026-08-10',
      hora_inicio: '10:00',
      servico_ids: [5, 6],
    };

    await criarAgendamento(dados);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(dados) })
    );
  });

  test('cancelarAgendamento envia PATCH para a rota correta', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, status: 'cancelado' }),
    });

    await cancelarAgendamento(1);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/1/cancelar',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  test('buscarHorariosDisponiveis monta a query string correta', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await buscarHorariosDisponiveis(2, '2026-08-10', 30);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/horarios-disponiveis?barbeiro_id=2&data=2026-08-10&duracao_minutos=30',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('buscarHorariosDisponiveisQualquerBarbeiro monta a query string com servico_ids separados por vírgula', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await buscarHorariosDisponiveisQualquerBarbeiro(3, [5, 6], '2026-08-10');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=3&servico_ids=5,6&data=2026-08-10',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
