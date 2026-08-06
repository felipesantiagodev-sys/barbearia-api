import { describe, test, expect } from 'vitest';
import { calcularCorTexto } from './contraste';

describe('calcularCorTexto', () => {
  test('retorna branco para fundo escuro', () => {
    expect(calcularCorTexto('#000000')).toBe('#FFFFFF');
    expect(calcularCorTexto('#1A1A1A')).toBe('#FFFFFF');
  });

  test('retorna preto para fundo claro', () => {
    expect(calcularCorTexto('#FFFFFF')).toBe('#000000');
    expect(calcularCorTexto('#F0F0F0')).toBe('#000000');
  });

  test('funciona com cores saturadas de luminância intermediária', () => {
    expect(calcularCorTexto('#FFFF00')).toBe('#000000');
    expect(calcularCorTexto('#0000FF')).toBe('#FFFFFF');
  });

  test('aceita hex em minúsculas', () => {
    expect(calcularCorTexto('#ffffff')).toBe('#000000');
  });
});
