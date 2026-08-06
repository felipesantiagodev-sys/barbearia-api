import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Marca from '../components/Marca';
import styles from './Auth.module.css';

export default function LoginAdmin() {
  const { entrarComoAdmin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await entrarComoAdmin(email, senha);
      navigate('/');
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao fazer login');
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Painel do administrador</p>
        </div>

        <form className={styles.cartao} onSubmit={aoSubmeter}>
          <h1 className={styles.titulo}>Entrar como administrador</h1>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="email-admin">
              Email
            </label>
            <input
              className={styles.entrada}
              id="email-admin"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="senha-admin">
              Senha
            </label>
            <input
              className={styles.entrada}
              id="senha-admin"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          {erro && (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          )}

          <button className={styles.botao} type="submit">
            Entrar
          </button>
        </form>

        <p className={styles.rodape}>
          É cliente da barbearia? <Link to="/login">Entrar como cliente</Link>
        </p>
      </div>
    </div>
  );
}
