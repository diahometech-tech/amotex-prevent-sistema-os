# Amotex Prevent — Sistema de OS

App interno da Amotex Prevent para gestão de ordens de serviço (preventivas e corretivas), checklists, fotos, assinatura digital e dashboard por condomínio. Não é vendido ao condomínio — é ferramenta interna da Amotex.

Contexto de negócio completo, requisitos e arquitetura geral do projeto (incluindo o Agente Hermes, que é um sistema separado): repositório [`amotex-prevent-infra`](https://github.com/diahometech-tech/amotex-prevent-infra), pasta `docs/` (`PRD-v2.md`, `Modelo-de-Dados.md`).

## Origem do código — leia antes de mexer

Este repositório nasceu de um fork do [NexusFlow](https://github.com/Dmc9494/nexusflow) (sistema de onboarding contábil, domínio completamente diferente). O reuso é **só de backend, padrões e componentes funcionais** — nunca de interface visual. Reaproveitado: camada de dados Postgres (`src/lib/db-postgres.ts`), auth com bcrypt + sessão assinada (`src/lib/auth.ts`), upload com câmera mobile (`src/lib/storage.ts`), padrão de notificação via webhook n8n (`src/lib/notify.ts`), scripts de deploy. Geração de PDF é `pdfkit` (`src/lib/os-pdf.ts`), não o `docx@9` original do NexusFlow (removido — sem uso desde o fork).

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
- `src/lib/sla.ts` reescrito como `computeUrgencia`/`computeResumoRotas` — nosso domínio não tem funil multi-etapa (isso era específico da Contex), é prioridade + tempo em aberto. **Removido em 30/08** (ver issue #9 abaixo): as duas funções contavam urgência pelo campo manual cru e nenhuma tinha mais consumidor depois de `resumoRotasPorCondominio()`.
- `src/lib/uploads.ts` adaptado: fotos da OS usam nome único (UUID) por arquivo, já que uma OS tem várias fotos antes/depois (diferente do modelo antigo de 1 arquivo por campo).
- **Campo `prioridade` (alta/media/baixa) adicionado à entidade `OS`** — não estava no `Modelo-de-Dados.md` original, foi identificado como lacuna real ao montar o mockup visual (a lista de OS do PRD pede indicador de prioridade). Refletido em `db.ts`, `db-postgres.ts` e `postgres/schema.sql`.
- Removidos por serem código morto/fora de escopo: `src/lib/gestor-scope.ts`, `src/lib/dossie-export.ts`, `src/lib/push.ts`, `src/lib/notifications.ts`, `src/lib/seed.ts`.

**Ainda não feito:**
1. Protótipo visual publicado no Claude Design com os design tokens abaixo — ver link combinado na conversa que gerou este checkpoint (não versionado aqui, é um Artifact separado).

**Feito em 28/08 (geração de PDF):**
- **PDF automático da OS ao finalizar** (`src/lib/os-pdf.ts`, pdfkit) — condomínio, dados da OS, checklist, fotos antes/depois, assinaturas. Salvo em `uploads/os/<id>/os.pdf`, `pdf_url` gravado na OS. Falha na geração não desfaz a finalização (retorna `pdfError` na resposta). Dependência `docx@9` removida (não usada desde o fork). Testado ponta a ponta em produção.
- Envio automático por e-mail/WhatsApp é "Should" no PRD, não "Must" — decidido rotear via workflow n8n (WhatsApp sai pelo canal nativo do Hermes, não pelo Next.js) em vez de construir SMTP no app. Entra junto com o trabalho do Hermes.
- Backlog de frontend restante registrado na [issue #5](https://github.com/diahometech-tech/amotex-prevent-sistema-os/issues/5): dashboard admin (KPIs), gestão de rotas dedicada, reescrita de `/admin/usuarios`.

**Feito em 28/08 (auditoria pós-deploy):**
- **PATCH /api/reservatorios/[id] e PATCH /api/contatos/[id]** — faltavam (issue #3, achada pela sessão de frontend auditando a UI contra as rotas reais). Admin apenas; reservatório com checagem de unicidade do `nome_sensorlog` excluindo o próprio registro.
- **Bug real no backend JSON local**: `updateX` fazia spread ingênuo (`{...atual, ...updates}`), então um PATCH parcial sobrescrevia com `undefined` qualquer campo não enviado — Postgres não tinha esse problema (`buildSet` já ignora undefined), então dev e produção divergiam silenciosamente. Corrigido com `stripUndefined()` nos 6 métodos de update do `jsonBackend`.
- **Gap de autorização em `/uploads/[...path]`**: exigia sessão mas não verificava condomínio — um síndico autenticado abria foto/assinatura de qualquer OS sabendo o UUID. Agora resolve a OS pelo path e aplica `canAccessCondominio` antes de servir o arquivo. Confirmado com teste ponta a ponta (não só leitura de código): cross-condomínio bloqueado (403), próprio condomínio liberado (200), admin liberado, sem sessão dá 401.
- **Bug crítico em produção, já corrigido**: a tela de login enviava `username`, a API esperava `login` — ninguém conseguia entrar com senha nenhuma. Achado e corrigido de forma independente pela sessão de frontend (commit `ddbf4c1`) quase ao mesmo tempo que aqui; ficamos com a dela.

**Feito em 27/08:**
- **PR #1 do frontend mesclado no `main`** (commit `8d4cd6e`) — shell da aplicação, cadastro de condomínio/reservatório/contato/equipamento, lista de OS com modal de detalhe, assinatura digital, upload de foto, painel do síndico. Só tocou UI + `src/lib/{os-priority,permissions,condominio-stats}.ts` (lógica pura, fora do escopo do backend) — nada em `api/`, `db.ts`, `auth.ts`.
- **`src/lib/os-priority.ts` reconciliado** com o campo manual `os.prioridade` (commit `6b41fd8`) — resolve o `TODO(merge)` deixado pela sessão de frontend: base = valor manual (alta/media/baixa), tipo/origem/tempo em aberto só escalam pra cima, nunca rebaixam. "Urgente" (4º nível da escala visual) só é alcançável por agravante.
- **`npx tsc --noEmit` limpo no projeto inteiro** (backend + frontend mesclados) — build de produção deixou de estar bloqueado por erro de tipo.
- `scripts/seed.ts` (`npm run seed`) — dados de exemplo pra dev/teste local: 2 condomínios, reservatórios com de-para SensorLog, cadeia de contatos por nível de escalonamento, 1 usuária síndica escopada (`marisa.sindica` / `sindica123`), 4 OS cobrindo tipo/status/prioridade/origem diferentes (inclusive uma com checklist obrigatório pendente, pra exercitar a trava de `finalizarOS`). Usa a classe `Database` — roda contra o backend JSON local por padrão, ou contra o Postgres se `DATABASE_URL` estiver definido no ambiente.
- Banco de produção provisionado na VPS (`amotex_os`, schema aplicado) — ver `CLAUDE.md` do repo `amotex-prevent-infra`. Ainda sem dados de exemplo lá (seed rodou só localmente até agora).

**Feito em 31/08 (frontend — fecha a issue #5 e a #6):**
- **Dashboard admin (`/dashboard`)** — KPIs (OS abertas, pendências críticas, alertas nas últimas 24h, condomínios monitorados), lista de OS que precisam de atenção (abre o `OSModal`), alertas recentes e resumo de rota do dia. Admin apenas: o gate real é o 403 do servidor em `GET /api/alertas`, não uma checagem de papel no cliente. Alerta com de-para não resolvido é sinalizado na tela, nunca escondido.
- **Gestão de Rotas (`/rotas`)** — OS ativas agrupadas por condomínio (mais crítico primeiro), com "Marcar Visitado" (`PATCH /api/os/[id]` com `entrada_em` + `status: em_andamento`) e detalhe via `OSModal`. Admin ou técnico.
- **Catálogo de equipamento no `EquipamentoForm`** — combobox (`<datalist>` nativo) sobre `GET /api/equipamentos/catalogo`; selecionar preenche tipo/modelo/potência, digitar algo novo segue como cadastro manual.
- **`AppShell`**: nav unificada com `gate` por item, reaproveitando `canManageUsers`/`canManageOS` de `permissions.ts`.

**Correções da revisão de código do frontend (mesmo dia, 8 achados confirmados + 1 achado próprio):**
- **Técnico nunca via nome de técnico nenhum** (`/` e `/rotas`): `GET /api/users` responde em dois formatos — admin recebe a lista completa (com `papel`), técnico recebe `{id, nome}` reduzido (já só com técnicos ativos). O filtro `papel === 'tecnico'` zerava a lista inteira pro técnico. Agora aceita também quem chega sem `papel`.
- **Contagem de "urgentes" divergia do badge da própria tela**: `computeResumoRotas` (em `sla.ts`) conta por `os.prioridade === 'alta'` (campo manual cru de 3 níveis), enquanto os badges usam `computeOsPrioridade` (escala visual de 4 níveis, que escala por tipo/origem/tempo). Uma corretiva automática com prioridade "media" aparecia com badge **Urgente** e o card dizia **0 urgentes** — e o `sort` chegava a empurrar o condomínio mais crítico para baixo. Corrigido com `resumoRotasPorCondominio()` novo em `src/lib/os-priority.ts` (contagem e ordem saem da MESMA função que pinta o badge). `sla.ts` é do backend e **não foi tocado** — a divergência foi reportada lá.
  - **Resolvido na raiz em 30/08 (backend, issue #9)**: `sla.ts` foi removido por inteiro, não só `computeResumoRotas`. `computeUrgencia` (a outra função do arquivo) tinha exatamente a mesma armadilha — também lia `os.prioridade === 'alta'` cru — e também já estava sem consumidor nenhum desde a migração pra `resumoRotasPorCondominio()`. Deixar o arquivo ali, mesmo inerte, era uma armadilha pronta pra alguém importar nele de novo.
- **Falha do `GET /api/os` no dashboard era silenciosa**: KPIs zeravam sem aviso e o admin lia "nada pendente". Agora qualquer fonte que falhar aparece num banner nomeando o que não carregou.
- **KPI de alertas saturava em 15** (era o `?limit=` do fetch exibido como número real). Agora busca 100 e o KPI conta uma janela real de 24h; a lista lateral continua cortada em 15.
- Fallback de técnico não resolvido passava o **UUID pela função de iniciais** e exibia uma letra sem sentido — removido.
- Banner de erro do "Marcar Visitado" **não limpava** num retry bem-sucedido.
- `catalogoLabel` **colidia com `potencia_hp = 0`** (o campo aceita 0): chave duplicada no React e seleção do item errado no datalist.
- **Achado próprio, fora da revisão**: o síndico não via o ícone de Rotas mas abria a tela pela URL. Sem vazamento (o `GET /api/os` já escopa síndico ao próprio condomínio no servidor), mas a tela ganhou o mesmo gate do menu.
- Não corrigido de propósito: `<Button>` dentro de `<Link>` é aninhamento interativo inválido, mas é o padrão já usado em `painel/[id]` e `condominios/[id]` (3 ocorrências) — mexer só numa criaria inconsistência. Vale uma passada dedicada no projeto inteiro.

**Validação dessas correções** (não só leitura de código): `tsc` e `eslint` limpos, `npm run build` OK, e teste ponta a ponta em navegador real (Playwright) nos 3 papéis — nome de técnico resolvendo como técnico, contagens batendo com os badges, banner de erro aparecendo com a API derrubada e limpando no retry, catálogo sem colisão em 0 HP, e RBAC conferido em `/dashboard` e `/rotas`.

## Armadilhas herdadas do NexusFlow (continuam valendo aqui)

- Nunca rodar `npm run build` com o `dev` ativo — corrompe o cache do `.next` (Turbopack)
- Se houver Service Worker, restringir escopo — um `sw.js` com escopo `/` já cacheou API e serviu dado velho no projeto original
- `GET /api/users` tem **dois formatos de resposta** conforme o papel (completo pro admin, `{id, nome}` pro técnico). Qualquer filtro por `papel` no cliente precisa tolerar o campo ausente — já quebrou a lista de técnicos duas vezes.
- Escala de prioridade tem **duas fontes**: `os.prioridade` (campo manual, 3 níveis, no banco) e `computeOsPrioridade` (escala visual, 4 níveis, com agravantes). Contagem/ordenação exibida ao lado de um badge tem que usar a mesma função do badge, senão diverge silenciosamente.
