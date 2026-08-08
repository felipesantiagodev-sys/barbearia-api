import { apiClient } from './client';

export interface Assinatura {
  id: number;
  status: string;
  data_inicio: string;
  proxima_cobranca: string | null;
  plano: { nome: string; valor_mensal: number; vantagens: string | null };
}

export function buscarMinhaAssinatura(): Promise<Assinatura | null> {
  return apiClient.get<Assinatura | null>('/clientes/me/assinatura');
}
