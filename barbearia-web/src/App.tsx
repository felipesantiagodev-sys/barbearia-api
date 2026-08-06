import { BrowserRouter, Routes, Route } from 'react-router-dom';

function Placeholder() {
  return <div>Barbearia Web — em construção</div>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Placeholder />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
