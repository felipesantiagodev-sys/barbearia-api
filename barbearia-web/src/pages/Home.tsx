import { useAuth } from '../contexts/AuthContext';
import { useTema } from '../contexts/TemaContext';

export default function Home() {
  const { usuario, sair } = useAuth();
  const { cores } = useTema();

  return (
    <div>
      <h1>Olá, {usuario?.nome}</h1>
      <p>Tipo: {usuario?.tipo}</p>
      {cores && (
        <p>
          Cor primária da sua barbearia: <span style={{ color: cores.cor_primaria }}>{cores.cor_primaria}</span>
        </p>
      )}
      <button onClick={sair}>Sair</button>
    </div>
  );
}
