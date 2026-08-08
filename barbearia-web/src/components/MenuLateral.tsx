import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Marca from './Marca';
import styles from './MenuLateral.module.css';

export default function MenuLateral() {
  const { sair } = useAuth();
  const [aberto, setAberto] = useState(false);

  function fechar() {
    setAberto(false);
  }

  function aoSair() {
    fechar();
    sair();
  }

  return (
    <>
      <header className={styles.cabecalho}>
        <button className={styles.botaoAbrir} onClick={() => setAberto(true)} aria-label="Abrir menu">
          ☰
        </button>
      </header>

      {aberto && (
        <div className={styles.sobreposicao} onClick={fechar}>
          <nav className={styles.menu} onClick={(e) => e.stopPropagation()} aria-label="Navegação principal">
            <div className={styles.menuCabecalho}>
              <Marca />
            </div>

            <Link className={styles.item} to="/" onClick={fechar}>
              Início
            </Link>
            <Link className={styles.item} to="/agendamentos" onClick={fechar}>
              Agendamentos
            </Link>
            <Link className={styles.item} to="/novo-agendamento" onClick={fechar}>
              Novo agendamento
            </Link>
            <Link className={styles.item} to="/plano" onClick={fechar}>
              Plano
            </Link>

            <button className={styles.itemSair} onClick={aoSair}>
              Sair
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
