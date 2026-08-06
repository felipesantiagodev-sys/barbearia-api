import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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
    <form onSubmit={aoSubmeter}>
      <h1>Entrar</h1>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

      <label htmlFor="senha">Senha</label>
      <input id="senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />

      {erro && <p role="alert">{erro}</p>}

      <button type="submit">Entrar</button>
    </form>
  );
}
