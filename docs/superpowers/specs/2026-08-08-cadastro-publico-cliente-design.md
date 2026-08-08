# Cadastro Público de Cliente por Link

**Data:** 2026-08-08
**Status:** Aprovado para planejamento

## Contexto

Hoje não existe nenhuma tela pela qual um cliente final possa criar sua própria conta — a única forma de um cliente existir é via script/API direta, o que já foi usado para popular dados de demonstração nas fases anteriores. O backend já tem a rota `POST /barbearias/:barbearia_id/clientes` implementada e corretamente escopada por tenant (`src/controllers/clienteController.js`, função `criarClientePublico`), mas nenhuma tela do frontend a consome.

O objetivo desta fase é permitir que uma barbearia distribua um link de cadastro (ex: por WhatsApp, redes sociais) que leva o cliente final direto ao formulário de criação de conta já vinculado àquela barbearia específica, sem exigir login prévio nem qualquer configuração manual por parte do cliente.

## Decisões de Design

### 1. Link identifica a barbearia pelo ID numérico

O link tem o formato `/cadastro/:barbeariaId` (ex: `/cadastro/1`), usando o ID numérico já existente da barbearia — sem introduzir um identificador amigável (slug) novo no banco nesta fase. Simplicidade: o dono (ou quem gerencia a plataforma) copia o link pronto e compartilha; não há necessidade de gerar/validar unicidade de um slug textual agora. Um slug amigável pode ser adicionado no futuro sem quebrar compatibilidade (o ID numérico continuaria funcionando).

### 2. Coleta de dados: nome completo, email, telefone, data de nascimento, senha

Estende o formulário além do que a rota de backend aceita hoje (nome, email, telefone, senha), adicionando `data_nascimento`. Todos os campos são obrigatórios, exceto telefone (que já é opcional na tabela `cliente` atual).

### 3. Data de nascimento: sem regra de idade mínima nesta fase

Validação apenas de formato (data válida) e de que não está no futuro. Nenhuma regra de negócio de idade mínima é aplicada agora — pode ser adicionada depois sem mudança de schema.

### 4. Barbearia inexistente: erro claro antes de mostrar o formulário

Ao carregar a tela, o frontend consulta `GET /barbearias/:id/tema` (rota pública já existente, usada desde a Fase 1 para aplicar o tema visual) para confirmar que a barbearia existe. Se retornar 404, a tela mostra "Link de cadastro inválido ou expirado" em vez do formulário — evita que o cliente preencha todos os campos só para descobrir o erro no envio. Como efeito colateral positivo, a tela de cadastro já nasce com a identidade visual (cores) da barbearia aplicada, consistente com o resto do app.

### 5. Pós-cadastro: mensagem de sucesso, sem login automático

Após o cadastro bem-sucedido, a tela mostra uma confirmação com um link para `/login` — não autentica automaticamente. Consistente com o padrão já usado no onboarding de admin (que também não loga automaticamente após o cadastro).

### 6. Geração/distribuição do link fica fora de escopo

Não há, nesta fase, nenhuma tela ou botão que gere/copie o link automaticamente para o dono — isso pertence à Fase 3 (painel do dono), que ainda não existe. Por enquanto, a URL é montada manualmente por quem administra a plataforma.

## Arquitetura

### Backend

Uma migration aditiva:
```sql
ALTER TABLE cliente ADD COLUMN data_nascimento DATE;
```
Nullable — clientes já cadastrados (via script, em sessões anteriores) não têm esse dado retroativamente, e isso não deve quebrar nada.

`criarClientePublico` (`src/controllers/clienteController.js`) é estendida para:
- Aceitar `data_nascimento` no body.
- Validar que é uma data parseável e não está no futuro (`400` se inválida).
- Incluir a coluna no `INSERT`.

A rota `POST /barbearias/:barbearia_id/clientes` (já registrada em `src/routes/barbeariaRoutes.js`) não muda de assinatura — só o controller por trás dela ganha um campo a mais.

### Frontend (`barbearia-web/`)

- `src/api/cadastro.ts` (novo) — `cadastrarCliente(barbeariaId, dados)`, chamando `POST /barbearias/:barbeariaId/clientes`.
- `src/pages/CadastroCliente.tsx` (novo) — lê `:barbeariaId` da URL via `useParams`, busca o tema da barbearia (`buscarTema`, já existe em `api/tema.ts`) para validar existência e aplicar cores, mostra o formulário ou a mensagem de erro/sucesso conforme o estado.
- Rota `/cadastro/:barbeariaId` registrada em `App.tsx`, **fora** de `RotaProtegida` (é pública, sem exigir login).

## Fora de escopo

- Geração/cópia automática do link pelo dono (Fase 3, painel do dono).
- Slug amigável de barbearia (identificador textual em vez de ID numérico).
- Validação de idade mínima.
- Confirmação de email no cadastro de cliente (diferente do fluxo de admin, que já tem verificação de email — clientes não têm esse fluxo hoje, e não está sendo adicionado agora).

## Risco técnico a validar no início da implementação

Nenhuma migration complexa — só uma coluna nova nullable. A rota de backend já existe e já foi testada em fases anteriores; a extensão é pontual.
