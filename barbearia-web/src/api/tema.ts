import { apiClient } from './client';

export interface CoresTema {
  cor_primaria: string;
  cor_fundo: string;
  cor_secundaria: string;
}

export function buscarTema(barbeariaId: number): Promise<CoresTema> {
  return apiClient.get<CoresTema>(`/barbearias/${barbeariaId}/tema`);
}

export function salvarTema(barbeariaId: number, cores: CoresTema): Promise<CoresTema> {
  return apiClient.put<CoresTema>(`/barbearias/${barbeariaId}/tema`, cores);
}
