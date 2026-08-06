import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Marca from '../components/Marca';
import { redefinirSenha } from '../api/senha';
import styles from './Auth.module.css';

export default function RedefinirSenha() {
  const [parametros] = useSearchParams();
  const tipo = parametros.get('tipo') === 'admin' ? 'admin' : 'cliente';
  const token = parametros.get('token') ?? '';

  const [senhaNova, setSenhaNova] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setMensagem(null);
    try {
      const resposta = await redefinirSenha(tipo, token, senhaNova);
      setMensagem(resposta.mensagem);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao redefinir senha');
    }
  }

  return (
    <div className={styles.pagina}>
      <div>
        <div className={styles.cabecalho}>
          <Marca />
          <p className={styles.subtitulo}>Redefinir senha</p>
        </div>

        {mensagem ? (
          <div className={styles.cartao}>
            <p className={styles.status} role="status">
              {mensagem}
            </p>
            <p className={styles.rodape}>
              <Link to={tipo === 'admin' ? '/admin/login' : '/login'}>Ir para o login</Link>
            </p>
          </div>
        ) : (
          <form className={styles.cartao} onSubmit={aoSubmeter}>
            <h1 className={styles.titulo}>Defina sua nova senha</h1>

            <div className={styles.campo}>
              <label className={styles.rotulo} htmlFor="senha-nova">
                Nova senha
              </label>
              <input
                className={styles.entrada}
                id="senha-nova"
                type="password"
                value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {erro && (
              <p className={styles.erro} role="alert">
                {erro}
              </p>
            )}

            <button className={styles.botao} type="submit">
              Redefinir senha
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
