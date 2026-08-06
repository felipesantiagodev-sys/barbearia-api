// Calcula a luminância relativa de uma cor (fórmula padrão WCAG 2.0:
// https://www.w3.org/TR/WCAG20/#relativeluminancedef) e decide entre preto
// e branco para o texto sobre ela, garantindo contraste mínimo legível
// mesmo quando o usuário escolhe a cor de fundo livremente.
export function calcularCorTexto(corFundoHex: string): '#000000' | '#FFFFFF' {
  const hex = corFundoHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const linearizar = (canal: number) =>
    canal <= 0.03928 ? canal / 12.92 : Math.pow((canal + 0.055) / 1.055, 2.4);

  const luminancia = 0.2126 * linearizar(r) + 0.7152 * linearizar(g) + 0.0722 * linearizar(b);

  // Limiar de 0.5 é uma aproximação padrão e simples: luminâncias acima
  // disso indicam fundo claro (texto escuro fica mais legível), abaixo
  // indicam fundo escuro (texto claro fica mais legível).
  return luminancia > 0.5 ? '#000000' : '#FFFFFF';
}
