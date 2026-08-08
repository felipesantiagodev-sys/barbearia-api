import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MenuLateral from '../components/MenuLateral';
import { listarUnidades, listarBarbeiros, listarServicosDoBarbeiro, listarServicos, type Unidade, type Barbeiro, type Servico } from '../api/catalogo';
import {
  buscarHorariosDisponiveis,
  buscarHorariosDisponiveisQualquerBarbeiro,
  criarAgendamento,
  type Slot,
  type SlotComBarbeiro,
} from '../api/agendamento';
import styles from './NovoAgendamento.module.css';

type Modal = 'unidade' | 'profissional' | 'servicos' | 'horario' | 'resumo' | null;

const SEM_PREFERENCIA_ID = -1;
const DIAS_SEMANA_ABREVIADOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const QUANTIDADE_DIAS_CARROSSEL = 7;

function gerarProximosDias(): Date[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Array.from({ length: QUANTIDADE_DIAS_CARROSSEL }, (_, indice) => {
    const dia = new Date(hoje);
    dia.setDate(hoje.getDate() + indice);
    return dia;
  });
}

function formatarDataLocal(data: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${pad(data.getMonth() + 1)}-${pad(data.getDate())}`;
}

export default function NovoAgendamento() {
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const [modalAberto, setModalAberto] = useState<Modal>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [unidadeId, setUnidadeId] = useState<number | null>(null);
  const [unidadeNome, setUnidadeNome] = useState<string | null>(null);

  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [barbeiroId, setBarbeiroId] = useState<number | null>(null);
  const [barbeiroNome, setBarbeiroNome] = useState<string | null>(null);

  const [servicosDisponiveis, setServicosDisponiveis] = useState<Servico[]>([]);
  const [servicoIdsSelecionados, setServicoIdsSelecionados] = useState<number[]>([]);

  const [diasComHorarios] = useState<Date[]>(gerarProximosDias());
  const [diaEscolhido, setDiaEscolhido] = useState<Date | null>(null);
  const [horarios, setHorarios] = useState<(Slot | SlotComBarbeiro)[]>([]);
  const [carregandoHorarios, setCarregandoHorarios] = useState(false);
  const [horarioEscolhido, setHorarioEscolhido] = useState<Slot | SlotComBarbeiro | null>(null);

  useEffect(() => {
    listarUnidades().then(setUnidades).catch(() => setErro('Erro ao carregar unidades'));
  }, []);

  function abrirModalUnidade() {
    setModalAberto('unidade');
  }

  function aoEscolherUnidade(unidade: Unidade) {
    setUnidadeId(unidade.id);
    setUnidadeNome(unidade.nome);
    setBarbeiroId(null);
    setBarbeiroNome(null);
    setServicoIdsSelecionados([]);
    setHorarioEscolhido(null);
    setModalAberto(null);
    listarBarbeiros(unidade.id).then(setBarbeiros).catch(() => setErro('Erro ao carregar profissionais'));
  }

  function abrirModalProfissional() {
    if (!unidadeId) return;
    setModalAberto('profissional');
  }

  function aoEscolherProfissional(id: number, nome: string) {
    setBarbeiroId(id);
    setBarbeiroNome(nome);
    setServicoIdsSelecionados([]);
    setHorarioEscolhido(null);
    setModalAberto(null);
    if (id === SEM_PREFERENCIA_ID) {
      listarServicos().then(setServicosDisponiveis).catch(() => setErro('Erro ao carregar serviços'));
    } else {
      listarServicosDoBarbeiro(id).then(setServicosDisponiveis).catch(() => setErro('Erro ao carregar serviços'));
    }
  }

  function abrirModalServicos() {
    if (!barbeiroId && barbeiroId !== SEM_PREFERENCIA_ID) return;
    setModalAberto('servicos');
  }

  function alternarServico(id: number) {
    setServicoIdsSelecionados((atual) =>
      atual.includes(id) ? atual.filter((s) => s !== id) : [...atual, id]
    );
  }

  function confirmarServicos() {
    setHorarioEscolhido(null);
    setModalAberto(null);
  }

  async function abrirModalHorario() {
    if (servicoIdsSelecionados.length === 0) return;
    setModalAberto('horario');
    setDiaEscolhido(null);
    setHorarios([]);
  }

  async function aoEscolherDia(dia: Date) {
    if (!unidadeId) return;
    setDiaEscolhido(dia);
    setCarregandoHorarios(true);
    const dataFormatada = formatarDataLocal(dia);
    const duracaoTotal = servicosDisponiveis
      .filter((s) => servicoIdsSelecionados.includes(s.id))
      .reduce((soma, s) => soma + s.duracao_minutos, 0);

    try {
      if (barbeiroId === SEM_PREFERENCIA_ID) {
        const slots = await buscarHorariosDisponiveisQualquerBarbeiro(unidadeId, servicoIdsSelecionados, dataFormatada);
        setHorarios(slots);
      } else if (barbeiroId) {
        const slots = await buscarHorariosDisponiveis(barbeiroId, dataFormatada, duracaoTotal);
        setHorarios(slots);
      }
    } catch {
      setErro('Erro ao buscar horários disponíveis');
    } finally {
      setCarregandoHorarios(false);
    }
  }

  function aoEscolherHorario(slot: Slot | SlotComBarbeiro) {
    setHorarioEscolhido(slot);
    setModalAberto(null);
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
    const dataHora = new Date(horarioEscolhido.inicio);
    const data = formatarDataLocal(dataHora);
    const pad = (n: number) => String(n).padStart(2, '0');
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

  const nomesServicosSelecionados = servicosDisponiveis
    .filter((s) => servicoIdsSelecionados.includes(s.id))
    .map((s) => s.nome);

  const valorTotal = servicosDisponiveis
    .filter((s) => servicoIdsSelecionados.includes(s.id))
    .reduce((soma, s) => soma + Number(s.valor), 0);

  const podeAbrirProfissional = unidadeId !== null;
  const podeAbrirServicos = barbeiroId !== null;
  const podeAbrirHorario = servicoIdsSelecionados.length > 0;
  const prontoParaAgendar = unidadeId !== null && barbeiroId !== null && servicoIdsSelecionados.length > 0 && horarioEscolhido !== null;

  return (
    <div className={styles.pagina}>
      <MenuLateral />
      <h1 className={styles.titulo}>Novo agendamento</h1>

      {erro && <p className={styles.erro}>{erro}</p>}

      <div className={styles.cartoes}>
        <button className={styles.cartaoEtapa} onClick={abrirModalUnidade}>
          <span className={styles.iconeEtapa}>🏠</span>
          <span className={styles.textoEtapa}>
            <span className={styles.rotuloEtapa}>Filial</span>
            <span className={unidadeNome ? styles.valorEtapa : `${styles.valorEtapa} ${styles.valorEtapaVazio}`}>
              {unidadeNome ?? 'Selecione a filial'}
            </span>
          </span>
        </button>

        <button className={styles.cartaoEtapa} onClick={abrirModalProfissional} disabled={!podeAbrirProfissional}>
          <span className={styles.iconeEtapa}>👤</span>
          <span className={styles.textoEtapa}>
            <span className={styles.rotuloEtapa}>Profissional</span>
            <span className={barbeiroNome ? styles.valorEtapa : `${styles.valorEtapa} ${styles.valorEtapaVazio}`}>
              {barbeiroNome ?? 'Selecione um profissional'}
            </span>
          </span>
        </button>

        <button className={styles.cartaoEtapa} onClick={abrirModalServicos} disabled={!podeAbrirServicos}>
          <span className={styles.iconeEtapa}>✂️</span>
          <span className={styles.textoEtapa}>
            <span className={styles.rotuloEtapa}>Serviços</span>
            <span
              className={
                nomesServicosSelecionados.length > 0 ? styles.valorEtapa : `${styles.valorEtapa} ${styles.valorEtapaVazio}`
              }
            >
              {nomesServicosSelecionados.length > 0 ? nomesServicosSelecionados.join(', ') : 'Selecione os serviços'}
            </span>
          </span>
        </button>

        <button className={styles.cartaoEtapa} onClick={abrirModalHorario} disabled={!podeAbrirHorario}>
          <span className={styles.iconeEtapa}>🗓️</span>
          <span className={styles.textoEtapa}>
            <span className={styles.rotuloEtapa}>Horário</span>
            <span
              className={horarioEscolhido ? styles.valorEtapa : `${styles.valorEtapa} ${styles.valorEtapaVazio}`}
            >
              {horarioEscolhido ? new Date(horarioEscolhido.inicio).toLocaleString('pt-BR') : 'Selecione um horário'}
            </span>
          </span>
        </button>
      </div>

      <button
        className={styles.botao}
        disabled={!prontoParaAgendar}
        onClick={() => setModalAberto('resumo')}
      >
        Agendar
      </button>

      {modalAberto === 'unidade' && (
        <div className={styles.sobreposicao} onClick={() => setModalAberto(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitulo}>Selecione a filial</h2>
            <div className={styles.lista}>
              {unidades.map((unidade) => (
                <button key={unidade.id} className={styles.opcao} onClick={() => aoEscolherUnidade(unidade)}>
                  {unidade.nome}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalAberto === 'profissional' && (
        <div className={styles.sobreposicao} onClick={() => setModalAberto(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitulo}>Selecione o profissional</h2>
            <div className={styles.gridProfissionais}>
              {barbeiros.map((barbeiro) => (
                <button
                  key={barbeiro.id}
                  className={styles.cartaoProfissional}
                  onClick={() => aoEscolherProfissional(barbeiro.id, barbeiro.nome)}
                >
                  {barbeiro.foto_url ? (
                    <img
                      src={barbeiro.foto_url}
                      alt={barbeiro.nome}
                      className={
                        barbeiroId === barbeiro.id
                          ? `${styles.fotoProfissional} ${styles.fotoProfissionalSelecionada}`
                          : styles.fotoProfissional
                      }
                    />
                  ) : (
                    <span
                      className={
                        barbeiroId === barbeiro.id
                          ? `${styles.avatarGenerico} ${styles.avatarGenericoSelecionado}`
                          : styles.avatarGenerico
                      }
                      aria-hidden="true"
                    >
                      👤
                    </span>
                  )}
                  <span className={styles.nomeProfissional}>{barbeiro.nome}</span>
                </button>
              ))}

              <button
                className={styles.cartaoProfissional}
                onClick={() => aoEscolherProfissional(SEM_PREFERENCIA_ID, 'Sem preferência')}
              >
                <span
                  className={
                    barbeiroId === SEM_PREFERENCIA_ID
                      ? `${styles.avatarGenerico} ${styles.avatarGenericoSelecionado}`
                      : styles.avatarGenerico
                  }
                  aria-hidden="true"
                >
                  👤
                </span>
                <span className={styles.nomeProfissional}>Sem preferência</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {modalAberto === 'servicos' && (
        <div className={styles.sobreposicao} onClick={() => setModalAberto(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitulo}>Selecione os serviços</h2>
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
            <p className={styles.resumoValor}>Total: R$ {valorTotal.toFixed(2)}</p>
            <button className={styles.botao} onClick={confirmarServicos} disabled={servicoIdsSelecionados.length === 0}>
              Confirmar serviços
            </button>
          </div>
        </div>
      )}

      {modalAberto === 'horario' && (
        <div className={styles.sobreposicao} onClick={() => setModalAberto(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitulo}>Selecione data e hora</h2>

            <div className={styles.carrosselDias}>
              {diasComHorarios.map((dia) => (
                <button
                  key={dia.toISOString()}
                  className={
                    diaEscolhido && formatarDataLocal(diaEscolhido) === formatarDataLocal(dia)
                      ? `${styles.diaCartao} ${styles.diaCartaoSelecionado}`
                      : styles.diaCartao
                  }
                  onClick={() => aoEscolherDia(dia)}
                >
                  <span className={styles.diaSemana}>{DIAS_SEMANA_ABREVIADOS[dia.getDay()]}</span>
                  <span className={styles.diaNumero}>{dia.getDate()}</span>
                </button>
              ))}
            </div>

            {diaEscolhido && !carregandoHorarios && horarios.length === 0 && (
              <p className={styles.semHorarios}>Nenhum horário disponível neste dia.</p>
            )}

            {horarios.length > 0 && (
              <div className={styles.gridHorarios}>
                {horarios.map((slot) => (
                  <button key={slot.inicio} className={styles.horarioCartao} onClick={() => aoEscolherHorario(slot)}>
                    {new Date(slot.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {modalAberto === 'resumo' && horarioEscolhido && (
        <div className={styles.sobreposicao} onClick={() => setModalAberto(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitulo}>Confirme seu agendamento</h2>
            <div className={styles.resumo}>
              <div className={styles.resumoLinha}>
                <span>Filial</span>
                <span>{unidadeNome}</span>
              </div>
              <div className={styles.resumoLinha}>
                <span>Profissional</span>
                <span>{barbeiroNome}</span>
              </div>
              <div className={styles.resumoLinha}>
                <span>Data e hora</span>
                <span>{new Date(horarioEscolhido.inicio).toLocaleString('pt-BR')}</span>
              </div>
              <div className={styles.resumoLinha}>
                <span>Serviços</span>
                <span>{nomesServicosSelecionados.join(', ')}</span>
              </div>
              <div className={styles.resumoLinha}>
                <span>Total</span>
                <span>R$ {valorTotal.toFixed(2)}</span>
              </div>
            </div>
            <button className={styles.botao} onClick={aoConfirmar}>
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
