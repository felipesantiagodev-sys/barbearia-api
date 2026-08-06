# Recuperação de Senha (Esqueci Minha Senha)

**Data:** 2026-08-06
**Status:** Aprovado para planejamento

## Contexto

O backend (`barbearia-api`) tem dois tipos de usuário com senha própria: `usuario_admin` (dono/gerente da barbearia) e `cliente` (cliente final). Nenhum dos dois tem hoje um caminho para recuperar acesso caso esqueçam a senha — a única forma de trocar seria alterar direto no banco.

O onboarding self-service já implementou um padrão equivalente para verificação de email (`migrations/009_onboarding_verificacao_email.sql`, `src/services/emailService.js`, `src/middlewares/rateLimiters.js`): token UUID com expiração em coluna própria, envio via Resend, rate limiting dedicado, e resposta genérica anti-enumeração. Este design reaproveita o mesmo padrão para redefinição de senha, com colunas e endpoints próprios (não reutiliza `token_verificacao`).

Uma particularidade do schema: o email de `usuario_admin` e `cliente` é único **por barbearia** (`UNIQUE (barbearia_id, email)`), não globalmente — a mesma pessoa pode ter contas com o mesmo email em barbearias diferentes (cenário legítimo: dono de mais de uma barbearia). O fluxo de recuperação precisa lidar com isso.

## Decisões de Design

### 1. Escopo: admins e clientes, com endpoints separados

Ambos os tipos de usuário ganham o fluxo, com endpoints distintos (`/auth/admin/...` e `/auth/cliente/...`), consistente com o padrão já usado em login e cadastro — não há endpoint unificado que tente adivinhar o tipo de usuário.

### 2. Mecanismo: link com token por email

Usuário informa o email, recebe um link com token UUID de uso único por email via Resend, clica e define a nova senha. Mesmo padrão do link de verificação de email do onboarding — nenhuma infraestrutura nova é necessária.

### 3. Expiração: 1 hora

Token expira 1h após ser gerado. Mais curto que os 24h do fluxo de verificação de cadastro, porque redefinição de senha é um evento sensível (indica possível perda de acesso ou tentativa de takeover) e uma janela mais estreita reduz a superfície de risco caso o email seja interceptado.

### 4. Anti-enumeração: resposta sempre genérica

O endpoint de solicitação (`/esqueci-senha`) sempre responde com sucesso genérico (`"Se esse email existir, você vai receber um link"`), exista ou não o email no sistema — mesmo padrão de `reenviarVerificacao` em `onboardingController.js`. Evita que alguém descubra quais emails têm conta testando um por um.

### 5. Email duplicado entre barbearias: um link por conta encontrada

Como o mesmo email pode ter contas em barbearias diferentes, a solicitação busca **todas** as contas daquele tipo com aquele email (reaproveitando o padrão de `buscarComoPlataforma`, que já existe em `authController.js` para contornar RLS nessa busca cross-tenant de leitura). Um token é gerado por conta encontrada, e um email é enviado por conta — cada link menciona o nome da barbearia correspondente no assunto, para o usuário saber qual conta cada link redefine.

### 6. Conteúdo do email: inclui o nome da barbearia

Assunto do tipo `Redefinir senha — <nome da barbearia>`, desambiguando o caso de múltiplas contas. Segue o mesmo padrão de escape HTML já usado em `enviarEmailVerificacao` (o nome vem de dado já armazenado no banco, mas escapamos por defesa em profundidade, já que nomes de barbearia são fornecidos pelo usuário no cadastro).

### 7. Link inclui o tipo de usuário

O link de redefinição carrega `?tipo=admin&token=...` (ou `tipo=cliente`), para a tela de redefinição saber diretamente qual endpoint (`/auth/admin/redefinir-senha` ou `/auth/cliente/redefinir-senha`) chamar, sem precisar tentar um e cair para o outro.

### 8. Pós-redefinição: volta ao login manual

Depois de redefinir com sucesso, a tela mostra confirmação e leva o usuário de volta à tela de login correspondente (cliente ou admin) para entrar manualmente com a nova senha — não autentica automaticamente. Mais simples de implementar e evita reaproveitar lógica de emissão de JWT nesse fluxo.

## Arquitetura

### Modelo de dados

Duas migrations aditivas, mesma estrutura de `009_onboarding_verificacao_email.sql`:

```sql
-- usuario_admin
ALTER TABLE usuario_admin ADD COLUMN token_reset_senha UUID;
ALTER TABLE usuario_admin ADD COLUMN token_reset_senha_expira_em TIMESTAMP;
CREATE INDEX idx_usuario_admin_token_reset_senha
  ON usuario_admin(token_reset_senha) WHERE token_reset_senha IS NOT NULL;

-- cliente
ALTER TABLE cliente ADD COLUMN token_reset_senha UUID;
ALTER TABLE cliente ADD COLUMN token_reset_senha_expira_em TIMESTAMP;
CREATE INDEX idx_cliente_token_reset_senha
  ON cliente(token_reset_senha) WHERE token_reset_senha IS NOT NULL;
```

Colunas totalmente separadas de `token_verificacao`/`token_verificacao_expira_em` — o fluxo de reset de senha nunca interfere no fluxo de verificação de cadastro, e os dois podem estar ativos ao mesmo tempo para uma mesma conta sem conflito.

### Endpoints

Adicionados a `src/controllers/authController.js` (mesmo módulo do login) e `src/routes/authRoutes.js`:

- `POST /auth/admin/esqueci-senha` — `{ email }` → busca todas as contas de `usuario_admin` com esse email via `buscarComoPlataforma`, gera token+expiração por conta, envia um email por conta, responde `200` genérico sempre.
- `POST /auth/cliente/esqueci-senha` — mesma lógica para `cliente`.
- `POST /auth/admin/redefinir-senha` — `{ token, senha_nova }` → valida token+expiração em `usuario_admin`, atualiza `senha_hash` (bcrypt), invalida o token. Trata `22P02` (token malformado) como 400, mesmo padrão de `verificarEmail`.
- `POST /auth/cliente/redefinir-senha` — mesma lógica para `cliente`.

### Rate limiting

Novo `limitadorEsqueciSenha` em `src/middlewares/rateLimiters.js` (3 requisições/hora por IP, mesmo valor de `limitadorReenvio`), aplicado nos dois endpoints `/esqueci-senha`. Os endpoints `/redefinir-senha` não precisam de rate limiting dedicado — já exigem posse de um token de uso único enviado por email, o que naturalmente limita tentativas.

### Email

Nova função `enviarEmailRedefinicaoSenha(destinatario, nomeBarbearia, tokenReset, tipoUsuario)` em `src/services/emailService.js`, reaproveitando `escaparHtml`. Link gerado: `${APP_BASE_URL}/redefinir-senha?tipo=${tipoUsuario}&token=${tokenReset}`.

### Frontend (`barbearia-web/`)

Duas telas novas, usando a identidade visual BarberOS já criada (`Auth.module.css`, `Marca`):

- `/recuperar-senha` — formulário de email com abas/toggle "Sou cliente" / "Sou administrador", chama o endpoint correspondente, mostra a mensagem genérica de sucesso após o envio.
- `/redefinir-senha` — lê `tipo` e `token` da query string, formulário de nova senha (+ confirmação), chama o endpoint de redefinir baseado em `tipo`. Em caso de sucesso, mostra confirmação com link de volta ao login correto (cliente ou admin).

Link "Esqueci minha senha" adicionado ao rodapé de `LoginCliente.tsx` e `LoginAdmin.tsx` (existentes), apontando para `/recuperar-senha`.

## Fora de escopo

- Alterar senha estando já autenticado (fluxo diferente, dentro do painel — fica para quando essas telas existirem nas fases 2/3).
- Notificação de segurança ("sua senha foi alterada") por email — pode ser adicionado depois sem mudança de arquitetura.
- Invalidar sessões/tokens JWT ativos após redefinição de senha (hoje o JWT não tem mecanismo de revogação; está fora do escopo deste fluxo).

## Risco técnico a validar no início da implementação

Nenhuma migration ou dependência nova de infraestrutura além do já existente (Postgres, Resend já configurado no onboarding). `buscarComoPlataforma` já existe em `authController.js` e será reaproveitada localmente (mesmo arquivo, sem necessidade de exportação).
