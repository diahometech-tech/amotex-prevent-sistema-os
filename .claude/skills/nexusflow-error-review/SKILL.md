---
name: nexusflow-error-review
description: Revisão diária de erros de produção do NexusFlow — cruza logs de execução (PM2, na VPS) com a trilha de auditoria (activity_logs/session_logs, no Postgres) das últimas 24h, identifica bugs reais, gera relatório e prepara PR de correção (draft, nunca merge automático). Use quando o usuário pedir "revisão diária de erros", "checar logs de produção", ou quando este skill for chamado por um agendamento (cron) local.
---

# Revisão diária de erros — NexusFlow

Este skill roda **na máquina local do usuário** (não no ambiente remoto/cloud), porque só ela tem
acesso SSH configurado à VPS da Contex e as credenciais necessárias (ver `reference_vps.md` /
memória persistente do Claude Code do usuário — nunca ficam neste repositório).

**Carregue primeiro a skill `nexusflow-context`** (regras de negócio, incidentes conhecidos) —
muitos "erros" nos logs já são bugs documentados lá; não trate como novo achado algo que já foi
corrigido ou é comportamento esperado.

## Objetivo

Não é achar qualquer `console.error` — é separar **ruído conhecido** de **bug real e novo**, dar
causa raiz com localização exata no código, e (quando o fix for de baixo risco e alta confiança)
já preparar a correção numa branch + PR draft para o usuário revisar. Nunca faz merge sozinho.

## Passo a passo

### 0. Snapshot de integridade de campos essenciais (antes de tudo)

Motivado por um relato real de usuário (medo de anexo/dado "sumir" numa atualização) —
esta etapa não procura erro em log, procura **perda de dado real**, que é diferente de bug
de exibição (dado continua no banco, só não aparece na tela — já aconteceu várias vezes,
ver `nexusflow-context`).

```bash
scripts/nexusflow-integrity-snapshot.sh
```

Requer `DATABASE_URL` (mesma variável de produção). Conta, no Postgres, quantas OS têm
`certificado_a1_url`, `cnpj_comprovante_url`, `certidao_inteiro_teor_url`, `cert_email`,
`cert_aparelho`, `t2_new_email`, `t2_new_phone` preenchidos (+ total de OS não excluídas) e
compara com o snapshot do dia anterior, guardado em
`docs/integridade-dados/historico.csv` (versionado no repo — é o que permite comparar com
"ontem" a partir de qualquer máquina). **Nenhum destes contadores deveria cair nunca** —
migrações do Postgres só fazem `ADD COLUMN`/`UPDATE` em campo vazio, nunca `DROP`/
sobrescrita (ver `db-postgres.ts`).

Se o script sair com código 2 (algum contador caiu): trate como **achado crítico**, primeiro
item do relatório do passo 4, independente do que mais for encontrado no dia. Isso NÃO segue
o fluxo normal do passo 5 ("PR draft de baixo risco") — antes de propor qualquer correção:

1. Cruze com a auditoria (`activity_logs`) das últimas 24h procurando qualquer
   `DELETE`/edição em massa que explique a queda (ex.: alguém apagou OS pela Lixeira, um
   script ad-hoc rodou direto no banco).
2. Se achar explicação de negócio legítima (ex.: gestor excluiu OS de teste), documente no
   relatório e siga — não é bug.
3. Se NÃO achar explicação, **avise o usuário imediatamente** (não espere o relatório do fim
   do dia) — é o único tipo de achado desta skill que justifica interromper o fluxo normal
   pra alertar na hora, porque significa que dado real pode ter sido perdido e quanto mais
   tempo passa, mais difícil fica de recuperar/investigar.

### 1. Coletar logs de execução (PM2, VPS)

```bash
scripts/nexusflow-fetch-logs.sh 24 /tmp/nexusflow-logs-$(date +%F).txt
```

Requer `NEXUSFLOW_VPS_HOST` no ambiente (host/alias SSH da VPS — pergunte ao usuário ou consulte
a memória persistente dele se não estiver setado). Se o arquivo vier vazio ou sem timestamps
reconhecíveis, verifique se `ecosystem.config.js` tem `log_date_format` e se a VPS já rodou
`pm2 restart ecosystem.config.js` (ou `pm2 delete nexusflow && pm2 start ecosystem.config.js`)
depois da mudança — um `pm2 restart nexusflow` simples NÃO relê o ecosystem file.

### 2. Coletar trilha de auditoria (Postgres)

Via `psql "$DATABASE_URL"` (mesma variável de produção — pegar do `.env` da VPS ou da memória do
usuário, nunca commitar), consultar as últimas 24h de `activity_logs` e `session_logs` (mesmas
tabelas que alimentam `/api/activity-logs` e `/api/session-logs` — ver `src/lib/db-postgres.ts`
para o schema exato antes de escrever a query). Isso não é log de erro técnico — é contexto de
**uso**: serve para correlacionar "erro tal aconteceu às 14:32" com "usuário X estava fazendo
ação Y às 14:31" (mesmo dossiê/rota), o que ajuda demais a reproduzir e a confirmar causa raiz.

### 3. Analisar

1. Agrupe as linhas de erro por assinatura (mesma mensagem/stack, ignorando valores variáveis
   tipo IDs) — reporte contagem de ocorrências, não cada linha crua.
2. Para cada assinatura distinta:
   - Ache a origem exata no código (`grep -rn "<trecho da mensagem>" src/`).
   - Leia contexto suficiente pra entender a causa raiz de verdade (não especule).
   - Cruze com a auditoria do passo 2: qual usuário/papel/dossiê estava envolvido, se der pra saber.
   - Confira contra os "Incidentes conhecidos" da skill `nexusflow-context` — se já é um bug
     mapeado e corrigido, mas ainda aparece, isso é sinal de regressão (destaque isso explicitamente).
3. Aplique o mesmo padrão de confiança usado em revisões de segurança deste projeto: só proponha
   fix pra causa raiz que você confirmou lendo o código, não para sintoma superficial.

### 4. Relatório

Escreva em `docs/relatorios-erros/YYYY-MM-DD.md` (criar pasta se não existir):

```markdown
# Revisão de erros — YYYY-MM-DD

## 🚨 Integridade de dados (passo 0)
OK, nenhum contador caiu. / OU: contador(es) X caiu(íram) — ver investigação abaixo.

## Resumo
N erros distintos, M ocorrências totais, período HH:MM–HH:MM.

## Achado 1: <mensagem/assinatura> (Nx)
- Local: arquivo:linha
- Causa raiz: ...
- Usuários/ações envolvidas (via auditoria): ...
- Já documentado em nexusflow-context? sim/não
- Proposta de correção: <diff ou descrição> — Confiança: alta/média/baixa
- Ação tomada: PR draft #NN aberto / precisa de decisão do usuário / nenhuma (ruído/já corrigido)
```

Se não houver nenhum erro novo no período, **não crie um arquivo cheio** — só adicione uma linha
em `docs/relatorios-erros/INDICE.md` tipo `YYYY-MM-DD — sem ocorrências novas` (crie o índice se
não existir). Isso evita acumular arquivos vazios todo dia.

### 5. Preparar correção (só quando fizer sentido)

Para achados com **confiança alta e risco baixo** (bug técnico claro, sem ambiguidade de regra de
negócio — mesmo critério usado na revisão de segurança RBAC/IDOR já feita neste projeto):

1. Branch nova a partir de `master` atualizado: `fix/auto-YYYY-MM-DD-<slug-curto>`.
2. Aplique o fix mínimo necessário (sem refactor além do escopo).
3. `npx tsc --noEmit` limpo (NUNCA rode `npm run build` com `npm run dev` ativo na mesma pasta —
   corrompe o cache do Turbopack, ver `AGENTS.md`).
4. Commit + push da branch.
5. Abra PR **draft** contra `master` (nunca mescla sozinho — mesmo em automação, correção de
   produção precisa de revisão humana antes de ir pro ar).
6. Registre o número do PR no relatório do passo 4.

Se o achado for ambíguo (pode ser regra de negócio, não bug; ou o fix exigiria decisão de
arquitetura), **não tente corrigir** — só documente a dúvida no relatório para o usuário decidir.

## Agendamento (fica por conta do usuário, fora deste skill)

Este skill não se auto-agenda. Para rodar diariamente, o usuário configura um cron (ou
equivalente) na própria máquina chamando o Claude Code em modo não-interativo, por exemplo:

```cron
0 8 * * * cd /caminho/para/nexusflow && NEXUSFLOW_VPS_HOST=contex-vps claude -p "/nexusflow-error-review" >> ~/nexusflow-error-review.log 2>&1
```

Isso vai pedir aprovação de permissão pra cada ferramenta na primeira vez (ssh, psql, git, gh) —
o usuário precisa either rodar interativamente uma vez pra aprovar, ou adicionar um allowlist
específico (`ssh contex-vps`, `psql`, comandos `git`/`gh` restritos ao padrão de branch
`fix/auto-*`) em `.claude/settings.local.json` (arquivo local, não versionado — não colocar
credenciais nem hosts nesse arquivo compartilhado do repo).
