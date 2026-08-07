-- Up Migration
ALTER TABLE usuario_admin
  ADD COLUMN tentativas_login_falhas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate TIMESTAMP;

-- Down Migration
ALTER TABLE usuario_admin
  DROP COLUMN bloqueado_ate,
  DROP COLUMN tentativas_login_falhas;
