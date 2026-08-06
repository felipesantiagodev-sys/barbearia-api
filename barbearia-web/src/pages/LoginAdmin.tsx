import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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
    <form onSubmit={aoSubmeter}>
      <h1>Entrar como administrador</h1>
      <label htmlFor="email-admin">Email</label>
      <input id="email-admin" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

      <label htmlFor="senha-admin">Senha</label>
      <input id="senha-admin" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />

      {erro && <p role="alert">{erro}</p>}

      <button type="submit">Entrar</button>
    </form>
  );
}
