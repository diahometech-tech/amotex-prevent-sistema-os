# Amotex Prevent — Sistema de OS

App interno da Amotex Prevent para gestão de ordens de serviço (preventivas e corretivas), checklists, fotos, assinatura digital e dashboard por condomínio. Não é vendido ao condomínio — é ferramenta interna da Amotex.

Contexto de negócio completo, requisitos e arquitetura geral do projeto (incluindo o Agente Hermes, que é um sistema separado): repositório [`amotex-prevent-infra`](https://github.com/diahometech-tech/amotex-prevent-infra), pasta `docs/` (`PRD-v2.md`, `Modelo-de-Dados.md`).

## Origem do código — leia antes de mexer

Este repositório nasceu de um fork do [NexusFlow](https://github.com/Dmc9494/nexusflow) (sistema de onboarding contábil, domínio completamente diferente). O reuso é **só de backend, padrões e componentes funcionais** — nunca de interface visual. Reaproveitado: camada de dados Postgres (`src/lib/db-postgres.ts`), auth com bcrypt + sessão assinada (`src/lib/auth.ts`), upload com câmera mobile (`src/lib/storage.ts`), geração de DOCX (`docx@9`), cálculo de SLA (`src/lib/sla.ts`), padrão de notificação via webhook n8n (`src/lib/notify.ts`), scripts de deploy.

**A interface visual é própria da Amotex** (paleta azul-marinho + vermelho + branco, logo com mascote robô, marca "Amotex Prevent") — nunca reaproveitar tema/layout do NexusFlow. Cores exatas da marca ainda a incorporar como design tokens (aguardando arquivo de paleta oficial do cliente).

## Status do fork (26/08/2026) — em andamento, não use como referência de completude

Feito até agora:
- Histórico do NexusFlow removido (repo começou do zero aqui)
- Conteúdo 100% específico de abertura de empresa removido: rotas `captacao`, `cnpj`, `consulta`, `terceiro`, `os-abertura` (documento de abertura), `crypto.ts` (credenciais Gov.br), páginas `terceiro`/`consulta`
- `postgres/schema.sql` reescrito para o domínio de condomínios (ver `docs/Modelo-de-Dados.md` no repo de infra): `condominio`, `reservatorio`, `contato`, `equipamento`, `usuario`, `alerta`, `playbook`, `escalonamento`, `os`, `checklist_item`, `foto`, `audit_log`

**Ainda não feito — próximos passos, nesta ordem:**
1. Reescrever `src/lib/db.ts` e `src/lib/db-postgres.ts`: hoje ainda modelam `Dossier` (onboarding contábil), precisam virar `Condominio`/`OS`/etc conforme o schema acima
2. Corrigir imports quebrados por arquivos já removidos: `src/app/api/dossiers/[id]/route.ts` e `src/app/api/dossiers/[id]/files-zip/route.ts` ainda referenciam `lib/crypto` e `lib/os-abertura-doc` (deletados) — serão reescritos junto do item 1, não vale corrigir isolado
3. Renomear rotas/entidades de `dossiers` → `os` em todo o `src/app/api` e `src/app/page.tsx` (hoje ainda é o kanban de dossiê contábil)
4. Nova interface visual (design tokens da marca Amotex Prevent)
5. Seed de dados de teste (`src/lib/seed.ts` ainda gera dossiês fake — trocar por condomínios/reservatórios de exemplo)

**Não rode `npm install`/`npm run dev` esperando um app funcional ainda** — a camada de dados e as rotas API estão em transição entre os dois domínios.

## Armadilhas herdadas do NexusFlow (continuam valendo aqui)

- Nunca rodar `npm run build` com o `dev` ativo — corrompe o cache do `.next` (Turbopack)
- Se houver Service Worker, restringir escopo — um `sw.js` com escopo `/` já cacheou API e serviu dado velho no projeto original
