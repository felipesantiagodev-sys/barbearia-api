import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TemaProvider, useTema } from './TemaContext';
import * as temaApi from '../api/tema';

function ComponenteDeTeste() {
  const { cores } = useTema();
  return <span data-testid="cor-primaria">{cores ? cores.cor_primaria : 'sem-tema'}</span>;
}

describe('TemaContext', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('busca o tema da barbearia e aplica as CSS custom properties no documento', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#FF5733',
      cor_fundo: '#FFFFFF',
      cor_secundaria: '#3357FF',
    });

    render(
      <TemaProvider barbeariaId={5}>
        <ComponenteDeTeste />
      </TemaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('cor-primaria').textContent).toBe('#FF5733');
    });

    expect(document.documentElement.style.getPropertyValue('--cor-primaria')).toBe('#FF5733');
    expect(document.documentElement.style.getPropertyValue('--cor-fundo')).toBe('#FFFFFF');
    expect(document.documentElement.style.getPropertyValue('--cor-secundaria')).toBe('#3357FF');
  });

  test('calcula e aplica a cor de texto sobre o fundo automaticamente', async () => {
    vi.spyOn(temaApi, 'buscarTema').mockResolvedValue({
      cor_primaria: '#FF5733',
      cor_fundo: '#000000',
      cor_secundaria: '#3357FF',
    });

    render(
      <TemaProvider barbeariaId={5}>
        <ComponenteDeTeste />
      </TemaProvider>
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--cor-texto-sobre-fundo')).toBe('#FFFFFF');
    });
  });

  test('não quebra se barbeariaId for null (usuário deslogado)', () => {
    render(
      <TemaProvider barbeariaId={null}>
        <ComponenteDeTeste />
      </TemaProvider>
    );

    expect(screen.getByTestId('cor-primaria').textContent).toBe('sem-tema');
  });
});
