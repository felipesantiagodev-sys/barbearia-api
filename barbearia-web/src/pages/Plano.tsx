import { useEffect, useState } from 'react';
import MenuLateral from '../components/MenuLateral';
import BotaoVoltar from '../components/BotaoVoltar';
import { buscarMinhaAssinatura, type Assinatura } from '../api/assinatura';
import styles from './Plano.module.css';

export default function Plano() {
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [mostrarVantagens, setMostrarVantagens] = useState(false);

  useEffect(() => {
    buscarMinhaAssinatura()
      .then(setAssinatura)
      .catch(() => setAssinatura(null))
      .finally(() => setCarregado(true));
  }, []);

  return (
    <div className={styles.pagina}>
      <MenuLateral acaoSecundaria={<BotaoVoltar />} />
      <h1 className={styles.titulo}>Plano</h1>

      {!carregado && <p className={styles.semPlano}>Carregando...</p>}

      {carregado && !assinatura && (
        <p className={styles.semPlano}>Você ainda não tem um plano ativo.</p>
      )}

      {assinatura && (
        <div className={styles.cartao}>
          <h2 className={styles.nomePlano}>{assinatura.plano.nome}</h2>

          <p className={styles.vigencia}>
            Tempo de vigência: <strong>Indeterminado</strong>
          </p>

          <p className={styles.valor}>
            R$ {Number(assinatura.plano.valor_mensal).toFixed(2)}
            <span className={styles.valorPeriodo}> Por mês</span>
          </p>

          {assinatura.plano.vantagens && (
            <div className={styles.secaoVantagens}>
              <button className={styles.linkVantagens} onClick={() => setMostrarVantagens((atual) => !atual)}>
                Confira as vantagens {mostrarVantagens ? '↓' : '→'}
              </button>
              {mostrarVantagens && (
                <ul className={styles.listaVantagens}>
                  {assinatura.plano.vantagens.split('\n').filter(Boolean).map((linha) => (
                    <li key={linha}>{linha}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
