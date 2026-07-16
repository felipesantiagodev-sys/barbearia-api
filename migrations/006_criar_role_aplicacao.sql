-- Up Migration
-- Cria o role de aplicação usado pela conexão da API. Este role NÃO deve ter
-- SUPERUSER nem BYPASSRLS -- ambos permitiriam contornar Row-Level Security
-- (migration 005_habilitar_rls.sql), tornando o isolamento multi-tenant
-- inefetivo de forma silenciosa. A senha real de cada ambiente (dev, staging,
-- produção) deve ser definida fora deste arquivo (ex: variável de ambiente do
-- gerenciador de segredos), nunca commitada -- aqui usamos um valor placeholder
-- que DEVE ser trocado manualmente logo após a migration rodar em qualquer
-- ambiente novo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'barbearia_app') THEN
    CREATE ROLE barbearia_app WITH LOGIN PASSWORD 'TROCAR_ESTA_SENHA_APOS_MIGRAR' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO barbearia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO barbearia_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO barbearia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO barbearia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO barbearia_app;

-- Down Migration
-- Não reverte GRANTs individualmente (seria extenso e de baixo valor); revoga
-- acesso ao schema, o que efetivamente invalida o role para uso pela aplicação.
-- O role em si não é dropado no down para evitar perda acidental caso outras
-- conexões ainda dependam dele -- remoção completa deve ser uma ação manual
-- deliberada, não parte automática de um rollback de migration.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM barbearia_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM barbearia_app;
REVOKE USAGE ON SCHEMA public FROM barbearia_app;
