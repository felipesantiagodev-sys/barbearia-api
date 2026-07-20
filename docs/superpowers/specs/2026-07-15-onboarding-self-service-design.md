# Onboarding Self-Service — Design

**Data:** 2026-07-15
**Status:** Aprovado para planejamento
**Fase:** 2 (depende da fundação multi-tenant, já implementada e em produção). Billing/cobrança da assinatura SaaS fica para uma fase 3 separada.

## Contexto

Hoje a criação de uma barbearia nova exige duas chamadas HTTP separadas, ambas protegidas por autenticação: `POST /barbearias` (exige JWT de `usuario_plataforma`, o super-admin) seguido de `POST /auth/admin/cadastro` (exige JWT de um admin já autenticado *dentro* daquele tenant). Ou seja, hoje só o super-admin consegue trazer uma barbearia nova para a plataforma — não existe nenhum caminho para um dono de barbearia se cadastrar sozinho.

Essa fase entrega o onboarding self-service: uma barbearia nova se cadastra sem depender do super-admin, criando de uma vez a `barbearia` e seu primeiro `usuario_admin` (papel `dono`), com o acesso liberado somente após confirmação de email — para mitigar o abuso que a rota pública original permitia antes da fundação multi-tenant fechar esse buraco.

## Decisões de Arquitetura

### 1. Fluxo: formulário único, sem wizard

Uma única chamada (`POST /onboarding/cadastro`) recebe todos os dados necessários (nome da barbearia, CNPJ opcional, nome do admin, email, senha) e cria barbearia + admin numa operação atômica. Sem criação automática de unidade/serviço/barbeiro — o painel do dono começa vazio, e ele usa as rotas já existentes para montar o negócio dele.

**Por quê:** mantém o escopo pequeno e testável rapidamente, adequado para validar demanda antes de investir num fluxo guiado em múltiplas etapas. Um wizard pode ser uma iteração futura sobre esta base, não um pré-requisito.

### 2. Verificação de email antes de liberar acesso

O cadastro cria a barbearia com `status = 'pendente_verificacao'` e o admin com `email_verificado = false`. Um email com link de confirmação é enviado; `loginAdmin` rejeita login (403) enquanto `email_verificado` for `false`, mesmo com senha correta.

**Alternativas descartadas:**
- *Rate limiting por IP sem verificação de email*: mais simples e sem fricção para o usuário real, mas não impede bots com múltiplos IPs/proxies, e não garante que o email cadastrado existe — o que passa a ser relevante quando billing (fase 3) precisar notificar cobranças por email.
- *Aprovação manual pelo super-admin*: máximo controle, mas não escala e deixa de ser genuinamente self-service — o objetivo desta fase é justamente remover essa dependência.

### 3. Rate limiting complementar

`express-rate-limit` (nova dependência) nas rotas de cadastro e reenvio de verificação, limitando por IP. Complementa a verificação de email (que sozinha não impede um bot de gerar centenas de cadastros pendentes, mesmo que nunca sejam confirmados) sem exigir infraestrutura adicional (Redis, etc.) — um limitador em memória de processo é suficiente neste estágio de volume.

### 4. Provedor de email: Resend

Escolhido por ter SDK Node simples, tier gratuito adequado ao volume inicial (cadastros esporádicos, não campanhas de marketing), e API desenhada para email transacional (o caso de uso aqui), não para email marketing em massa. A API key é fornecida via variável de ambiente (`RESEND_API_KEY`), nunca commitada.

### 5. Schema: colunas aditivas, sem quebrar o fluxo existente

Nova migration adicionando:
- `barbearia.status VARCHAR(20) NOT NULL DEFAULT 'ativa' CHECK (status IN ('pendente_verificacao', 'ativa', 'suspensa'))` — o default `'ativa'` preserva o comportamento das barbearias já existentes (criadas antes desta migration, sem passar pelo fluxo de verificação); o onboarding self-service insere explicitamente `'pendente_verificacao'`.
- `usuario_admin.email_verificado BOOLEAN NOT NULL DEFAULT true` — mesma lógica: admins existentes (criados pelo super-admin, uma fonte confiável) e futuros admins secundários cadastrados por `cadastrarAdmin` dentro de um tenant já ativo continuam podendo logar sem barreira nova; só o onboarding self-service insere explicitamente `false`.
- `usuario_admin.token_verificacao UUID`, `usuario_admin.token_verificacao_expira_em TIMESTAMP` — nulos por padrão, populados apenas durante o fluxo de verificação pendente.

**Por que o default é o inverso do carimbo usado no onboarding:** evita uma migration de backfill e mantém o sistema atual (super-admin cadastrando barbearias, admins cadastrando colegas) funcionando exatamente como hoje sem nenhuma mudança de comportamento — só o novo caminho de entrada (onboarding público) exercita os novos estados.

### 6. Rotas novas

- `POST /onboarding/cadastro` (pública, rate-limited): cria barbearia + admin, envia email, responde 201 sem emitir JWT.
- `GET /onboarding/verificar?token=...` (pública): confirma o token, ativa a barbearia e o admin.
- `POST /onboarding/reenviar-verificacao` (pública, rate-limited): recebe `{ email }`, gera novo token se existir um admin pendente com esse email, reenvia o email. Resposta genérica de sucesso independente de o email existir ou não (evita enumeração de contas cadastradas).

### 7. Transação e padrão de conexão

Segue o padrão já estabelecido no projeto (client dedicado por requisição, `BEGIN`/`SET LOCAL`/`COMMIT` via `res.json`/`res.send` interceptados) — mas como esta rota é pública e ainda não existe tenant para escopar, o cadastro roda com `app.is_plataforma = 'true'` (mesmo bypass de RLS já usado por `apenasPlataforma`), dentro de uma transação própria que insere `barbearia` e `usuario_admin` atomicamente. O envio de email acontece **depois** do commit (fora da transação) — um email que falhe não deve desfazer o cadastro; o usuário sempre pode pedir reenvio.

### 8. Fora de escopo desta fase

- Billing/cobrança da assinatura SaaS (fase 3).
- Validação de formato/unicidade de CNPJ (mantém o comportamento atual: campo livre e opcional).
- Fluxo de "esqueci minha senha".
- Wizard multi-etapa ou criação automática de unidade/serviço/barbeiro padrão.
- Frontend da tela de cadastro/verificação — esta fase entrega apenas a API; o link do email aponta para um endpoint de API que responde JSON (a integração com uma tela real de confirmação fica para quando o frontend existir).

## Risco técnico a validar no início da implementação

O tier gratuito do Resend exige um domínio verificado para enviar de um endereço próprio (ex: `noreply@suaapp.com`) — sem isso, só é possível enviar do endereço de teste `onboarding@resend.dev`, que funciona para desenvolvimento mas não deve ser usado em produção real. Validar isso ao configurar a conta, antes de assumir que o remetente final está pronto.
