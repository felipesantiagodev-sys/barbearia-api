const BUFFER_MINUTOS = 10;
const GRANULARIDADE_MINUTOS = 10;

function combinarDataHora(dataStr, horaStr) {
  return new Date(`${dataStr}T${horaStr}`);
}

function adicionarMinutos(data, minutos) {
  return new Date(data.getTime() + minutos * 60000);
}

function subtrairIntervalo(janelas, ocupado) {
  const resultado = [];

  for (const janela of janelas) {
    // Caso 1: não há sobreposição — a janela fica intacta
    if (ocupado.fim <= janela.inicio || ocupado.inicio >= janela.fim) {
      resultado.push(janela);
      continue;
    }
    // Caso 2: o ocupado "morde" o início da janela
    if (ocupado.inicio <= janela.inicio && ocupado.fim < janela.fim) {
      resultado.push({ inicio: ocupado.fim, fim: janela.fim });
      continue;
    }
    // Caso 3: o ocupado "morde" o final da janela
    if (ocupado.inicio > janela.inicio && ocupado.fim >= janela.fim) {
      resultado.push({ inicio: janela.inicio, fim: ocupado.inicio });
      continue;
    }
    // Caso 4: o ocupado está no MEIO da janela — ela se divide em duas
    if (ocupado.inicio > janela.inicio && ocupado.fim < janela.fim) {
      resultado.push({ inicio: janela.inicio, fim: ocupado.inicio });
      resultado.push({ inicio: ocupado.fim, fim: janela.fim });
      continue;
    }
    // Caso 5: o ocupado cobre a janela inteira — não sobra nada
  }

  return resultado;
}

function gerarSlotsDisponiveis(janelasLivres, duracaoServicosMinutos) {
  const duracaoComBuffer = duracaoServicosMinutos + BUFFER_MINUTOS;
  const slots = [];

  for (const janela of janelasLivres) {
    let candidato = new Date(janela.inicio);

    while (adicionarMinutos(candidato, duracaoComBuffer) <= janela.fim) {
      slots.push({
        inicio: new Date(candidato),
        fim_atendimento: adicionarMinutos(candidato, duracaoServicosMinutos),
      });
      candidato = adicionarMinutos(candidato, GRANULARIDADE_MINUTOS);
    }
  }

  return slots;
}

module.exports = {
  combinarDataHora,
  adicionarMinutos,
  subtrairIntervalo,
  gerarSlotsDisponiveis,
};