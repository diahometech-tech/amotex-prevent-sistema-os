# Amotex Prevent — Sistema de OS

App interno da Amotex Prevent para gestão de ordens de serviço (preventivas e corretivas), checklists, fotos, assinatura digital e dashboard por condomínio. Não é vendido ao condomínio — é ferramenta interna da Amotex.

Contexto de negócio completo, requisitos e arquitetura geral do projeto (incluindo o Agente Hermes, que é um sistema separado): repositório [`amotex-prevent-infra`](https://github.com/diahometech-tech/amotex-prevent-infra), pasta `docs/` (`PRD-v2.md`, `Modelo-de-Dados.md`).

## Origem do código — leia antes de mexer

Este repositório nasceu de um fork do [NexusFlow](https://github.com/Dmc9494/nexusflow) (sistema de onboarding contábil, domínio completamente diferente). O reuso é **só de backend, padrões e componentes funcionais** — nunca de interface visual. Reaproveitado: camada de dados Postgres (`src/lib/db-postgres.ts`), auth com bcrypt + sessão assinada (`src/lib/auth.ts`), upload com câmera mobile (`src/lib/storage.ts`), geração de DOCX (`docx@9`), cálculo de SLA (`src/lib/sla.ts`), padrão de notificação via webhook n8n (`src/lib/notify.ts`), scripts de deploy.

**A interface visual é própria da Amotex** (logo com mascote robô, marca "Amotex Prevent") — nunca reaproveitar tema/layout do NexusFlow. Design tokens extraídos visualmente do material de marca do cliente (aproximados, ajustar se um manual de marca com hex exatos aparecer depois):

```css
--bg-primary: #0B1E3A;    /* fundo principal, header */
--bg-panel: #132A4D;      /* cards, painéis, modal */
--brand-red: #D6161F;     /* logo, CTAs, destaques, prioridade alta */
--accent-blue: #2E5C94;   /* ícones secundários, badges informativos */
--text-on-dark: #FFFFFF;
--text-muted: #9BAAC4;
```

## Status do fork (26/08/2026) — em andamento, não use como referência de completude

Feito até agora:
- Histórico do NexusFlow removido (repo começou do zero aqui)
- Conteúdo 100% específico de abertura de empresa removido: rotas `captacao`, `cnpj`, `consulta`, `terceiro`, `os-abertura` (documento de abertura), `crypto.ts` (credenciais Gov.br), páginas `terceiro`/`consulta`
- `postgres/schema.sql` reescrito para o domínio de condomínios (ver `docs/Modelo-de-Dados.md` no repo de infra): `condominio`, `reservatorio`, `contato`, `equipamento`, `usuario`, `alerta`, `playbook`, `escalonamento`, `os`, `checklist_item`, `foto`, `session_log`, `audit_log`
- **`src/lib/db.ts` e `src/lib/db-postgres.ts` reescritos por completo** para o novo domínio (interface `DbBackend` com as 12 entidades acima, backend JSON local + backend Postgres, ambos com o mesmo shape). `Database.finalizarOS()` já implementa a trava de qualidade (não finaliza com item obrigatório de checklist pendente).
- `src/lib/auth.ts` ajustado: `UserRole` agora é `admin | tecnico | sindico`; `canManageUsers` só admin; `isFieldRole` (captador/terceiro/certificador) virou `isScopedToOwnCondominio` (síndico só vê o próprio condomínio); cookie de sessão renomeado de `nexus_session` para `amotex_session`

**Backend 100% reescrito e compilando limpo (`npx tsc --noEmit` só acusa erro em `page.tsx`):**
- Todas as rotas de API reescritas pro domínio novo: `condominios/*` (+ `[id]/reservatorios`, `/contatos`, `/equipamentos`, com de-para SensorLog), `os/*` (+ `[id]/checklist`, `/checklist/[itemId]`, `/fotos`), `users/*`, `auth/*`, `session-logs`, `activity-logs`. RBAC: `admin` gerencia cadastros, `admin`+`tecnico` operam OS, `sindico` só lê o próprio condomínio (`canAccessCondominio` em `auth.ts`).
- Removidas rotas/features que não existem no nosso domínio: `push/*` (web push), `tasks/*` e `dossiers/[id]/tasks/*` (atribuição de tarefa entre colegas), `projects/*` (conceito de "projeto" era da Contex), `users/directory`, `dossiers/deleted`/`restore` (sem soft-delete de OS no schema).
- `src/lib/notify.ts` adaptado — eventos `os_created`/`os_status_changed`/`os_finalizada` (mesmo padrão de webhook n8n já validado no protótipo do Hermes).
- `src/lib/sla.ts` reescrito como `computeUrgencia`/`computeResumoRotas` — nosso domínio não tem funil multi-etapa (isso era específico da Contex), é prioridade + tempo em aberto.
- `src/lib/uploads.ts` adaptado: fotos da OS usam nome único (UUID) por arquivo, já que uma OS tem várias fotos antes/depois (diferente do modelo antigo de 1 arquivo por campo).
- **Campo `prioridade` (alta/media/baixa) adicionado à entidade `OS`** — não estava no `Modelo-de-Dados.md` original, foi identificado como lacuna real ao montar o mockup visual (a lista de OS do PRD pede indicador de prioridade). Refletido em `db.ts`, `db-postgres.ts` e `postgres/schema.sql`.
- Removidos por serem código morto/fora de escopo: `src/lib/gestor-scope.ts`, `src/lib/dossie-export.ts`, `src/lib/push.ts`, `src/lib/notifications.ts`, `src/lib/seed.ts`.

**Ainda não feito:**
1. Protótipo visual publicado no Claude Design com os design tokens abaixo — ver link combinado na conversa que gerou este checkpoint (não versionado aqui, é um Artifact separado).
2. Deploy do app nesta VPS (o app em si — o banco já está pronto, ver seção abaixo).

**Feito em 27/08:**
- **PR #1 do frontend mesclado no `main`** (commit `8d4cd6e`) — shell da aplicação, cadastro de condomínio/reservatório/contato/equipamento, lista de OS com modal de detalhe, assinatura digital, upload de foto, painel do síndico. Só tocou UI + `src/lib/{os-priority,permissions,condominio-stats}.ts` (lógica pura, fora do escopo do backend) — nada em `api/`, `db.ts`, `auth.ts`.
- **`src/lib/os-priority.ts` reconciliado** com o campo manual `os.prioridade` (commit `6b41fd8`) — resolve o `TODO(merge)` deixado pela sessão de frontend: base = valor manual (alta/media/baixa), tipo/origem/tempo em aberto só escalam pra cima, nunca rebaixam. "Urgente" (4º nível da escala visual) só é alcançável por agravante.
- **`npx tsc --noEmit` limpo no projeto inteiro** (backend + frontend mesclados) — build de produção deixou de estar bloqueado por erro de tipo.
- `scripts/seed.ts` (`npm run seed`) — dados de exemplo pra dev/teste local: 2 condomínios, reservatórios com de-para SensorLog, cadeia de contatos por nível de escalonamento, 1 usuária síndica escopada (`marisa.sindica` / `sindica123`), 4 OS cobrindo tipo/status/prioridade/origem diferentes (inclusive uma com checklist obrigatório pendente, pra exercitar a trava de `finalizarOS`). Usa a classe `Database` — roda contra o backend JSON local por padrão, ou contra o Postgres se `DATABASE_URL` estiver definido no ambiente.
- Banco de produção provisionado na VPS (`amotex_os`, schema aplicado) — ver `CLAUDE.md` do repo `amotex-prevent-infra`. Ainda sem dados de exemplo lá (seed rodou só localmente até agora).

## Armadilhas herdadas do NexusFlow (continuam valendo aqui)

- Nunca rodar `npm run build` com o `dev` ativo — corrompe o cache do `.next` (Turbopack)
- Se houver Service Worker, restringir escopo — um `sw.js` com escopo `/` já cacheou API e serviu dado velho no projeto original
