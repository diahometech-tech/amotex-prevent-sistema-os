# Migração NexusFlow → Supabase + Vercel

Estado atual: MVP roda **100% local** com banco em `src/lib/local_db.json` (custo zero).
Este guia leva para produção na nuvem **sem reescrever a aplicação** — a camada de
dados está concentrada na classe `Database` (`src/lib/db.ts`), que é o único ponto
a trocar.

## Visão geral (o que muda)

| Camada | Hoje (local) | Nuvem (alvo) |
|---|---|---|
| Banco | JSON em arquivo | Postgres (Supabase) |
| Auth/sessão | cookie base64 não assinado | Supabase Auth (JWT) |
| Senha usuários | texto puro no JSON | `auth.users` (hash gerenciado) |
| Anexos | `public/uploads` no disco | Supabase Storage (bucket) |
| Credencial Gov | `[AES256-ENC]` (base64 fake) | `pgcrypto`/Vault + função auditada |
| Hospedagem | `npm run dev` | Vercel |

## Passo a passo

### 1. Criar projeto Supabase (free)
- Crie o projeto, copie `Project URL`, `anon key` e `service_role key`.
- Preencha o `.env.local` a partir do `.env.example`.

### 2. Rodar o schema
- SQL Editor → cole e rode `supabase/schema.sql` (idempotente; já cobre
  dossiers, profiles, checklists, activity_logs, campos da OS de Abertura,
  `captured_by`, `protocolo`, índices e RLS básica).

### 3. Storage de anexos
- Crie um bucket `documentos` (privado).
- Trocar `saveDataUrl`/`saveBase64Image` (hoje gravam em `public/uploads`) por
  upload ao bucket via `supabase.storage.from('documentos').upload(...)`,
  guardando a URL assinada.

### 4. Instalar o client e criar o adaptador
```bash
npm install @supabase/supabase-js
```
- Criar `src/lib/supabase.ts` com `createClient(URL, ANON)` (client) e um client
  `service_role` para uso exclusivo nas rotas `/api`.
- Reimplementar os métodos da classe `Database` (getDossiers, createDossier,
  updateDossier, deleteDossier, getUsers, etc.) usando as tabelas do Supabase.
  **A assinatura dos métodos não muda** → o resto do app continua igual.

### 5. Autenticação
- Trocar `src/lib/auth.ts` (cookie base64) pelo Supabase Auth (SSR helpers
  `@supabase/ssr`). As rotas `/api/auth/*` deixam de ser necessárias.
- O guard em `page.tsx` (`/api/auth/me`) passa a usar a sessão do Supabase.
- Migrar os 7 usuários-semente como `auth.users` (a trigger `handle_new_user`
  cria o `profile` com o papel).

### 6. Credenciais Gov (LGPD)
- Substituir o `[AES256-ENC]` por criptografia real (`pgcrypto` com
  `GOV_ENCRYPTION_KEY`) e expor a senha só por função `SECURITY DEFINER` que
  grava em `activity_logs` (replica o `/api/dossiers/[id]/reveal`).

### 7. Migrar os dados de demonstração (opcional)
- Inserir o conteúdo de `local_db.json` (dossiers, logs) via script `seed` ou
  CSV import. Em produção real, começar vazio (`NEXUSFLOW_NO_SEED=1`).

### 8. Deploy na Vercel
- Importar o repo, setar as env vars do `.env.example`, deploy.
- Custo estimado em produção: ~R$ 250–400/mês (Supabase Pro + Vercel Pro).

## Hardening pendente (anotado durante o MVP)
- `GET /api/dossiers` (lista) ainda sem gate de sessão → no Supabase, RLS resolve.
- Senha de usuário em texto puro → resolvido pelo Supabase Auth.
- Sessão por cookie não assinado → resolvido pelo JWT do Supabase.
- View restrita do **Terceiro** (e-mail/telefone/CNPJ/protocolo) via RLS por papel.
