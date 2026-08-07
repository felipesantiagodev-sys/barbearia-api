import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { listarUnidades, listarBarbeiros, listarServicosDoBarbeiro, listarServicos } from './catalogo';
import { setToken } from './client';

describe('api/catalogo', () => {
  beforeEach(() => {
    setToken('token-fake');
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('listarUnidades chama a rota correta', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarUnidades();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/unidades',
      expect.objectContaining({ method: 'GET' })
    );
  });

  // Finding 2 da revisão final de branch: listarBarbeiros precisa aceitar um
  // unidadeId opcional e incluí-lo como query string, para que o wizard de
  // agendamento (NovoAgendamento.tsx) consiga listar só os barbeiros da
  // unidade escolhida no passo 1 -- ver spec em
  // docs/superpowers/specs/2026-08-07-app-cliente-agendamento-design.md.
  test('listarBarbeiros sem unidadeId não adiciona query string (mantém comportamento anterior)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarBarbeiros();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/barbeiros',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('listarBarbeiros com unidadeId inclui unidade_id na query string', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarBarbeiros(3);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/barbeiros?unidade_id=3',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('listarServicosDoBarbeiro chama a rota correta', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarServicosDoBarbeiro(2);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/barbeiros/2/servicos',
      expect.objectContaining({ method: 'GET' })
    );
  });

  test('listarServicos chama a rota correta', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    await listarServicos();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/servicos',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
