import styles from './Marca.module.css';

export default function Marca() {
  return (
    <div>
      <div className={styles.wordmark}>BarberOS</div>
      <div className={styles.tracoAssinatura} aria-hidden="true" />
    </div>
  );
}
