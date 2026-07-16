-- Up Migration

DO $$
DECLARE
  tabelas TEXT[] := ARRAY[
    'unidade', 'servico', 'plano', 'usuario_admin',
    'cliente', 'barbeiro', 'barbeiro_disponibilidade', 'barbeiro_excecao',
    'barbeiro_servico', 'plano_servico', 'assinatura',
    'agendamento', 'agendamento_servico', 'notificacao', 'pagamento'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (barbearia_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::integer
                OR current_setting(''app.is_plataforma'', true) = ''true'')
         WITH CHECK (barbearia_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::integer
                     OR current_setting(''app.is_plataforma'', true) = ''true'')',
      t
    );
  END LOOP;
END $$;

-- Down Migration
DO $$
DECLARE
  tabelas TEXT[] := ARRAY[
    'unidade', 'servico', 'plano', 'usuario_admin',
    'cliente', 'barbeiro', 'barbeiro_disponibilidade', 'barbeiro_excecao',
    'barbeiro_servico', 'plano_servico', 'assinatura',
    'agendamento', 'agendamento_servico', 'notificacao', 'pagamento'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
