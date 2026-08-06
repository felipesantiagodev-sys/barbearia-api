import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Marca from '../components/Marca';
import { esqueciSenha } from '../api/senha';
import styles from './Auth.module.css';

export default function RecuperarSenha() {
  const [tipo, setTipo] = useState<'cliente' | 'admin'>('cliente');
  const [email, setEmail] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setMensagem(null);
    try {
      const resposta = await esqueciSenha(tipo, email);
      setMensagem(resposta.mensagem);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao processar solicitação');
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Recuperar senha</p>
        </div>

        <form className={styles.cartao} onSubmit={aoSubmeter}>
          <h1 className={styles.titulo}>Esqueci minha senha</h1>

          <div className={styles.abas}>
            <button
              type="button"
              className={tipo === 'cliente' ? `${styles.aba} ${styles.abaAtiva}` : styles.aba}
              onClick={() => setTipo('cliente')}
              aria-pressed={tipo === 'cliente'}
            >
              Sou cliente
            </button>
            <button
              type="button"
              className={tipo === 'admin' ? `${styles.aba} ${styles.abaAtiva}` : styles.aba}
              onClick={() => setTipo('admin')}
              aria-pressed={tipo === 'admin'}
            >
              Sou administrador
            </button>
          </div>

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

          {erro && (
            <p className={styles.erro} role="alert">
              {erro}
            </p>
          )}

          {mensagem && (
            <p className={styles.status} role="status">
              {mensagem}
            </p>
          )}

          <button className={styles.botao} type="submit">
            Enviar link de recuperação
          </button>
        </form>

        <p className={styles.rodape}>
          Lembrou a senha? <Link to={tipo === 'admin' ? '/admin/login' : '/login'}>Voltar para o login</Link>
        </p>
      </div>
    </div>
  );
}
