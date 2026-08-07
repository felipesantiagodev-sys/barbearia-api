import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { listarUnidades, listarBarbeiros, listarServicosDoBarbeiro, listarServicos, type Unidade, type Barbeiro, type Servico } from '../api/catalogo';
import {
  buscarHorariosDisponiveis,
  buscarHorariosDisponiveisQualquerBarbeiro,
  criarAgendamento,
  type Slot,
  type SlotComBarbeiro,
} from '../api/agendamento';
import styles from './NovoAgendamento.module.css';

type Passo = 'unidade' | 'profissional' | 'servicos' | 'horario' | 'confirmacao';

const SEM_PREFERENCIA_ID = -1;

export default function NovoAgendamento() {
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const [passo, setPasso] = useState<Passo>('unidade');
  const [erro, setErro] = useState<string | null>(null);

  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [unidadeId, setUnidadeId] = useState<number | null>(null);

  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [barbeiroId, setBarbeiroId] = useState<number | null>(null);

  const [servicosDisponiveis, setServicosDisponiveis] = useState<Servico[]>([]);
  const [servicoIdsSelecionados, setServicoIdsSelecionados] = useState<number[]>([]);

  const [horarios, setHorarios] = useState<(Slot | SlotComBarbeiro)[]>([]);
  const [horarioEscolhido, setHorarioEscolhido] = useState<Slot | SlotComBarbeiro | null>(null);

  useEffect(() => {
    listarUnidades().then(setUnidades).catch(() => setErro('Erro ao carregar unidades'));
  }, []);

  function aoEscolherUnidade(id: number) {
    setUnidadeId(id);
    setPasso('profissional');
    listarBarbeiros(id).then(setBarbeiros).catch(() => setErro('Erro ao carregar profissionais'));
  }

  function aoEscolherProfissional(id: number) {
    setBarbeiroId(id);
    setPasso('servicos');
    if (id === SEM_PREFERENCIA_ID) {
      listarServicos().then(setServicosDisponiveis).catch(() => setErro('Erro ao carregar serviços'));
    } else {
      listarServicosDoBarbeiro(id).then(setServicosDisponiveis).catch(() => setErro('Erro ao carregar serviços'));
    }
  }

  function alternarServico(id: number) {
    setServicoIdsSelecionados((atual) =>
      atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id]
    );
  }

  async function aoContinuarServicos() {
    if (!unidadeId || servicoIdsSelecionados.length === 0) return;
    setPasso('horario');
    const hoje = new Date().toISOString().slice(0, 10);
    const duracaoTotal = servicosDisponiveis
      .filter((s) => servicoIdsSelecionados.includes(s.id))
      .reduce((soma, s) => soma + s.duracao_minutos, 0);

    try {
      if (barbeiroId === SEM_PREFERENCIA_ID) {
        const slots = await buscarHorariosDisponiveisQualquerBarbeiro(unidadeId, servicoIdsSelecionados, hoje);
        setHorarios(slots);
      } else if (barbeiroId) {
        const slots = await buscarHorariosDisponiveis(barbeiroId, hoje, duracaoTotal);
        setHorarios(slots);
      }
    } catch {
      setErro('Erro ao buscar horários disponíveis');
    }
  }

  function aoEscolherHorario(slot: Slot | SlotComBarbeiro) {
    setHorarioEscolhido(slot);
    setPasso('confirmacao');
  }

  async function aoConfirmar() {
    if (!usuario || !unidadeId || !horarioEscolhido) return;

    const barbeiroFinal = 'barbeiro_id' in horarioEscolhido ? horarioEscolhido.barbeiro_id : barbeiroId;
    if (!barbeiroFinal) return;

    // Usa horário LOCAL (não UTC) para bater com `combinarDataHora` no
    // backend (src/utils/agenda.js), que faz `new Date(`${data}T${hora}`)`
    // sem sufixo de timezone -- o Node interpreta isso como horário local do
    // servidor. Usar toISOString() aqui (UTC) causava um desvio de fuso: em
    // servidor UTC-3, um slot exibido como "08:00" era salvo como "11:00".
    const pad = (n: number) => String(n).padStart(2, '0');
    const dataHora = new Date(horarioEscolhido.inicio);
    const data = `${dataHora.getFullYear()}-${pad(dataHora.getMonth() + 1)}-${pad(dataHora.getDate())}`;
    const horaInicio = `${pad(dataHora.getHours())}:${pad(dataHora.getMinutes())}`;

    try {
      await criarAgendamento({
        cliente_id: usuario.id,
        barbeiro_id: barbeiroFinal,
        unidade_id: unidadeId,
        data,
        hora_inicio: horaInicio,
        servico_ids: servicoIdsSelecionados,
      });
      navigate('/');
    } catch {
      setErro('Erro ao confirmar agendamento');
    }
  }

  const valorTotal = servicosDisponiveis
    .filter((s) => servicoIdsSelecionados.includes(s.id))
    .reduce((soma, s) => soma + Number(s.valor), 0);

  return (
    <div className={styles.pagina}>
      {erro && <p className={styles.erro}>{erro}</p>}

      {passo === 'unidade' && (
        <>
          <h1 className={styles.titulo}>Escolha a unidade</h1>
          <div className={styles.lista}>
            {unidades.map((unidade) => (
              <button key={unidade.id} className={styles.opcao} onClick={() => aoEscolherUnidade(unidade.id)}>
                {unidade.nome}
              </button>
            ))}
          </div>
        </>
      )}

      {passo === 'profissional' && (
        <>
          <h1 className={styles.titulo}>Escolha o profissional</h1>
          <div className={styles.lista}>
            <button className={styles.opcao} onClick={() => aoEscolherProfissional(SEM_PREFERENCIA_ID)}>
              Sem preferência
            </button>
            {barbeiros.map((barbeiro) => (
              <button key={barbeiro.id} className={styles.opcao} onClick={() => aoEscolherProfissional(barbeiro.id)}>
                {barbeiro.nome}
              </button>
            ))}
          </div>
        </>
      )}

      {passo === 'servicos' && (
        <>
          <h1 className={styles.titulo}>Escolha os serviços</h1>
          <div className={styles.lista}>
            {servicosDisponiveis.map((servico) => (
              <button
                key={servico.id}
                className={
                  servicoIdsSelecionados.includes(servico.id)
                    ? `${styles.opcao} ${styles.opcaoSelecionada}`
                    : styles.opcao
                }
                onClick={() => alternarServico(servico.id)}
              >
                {servico.nome} — R$ {Number(servico.valor).toFixed(2)}
              </button>
            ))}
          </div>
          <button className={styles.botao} onClick={aoContinuarServicos} disabled={servicoIdsSelecionados.length === 0}>
            Continuar
          </button>
        </>
      )}

      {passo === 'horario' && (
        <>
          <h1 className={styles.titulo}>Escolha o horário</h1>
          <div className={styles.lista}>
            {horarios.map((slot) => (
              <button key={slot.inicio} className={styles.opcao} onClick={() => aoEscolherHorario(slot)}>
                {new Date(slot.inicio).toLocaleString('pt-BR')}
              </button>
            ))}
          </div>
        </>
      )}

      {passo === 'confirmacao' && horarioEscolhido && (
        <>
          <h1 className={styles.titulo}>Confirme seu agendamento</h1>
          <div className={styles.resumo}>
            <div className={styles.resumoLinha}>
              <span>Data e hora</span>
              <span>{new Date(horarioEscolhido.inicio).toLocaleString('pt-BR')}</span>
            </div>
            <div className={styles.resumoLinha}>
              <span>Serviços</span>
              <span>{servicosDisponiveis.filter((s) => servicoIdsSelecionados.includes(s.id)).map((s) => s.nome).join(', ')}</span>
            </div>
            <div className={styles.resumoLinha}>
              <span>Total</span>
              <span>R$ {valorTotal.toFixed(2)}</span>
            </div>
          </div>
          <button className={styles.botao} onClick={aoConfirmar}>
            Confirmar
          </button>
        </>
      )}
    </div>
  );
}
