const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/database');
const barbeiroRoutes = require('./routes/barbeiroRoutes');
const servicoRoutes = require('./routes/servicoRoutes');
const barbeariaRoutes = require('./routes/barbeariaRoutes');
const unidadeRoutes = require('./routes/unidadeRoutes');
const planoRoutes = require('./routes/planoRoutes');
const clienteRoutes = require('./routes/clienteRoutes');
const agendamentoRoutes = require('./routes/agendamentoRoutes');
const financeiroRoutes = require('./routes/financeiroRoutes');
const authRoutes = require('./routes/authRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ mensagem: 'API da barbearia rodando com sucesso!' });
});

app.use('/barbearias', barbeariaRoutes);
app.use('/unidades', unidadeRoutes);
app.use('/barbeiros', barbeiroRoutes);
app.use('/servicos', servicoRoutes);
app.use('/planos', planoRoutes);
app.use('/clientes', clienteRoutes);
app.use('/agendamentos', agendamentoRoutes);
app.use('/financeiro', financeiroRoutes);
app.use('/auth', authRoutes);

app.get('/teste-banco', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW()');
    res.json({
      mensagem: 'Conexão com o banco funcionando!',
      horario_do_banco: resultado.rows[0].now,
    });
  } catch (erro) {
    console.error(erro);
    res.status(500).json({ erro: 'Falha ao conectar no banco' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});