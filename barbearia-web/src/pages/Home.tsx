import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';
import { buscarMinhaAssinatura, type Assinatura } from '../api/assinatura';
import { listarMeusAgendamentos, type Agendamento } from '../api/agendamento';
import styles from './Home.module.css';

export default function Home() {
  const { usuario, sair } = useAuth();
  const { cores } = useTema();
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null);
  const [proximosAgendamentos, setProximosAgendamentos] = useState<Agendamento[]>([]);

  useEffect(() => {
    if (usuario?.tipo !== 'cliente') return;

    buscarMinhaAssinatura()
      .then(setAssinatura)
      .catch(() => setAssinatura(null));

    listarMeusAgendamentos('agendados')
      .then(setProximosAgendamentos)
      .catch(() => setProximosAgendamentos([]));
  }, [usuario]);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <h1 className={styles.saudacao}>Olá, {usuario?.nome}</h1>
        <p className={styles.papel}>{usuario?.tipo === 'admin' ? 'Administrador' : 'Cliente'}</p>
      </div>

      {cores && (
        <div className={styles.cardTema}>
          <span className={styles.amostraCor} style={{ backgroundColor: cores.cor_primaria }} />
          <p className={styles.tema}>
            <span className={styles.temaRotulo}>Cor da sua barbearia </span>
            {cores.cor_primaria}
          </p>
        </div>
      )}

      {usuario?.tipo === 'cliente' && (
        <>
          {assinatura && (
            <div className={styles.cardPlano}>
              <p className={styles.planoRotulo}>Seu plano</p>
              <p className={styles.planoNome}>{assinatura.plano.nome}</p>
              <p className={styles.planoValor}>
                R$ {Number(assinatura.plano.valor_mensal).toFixed(2)}/mês
              </p>
            </div>
          )}

          <div className={styles.secaoAgendamentos}>
            <div className={styles.secaoCabecalho}>
              <h2 className={styles.secaoTitulo}>Próximos agendamentos</h2>
              <Link className={styles.linkNovoAgendamento} to="/novo-agendamento">
                Novo agendamento
              </Link>
            </div>

            {proximosAgendamentos.length === 0 ? (
              <p className={styles.semAgendamentos}>Você ainda não tem agendamentos marcados.</p>
            ) : (
              <ul className={styles.listaAgendamentos}>
                {proximosAgendamentos.map((agendamento) => (
                  <li key={agendamento.id} className={styles.itemAgendamento}>
                    {new Date(agendamento.data_hora_inicio).toLocaleString('pt-BR')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <button className={styles.botaoSair} onClick={sair}>
        Sair
      </button>
    </div>
  );
}
