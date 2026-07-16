-- Up Migration
ALTER TABLE cliente ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro_disponibilidade ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro_excecao ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE barbeiro_servico ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE plano_servico ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE assinatura ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE agendamento ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE agendamento_servico ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE notificacao ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);
ALTER TABLE pagamento ADD COLUMN barbearia_id INTEGER REFERENCES barbearia(id);

-- Down Migration
ALTER TABLE pagamento DROP COLUMN barbearia_id;
ALTER TABLE notificacao DROP COLUMN barbearia_id;
ALTER TABLE agendamento_servico DROP COLUMN barbearia_id;
ALTER TABLE agendamento DROP COLUMN barbearia_id;
ALTER TABLE assinatura DROP COLUMN barbearia_id;
ALTER TABLE plano_servico DROP COLUMN barbearia_id;
ALTER TABLE barbeiro_servico DROP COLUMN barbearia_id;
ALTER TABLE barbeiro_excecao DROP COLUMN barbearia_id;
ALTER TABLE barbeiro_disponibilidade DROP COLUMN barbearia_id;
ALTER TABLE barbeiro DROP COLUMN barbearia_id;
ALTER TABLE cliente DROP COLUMN barbearia_id;
