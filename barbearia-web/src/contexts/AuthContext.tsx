import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { loginCliente, loginAdmin } from '../api/auth';
import { setToken } from '../api/client';

interface UsuarioAutenticado {
  id: number;
  tipo: 'cliente' | 'admin';
  barbearia_id: number;
  nome: string;
  email: string;
}

interface ContextoAuth {
  usuario: UsuarioAutenticado | null;
  entrarComoCliente(email: string, senha: string): Promise<void>;
  entrarComoAdmin(email: string, senha: string): Promise<void>;
  sair(): void;
  carregando: boolean;
}

const AuthContext = createContext<ContextoAuth | null>(null);

// O JWT tem 3 partes separadas por ".": cabeçalho, payload, assinatura.
// Decodificamos só o payload (base64) para extrair id/tipo/barbearia_id --
// isso NUNCA é usado para decisões de autorização (o backend já validou a
// assinatura antes de aceitar a requisição); é só para saber quem está
// logado e montar a UI/roteamento no cliente.
function decodificarPayloadJwt(token: string): { id: number; tipo: 'cliente' | 'admin'; barbearia_id: number } {
  const [, payloadBase64] = token.split('.');
  return JSON.parse(atob(payloadBase64));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioAutenticado | null>(null);
  const [carregando, setCarregando] = useState(false);

  const entrarComoCliente = useCallback(async (email: string, senha: string) => {
    setCarregando(true);
    try {
      const resposta = await loginCliente(email, senha);
      const payload = decodificarPayloadJwt(resposta.token);
      setToken(resposta.token);
      setUsuario({ ...payload, nome: resposta.nome, email: resposta.email });
    } finally {
      setCarregando(false);
    }
  }, []);

  const entrarComoAdmin = useCallback(async (email: string, senha: string) => {
    setCarregando(true);
    try {
      const resposta = await loginAdmin(email, senha);
      const payload = decodificarPayloadJwt(resposta.token);
      setToken(resposta.token);
      setUsuario({ ...payload, nome: resposta.nome, email: resposta.email });
    } finally {
      setCarregando(false);
    }
  }, []);

  const sair = useCallback(() => {
    setToken(null);
    setUsuario(null);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, entrarComoCliente, entrarComoAdmin, sair, carregando }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): ContextoAuth {
  const contexto = useContext(AuthContext);
  if (!contexto) {
    throw new Error('useAuth precisa ser usado dentro de um AuthProvider');
  }
  return contexto;
}
