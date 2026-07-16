-- Up Migration
CREATE TABLE usuario_plataforma (
  id SERIAL PRIMARY KEY,
  nome VARCHAR NOT NULL,
  email VARCHAR NOT NULL UNIQUE,
  senha_hash VARCHAR NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMP NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE usuario_plataforma;
