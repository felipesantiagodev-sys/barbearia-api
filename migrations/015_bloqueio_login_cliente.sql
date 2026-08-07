-- Up Migration
ALTER TABLE cliente
  ADD COLUMN tentativas_login_falhas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate TIMESTAMP;

-- Down Migration
ALTER TABLE cliente
  DROP COLUMN bloqueado_ate,
  DROP COLUMN tentativas_login_falhas;
