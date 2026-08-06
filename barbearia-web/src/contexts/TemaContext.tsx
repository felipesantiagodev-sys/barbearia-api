import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { buscarTema, type CoresTema } from '../api/tema';
import { calcularCorTexto } from '../utils/contraste';

interface ContextoTema {
  cores: CoresTema | null;
  recarregarTema(): Promise<void>;
}

const TemaContext = createContext<ContextoTema | null>(null);

function aplicarCoresNoDocumento(cores: CoresTema): void {
  const raiz = document.documentElement;
  raiz.style.setProperty('--cor-primaria', cores.cor_primaria);
  raiz.style.setProperty('--cor-fundo', cores.cor_fundo);
  raiz.style.setProperty('--cor-secundaria', cores.cor_secundaria);
  raiz.style.setProperty('--cor-texto-sobre-fundo', calcularCorTexto(cores.cor_fundo));
  raiz.style.setProperty('--cor-texto-sobre-primaria', calcularCorTexto(cores.cor_primaria));
}

export function TemaProvider({
  barbeariaId,
  children,
}: {
  barbeariaId: number | null;
  children: ReactNode;
}) {
  const [cores, setCores] = useState<CoresTema | null>(null);

  const recarregarTema = useCallback(async () => {
    if (barbeariaId === null) {
      setCores(null);
      return;
    }
    const dados = await buscarTema(barbeariaId);
    setCores(dados);
    aplicarCoresNoDocumento(dados);
  }, [barbeariaId]);

  useEffect(() => {
    recarregarTema();
  }, [recarregarTema]);

  return (
    <TemaContext.Provider value={{ cores, recarregarTema }}>
      {children}
    </TemaContext.Provider>
  );
}

export function useTema(): ContextoTema {
  const contexto = useContext(TemaContext);
  if (!contexto) {
    throw new Error('useTema precisa ser usado dentro de um TemaProvider');
  }
  return contexto;
}
