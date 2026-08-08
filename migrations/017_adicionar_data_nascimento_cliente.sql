-- Up Migration
ALTER TABLE cliente ADD COLUMN data_nascimento DATE;

-- Down Migration
ALTER TABLE cliente DROP COLUMN data_nascimento;
