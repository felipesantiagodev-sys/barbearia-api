import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TemaProvider } from './contexts/TemaContext';
import LoginCliente from './pages/LoginCliente';
import LoginAdmin from './pages/LoginAdmin';
import RecuperarSenha from './pages/RecuperarSenha';
import RedefinirSenha from './pages/RedefinirSenha';
import Home from './pages/Home';
import NovoAgendamento from './pages/NovoAgendamento';
import Agendamentos from './pages/Agendamentos';
import Plano from './pages/Plano';
import RotaProtegida from './components/RotaProtegida';

function AreaComTema({ children }: { children: React.ReactNode }) {
  const { usuario } = useAuth();
  return <TemaProvider barbeariaId={usuario?.barbearia_id ?? null}>{children}</TemaProvider>;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AreaComTema>
          <Routes>
            <Route path="/login" element={<LoginCliente />} />
            <Route path="/admin/login" element={<LoginAdmin />} />
            <Route path="/recuperar-senha" element={<RecuperarSenha />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
            <Route
              path="/"
              element={
                <RotaProtegida>
                  <Home />
                </RotaProtegida>
              }
            />
            <Route
              path="/novo-agendamento"
              element={
                <RotaProtegida>
                  <NovoAgendamento />
                </RotaProtegida>
              }
            />
            <Route
              path="/agendamentos"
              element={
                <RotaProtegida>
                  <Agendamentos />
                </RotaProtegida>
              }
            />
            <Route
              path="/plano"
              element={
                <RotaProtegida>
                  <Plano />
                </RotaProtegida>
              }
            />
          </Routes>
        </AreaComTema>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
