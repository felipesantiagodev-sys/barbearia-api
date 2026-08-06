import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Marca from '../components/Marca';
import styles from './Auth.module.css';

export default function LoginCliente() {
  const { entrarComoCliente } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await entrarComoCliente(email, senha);
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
          <p className={styles.subtitulo}>Gestão para barbearias</p>
        </div>

        <form className={styles.cartao} onSubmit={aoSubmeter}>
          <h1 className={styles.titulo}>Entrar</h1>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="email">
              Email
            </label>
            <input
              className={styles.entrada}
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="senha">
              Senha
            </label>
            <input
              className={styles.entrada}
              id="senha"
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
          É o dono da barbearia? <Link to="/admin/login">Entrar como administrador</Link>
        </p>
      </div>
    </div>
  );
}
