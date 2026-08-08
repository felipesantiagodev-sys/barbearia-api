import { Link } from 'react-router-dom';
import styles from './BotaoVoltar.module.css';

export default function BotaoVoltar({ para = '/' }: { para?: string }) {
  return (
    <Link className={styles.botaoVoltar} to={para} aria-label="Voltar">
      ← Voltar
    </Link>
  );
}
