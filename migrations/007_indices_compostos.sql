-- Up Migration
-- Índices nas colunas mais consultadas por tenant. Sem eles, toda query com
-- RLS ativo (migration 005_habilitar_rls.sql) faz sequential scan filtrando
-- barbearia_id linha a linha, o que não escala para milhares de tenants com
-- milhões de linhas agregadas.

CREATE INDEX idx_cliente_barbearia ON cliente(barbearia_id);
CREATE INDEX idx_barbeiro_barbearia ON barbeiro(barbearia_id);
CREATE INDEX idx_agendamento_barbearia_data ON agendamento(barbearia_id, data_hora_inicio);
CREATE INDEX idx_agendamento_servico_barbearia ON agendamento_servico(barbearia_id);
CREATE INDEX idx_notificacao_barbearia ON notificacao(barbearia_id);
CREATE INDEX idx_pagamento_barbearia_criado ON pagamento(barbearia_id, criado_em);
CREATE INDEX idx_assinatura_barbearia ON assinatura(barbearia_id);
CREATE INDEX idx_unidade_barbearia ON unidade(barbearia_id);
CREATE INDEX idx_servico_barbearia ON servico(barbearia_id);
CREATE INDEX idx_plano_barbearia ON plano(barbearia_id);
CREATE INDEX idx_usuario_admin_barbearia ON usuario_admin(barbearia_id);

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_barbearia;
DROP INDEX IF EXISTS idx_plano_barbearia;
DROP INDEX IF EXISTS idx_servico_barbearia;
DROP INDEX IF EXISTS idx_unidade_barbearia;
DROP INDEX IF EXISTS idx_assinatura_barbearia;
DROP INDEX IF EXISTS idx_pagamento_barbearia_criado;
DROP INDEX IF EXISTS idx_notificacao_barbearia;
DROP INDEX IF EXISTS idx_agendamento_servico_barbearia;
DROP INDEX IF EXISTS idx_agendamento_barbearia_data;
DROP INDEX IF EXISTS idx_barbeiro_barbearia;
DROP INDEX IF EXISTS idx_cliente_barbearia;
