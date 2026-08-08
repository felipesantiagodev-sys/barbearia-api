import { apiClient } from './client';

export interface CadastroClienteInput {
  nome: string;
  email: string;
  senha: string;
  telefone?: string;
  data_nascimento: string;
}

export interface ClienteCadastrado {
  id: number;
  nome: string;
  email: string;
  telefone: string | null;
  data_nascimento: string;
  criado_em: string;
}

export function cadastrarCliente(barbeariaId: number, dados: CadastroClienteInput): Promise<ClienteCadastrado> {
  return apiClient.post<ClienteCadastrado>(`/barbearias/${barbeariaId}/clientes`, dados);
}
