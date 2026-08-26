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

**Ainda não feito — próximos passos, nesta ordem:**
1. **Rotas de API** (~20 arquivos em `src/app/api/dossiers/*`, `activity-logs`, `my-dossiers`, `my-stats`, `projects`, `push/*`, `users/*`) ainda importam os tipos antigos (`Dossier`, `ActivityLog`, `OsTask`, `PushSubscription`) que não existem mais em `db.ts` — quebram até serem reescritas para `Condominio`/`OS`/`AuditLog`/etc. Renomear caminho de rota `dossiers` → `os` junto.
2. **`src/app/page.tsx`** (kanban principal) — hoje ainda modela a esteira de dossiê contábil, é a maior peça de UI a reescrever, e é onde entra a nova identidade visual (não copiar layout/tema do NexusFlow, ver seção acima).
3. **Libs auxiliares que ainda referenciam o domínio antigo:** `src/lib/sla.ts`, `src/lib/notify.ts`, `src/lib/seed.ts`, `src/lib/gestor-scope.ts`, `src/lib/push.ts`, `src/lib/dossie-export.ts` — `sla.ts` e `notify.ts` são os mais valiosos de adaptar (cálculo de prioridade de OS e o padrão de webhook n8n); `gestor-scope.ts` (isolamento por `terceiro_projeto`) provavelmente não se aplica mais e pode ser removido.
4. Seed de dados de teste com condomínios/reservatórios de exemplo (troca de `src/lib/seed.ts`)
5. Design tokens da marca Amotex Prevent (aguardando paleta oficial do cliente)

**`npm install` roda normal, mas `npm run dev`/`npm run build` ainda vão quebrar** — as rotas de API do item 1 têm imports que não existem mais em `db.ts`.

## Armadilhas herdadas do NexusFlow (continuam valendo aqui)

- Nunca rodar `npm run build` com o `dev` ativo — corrompe o cache do `.next` (Turbopack)
- Se houver Service Worker, restringir escopo — um `sw.js` com escopo `/` já cacheou API e serviu dado velho no projeto original
