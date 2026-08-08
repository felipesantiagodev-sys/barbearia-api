-- Up Migration
ALTER TABLE plano ADD COLUMN vantagens TEXT;

-- Down Migration
ALTER TABLE plano DROP COLUMN vantagens;
