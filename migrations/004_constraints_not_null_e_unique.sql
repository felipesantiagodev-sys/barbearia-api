-- Up Migration
ALTER TABLE cliente ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro_disponibilidade ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro_excecao ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE barbeiro_servico ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE plano_servico ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE assinatura ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE agendamento ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE agendamento_servico ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE notificacao ALTER COLUMN barbearia_id SET NOT NULL;
ALTER TABLE pagamento ALTER COLUMN barbearia_id SET NOT NULL;

-- cliente: email único por tenant, não mais globalmente único
ALTER TABLE cliente DROP CONSTRAINT IF EXISTS cliente_email_key;
ALTER TABLE cliente ADD CONSTRAINT cliente_barbearia_email_key UNIQUE (barbearia_id, email);

-- usuario_admin: mesma regra
ALTER TABLE usuario_admin DROP CONSTRAINT IF EXISTS usuario_admin_email_key;
ALTER TABLE usuario_admin ADD CONSTRAINT usuario_admin_barbearia_email_key UNIQUE (barbearia_id, email);

CREATE OR REPLACE FUNCTION validar_barbearia_id_pagamento()
RETURNS TRIGGER AS $$
DECLARE
  barbearia_esperada INTEGER;
BEGIN
  IF NEW.agendamento_id IS NOT NULL THEN
    SELECT barbearia_id INTO barbearia_esperada FROM agendamento WHERE id = NEW.agendamento_id;
    IF NOT FOUND OR barbearia_esperada IS NULL THEN
      RAISE EXCEPTION 'referência inválida para pagamento (agendamento_id=%, assinatura_id=%)', NEW.agendamento_id, NEW.assinatura_id;
    END IF;
  ELSIF NEW.assinatura_id IS NOT NULL THEN
    SELECT barbearia_id INTO barbearia_esperada FROM assinatura WHERE id = NEW.assinatura_id;
    IF NOT FOUND OR barbearia_esperada IS NULL THEN
      RAISE EXCEPTION 'referência inválida para pagamento (agendamento_id=%, assinatura_id=%)', NEW.agendamento_id, NEW.assinatura_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'pagamento precisa referenciar agendamento_id ou assinatura_id';
  END IF;

  IF NEW.barbearia_id != barbearia_esperada THEN
    RAISE EXCEPTION 'barbearia_id do pagamento (%) não corresponde à barbearia da referência (%)', NEW.barbearia_id, barbearia_esperada;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_barbearia_id_pagamento
  BEFORE INSERT OR UPDATE ON pagamento
  FOR EACH ROW EXECUTE FUNCTION validar_barbearia_id_pagamento();

-- Down Migration
DROP TRIGGER IF EXISTS trg_validar_barbearia_id_pagamento ON pagamento;
DROP FUNCTION IF EXISTS validar_barbearia_id_pagamento();

ALTER TABLE usuario_admin DROP CONSTRAINT IF EXISTS usuario_admin_barbearia_email_key;
ALTER TABLE usuario_admin ADD CONSTRAINT usuario_admin_email_key UNIQUE (email);
ALTER TABLE cliente DROP CONSTRAINT IF EXISTS cliente_barbearia_email_key;
ALTER TABLE cliente ADD CONSTRAINT cliente_email_key UNIQUE (email);

ALTER TABLE pagamento ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE notificacao ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE agendamento_servico ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE agendamento ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE assinatura ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE plano_servico ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro_servico ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro_excecao ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro_disponibilidade ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE barbeiro ALTER COLUMN barbearia_id DROP NOT NULL;
ALTER TABLE cliente ALTER COLUMN barbearia_id DROP NOT NULL;
