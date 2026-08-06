-- Up Migration
ALTER TABLE barbearia
  ADD COLUMN cor_primaria VARCHAR(7) NOT NULL DEFAULT '#000000',
  ADD COLUMN cor_fundo VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN cor_secundaria VARCHAR(7) NOT NULL DEFAULT '#6B7280';

-- Down Migration
ALTER TABLE barbearia
  DROP COLUMN cor_primaria,
  DROP COLUMN cor_fundo,
  DROP COLUMN cor_secundaria;
