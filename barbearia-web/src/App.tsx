import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TemaProvider } from './contexts/TemaContext';
import LoginCliente from './pages/LoginCliente';
import LoginAdmin from './pages/LoginAdmin';
import Home from './pages/Home';
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
            <Route
              path="/"
              element={
                <RotaProtegida>
                  <Home />
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
