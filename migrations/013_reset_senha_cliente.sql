-- Up Migration
ALTER TABLE cliente
  ADD COLUMN token_reset_senha UUID,
  ADD COLUMN token_reset_senha_expira_em TIMESTAMP;

CREATE INDEX idx_cliente_token_reset_senha
  ON cliente(token_reset_senha)
  WHERE token_reset_senha IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_cliente_token_reset_senha;
ALTER TABLE cliente
  DROP COLUMN token_reset_senha_expira_em,
  DROP COLUMN token_reset_senha;
