-- Up Migration
ALTER TABLE usuario_admin
  ADD COLUMN token_reset_senha UUID,
  ADD COLUMN token_reset_senha_expira_em TIMESTAMP;

CREATE INDEX idx_usuario_admin_token_reset_senha
  ON usuario_admin(token_reset_senha)
  WHERE token_reset_senha IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_token_reset_senha;
ALTER TABLE usuario_admin
  DROP COLUMN token_reset_senha_expira_em,
  DROP COLUMN token_reset_senha;
