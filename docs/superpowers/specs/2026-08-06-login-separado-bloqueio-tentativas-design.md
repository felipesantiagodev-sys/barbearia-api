# Login Separado por Tipo + Bloqueio por Tentativas de Login

**Data:** 2026-08-06
**Status:** Aprovado para planejamento

## Contexto

Hoje `LoginCliente.tsx` e `LoginAdmin.tsx` têm um link cruzado entre si ("É o dono da barbearia? Entrar como administrador" / "É cliente da barbearia? Entrar como cliente"). Isso confunde o usuário sobre qual porta de entrada usar, já que os dois tipos de conta (`usuario_admin`, `cliente`) são conceitualmente distintos e nunca deveriam se misturar na experiência de login.

Além disso, não existe hoje nenhuma proteção contra tentativas repetidas de adivinhar a senha — um atacante pode tentar senhas indefinidamente contra qualquer conta.

Este design cobre duas mudanças pequenas e relacionadas (ambas tocam o fluxo de login) na mesma leva: remover o cruzamento entre as telas de login, e adicionar bloqueio de conta após 5 tentativas de senha incorretas seguidas.

## Decisões de Design

### 1. Telas de login separadas, sem detecção automática

`LoginCliente.tsx` e `LoginAdmin.tsx` deixam de ter qualquer link ou menção uma à outra. Cada uma é uma porta de entrada isolada para seu tipo de conta. Quem tentar logar no formulário errado (ex: um cliente tentando `/admin/login`) recebe o erro padrão de credenciais inválidas — o backend já busca só na tabela correspondente, então isso já acontece naturalmente, sem mudança de backend necessária para este ponto. Não há detecção automática de tipo por email nesta fase.

### 2. Bloqueio após 5 tentativas de senha incorretas, por conta

O contador é por conta (email específico), não por IP — um atacante trocando de IP não contorna o bloqueio, e usuários legítimos em rede compartilhada não são afetados por erros de terceiros.

- Login com senha errada incrementa um contador de falhas na própria conta.
- Ao atingir 5 falhas consecutivas, a conta fica bloqueada.
- Login com senha correta, a qualquer momento antes de bater 5, zera o contador — só falhas *seguidas* contam.
- Uma vez bloqueada, a única forma de desbloquear é redefinir a senha (fluxo de recuperação de senha já implementado). Não há expiração automática por tempo.
- Vale para `usuario_admin` e `cliente`, mesma lógica nos dois.

### 3. Mensagem de bloqueio explícita

Diferente do erro genérico de "email ou senha inválidos" usado para credenciais erradas, uma conta bloqueada recebe uma resposta específica informando o bloqueio e direcionando para a tela de recuperação de senha (`/recuperar-senha`, já existente). Trade-off consciente: isso revela que a conta existe (diferente do padrão anti-enumeração usado no fluxo de "esqueci senha"), mas se justifica aqui porque só quem já está tentando logar com aquele email específico — presumivelmente o dono legítimo ou alguém mirando especificamente essa conta — vê essa mensagem, e a alternativa (mensagem genérica) deixaria o usuário legítimo sem saber por que não consegue mais entrar.

## Arquitetura

### Modelo de dados

Duas migrations aditivas (`014`, `015`):

```sql
-- usuario_admin
ALTER TABLE usuario_admin
  ADD COLUMN tentativas_login_falhas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate TIMESTAMP;

-- cliente (mesma estrutura)
ALTER TABLE cliente
  ADD COLUMN tentativas_login_falhas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate TIMESTAMP;
```

`bloqueado_ate` nulo significa "não bloqueado". Ao bloquear, é setado para uma data suficientemente distante no futuro (não é um bloqueio temporizado — só redefinição de senha limpa o campo), o que reaproveita a mesma forma de checagem (`bloqueado_ate > now()`) usada nos tokens de reset de senha, por consistência.

### Backend

`loginAdmin`/`loginCliente` em `src/controllers/authController.js`:
1. Busca a conta pelo email (já existente).
2. Se `bloqueado_ate` estiver no futuro, responde `423 Locked` com mensagem apontando para `/recuperar-senha`, sem sequer checar a senha.
3. Senha incorreta: incrementa `tentativas_login_falhas`; se atingir 5, seta `bloqueado_ate`.
4. Senha correta: zera `tentativas_login_falhas` e `bloqueado_ate`, segue o fluxo de emissão de JWT já existente.

`redefinirSenhaAdmin`/`redefinirSenhaCliente` (já implementados na feature de recuperação de senha) passam a zerar `tentativas_login_falhas` e `bloqueado_ate` junto com a troca de `senha_hash`.

### Frontend

`LoginCliente.tsx`/`LoginAdmin.tsx`:
- Remove o parágrafo de rodapé com link cruzado.
- Trata resposta `423` separadamente de `401`, mostrando a mensagem de bloqueio com link para `/recuperar-senha` (já existente) em vez do erro genérico.

## Fora de escopo

- Bloqueio por IP (rate limiting já existe para outras rotas sensíveis via `express-rate-limit`, mas não é o mecanismo usado aqui).
- Notificação por email quando uma conta é bloqueada.
- Painel de administração para desbloquear contas manualmente (super-admin) — se necessário no futuro, é uma extensão simples sobre este schema.
- Expiração automática de bloqueio por tempo.

## Risco técnico a validar no início da implementação

Nenhuma migration ou dependência nova de infraestrutura além do já existente. Migrations `014`/`015` seguem o mesmo padrão aditivo das anteriores.
