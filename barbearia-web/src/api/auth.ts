import { apiClient } from './client';

interface RespostaLogin {
  token: string;
  nome: string;
  email: string;
}

export function loginCliente(email: string, senha: string): Promise<RespostaLogin> {
  return apiClient.post<RespostaLogin>('/auth/cliente/login', { email, senha });
}

export function loginAdmin(email: string, senha: string): Promise<RespostaLogin> {
  return apiClient.post<RespostaLogin>('/auth/admin/login', { email, senha });
}
