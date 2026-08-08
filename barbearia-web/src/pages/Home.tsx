import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MenuLateral from '../components/MenuLateral';
import { buscarMinhaAssinatura, type Assinatura } from '../api/assinatura';
import { listarMeusAgendamentos, type Agendamento } from '../api/agendamento';
import styles from './Home.module.css';

export default function Home() {
  const { usuario } = useAuth();
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
      <MenuLateral />
      <div className={styles.cabecalho}>
        <h1 className={styles.saudacao}>Olá, {usuario?.nome}</h1>
        <p className={styles.papel}>{usuario?.tipo === 'admin' ? 'Administrador' : 'Cliente'}</p>
      </div>

      {usuario?.tipo === 'cliente' && (
        <>
          {assinatura && (
            <div className={styles.cartaoPlano}>
              <p className={styles.tituloCartao}>Seu plano</p>
              <p className={styles.textoPlano}>
                Você está aproveitando as vantagens do <strong>{assinatura.plano.nome}</strong>
              </p>
              <Link className={styles.linkDetalhes} to="/plano">
                Detalhes sobre o plano →
              </Link>
            </div>
          )}

          <Link className={styles.banner} to="/plano">
            <span>
              <span className={styles.bannerTitulo}>Conheça nossos planos</span>
              <span className={styles.bannerSubtitulo}>Aproveite vantagens exclusivas</span>
            </span>
            <span aria-hidden="true">→</span>
          </Link>

          <div className={styles.secaoAgendamentos}>
            <div className={styles.secaoCabecalho}>
              <h2 className={styles.secaoTitulo}>Próximos agendamentos</h2>
              <Link className={styles.linkVerTudo} to="/agendamentos">
                Ver tudo
              </Link>
            </div>

            {proximosAgendamentos.length === 0 ? (
              <p className={styles.semAgendamentos}>Você ainda não tem agendamentos marcados.</p>
            ) : (
              <div className={styles.listaAgendamentos}>
                {proximosAgendamentos.map((agendamento) => (
                  <div key={agendamento.id} className={styles.cartaoAgendamento}>
                    <p className={styles.dataAgendamento}>
                      {new Date(agendamento.data_hora_inicio).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    <p className={styles.totalAgendamento}>
                      Total: R$ {Number(agendamento.valor_total).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link className={styles.botaoNovoAgendamento} to="/novo-agendamento">
            + Novo agendamento
          </Link>
        </>
      )}
    </div>
  );
}
