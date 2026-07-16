const app = require('./app');
const { iniciarJobLembretes } = require('./jobs/lembretes');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  iniciarJobLembretes();
});
