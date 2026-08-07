# App do Cliente Final — Agendamento (Fase 2 do Frontend)

**Data:** 2026-08-07
**Status:** Aprovado para planejamento
**Fase:** 2 de 3 do frontend (fundação/tema → **app do cliente final** → painel do dono).

## Contexto

A fundação do frontend (Fase 1) já está pronta: projeto React com autenticação separada (cliente/admin), tema dinâmico por barbearia, recuperação de senha e bloqueio de conta por tentativas. Hoje, após login, o cliente só vê uma tela `Home` mínima ("Olá, [nome]") — nenhuma tela de produto existe.

Esta fase entrega o núcleo de valor do app do cliente final: agendar um horário, seguindo o fluxo de referência do Cashbarber (unidade → profissional → serviços → horário → confirmação), consultar seus agendamentos (agendados/anteriores) e ver sua assinatura ativa na Home.

O backend já tem a maior parte da lógica de domínio pronta (criação de agendamento, cálculo de disponibilidade considerando agenda semanal/exceções/agendamentos existentes, cálculo de valor com desconto de plano), mas falta expor 3 capacidades de leitura que o frontend precisa e que hoje não existem como endpoint HTTP: listar os agendamentos do próprio cliente, consultar a assinatura ativa do próprio cliente, e calcular disponibilidade agregada entre múltiplos barbeiros (para a opção "sem preferência" de profissional).

## Decisões de Design

### 1. Dados de catálogo (serviços/barbeiros/unidades) via API/script, não via UI

O cadastro desses dados continua sendo feito via API/script diretamente no banco (como já acontece hoje para a "Barbearia Exemplo"), não por uma tela de cadastro. A tela de cadastro fica para a Fase 3 (painel do dono). Esta fase assume que uma barbearia já tem unidades, barbeiros e serviços cadastrados.

### 2. Fluxo de agendamento fiel ao Cashbarber: unidade → profissional → serviços → horário → confirmação

Cinco passos, replicando o fluxo de referência:
1. **Unidade** — lista de `GET /unidades`.
2. **Profissional** — lista de barbeiros da unidade escolhida, com uma opção adicional "Sem preferência".
3. **Serviços** — se um profissional específico foi escolhido, lista `GET /barbeiros/:id/servicos` (só os que ele atende); se "sem preferência", lista `GET /servicos` (catálogo completo da barbearia). Seleção múltipla.
4. **Horário** — busca disponibilidade. Se profissional específico: usa a rota já existente `GET /agendamentos/horarios-disponiveis` (que já considera agenda semanal, exceções e agendamentos existentes). Se "sem preferência": usa a nova rota agregada (seção "Extensões de Backend" abaixo).
5. **Confirmação** — resumo (data/hora, serviços, profissional, valor total) com botão "Confirmar", que dispara `POST /agendamentos`. O agendamento só é criado quando o cliente confirma explicitamente — escolher o horário no passo 4 não cria nada ainda.

### 3. "Sem preferência" de profissional é suportado

Fiel à referência visual. Como a rota de disponibilidade existente exige um `barbeiro_id` específico, esta fase adiciona uma rota agregada que cruza a disponibilidade de todos os barbeiros da unidade que atendem TODOS os serviços escolhidos, e atribui automaticamente o primeiro barbeiro disponível a cada slot oferecido.

### 4. "Agendados" vs "Anteriores": por status E data

Um agendamento aparece em "Agendados" apenas se `status = 'confirmado'` E a data/hora de início ainda não passou. Qualquer outra combinação (concluído, cancelado, reagendado, no_show, ou confirmado com data já passada) aparece em "Anteriores". Isso evita que um agendamento cujo admin esqueceu de marcar como concluído continue aparecendo como "próximo" depois do horário já ter passado.

### 5. Home com resumo de assinatura ativa (somente leitura)

A Home mostra: saudação, um bloco com a assinatura ativa do cliente (nome do plano, valor mensal) se houver uma, e a lista de próximos agendamentos. Não há fluxo de **compra** de plano pelo app nesta fase — é puramente informativo, usando dado que já existe no backend (a tabela `assinatura` já é usada internamente no cálculo de desconto de agendamento, só falta expô-la via um endpoint de leitura).

### 6. `cliente_id` sempre vem do JWT no frontend, nunca de input do usuário

A rota `POST /agendamentos` aceita `cliente_id` no corpo da requisição sem validar que é o mesmo do usuário autenticado (só valida que pertence ao mesmo tenant). O frontend é responsável por sempre enviar o `id` do cliente logado (extraído do JWT decodificado, já disponível via `useAuth()`), nunca aceitar esse valor de nenhum campo de formulário.

### 7. Cancelamento de agendamento a partir da lista, sem tela dedicada

Na tela de "Agendamentos", um agendamento com `status = 'confirmado'` mostra um botão "Cancelar" que chama `PATCH /agendamentos/:id/cancelar` diretamente (com confirmação simples, tipo `window.confirm` ou um modal leve) — não há uma tela separada de detalhe do agendamento nesta fase.

## Arquitetura

### Extensões de Backend

Três rotas novas, todas somente leitura (GET) exceto a de confirmação de agendamento que já existe:

**`GET /agendamentos/meus`** (autenticado como cliente, `verificarToken` + `escoparTenant`)
- Query param opcional `?status=agendados|anteriores` (padrão: retorna todos).
- Filtra `cliente_id = req.usuario.id` sempre — um cliente nunca pode listar agendamentos de outro `cliente_id`, mesmo que tente passar um diferente (a rota ignora qualquer `cliente_id` vindo de fora, usa só o do JWT).
- "agendados": `status = 'confirmado' AND data_hora_inicio > now()`.
- "anteriores": tudo que não se encaixa em "agendados" (`status != 'confirmado'` OR `data_hora_inicio <= now()`).
- Retorna array de agendamentos com os serviços e valor total já agregados (mesmo formato de resposta usado em `criarAgendamento`: `{ ...agendamento, itens: [...], valor_total }`), ordenado por `data_hora_inicio` (ascendente para "agendados", descendente para "anteriores").

**`GET /clientes/me/assinatura`** (autenticado como cliente, `verificarToken` + `escoparTenant`)
- Busca a assinatura com `status = 'ativa'` do cliente logado (`req.usuario.id`), com join em `plano` para trazer `nome` e `valor_mensal`.
- Retorna `null` (200, corpo `null`) se não houver assinatura ativa, ou o objeto `{ id, plano: { nome, valor_mensal }, data_inicio, proxima_cobranca, status }` se houver.

**`GET /agendamentos/horarios-disponiveis-qualquer-barbeiro`** (pública, mesmo padrão de `horarios-disponiveis`)
- Query params: `unidade_id`, `servico_ids` (lista separada por vírgula), `data`.
- Descobre todos os barbeiros da unidade que atendem TODOS os `servico_ids` informados (via `barbeiro_servico`).
- Para cada barbeiro candidato, reaproveita a mesma lógica de `listarHorariosDisponiveis` já existente (agenda semanal, exceções, agendamentos existentes).
- Agrega os resultados por horário: cada slot retornado inclui `barbeiro_id` (o primeiro barbeiro disponível encontrado para aquele horário, entre os candidatos, para evitar duplicar o mesmo horário uma vez por barbeiro).
- Formato de resposta: mesmo array de `{ inicio, fim_atendimento }`, acrescido de `barbeiro_id` em cada item.

### Frontend (`barbearia-web/`)

Novas telas, reaproveitando os `Contexts` (Auth, Tema) e o padrão de `api/*.ts` já estabelecidos:

- `src/api/agendamento.ts` — `listarMeusAgendamentos`, `criarAgendamento`, `cancelarAgendamento`, `buscarHorariosDisponiveis`, `buscarHorariosDisponiveisQualquerBarbeiro`.
- `src/api/catalogo.ts` — `listarUnidades`, `listarBarbeiros`, `listarServicosDoBarbeiro`, `listarServicos`.
- `src/api/assinatura.ts` — `buscarMinhaAssinatura`.
- `src/pages/Home.tsx` (reescrita) — bloco de assinatura + lista de próximos agendamentos + botão "Novo agendamento".
- `src/pages/NovoAgendamento.tsx` — wizard de 5 passos, com estado local (não precisa de Context próprio — o fluxo é linear e vive dentro de uma única visita à tela).
- `src/pages/Agendamentos.tsx` — abas Agendados/Anteriores.

## Fora de escopo desta fase

- Tela de cadastro de unidade/barbeiro/serviço (Fase 3).
- Fluxo de compra/assinatura de plano pelo app (só leitura de assinatura existente).
- Tela de reagendamento (o endpoint `PATCH /agendamentos/:id/reagendar` já existe no backend, mas nenhuma tela chama nesta fase).
- Notificações push, upload de foto de perfil.
- Editor de tema com preview visual (Fase 3, embora o endpoint já exista desde a Fase 1).

## Risco técnico a validar no início da implementação

Nenhuma migration nova é necessária (todas as tabelas envolvidas já existem). A rota agregada de "sem preferência" reaproveita a lógica de cálculo de slots já existente em `src/utils/agenda.js` e na função interna de `listarHorariosDisponiveis` — vale confirmar, ao implementar, se essa lógica está isolada o suficiente para ser chamada em loop (uma vez por barbeiro candidato) sem duplicar código.
