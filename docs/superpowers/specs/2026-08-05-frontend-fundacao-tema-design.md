# Frontend — Fundação e Sistema de Tema por Tenant

**Data:** 2026-08-05
**Status:** Aprovado para planejamento
**Fase:** 1 de 3 do frontend (fundação/tema → app do cliente final → painel do dono). Cada fase é um spec + plano + implementação independente.

## Contexto

O backend (`barbearia-api`) já está pronto: multi-tenant com RLS, autenticação JWT (cliente, admin, super-admin de plataforma), onboarding self-service, e todas as rotas de domínio (agendamento, financeiro, unidade, barbeiro, serviço, plano). Não existe frontend nenhum hoje — tudo é consumido via API direta (Postman/scripts).

O usuário forneceu como referência visual o app "Cashbarber" (prints de tela): lista de serviços com preço promocional riscado, fluxo de agendamento em 4 passos (filial → profissional → serviços → horário), tela de agendamentos com histórico, e um menu lateral com logo customizável da barbearia. O objetivo é replicar essa qualidade de experiência, mas com uma diferença importante: **cada barbearia (tenant) deve poder personalizar a cor do próprio app**, não só o logo.

Esta primeira fase entrega a base sobre a qual as telas de produto (fases 2 e 3) serão construídas: o projeto React, autenticação, e o sistema de tema dinâmico por tenant — sem ainda construir nenhuma tela de agendamento ou painel administrativo de negócio.

## Decisões de Arquitetura

### 1. Stack: Vite + React + TypeScript, sem framework de UI pesado

Um novo projeto separado do backend (`barbearia-web/`), consumindo a API via HTTP. Vite como build tool (SPA simples, sem necessidade de SSR — o app é majoritariamente pós-login, sem requisito de SEO). TypeScript para pegar erros de integração com a API em tempo de desenvolvimento.

**Alternativas descartadas:**
- *Next.js*: traria SSR/roteamento por arquivo, mas isso é overhead sem benefício real aqui — não há conteúdo público que precise de SEO, e a maior parte do app exige login.
- *Biblioteca de temização pronta (ex: Material UI)*: aceleraria componentes prontos, mas amarraria a aparência a um design system de terceiro. A referência visual fornecida (cards brancos simples, botão preto sólido) combina mais com componentes customizados leves estilizados via CSS custom properties.

### 2. Tema dinâmico via CSS custom properties

Cada barbearia define suas cores (ver seção 4), salvas no backend. No login, o frontend busca essas cores e as aplica como CSS custom properties no elemento raiz (`document.documentElement.style.setProperty('--cor-primaria', ...)`). Todo componente do app usa essas variáveis para cor de fundo, destaque e texto — nunca uma cor hardcoded.

**Por quê:** é a abordagem mais simples possível para theming dinâmico em CSS puro, sem dependência de biblioteca. Trocar de tenant (ou o dono trocar a cor) só exige re-setar as variáveis, sem re-renderizar a árvore de componentes.

### 3. Tenant resolvido no login, não na URL

Um domínio único para todos os tenants (ex: `app.suaplataforma.com`). Antes do login, a tela é neutra (sem cor de marca). O `barbearia_id` (extraído do JWT após login) dispara a busca do tema daquele tenant especificamente.

**Alternativa descartada:** *subdomínio por barbearia* (ex: `barbearianome.suaplataforma.com`), que permitiria mostrar a cor já na tela de login — mais fiel à referência visual (`cashbarber.com.br`), mas exige DNS wildcard e certificado SSL, infraestrutura que o projeto não tem hoje. Fica como melhoria futura quando a plataforma tiver domínio próprio configurado.

### 4. Editor de tema: controle completo com proteção de contraste automática

O dono define, no painel admin (fase 3, mas o endpoint e o cálculo são desta fase): uma cor primária/destaque, uma cor de fundo, e uma cor secundária. Uma pré-visualização ao vivo mostra como um botão e um texto ficariam com essas cores, atualizando em tempo real conforme o dono ajusta os seletores — antes de salvar.

**Proteção de contraste:** o dono nunca escolhe a cor do texto diretamente. Para cada cor de fundo escolhida, uma função calcula a luminância relativa (fórmula padrão WCAG) e decide automaticamente entre `#000000` e `#FFFFFF` para o texto sobre ela, garantindo legibilidade mínima sempre. Essa função é pura, testável isoladamente, sem depender de biblioteca externa.

**Por quê:** dar controle total de cor sem QUALQUER proteção arriscaria o próprio dono criar um app ilegível (texto claro sobre fundo claro) sem perceber, gerando reclamação depois. Calcular a cor do texto automaticamente elimina essa classe de erro por completo, sem reduzir a liberdade de escolha de cor de fundo/destaque.

### 5. Extensão da API: nova coluna e endpoint de tema

`barbearia` (tabela raiz de tenant, sem RLS) ganha uma migration aditiva:
```sql
ALTER TABLE barbearia
  ADD COLUMN cor_primaria VARCHAR(7) NOT NULL DEFAULT '#000000',
  ADD COLUMN cor_fundo VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
  ADD COLUMN cor_secundaria VARCHAR(7) NOT NULL DEFAULT '#6B7280';
```
Valores em formato hexadecimal (`#RRGGBB`), validados no backend antes de salvar. Defaults neutros preservam o comportamento de barbearias existentes (nenhuma precisa configurar tema para continuar funcionando).

Dois endpoints novos:
- `GET /barbearias/:id/tema` — público (necessário: mesmo antes do login, se subdomínio for implementado no futuro; por ora, chamado logo após login com o `barbearia_id` do JWT). Retorna as 3 cores.
- `PUT /barbearias/:id/tema` — protegido por `verificarToken` + `escoparTenant` + `apenasAdmin` (mesmo padrão de autorização já usado em outras rotas administrativas do projeto). Aceita as 3 cores, valida formato hexadecimal, salva.

### 6. Autenticação: dois fluxos de login separados

- `/login` (cliente final): formulário de email/senha que chama `POST /auth/cliente/login` já existente na API.
- `/admin/login` (dono/admin da barbearia): formulário próprio que chama `POST /auth/admin/login` já existente.
- O super-admin de plataforma (`usuario_plataforma`) fica fora do escopo do frontend — continua operado via API direta, como hoje.

O JWT retornado é guardado (localStorage) e decodificado no client apenas para extrair `barbearia_id`/`tipo`/`id` para fins de roteamento e busca de tema — nunca para decisões de autorização, que continuam inteiramente no backend.

### 7. Fora de escopo desta fase

- Qualquer tela de agendamento, listagem de serviços, ou histórico (fase 2 — app do cliente final).
- Qualquer tela de cadastro de unidade/barbeiro/serviço, financeiro, ou o próprio editor de tema como UI completa — esta fase entrega a *função* de cálculo de contraste e os *endpoints* de tema, mas a tela final do editor com preview visual é construída na fase 3 (painel do dono), reaproveitando essa base.
- Subdomínio por tenant (infraestrutura de DNS/SSL).
- Upload de logo (mencionado no print de referência) — tratado como parte da fase 3, não desta.
- Fluxo de "esqueci minha senha" no frontend (a API não tem esse fluxo ainda de qualquer forma).

## Risco técnico a validar no início da implementação

Nenhuma migration ou dependência nova de infraestrutura é necessária além do já existente (Postgres, Express). A única adição de dependência é no projeto frontend novo (React, Vite, TypeScript) — sem impacto no backend existente.
