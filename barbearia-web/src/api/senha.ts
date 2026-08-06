import { apiClient } from './client';

interface RespostaMensagem {
  mensagem: string;
}

export function esqueciSenha(tipo: 'admin' | 'cliente', email: string): Promise<RespostaMensagem> {
  return apiClient.post<RespostaMensagem>(`/auth/${tipo}/esqueci-senha`, { email });
}

export function redefinirSenha(
  tipo: 'admin' | 'cliente',
  token: string,
  senhaNova: string
): Promise<RespostaMensagem> {
  return apiClient.post<RespostaMensagem>(`/auth/${tipo}/redefinir-senha`, { token, senha_nova: senhaNova });
}
