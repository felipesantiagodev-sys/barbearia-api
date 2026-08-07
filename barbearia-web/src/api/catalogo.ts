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

export function listarBarbeiros(): Promise<Barbeiro[]> {
  return apiClient.get<Barbeiro[]>('/barbeiros');
}

export function listarServicosDoBarbeiro(barbeiroId: number): Promise<Servico[]> {
  return apiClient.get<Servico[]>(`/barbeiros/${barbeiroId}/servicos`);
}

export function listarServicos(): Promise<Servico[]> {
  return apiClient.get<Servico[]>('/servicos');
}
