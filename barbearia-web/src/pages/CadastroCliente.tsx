import { useState, useEffect, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import Marca from '../components/Marca';
import { buscarTema } from '../api/tema';
import { cadastrarCliente } from '../api/cadastro';
import authStyles from './Auth.module.css';
import styles from './CadastroCliente.module.css';

type EstadoBarbearia = 'carregando' | 'valida' | 'invalida';

export default function CadastroCliente() {
  const { barbeariaId } = useParams<{ barbeariaId: string }>();
  const idNumerico = Number(barbeariaId);

  const [estadoBarbearia, setEstadoBarbearia] = useState<EstadoBarbearia>('carregando');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [cadastroConcluido, setCadastroConcluido] = useState(false);

  useEffect(() => {
    buscarTema(idNumerico)
      .then(() => setEstadoBarbearia('valida'))
      .catch(() => setEstadoBarbearia('invalida'));
  }, [idNumerico]);

  async function aoSubmeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      await cadastrarCliente(idNumerico, {
        nome,
        email,
        telefone: telefone || undefined,
        data_nascimento: dataNascimento,
        senha,
      });
      setCadastroConcluido(true);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : 'Erro ao cadastrar');
    }
  }

  if (estadoBarbearia === 'carregando') {
    return (
      <div className={authStyles.pagina}>
        <p className={authStyles.status}>Carregando...</p>
      </div>
    );
  }

  if (estadoBarbearia === 'invalida') {
    return (
      <div className={authStyles.pagina}>
        <div>
          <div className={authStyles.cabecalho}>
            <Marca />
          </div>
          <p className={authStyles.erro} role="alert">
            Link de cadastro inválido ou expirado.
          </p>
        </div>
      </div>
    );
  }

  if (cadastroConcluido) {
    return (
      <div className={authStyles.pagina}>
        <div>
          <div className={authStyles.cabecalho}>
            <Marca />
          </div>
          <div className={authStyles.cartao}>
            <p className={authStyles.status} role="status">
              Conta criada com sucesso!
            </p>
            <div className={styles.linkVoltar}>
              <Link to="/login">Ir para o login</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={authStyles.pagina}>
      <div>
        <div className={authStyles.cabecalho}>
          <Marca />
          <p className={authStyles.subtitulo}>Crie sua conta</p>
        </div>

        <form className={authStyles.cartao} onSubmit={aoSubmeter}>
          <h1 className={authStyles.titulo}>Cadastro</h1>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="nome">
              Nome completo
            </label>
            <input
              className={authStyles.entrada}
              id="nome"
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="email">
              Email
            </label>
            <input
              className={authStyles.entrada}
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="telefone">
              Telefone
            </label>
            <input
              className={authStyles.entrada}
              id="telefone"
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="data-nascimento">
              Data de nascimento
            </label>
            <input
              className={authStyles.entrada}
              id="data-nascimento"
              type="date"
              value={dataNascimento}
              onChange={(e) => setDataNascimento(e.target.value)}
              required
            />
          </div>

          <div className={authStyles.campo}>
            <label className={authStyles.rotulo} htmlFor="senha">
              Senha
            </label>
            <input
              className={authStyles.entrada}
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          {erro && (
            <p className={authStyles.erro} role="alert">
              {erro}
            </p>
          )}

          <button className={authStyles.botao} type="submit">
            Cadastrar
          </button>
        </form>

        <p className={authStyles.rodape}>
          Já tem uma conta? <Link to="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
