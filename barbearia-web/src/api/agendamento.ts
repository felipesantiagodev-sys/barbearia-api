import { apiClient } from './client';

export interface ItemAgendamento {
  id: number;
  servico_id: number;
  coberto_pelo_plano: boolean;
  valor_cobrado: number;
}

export interface Agendamento {
  id: number;
  cliente_id: number;
  barbeiro_id: number;
  unidade_id: number;
  data_hora_inicio: string;
  data_hora_fim: string;
  status: string;
  itens: ItemAgendamento[];
  valor_total: number;
}

export interface NovoAgendamentoInput {
  cliente_id: number;
  barbeiro_id: number;
  unidade_id: number;
  data: string;
  hora_inicio: string;
  servico_ids: number[];
}

export interface Slot {
  inicio: string;
  fim_atendimento: string;
}

export interface SlotComBarbeiro extends Slot {
  barbeiro_id: number;
}

export function listarMeusAgendamentos(status?: 'agendados' | 'anteriores'): Promise<Agendamento[]> {
  const query = status ? `?status=${status}` : '';
  return apiClient.get<Agendamento[]>(`/agendamentos/meus${query}`);
}

export function criarAgendamento(dados: NovoAgendamentoInput): Promise<Agendamento> {
  return apiClient.post<Agendamento>('/agendamentos', dados);
}

export function cancelarAgendamento(id: number): Promise<Agendamento> {
  return apiClient.patch<Agendamento>(`/agendamentos/${id}/cancelar`);
}

export function buscarHorariosDisponiveis(
  barbeiroId: number,
  data: string,
  duracaoMinutos: number
): Promise<Slot[]> {
  return apiClient.get<Slot[]>(
    `/agendamentos/horarios-disponiveis?barbeiro_id=${barbeiroId}&data=${data}&duracao_minutos=${duracaoMinutos}`
  );
}

export function buscarHorariosDisponiveisQualquerBarbeiro(
  unidadeId: number,
  servicoIds: number[],
  data: string
): Promise<SlotComBarbeiro[]> {
  return apiClient.get<SlotComBarbeiro[]>(
    `/agendamentos/horarios-disponiveis-qualquer-barbeiro?unidade_id=${unidadeId}&servico_ids=${servicoIds.join(',')}&data=${data}`
  );
}
