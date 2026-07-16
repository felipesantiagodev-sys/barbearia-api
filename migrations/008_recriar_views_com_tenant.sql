-- Up Migration
-- Recria as views de relatório expondo barbearia_id e usando
-- security_invoker = true (Postgres 15+) para que a view rode com os
-- privilégios de quem a consulta, e não do dono/criador da view. Sem isso,
-- RLS (migration 005_habilitar_rls.sql) poderia ser contornado silenciosamente
-- via SELECT nestas views, pois views por padrão rodam como security definer
-- implícito (privilégios do criador). Antes desta migration, ambas as views
-- somavam/agregavam dados de TODAS as barbearias juntas -- um vazamento real
-- de dado financeiro e operacional entre tenants.

DROP VIEW IF EXISTS vw_faturamento_mensal;
CREATE VIEW vw_faturamento_mensal WITH (security_invoker = true) AS
SELECT
    p.barbearia_id,
    date_trunc('month', p.criado_em)::date AS mes,
    sum(CASE WHEN p.assinatura_id IS NOT NULL THEN p.valor ELSE 0 END) AS receita_planos,
    sum(CASE WHEN p.agendamento_id IS NOT NULL THEN p.valor ELSE 0 END) AS receita_avulso,
    sum(p.valor) AS receita_total
FROM pagamento p
WHERE p.status = 'pago'
GROUP BY p.barbearia_id, date_trunc('month', p.criado_em)
ORDER BY date_trunc('month', p.criado_em);

DROP VIEW IF EXISTS vw_desempenho_barbeiro_mensal;
CREATE VIEW vw_desempenho_barbeiro_mensal WITH (security_invoker = true) AS
SELECT
    a.barbearia_id,
    b.id AS barbeiro_id,
    b.nome AS barbeiro_nome,
    date_trunc('month', a.data_hora_inicio)::date AS mes,
    count(DISTINCT a.id) AS total_atendimentos,
    count(DISTINCT a.cliente_id) AS clientes_distintos,
    string_agg(DISTINCT s.nome, ', ') AS procedimentos_realizados,
    sum(asv.valor_cobrado) AS faturamento_gerado
FROM agendamento a
JOIN barbeiro b ON b.id = a.barbeiro_id
JOIN agendamento_servico asv ON asv.agendamento_id = a.id
JOIN servico s ON s.id = asv.servico_id
WHERE a.status = 'concluido'
GROUP BY a.barbearia_id, b.id, b.nome, date_trunc('month', a.data_hora_inicio)
ORDER BY date_trunc('month', a.data_hora_inicio), b.nome;

-- Views não herdam GRANTs das tabelas base automaticamente. O role de
-- aplicação (barbearia_app, migration 006_criar_role_aplicacao.sql) precisa
-- de SELECT explícito nestas views para a API conseguir consultá-las.
GRANT SELECT ON vw_faturamento_mensal, vw_desempenho_barbeiro_mensal TO barbearia_app;

-- Down Migration
REVOKE SELECT ON vw_faturamento_mensal, vw_desempenho_barbeiro_mensal FROM barbearia_app;

DROP VIEW IF EXISTS vw_desempenho_barbeiro_mensal;
CREATE VIEW vw_desempenho_barbeiro_mensal AS
SELECT b.id AS barbeiro_id, b.nome AS barbeiro_nome,
    date_trunc('month', a.data_hora_inicio)::date AS mes,
    count(DISTINCT a.id) AS total_atendimentos,
    count(DISTINCT a.cliente_id) AS clientes_distintos,
    string_agg(DISTINCT s.nome, ', ') AS procedimentos_realizados,
    sum(asv.valor_cobrado) AS faturamento_gerado
FROM agendamento a
JOIN barbeiro b ON b.id = a.barbeiro_id
JOIN agendamento_servico asv ON asv.agendamento_id = a.id
JOIN servico s ON s.id = asv.servico_id
WHERE a.status = 'concluido'
GROUP BY b.id, b.nome, date_trunc('month', a.data_hora_inicio)
ORDER BY date_trunc('month', a.data_hora_inicio), b.nome;

DROP VIEW IF EXISTS vw_faturamento_mensal;
CREATE VIEW vw_faturamento_mensal AS
SELECT date_trunc('month', criado_em)::date AS mes,
    sum(CASE WHEN assinatura_id IS NOT NULL THEN valor ELSE 0 END) AS receita_planos,
    sum(CASE WHEN agendamento_id IS NOT NULL THEN valor ELSE 0 END) AS receita_avulso,
    sum(valor) AS receita_total
FROM pagamento p
WHERE status = 'pago'
GROUP BY date_trunc('month', criado_em)
ORDER BY date_trunc('month', criado_em);
