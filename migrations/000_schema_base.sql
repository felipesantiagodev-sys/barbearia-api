-- Up Migration
-- Migration retroativa: recria o schema ORIGINAL das 15 tabelas de domínio de
-- negócio que já existiam no banco de dev (barbearia_db) antes de qualquer
-- migration versionada nesta sessão (001-006). Essas tabelas nunca tinham sido
-- versionadas em nenhuma migration -- este arquivo fecha esse gap de
-- reprodutibilidade para que o banco de teste (e qualquer banco novo) possa
-- ser inicializado do zero rodando 000 em diante.
--
-- O schema aqui reproduz o estado ANTES das migrations 002-006 (sem
-- barbearia_id, sem NOT NULL de barbearia_id, sem RLS, sem o role
-- barbearia_app) -- essas migrations aplicam suas mudanças por cima, na
-- sequência normal. Reconstruído via introspecção direta do banco de dev
-- (information_schema + pg_constraint), cruzando com a leitura linha a linha
-- de cada migration 002-006 para saber exatamente o que cada uma alterou.
--
-- NÃO inclui `usuario_plataforma` (tem migration própria, 001) nem
-- `pgmigrations` (interna do node-pg-migrate).

CREATE TABLE barbearia (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  cnpj VARCHAR(18),
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE unidade (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  endereco VARCHAR(255),
  telefone VARCHAR(20),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now(),
  barbearia_id INTEGER NOT NULL REFERENCES barbearia(id) ON DELETE CASCADE
);

CREATE TABLE servico (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  categoria VARCHAR(30) NOT NULL CHECK (categoria IN (
    'cabelo', 'barba', 'sobrancelha', 'pigmentacao', 'hidratacao',
    'alisamento', 'selagem', 'coloracao', 'outro'
  )),
  duracao_minutos INTEGER NOT NULL CHECK (duracao_minutos > 0),
  valor NUMERIC(10,2) NOT NULL CHECK (valor >= 0),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now(),
  barbearia_id INTEGER NOT NULL REFERENCES barbearia(id) ON DELETE CASCADE
);

CREATE TABLE plano (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  valor_mensal NUMERIC(10,2) NOT NULL CHECK (valor_mensal >= 0),
  intervalo_minimo_dias INTEGER NOT NULL DEFAULT 1,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now(),
  desconto_servico_fora_plano NUMERIC(5,2) NOT NULL DEFAULT 10.00
    CHECK (desconto_servico_fora_plano >= 0 AND desconto_servico_fora_plano <= 100),
  barbearia_id INTEGER NOT NULL REFERENCES barbearia(id) ON DELETE CASCADE
);

CREATE TABLE barbeiro (
  id SERIAL PRIMARY KEY,
  unidade_id INTEGER NOT NULL REFERENCES unidade(id) ON DELETE CASCADE,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(150),
  telefone VARCHAR(20),
  foto_url VARCHAR(255),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE barbeiro_disponibilidade (
  id SERIAL PRIMARY KEY,
  barbeiro_id INTEGER NOT NULL REFERENCES barbeiro(id) ON DELETE CASCADE,
  dia_semana SMALLINT NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  CHECK (hora_fim > hora_inicio)
);

CREATE TABLE barbeiro_excecao (
  id SERIAL PRIMARY KEY,
  barbeiro_id INTEGER NOT NULL REFERENCES barbeiro(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('folga_total', 'bloqueio_parcial', 'horario_extra')),
  hora_inicio TIME,
  hora_fim TIME,
  motivo VARCHAR(255)
);

CREATE TABLE barbeiro_servico (
  barbeiro_id INTEGER NOT NULL REFERENCES barbeiro(id) ON DELETE CASCADE,
  servico_id INTEGER NOT NULL REFERENCES servico(id) ON DELETE CASCADE,
  PRIMARY KEY (barbeiro_id, servico_id)
);

CREATE TABLE plano_servico (
  plano_id INTEGER NOT NULL REFERENCES plano(id) ON DELETE CASCADE,
  servico_id INTEGER NOT NULL REFERENCES servico(id) ON DELETE CASCADE,
  PRIMARY KEY (plano_id, servico_id)
);

CREATE TABLE cliente (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  telefone VARCHAR(20),
  senha_hash VARCHAR(255) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE usuario_admin (
  id SERIAL PRIMARY KEY,
  barbearia_id INTEGER NOT NULL REFERENCES barbearia(id) ON DELETE CASCADE,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  papel VARCHAR(20) NOT NULL DEFAULT 'dono' CHECK (papel IN ('dono', 'gerente')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE assinatura (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  plano_id INTEGER NOT NULL REFERENCES plano(id),
  status VARCHAR(20) NOT NULL CHECK (status IN ('ativa', 'inadimplente', 'cancelada')),
  data_inicio DATE NOT NULL,
  proxima_cobranca DATE,
  gateway_subscription_id VARCHAR(120),
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE agendamento (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES cliente(id),
  barbeiro_id INTEGER NOT NULL REFERENCES barbeiro(id),
  unidade_id INTEGER NOT NULL REFERENCES unidade(id),
  data_hora_inicio TIMESTAMP NOT NULL,
  data_hora_fim TIMESTAMP NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmado' CHECK (status IN (
    'confirmado', 'cancelado', 'concluido', 'no_show', 'reagendado'
  )),
  criado_em TIMESTAMP NOT NULL DEFAULT now(),
  reagendado_de_id INTEGER REFERENCES agendamento(id),
  CHECK (data_hora_fim > data_hora_inicio)
);

CREATE TABLE agendamento_servico (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER NOT NULL REFERENCES agendamento(id) ON DELETE CASCADE,
  servico_id INTEGER NOT NULL REFERENCES servico(id),
  coberto_pelo_plano BOOLEAN NOT NULL DEFAULT false,
  valor_cobrado NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (valor_cobrado >= 0)
);

CREATE TABLE notificacao (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER NOT NULL REFERENCES agendamento(id) ON DELETE CASCADE,
  tipo VARCHAR(30) NOT NULL DEFAULT 'lembrete_1_dia',
  status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'falhou')),
  enviado_em TIMESTAMP,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE pagamento (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamento(id),
  assinatura_id INTEGER REFERENCES assinatura(id),
  valor NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pendente', 'pago', 'falhou', 'reembolsado')),
  gateway_payment_id VARCHAR(120),
  criado_em TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (
    (agendamento_id IS NOT NULL AND assinatura_id IS NULL)
    OR (agendamento_id IS NULL AND assinatura_id IS NOT NULL)
  )
);

-- Down Migration
DROP TABLE pagamento;
DROP TABLE notificacao;
DROP TABLE agendamento_servico;
DROP TABLE agendamento;
DROP TABLE assinatura;
DROP TABLE usuario_admin;
DROP TABLE cliente;
DROP TABLE plano_servico;
DROP TABLE barbeiro_servico;
DROP TABLE barbeiro_excecao;
DROP TABLE barbeiro_disponibilidade;
DROP TABLE barbeiro;
DROP TABLE plano;
DROP TABLE servico;
DROP TABLE unidade;
DROP TABLE barbearia;
