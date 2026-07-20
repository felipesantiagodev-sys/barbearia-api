-- Up Migration
-- Fecha uma janela de corrida identificada na revisao final do onboarding
-- self-service: a checagem de "email ja pendente" em cadastrarOnboarding
-- (src/controllers/onboardingController.js) e um SELECT seguido de INSERT,
-- sem constraint de banco que impeca duas requisicoes concorrentes com o
-- mesmo email de passarem pela checagem antes de qualquer uma commitar.
-- Este indice unico parcial faz o Postgres rejeitar fisicamente o segundo
-- INSERT concorrente (erro 23505), que o controller ja trata como 409 --
-- o mesmo codigo que hoje cobre o caso sequencial passa a cobrir tambem
-- o caso concorrente, sem mudanca de logica na aplicacao.
--
-- Escopo: um unico admin PENDENTE (email_verificado = false) por email, em
-- toda a plataforma. Nao afeta o cenario legitimo de uma mesma pessoa ser
-- dona de barbearias diferentes, pois nesse caso os admins ja estao
-- VERIFICADOS (email_verificado = true), fora do escopo deste indice.
CREATE UNIQUE INDEX idx_usuario_admin_email_pendente_unico
  ON usuario_admin(email)
  WHERE email_verificado = false;

-- Down Migration
DROP INDEX IF EXISTS idx_usuario_admin_email_pendente_unico;
