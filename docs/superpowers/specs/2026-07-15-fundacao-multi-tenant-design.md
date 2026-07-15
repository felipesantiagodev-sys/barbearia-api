# Fundação Multi-Tenant — Design

**Data:** 2026-07-15
**Status:** Aprovado para planejamento
**Fase:** 1 de N (fundação de isolamento; onboarding completo de tenants, billing SaaS, e infraestrutura AWS ficam para fases futuras)

## Contexto

O `barbearia-api` foi construído como aplicação mono-tenant (uma instância = um cliente implícito). O objetivo de produto é transformá-lo em SaaS multi-tenant vendido para milhares de barbearias na mesma instância da aplicação e do banco.

Um mapeamento completo do código (ver investigação desta sessão) confirmou que **hoje não existe nenhum isolamento entre barbearias**: nenhuma query filtra por `barbearia_id` a partir do usuário autenticado. Um admin logado em qualquer barbearia pode ler/escrever dados de qualquer outra (`cliente`, `agendamento`, `financeiro`, etc). Isso é um vazamento de dados garantido (OWASP A01:2021 – Broken Access Control) assim que houver 2+ barbearias reais usando o sistema simultaneamente — não um risco teórico.

Esta fase entrega a **fundação de isolamento**: schema com `barbearia_id` em todas as tabelas, Row-Level Security no Postgres como segunda camada de defesa, JWT escopado por tenant, middleware que aplica o escopo em toda requisição, e correção de todas as queries que hoje vazam entre tenants. Não inclui: fluxo de onboarding/signup de novas barbearias, billing da plataforma, painel de super-admin além do mínimo para desbloquear com segurança a criação de tenants, nem mudanças de infraestrutura (deploy, AWS, observabilidade) — essas são fases futuras separadas.

## Decisões de Arquitetura

### 1. Estratégia de isolamento: banco compartilhado + `barbearia_id` + RLS

Todas as barbearias compartilham a mesma instância de PostgreSQL e as mesmas tabelas. Cada tabela relevante ganha uma coluna `barbearia_id`, e o Postgres aplica Row-Level Security (RLS) para bloquear acesso cross-tenant no nível do banco, independente de a aplicação lembrar de filtrar ou não.

**Alternativas consideradas e descartadas:**
- *Schema-per-tenant:* isolamento mais forte, mas migrations precisam rodar em milhares de schemas, connection pooling fica caro, e não escala operacionalmente para 10k+ tenants sem tooling dedicado adicional.
- *Database-per-tenant:* isolamento máximo, mas custo de infra inviável nesse volume; reservado normalmente para poucos clientes enterprise de altíssimo valor, não para o modelo de volume (Trinks/Booksy/AgendaPro).

**Por que RLS além do filtro na aplicação:** confiar só em `WHERE barbearia_id = $1` em cada query é frágil — um único endpoint novo escrito sem esse filtro (como já aconteceu em praticamente todo o código atual) reabre o vazamento. RLS é a rede de segurança que torna o vazamento estruturalmente impossível mesmo com esse tipo de erro humano.

### 2. Definição de tenant: `barbearia` é a raiz

`barbearia.id` é o `barbearia_id` usado como chave de isolamento em todas as tabelas. Uma rede com múltiplas unidades continua sendo um único tenant — bate com o modelo de produto (Trinks/Booksy: a empresa assina o plano, não cada filial).

### 3. Cliente final: isolado por tenant (não compartilhado entre barbearias)

Hoje `cliente` não tem nenhum vínculo com barbearia. Isso muda: `cliente` ganha `barbearia_id NOT NULL`, e a constraint de unicidade de email passa de global (`UNIQUE(email)`) para `UNIQUE(barbearia_id, email)`. O mesmo se aplica a `usuario_admin`.

Justificativa: é o modelo padrão de SaaS B2B (cada negócio dono dos próprios dados de clientes) e simplifica drasticamente LGPD/GDPR — se uma barbearia cancela a assinatura ou é banida, os dados de clientes dela saem junto, sem tocar em nenhuma outra barbearia. O modelo alternativo (cliente global tipo marketplace) exigiria uma tabela de relacionamento N:N e políticas de RLS substancialmente mais complexas sem benefício de produto correspondente.

### 4. Novo papel: `usuario_plataforma` (super-admin)

Hoje `POST /barbearias` (criar uma barbearia nova) é uma rota pública sem autenticação — qualquer pessoa na internet pode criar um tenant. Esta fase introduz uma tabela `usuario_plataforma`, estruturalmente **fora** da hierarquia de tenant (sem `barbearia_id`, ou com o valor sempre `NULL`), e um novo tipo de JWT (`tipo: 'plataforma'`) usado para proteger a criação de barbearias e futuras operações administrativas globais.

Não é um painel completo de gestão de tenants — é o mínimo necessário para (a) fechar o buraco de segurança da criação pública de tenants, e (b) fixar o modelo de dados certo desde já, porque adicionar "usuário sem tenant" depois que as RLS policies já estão em produção é caro (exige revisar toda policy já escrita).

### 5. Resolução de tenant: `barbearia_id` embutido no JWT

No login (admin ou cliente), o JWT emitido carrega `barbearia_id` além de `id` e `tipo`. Um middleware novo (`escoparTenant`) roda depois de `verificarToken` em toda rota protegida, e:

1. Extrai `barbearia_id` de `req.usuario`.
2. Abre uma conexão dedicada do pool (`pool.connect()`), inicia uma transação (`BEGIN`), executa `SELECT set_config('app.tenant_id', $1, true)` (o `true` = escopo `LOCAL`, válido só até o `COMMIT`/`ROLLBACK` da transação).
3. Injeta esse client em `req.db` para os controllers usarem durante toda a requisição.
4. Ao final da requisição (`res.on('finish')` ou bloco `finally` no próprio middleware), faz `COMMIT` (ou `ROLLBACK` em caso de erro) e libera o client de volta ao pool.

**Alternativas descartadas:**
- *Subdomínio por tenant:* passa mais "cara" de produto white-label, mas exige DNS wildcard, certificado SSL wildcard e roteamento extra — complexidade de infra que só compensa se domínio próprio for vendido como diferencial pago. Não é o caso agora.
- *Header customizado enviado pelo cliente:* inseguro por natureza — um header pode ser forjado; exigiria validação cruzada extra que o JWT assinado já resolve de graça.

**Por que client dedicado por requisição, não `pool.query()` direto:** RLS depende de uma variável de sessão (`app.tenant_id`) setada via `SET LOCAL`/`set_config`. Com `pool.query()`, cada chamada pode pegar uma conexão diferente do pool, então não há garantia de que a variável setada numa query ainda vale na próxima. Um client dedicado por requisição, com a variável setada dentro de uma transação que envolve toda a requisição, garante que RLS vale para toda operação daquele request — e tem o benefício colateral de tornar `criarAgendamento`/`reagendarAgendamento` (que já usam transação manual hoje) mais simples, já que o client já vem pronto do middleware.

### 6. Row-Level Security: policy padrão + `FORCE ROW LEVEL SECURITY`

Para cada tabela com `barbearia_id`:

```sql
ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <tabela> FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <tabela>
  USING (barbearia_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (barbearia_id = current_setting('app.tenant_id', true)::integer);
```

`FORCE ROW LEVEL SECURITY` é essencial e frequentemente esquecido: sem ele, o *owner* da tabela (tipicamente o mesmo role usado pela aplicação para rodar migrations) contorna o RLS silenciosamente. A aplicação deve rodar com um role que não seja o dono das tabelas, ou `FORCE` garante a política mesmo assim.

`current_setting('app.tenant_id', true)` — o segundo argumento `true` faz retornar `NULL` em vez de lançar erro se a variável não foi setada (ex: uma migration rodando fora do contexto de requisição). Combinado com `usuario_plataforma` (sem tenant), rotas de super-admin usam um bypass explícito e auditável (ver seção 7), nunca um "esquecimento" do `SET`.

### 7. Rotas de super-admin: bypass explícito de RLS

Operações do `usuario_plataforma` (ex: criar barbearia) não têm um `barbearia_id` para setar — por definição, atuam sobre múltiplos tenants ou antes deles existirem. Para essas rotas, o middleware de tenant não roda; em vez disso, um middleware separado (`apenasPlataforma`) valida `tipo === 'plataforma'` e usa uma política de RLS adicional explícita:

```sql
CREATE POLICY plataforma_bypass ON <tabela>
  USING (current_setting('app.is_plataforma', true) = 'true');
```

Setada apenas dentro do middleware de plataforma, nunca por padrão — isso evita que um bug esqueça de restringir e acidentalmente conceda acesso global a uma rota comum.

### 8. Desnormalização de `barbearia_id`

Tabelas que hoje só chegam à barbearia indiretamente (`agendamento` via `unidade_id`, `barbeiro_disponibilidade` via `barbeiro_id`, etc.) ganham a coluna `barbearia_id` diretamente, em vez de policies de RLS fazerem `JOIN` até a raiz a cada linha avaliada.

Justificativa: é a prática recomendada pela AWS SaaS Factory para isolamento em escala. RLS com subquery/JOIN em cada policy é caro (o Postgres paga esse custo em toda leitura) e mais difícil de indexar. Uma coluna direta + índice composto `(barbearia_id, id)` (e `(barbearia_id, <coluna de filtro comum>)` onde fizer sentido, ex: `(barbearia_id, data_hora_inicio)` em `agendamento`) é a base de toda query rápida nessa escala.

A integridade é garantida por `CHECK` ou trigger `BEFORE INSERT` que valida que o `barbearia_id` informado bate com o da entidade pai (ex: `agendamento.barbearia_id` deve ser igual a `unidade.barbearia_id` da unidade referenciada) — isso evita a própria aplicação inserir uma linha com `barbearia_id` inconsistente com sua hierarquia de FKs.

### 9. Migrations: `node-pg-migrate`

Substitui o processo manual atual. Migrations SQL puro (não o modo JS/DSL da lib, para manter auditabilidade total do DDL, especialmente crítico para revisar RLS policies), numeradas e commitadas no repo. Ordem planejada:

1. `001_criar_extensao_e_tabela_usuario_plataforma`
2. `002_adicionar_barbearia_id_em_tabelas_sem_vinculo` (cliente, e desnormalização nas demais)
3. `003_backfill_barbearia_id` (popula dados existentes seguindo a cadeia de FK — idempotente, com validação pós-backfill que falha a migration se alguma linha ficar com `barbearia_id NULL`)
4. `004_tornar_barbearia_id_not_null_e_constraints` (após backfill confirmado, aperta `NOT NULL`, `UNIQUE(barbearia_id, email)`, `CHECK`s de consistência)
5. `005_habilitar_rls_e_policies` (RLS em todas as tabelas + policies de tenant + policy de bypass de plataforma)
6. `006_indices_compostos` (índices `(barbearia_id, ...)` nas colunas mais consultadas)

Migrations separadas por preocupação (schema, dados, constraints, segurança, performance) para que um rollback parcial seja possível e cada etapa seja revisável isoladamente em code review.

### 10. Mudanças na aplicação (Node.js)

- **`src/middlewares/tenant.js`** (novo): `escoparTenant` (client dedicado + `SET LOCAL` + injeta `req.db`) e `apenasPlataforma` (valida `tipo === 'plataforma'` + seta `app.is_plataforma`).
- **`src/controllers/*.js`**: toda query que hoje usa `pool.query`/`client` do próprio controller passa a usar `req.db` (o client escopado). Isso remove a necessidade de qualquer `WHERE barbearia_id = $1` manual nas queries de leitura simples (RLS filtra sozinho) — mas o `INSERT` continua precisando popular `barbearia_id` explicitamente (RLS não inventa esse valor, só valida).
- **`authController.js`**: `loginAdmin` e `loginCliente` passam a incluir `barbearia_id` no payload do JWT (já ocorre para admin; cliente precisa do mesmo). Novo `loginPlataforma` para o super-admin.
- **`cadastrarAdmin`/`criarCliente`**: hoje aceitam `barbearia_id` livremente no body — isso deixa de ser aceitável (um usuário malicioso poderia se auto-cadastrar em qualquer barbearia). Cadastro de admin/cliente passa a exigir que a requisição já esteja autenticada/escopada a um tenant (ex: um admin já logado cadastra outro admin da mesma barbearia; cliente se auto-cadastra via uma rota pública, mas escopada por parâmetro de URL/subdomínio identificando a barbearia de destino — não por campo livre no body).
- **Rotas hoje sem filtro de tenant** (barbeiro, serviço, plano, unidade, cliente, financeiro — listadas no mapeamento): nenhuma mudança de código é necessária além de usar `req.db`, já que RLS resolve o filtro automaticamente. Isso é o principal ganho de usar RLS em vez de só filtro manual: dezenas de queries "esquecidas" são corrigidas de uma vez, sem reescrever cada uma.

### 11. Fora de escopo desta fase (fases futuras)

- Fluxo de onboarding/signup self-service de barbearias (hoje só o super-admin cria; ok por ora).
- Billing/assinatura da plataforma (cobrar a barbearia pelo uso do SaaS — hoje `plano`/`assinatura` são conceitos de negócio da barbearia para seus clientes finais, não da plataforma para a barbearia).
- Infraestrutura AWS, observabilidade, rate limiting por tenant, connection pooling avançado (PgBouncer), read replicas.
- Views `vw_faturamento_mensal`/`vw_desempenho_barbeiro_mensal`: precisam ser recriadas com `barbearia_id` e RLS própria (views não herdam RLS da tabela base automaticamente da mesma forma — precisam ser `security_invoker` ou redesenhadas). Como a `CREATE VIEW` dessas views não existe versionada em lugar nenhum do repositório, a primeira tarefa de implementação relacionada a elas é localizar/recriar essa definição — tratado como parte desta fase por ser um vazamento crítico já identificado (financeiro agregando dados de todas as barbearias), mas como sub-tarefa de descoberta, não uma alteração direta de arquivo existente.

## Risco técnico aberto a validar no início da implementação

O tipo de dado da PK de `barbearia.id` (e portanto de `barbearia_id` em todas as tabelas) não pôde ser confirmado por não haver DDL versionado no repositório. Assumimos `INTEGER`/`SERIAL` com base no padrão observado nas demais FKs do código (nenhum uso de `gen_random_uuid()` encontrado). A primeira tarefa da implementação é conectar ao banco real (`\d barbearia`) e confirmar — se for `UUID`, os casts `::integer` nas policies de RLS acima mudam para `::uuid` e o tipo de `current_setting` muda de acordo, mas a estratégia geral não muda.
