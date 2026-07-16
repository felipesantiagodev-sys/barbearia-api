-- Up Migration

-- barbeiro: via unidade
UPDATE barbeiro b SET barbearia_id = u.barbearia_id
FROM unidade u WHERE u.id = b.unidade_id AND b.barbearia_id IS NULL;

-- barbeiro_disponibilidade: via barbeiro
UPDATE barbeiro_disponibilidade bd SET barbearia_id = b.barbearia_id
FROM barbeiro b WHERE b.id = bd.barbeiro_id AND bd.barbearia_id IS NULL;

-- barbeiro_excecao: via barbeiro
UPDATE barbeiro_excecao be SET barbearia_id = b.barbearia_id
FROM barbeiro b WHERE b.id = be.barbeiro_id AND be.barbearia_id IS NULL;

-- barbeiro_servico: via barbeiro
UPDATE barbeiro_servico bs SET barbearia_id = b.barbearia_id
FROM barbeiro b WHERE b.id = bs.barbeiro_id AND bs.barbearia_id IS NULL;

-- plano_servico: via plano
UPDATE plano_servico ps SET barbearia_id = p.barbearia_id
FROM plano p WHERE p.id = ps.plano_id AND ps.barbearia_id IS NULL;

-- assinatura: via plano
UPDATE assinatura a SET barbearia_id = p.barbearia_id
FROM plano p WHERE p.id = a.plano_id AND a.barbearia_id IS NULL;

-- agendamento: via unidade
UPDATE agendamento ag SET barbearia_id = u.barbearia_id
FROM unidade u WHERE u.id = ag.unidade_id AND ag.barbearia_id IS NULL;

-- cliente: via primeiro agendamento existente do cliente (heurística necessária porque cliente hoje é global;
-- clientes sem nenhum agendamento ficam NULL aqui e precisam ser resolvidos manualmente antes da próxima migration)
UPDATE cliente c SET barbearia_id = sub.barbearia_id
FROM (
  SELECT DISTINCT ON (cliente_id) cliente_id, barbearia_id
  FROM agendamento
  ORDER BY cliente_id, criado_em ASC
) sub
WHERE sub.cliente_id = c.id AND c.barbearia_id IS NULL;

-- agendamento_servico: via agendamento
UPDATE agendamento_servico asv SET barbearia_id = ag.barbearia_id
FROM agendamento ag WHERE ag.id = asv.agendamento_id AND asv.barbearia_id IS NULL;

-- notificacao: via agendamento
UPDATE notificacao n SET barbearia_id = ag.barbearia_id
FROM agendamento ag WHERE ag.id = n.agendamento_id AND n.barbearia_id IS NULL;

-- pagamento: condicional (agendamento OU assinatura)
UPDATE pagamento pg SET barbearia_id = ag.barbearia_id
FROM agendamento ag WHERE ag.id = pg.agendamento_id AND pg.agendamento_id IS NOT NULL AND pg.barbearia_id IS NULL;

UPDATE pagamento pg SET barbearia_id = a.barbearia_id
FROM assinatura a WHERE a.id = pg.assinatura_id AND pg.assinatura_id IS NOT NULL AND pg.barbearia_id IS NULL;

-- Down Migration
-- Backfill não é reversível de forma significativa (não há "estado anterior" a restaurar
-- além de NULL, que a migration 002 down já cobre). Down desta migration é um no-op documentado.
SELECT 1;
