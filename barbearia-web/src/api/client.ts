const URL_BASE = 'http://localhost:3000';
const CHAVE_TOKEN = 'barbearia_token';

export function getToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(CHAVE_TOKEN, token);
  } else {
    localStorage.removeItem(CHAVE_TOKEN);
  }
}

export class ErroApi extends Error {
  bloqueado: boolean;

  constructor(mensagem: string, bloqueado: boolean) {
    super(mensagem);
    this.name = 'ErroApi';
    this.bloqueado = bloqueado;
  }
}

async function requisicao<T>(
  metodo: 'GET' | 'POST' | 'PUT',
  caminho: string,
  corpo?: unknown
): Promise<T> {
  const token = getToken();
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    cabecalhos.Authorization = `Bearer ${token}`;
  }

  const resposta = await fetch(`${URL_BASE}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const mensagemErro = dados && typeof dados === 'object' && 'erro' in dados
      ? String((dados as { erro: unknown }).erro)
      : `Erro na requisição (${resposta.status})`;
    const bloqueado = Boolean(dados && typeof dados === 'object' && 'bloqueado' in dados && (dados as { bloqueado: unknown }).bloqueado);
    throw new ErroApi(mensagemErro, bloqueado);
  }

  return dados as T;
}

export const apiClient = {
  get: <T>(caminho: string) => requisicao<T>('GET', caminho),
  post: <T>(caminho: string, corpo: unknown) => requisicao<T>('POST', caminho, corpo),
  put: <T>(caminho: string, corpo: unknown) => requisicao<T>('PUT', caminho, corpo),
};
