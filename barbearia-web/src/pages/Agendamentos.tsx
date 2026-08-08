import { useState, useEffect, useCallback } from 'react';
import MenuLateral from '../components/MenuLateral';
import { listarMeusAgendamentos, cancelarAgendamento, type Agendamento } from '../api/agendamento';
import styles from './Agendamentos.module.css';

type Aba = 'agendados' | 'anteriores';

export default function Agendamentos() {
  const [aba, setAba] = useState<Aba>('agendados');
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);

  const carregar = useCallback((abaAtual: Aba) => {
    listarMeusAgendamentos(abaAtual)
      .then(setAgendamentos)
      .catch(() => setAgendamentos([]));
  }, []);

  useEffect(() => {
    carregar(aba);
  }, [aba, carregar]);

  async function aoCancelar(id: number) {
    if (!window.confirm('Tem certeza que deseja cancelar este agendamento?')) return;
    await cancelarAgendamento(id);
    carregar(aba);
  }

  return (
    <div className={styles.pagina}>
      <MenuLateral />
      <h1 className={styles.titulo}>Agendamentos</h1>

      <div className={styles.abas}>
        <button
          className={aba === 'agendados' ? `${styles.aba} ${styles.abaAtiva}` : styles.aba}
          onClick={() => setAba('agendados')}
        >
          Agendados
        </button>
        <button
          className={aba === 'anteriores' ? `${styles.aba} ${styles.abaAtiva}` : styles.aba}
          onClick={() => setAba('anteriores')}
        >
          Anteriores
        </button>
      </div>

      {agendamentos.length === 0 ? (
        <p className={styles.vazio}>Nenhum agendamento nesta aba.</p>
      ) : (
        <div className={styles.lista}>
          {agendamentos.map((agendamento) => (
            <div key={agendamento.id} className={styles.card}>
              <p className={styles.data}>{new Date(agendamento.data_hora_inicio).toLocaleString('pt-BR')}</p>
              <p className={styles.status}>{agendamento.status}</p>
              {agendamento.status === 'confirmado' && (
                <button className={styles.botaoCancelar} onClick={() => aoCancelar(agendamento.id)}>
                  Cancelar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
