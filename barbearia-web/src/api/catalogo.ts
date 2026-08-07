import { apiClient } from './client';

export interface Unidade {
  id: number;
  nome: string;
  endereco: string | null;
  telefone: string | null;
}

export interface Barbeiro {
  id: number;
  nome: string;
  email: string | null;
  telefone: string | null;
  foto_url: string | null;
  unidade_id?: number;
}

export interface Servico {
  id: number;
  nome: string;
  categoria: string;
  duracao_minutos: number;
  valor: number;
}

export function listarUnidades(): Promise<Unidade[]> {
  return apiClient.get<Unidade[]>('/unidades');
}

export function listarBarbeiros(unidadeId?: number): Promise<Barbeiro[]> {
  const query = unidadeId !== undefined ? `?unidade_id=${unidadeId}` : '';
  return apiClient.get<Barbeiro[]>(`/barbeiros${query}`);
}

export function listarServicosDoBarbeiro(barbeiroId: number): Promise<Servico[]> {
  return apiClient.get<Servico[]>(`/barbeiros/${barbeiroId}/servicos`);
}

export function listarServicos(): Promise<Servico[]> {
  return apiClient.get<Servico[]>('/servicos');
}
