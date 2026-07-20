-- Up Migration
ALTER TABLE barbearia
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ativa'
  CHECK (status IN ('pendente_verificacao', 'ativa', 'suspensa'));

ALTER TABLE usuario_admin
  ADD COLUMN email_verificado BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE usuario_admin
  ADD COLUMN token_verificacao UUID;

ALTER TABLE usuario_admin
  ADD COLUMN token_verificacao_expira_em TIMESTAMP;

CREATE INDEX idx_usuario_admin_token_verificacao
  ON usuario_admin(token_verificacao)
  WHERE token_verificacao IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_token_verificacao;
ALTER TABLE usuario_admin DROP COLUMN token_verificacao_expira_em;
ALTER TABLE usuario_admin DROP COLUMN token_verificacao;
ALTER TABLE usuario_admin DROP COLUMN email_verificado;
ALTER TABLE barbearia DROP COLUMN status;
