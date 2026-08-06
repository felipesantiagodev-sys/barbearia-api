import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';
import styles from './Home.module.css';

export default function Home() {
  const { usuario, sair } = useAuth();
  const { cores } = useTema();

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

      <button className={styles.botaoSair} onClick={sair}>
        Sair
      </button>
    </div>
  );
}
