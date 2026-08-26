---
name: nexusflow-context
description: Contexto persistente do NexusFlow — sistema de onboarding contábil da Contex Contabilidade (captação → abertura de empresa → certificação digital). Carregue esta skill sempre que o usuário mencionar "NexusFlow", "Nexus" (no contexto de contabilidade/abertura de empresa), "Contex Contabilidade", "captador"/"certificador"/"operador de abertura" nesse sistema, ou pedir para trabalhar em qualquer arquivo dentro de um clone deste projeto (procure por `page.tsx` com um kanban de "dossiês"/OS, `captador.html`, ou o repositório github.com/Dmc9494/nexusflow). Use esta skill ANTES de editar qualquer código do projeto, mesmo para pedidos pequenos — ela evita repetir bugs já corrigidos e regressões entre sessões que já aconteceram neste projeto.
---

# Contexto do NexusFlow

Este arquivo existe porque sessões diferentes do Claude Code já trabalharam neste
projeto sem saber o que a sessão anterior tinha feito — isso já causou regressões
reais (ver "Incidentes" abaixo). Ler isto primeiro evita repetir esses erros.

**Esta skill é um resumo de um ponto no tempo, não a fonte da verdade.** Antes de
agir, sempre:

1. Confirme que está no diretório certo do projeto. Se não existir localmente,
   clone: `git clone https://github.com/Dmc9494/nexusflow.git`.
2. Rode `git log --oneline -15` e compare com o "Último commit refletido
   nesta skill" (no final deste arquivo). **Leia a mensagem completa de cada
   commit posterior a ele** (`git log <hash>..HEAD`) — as mensagens deste
   repo são detalhadas e frequentemente invalidam regras descritas aqui. Já
   aconteceu de verdade: esta skill descreveu por 14 commits uma regra de
   isolamento que o código tinha mudado. Se um item "Pendente" já tiver
   commit resolvendo, ele não é mais pendente.
3. Antes de mudar uma seção grande de `src/app/page.tsx` ou `public/captador.html`,
   dê um `grep` pelos nomes de campos/funções relevantes pra confirmar o estado
   real do arquivo — não assuma que o que está descrito aqui ainda é assim.

## Histórico do projeto

O NexusFlow começou como MVP low-code de custo zero (banco JSON local,
sem integrações externas), evoluiu pra RBAC real, geração de OS de abertura
em `.docx`, modelo de dupla atribuição (certificação ≠ abertura), e migrou
pra produção na VPS da Contex com Postgres, Cloudflare Zero Trust e
Syncthing. Depois disso, uma auditoria completa de segurança/isolamento
reescreveu a fila de certificação por regra de negócio real, e uma sequência
de PRs (#39–#52) endureceu o RBAC por papel, centralizou a finalização no
servidor e corrigiu falhas silenciosas — o resto deste arquivo reflete esse
estado. Para a linha do tempo completa —
decisões de arquitetura, bugs de infraestrutura já resolvidos (cache de
Service Worker, corrupção de cache do Turbopack, incidente de deploy
silencioso) e escopo explicitamente adiado — leia
`references/historico.md`. Vale ler antes de propor uma mudança grande de
arquitetura ou reabrir uma decisão antiga — pode já ter sido decidida
conscientemente e não ser um gap esquecido.

## Sobre o projeto

- **Stack:** Next.js 16 (App Router) + PostgreSQL (via `DATABASE_URL`).
- **Repo:** github.com/Dmc9494/nexusflow (privado).
- **Deploy:** push em `master` → GitHub Actions roda `npx tsc --noEmit` → SSH pra
  VPS da Contex → `npm install && npm run build` → `pm2 restart nexusflow` →
  health-check em `/api/health` → rollback automático se falhar.
  **Cuidado:** esse health-check é raso (só testa se o servidor responde, não
  roda uma query real) — um bug já passou por ~15 deploys "com sucesso" antes de
  alguém notar. Não assuma que "o deploy passou" significa "a feature funciona".
- **Arquivos-chave:**
  - `src/app/page.tsx` (~4000 linhas) — kanban principal, single-file, todos os papéis.
  - `src/lib/db.ts` — interface `Dossier` + adapter (`Database.*`), backend JSON local de dev.
  - `src/lib/db-postgres.ts` — schema Postgres com auto-migração (`ALTER TABLE ADD COLUMN IF NOT EXISTS`) rodando a cada subida do processo.
  - `public/captador.html` — PWA standalone offline pro captador em campo (não usa o bundle do Next, service worker próprio).
  - `public/manual.html` — manual do usuário, deve ser atualizado quando o fluxo muda.
  - `references/campos.md` (desta skill) — glossário dos campos do `Dossier`:
    o que cada campo significa, quem escreve e quando. Consulte antes de
    grepar/editar campos em `page.tsx`.

## Pontos de controle RBAC em `page.tsx`

Num arquivo de ~4000 linhas, estes são os gates a procurar (grep pelo nome)
antes de mexer em qualquer permissão ou visibilidade:

- `stepsForRole(role)` — quais etapas/colunas o papel enxerga; também escopa
  a busca global.
- `canSeeStep` — visibilidade de coluna no kanban.
- `canWorkStep` — quem pode AGIR numa OS/etapa (o gate central).
- `getCertColumnDossiers` — fila da view "Certificação".
- `canDelete` — exclusão (só gestor/admin, soft-delete).

### Pontos de controle RBAC na API (server-side, #61)

Uma auditoria de segurança encontrou vários IDOR (checagem de papel sem
checagem de ATRIBUIÇÃO) — corrigidos, guarde o padrão pra não reintroduzir:

- `reveal/route.ts`, `files-zip/route.ts`: além do papel, exige que o usuário
  seja o responsável da OS (`resp_certificacao`/`resp_abertura`/
  `terceiro_responsavel`) ou que a OS ainda esteja livre. Gestor/admin têm
  acesso irrestrito.
- `dossiers/[id]/route.ts` (PATCH): `resp_certificacao`/`resp_abertura` só
  podem ser setados livremente por gestor/admin; o próprio operador só pode
  AUTO-atribuir uma OS ainda sem responsável. Escrita de
  `cert_email_senha`/`cert_senha_acesso` restrita aos mesmos papéis que já
  podem LER em `/reveal` (`operador_certificacao`, `gestor`, `admin` — nunca
  `operador_abertura`).
- `dossiers/route.ts` (GET, listagem): filtra por papel no servidor (antes
  devolvia a esteira inteira pra qualquer papel interno) e não vaza mais
  `cert_email_senha_encrypted`/`cert_senha_acesso_encrypted`/
  `t2_new_email_senha_encrypted` em lote.
- `tasks/[taskId]/route.ts` (PATCH): só quem recebeu a tarefa (`to_user`) ou
  gestor/admin pode marcá-la como concluída.

Se adicionar uma rota nova que lê/escreve dado sensível de uma OS, siga o
mesmo padrão: papel primeiro, atribuição depois.

### Integridade da auditoria: identidade sempre de `session.name` (13/07/2026)

**Falha real encontrada e corrigida** (investigação motivada pelo gestor
suspeitando que interações de uma gestora específica não apareciam na
auditoria de algumas OS, e perguntando se um terceiro poderia ter acessado
aquele acesso). Três rotas gravavam `user_name` do log de auditoria a partir
de um campo enviado pelo **corpo/query da requisição do cliente**
(`operator_name` no body, `?by=` na query) em vez do `session.name` (vindo
do cookie assinado HMAC, ver `src/lib/auth.ts` — a única identidade que o
servidor pode confiar sem checar o cliente):

- `dossiers/[id]/route.ts` (PATCH — a rota mais usada do sistema, cobre
  quase toda gravação de OS: status, cert, pagamento, reatribuição,
  abertura, edição rápida do gestor).
- `dossiers/[id]/upload/route.ts` (upload de anexo).
- `dossiers/[id]/os-abertura/route.ts` (geração do .docx de abertura).

Confirmado com teste real: logado como `operador_certificacao`, mandei
`operator_name: "NOME FORJADO XPTO"` no PATCH — o log gravava esse nome
forjado, não o nome de quem estava de fato autenticado. Qualquer papel
interno (não só quem tem más intenções) podia produzir esse efeito sem
nenhuma ferramenta especial, só editando o payload no devtools do
navegador — e também explica confusões honestas: se o estado do frontend
(`currentOperator`) ficasse dessincronizado da sessão de verdade (aba
antiga, computador compartilhado sem logout completo), o log saía
atribuído a outra pessoa, mesmo sem má-fé de ninguém.

**Isso NÃO é a mesma coisa que um terceiro ganhar acesso de gestor** — as
três rotas já bloqueavam `captador`/`terceiro` por papel antes mesmo de
chegar no log (`session.role === 'terceiro' → 403`), e essa checagem
continua intacta. O problema era só a ATRIBUIÇÃO do nome no registro de
quem fez a ação — não uma escalada de privilégio.

Fix: `operator`/`user_name` nessas três rotas agora vêm sempre de
`session.name`, nunca de `operator_name`/`by` do cliente (que seguem
extraídos do body só pra não vazar pra dentro do `updates` genérico via
spread, não são mais lidos/usados como identidade). Todas as OUTRAS rotas
de log já usavam `session.name` corretamente (`reveal`, `terceiro-update`,
`captador-update`, `captador-agendar`, `tasks/*`, `files-zip`) — não foi
preciso mexer nelas, serve de referência do padrão certo.

**Se investigar um caso real de "log não bate com quem interagiu"**: cada
log tem `ip_address` gravado (`getClientIp`, vem do header
`x-forwarded-for` atrás do Cloudflare Tunnel) — cruzar o IP do log com o
IP conhecido do dispositivo da pessoa é o jeito de confirmar/descartar
"outra pessoa/dispositivo fez essa ação", independente do nome gravado.

## Papéis (roles)

**Reais, em uso na operação:** `captador`, `gestor`, `admin`, `operador_abertura`,
`operador_certificacao`, `terceiro` (parceiro externo e-commerce).

Os papéis antigos `operador_t1`, `operador_t2` e `operador_t3_t4` (modelo
granular antigo) foram **removidos do código** no commit `4e31cc9` (#39) —
RBAC, seeds, API de usuários, manual e schemas. Se encontrar referência a
eles em algum lugar, é resíduo a limpar, não feature.

## Fluxo de trabalho

`Captação → E1 (Risco) → E2 (Cadastro/Complemento) → E3 (Abertura da empresa) +
E4 (Certificação) em paralelo → Finalizado`

- Nomes visíveis ao usuário são **E1-E4**; o código interno usa `t1`-`t4` /
  `current_step`. E3 e E4 compartilham o mesmo `current_step: 't3'` no banco —
  são dois sub-fluxos rodando ao mesmo tempo na mesma OS, não etapas sequenciais.
- **Nível Gov.br** (`gov_level`): `prata` ou `ouro`.
  - **Ambos** (mudou — antes só Prata): sequência **BIRD ID/SYNC (e-CPF) →
    Abertura (paralelo) → A1 (e-CNPJ)**. O e-CPF precisa estar concluído
    (`bird_id_done`) **e** a abertura ter anexado cartão CNPJ + Certidão de
    Inteiro Teor antes do A1 liberar (`a1ReadyOf` em `page.tsx`) — regra de
    negócio real: emitir o e-CNPJ da empresa exige já ter feito o e-CPF do
    sócio no mesmo aparelho.
- **BIRD ID / SYNC não tem anexo** — só dados de acesso (usuário/senha do
  app; `cert_sistema_usado` agora é um seletor BIRD ID/SYNC, não texto
  livre). **A1** é o certificado de fato (e-CNPJ da empresa) — anexado como
  **`.zip`/`.rar`** contendo o `.pfx` + a senha num `.txt` dentro (não mais
  `.pfx` solto — provedores de e-mail bloqueiam o arquivo de certificado
  cru). Campo `certificado_a1_url`.

## Regras de negócio já implementadas (não redescobrir/reimplementar)

- **Isolamento por atribuição:** `canWorkStep` (em `page.tsx`) centraliza quem
  pode AGIR (não só ver) em cada OS; `stepsForRole`/`canSeeStep` controlam o
  que cada papel enxerga (inclusive a busca global, que filtra por
  `stepsForRole`). `operador_abertura` só vê e age da E3 em diante
  (`stepsForRole` = `['t3','finalizado']`, filtrado por `resp_abertura` = ele)
  — ele NÃO enxerga Captados/Recusadas/E1/E2 nem aparece como opção de
  operador responsável de E1/E2. Essa regra já quebrou uma vez por regressão
  e foi restaurada no `cb8f734` (#52) — cuidado pra não reintroduzir.
  `operador_certificacao` só age em OS com `resp_certificacao` = ele ou ainda
  livre.
- **Atribuição de responsável é sempre manual** (gestor/admin em "Atribuir
  Responsáveis"): ao entrar na E3 a OS fica LIVRE — não existe auto-atribuição
  de `resp_abertura`/`resp_certificacao` (removida no #42). O operador pode
  assumir uma OS livre ao executar a etapa, e o gestor pode remover uma
  atribuição (voltar a livre) pelo `ResponsibleSelect`.
- **Finalização é centralizada no servidor:** qualquer transição de
  `current_step` para `finalizado` (inclusive via "Edição Rápida" do admin)
  força `empresa_aberta=true` no backend, gera protocolo e exporta o dossiê
  pra pasta sincronizada (`DOSSIES_DIR`/Syncthing). Voltar etapa de uma OS
  finalizada reseta `empresa_aberta` (o protocolo já emitido é mantido);
  upload em OS já finalizada reexporta o dossiê completo (#46).
- **Protocolo sequencial considera a Lixeira:** `getNextProtocolo()` inclui
  dossiês excluídos no cálculo — um protocolo já usado nunca é reatribuído
  (#44; o protocolo identifica a OS no celular do e-commerce e precisa ser
  único).
- **Cadastro duplicado por CPF:** `POST /api/captacao` recusa (409) novo
  cadastro se já existe dossiê ativo com o mesmo CPF; o `captador.html`
  distingue erro definitivo (409/400) de falha de rede na fila offline —
  antes ficava re-tentando pra sempre (#43).
- **Terceiro só vê/edita o vínculo depois da E1:** gate tanto na listagem
  (`GET /api/terceiro/dossiers`) quanto na gravação (`PATCH
  /terceiro-update`), defesa em profundidade (#43).
- **Duplicidade de número/chip e aparelho travada no vínculo (03/08/2026):**
  `PATCH /terceiro-update` recusa (409) `t2_new_phone`/`cert_aparelho` que já
  esteja em uso em OUTRA OS ativa — cada linha/aparelho é física e única.
  Auditoria do que já ficou duplicado ANTES da trava (não corrige retroativo)
  fica na aba "Projetos" (gestor/admin), painel "número/aparelho duplicado".
- **Isolamento entre parceiros de PROJETOS diferentes** (03/08/2026, caso
  real: conta terceiro nova de um parceiro/projeto novo não podia ver as OS's
  do projeto "gerencia22", de outro parceiro). Campo novo `User.terceiro_projeto`
  (só usado no papel `terceiro`, editável na tela Usuários via botão "📁
  Projeto"): se preenchido, a conta só enxerga/grava OS's com
  `d.projeto === terceiro_projeto` — **inclusive as ainda sem
  `terceiro_responsavel` definido** (não é fila livre compartilhada entre
  projetos) **e exclusive as sem projeto atribuído** (ficam de fora também,
  decisão de negócio consciente). Vazio/undefined = sem restrição, mantém
  compatibilidade com a conta `terceiro` padrão e qualquer conta antiga.
  Gate em 3 lugares (mesmo padrão de defesa em profundidade do isolamento por
  atribuição): `GET /api/terceiro/dossiers` (listagem), `PATCH
  /terceiro-update` (gravação) e `POST /api/dossiers/[id]/reveal` (revelar
  senha) — os dois primeiros bloqueiam mesmo com a OS ainda livre; o de
  `/reveal` só entra depois do check de `terceiro_responsavel` (que já barra
  responsável diferente) pra cobrir o caso de OS livre de outro projeto.
  `files-zip` não precisou de gate — já bloqueia `terceiro` por papel, sem
  exceção. Pré-requisito pra funcionar: o campo `d.projeto` da OS já precisa
  estar atribuído (gestor/admin, tela Projetos ou dentro da OS) ANTES do
  parceiro daquele projeto acessar — se a OS ainda não tem projeto, nenhuma
  conta com `terceiro_projeto` definido a enxerga, nem a dona do projeto
  certo (precisa o gestor classificar primeiro).
- **Isolamento entre GESTORES de projetos diferentes (10/08/2026, caso real:
  a conta "Gestor empresas" via OS de outro gestor/projeto que não eram
  dela).** Até aqui, `gestor` era o único papel interno com acesso irrestrito
  a TODAS as OS por design — não existia nenhum conceito de "gestor dono de
  um cliente/projeto". Campo novo `User.gestor_projetos` (só usado no papel
  `gestor`, editável na tela Usuários via botão "📁 Projetos", dentro do
  próprio card do usuário): **lista de nomes de projeto separados por
  vírgula** — diferente de `terceiro_projeto` (que é um projeto só), um
  gestor pode responder por vários clientes ao mesmo tempo. Se preenchido, a
  conta só enxerga/edita/revela OS's com `d.projeto` num desses nomes —
  mesma regra de exclusão de `terceiro_projeto` (OS sem `projeto` atribuído
  fica de fora de qualquer escopo restrito). **Vazio/undefined = sem
  restrição** (mantém compatibilidade — nenhuma conta `gestor` existente ou
  nova perde acesso só por não ter esse campo definido; é uma restrição
  OPT-IN por conta, não o padrão pra todo mundo). Helper compartilhado em
  `src/lib/gestor-scope.ts` (`getGestorScope`/`dossierInGestorScope`) —
  qualquer endpoint novo que leia/escreva uma OS específica deve chamar isso
  quando `session.role === 'gestor'`. Gates aplicados (mais lugares que o
  isolamento do terceiro, porque `gestor` tem MUITO mais superfície de
  escrita que `terceiro`): `GET /api/dossiers` (listagem principal — é a
  fonte de dado de TODO o dashboard, então o filtro aqui já cobre Esteira/
  Certificação/Captadores/Agenda sem precisar mexer em `page.tsx`), `GET`+
  `PATCH`+`DELETE /api/dossiers/[id]`, `reveal`, `files-zip`, `upload`,
  `os-abertura`, `alert-sla`, `fix-a1-extension`, `restore`,
  `dossiers/deleted` (listagem da Lixeira), `sla-bulk`, e os overrides de
  gestor em `captador-update`/`captador-agendar` (o override que pula a
  checagem de `captured_by` não deve furar o escopo de uma conta restrita).
  `GET /api/projects` (tela "Projetos") também filtra pelo escopo — sem
  isso, uma conta restrita continuaria vendo NOME e contagem de uso de
  projetos de outros gestores mesmo sem acesso às OS's dentro; `POST`/
  `PATCH`/`DELETE /api/projects` bloqueiam criar/editar/excluir um projeto
  fora do próprio escopo. `GET /api/activity-logs` (Log de Acessos → Ações)
  também filtra por `dossier_id` pertencente ao escopo — mesmo raciocínio,
  os detalhes do log expõem nome de cliente de OS que a conta não deveria
  ver. **Não gateado de propósito** (proporcional ao que o isolamento do
  terceiro já cobria — não é "esquecido", é escopo consciente): endpoints de
  tarefas (`tasks/*`, incluindo `cobrar`) e `GET /api/session-logs` (login/
  IP por conta, não é dado de cliente). `page.tsx` **não precisou de nenhum
  filtro client-side novo** — como `GET /api/dossiers` já devolve só o pool
  escopado, todas as views que leem do state `dossiers` (Esteira, Dashboard,
  Certificação, Projetos, Captadores, Agenda) já saem corretas de graça,
  diferente do isolamento por atribuição de `operador_certificacao` (que é
  só de renderização, com payload completo). Testado ponta a ponta com
  `npm run dev` + curl: 2 contas gestor escopadas (projetos diferentes) só
  veem a própria OS na listagem, tomam 403 tentando `GET`/`PATCH`/`reveal`/
  `files-zip` na OS da outra, `/api/projects` retorna só o projeto próprio,
  `/api/activity-logs` só mostra logs da própria OS; conta gestor SEM
  `gestor_projetos` continua vendo tudo (compatibilidade confirmada).
- **Projeto obrigatório na aprovação da E1 (03/08/2026):** consequência
  direta da regra acima — se o gestor esquecer de classificar o projeto, a
  OS fica invisível pra qualquer terceiro com `terceiro_projeto` definido.
  Trava dupla: servidor (`PATCH /api/dossiers/[id]/route.ts`, transição
  `t1 → t2` exige `updates.projeto ?? original.projeto`, 422 se faltar,
  mesmo padrão da trava de finalização) + frontend (botão "🟢 Aprovar (E1
  Verde)" desabilitado sem `selectedOS.projeto`). O seletor "📁 Projeto"
  (bloco `isManager`) já fica visível na mesma aba "Trabalho", acima do
  painel de aprovação E1 — não precisou mover nada, só travar o botão.
  Não se aplica a nenhuma outra transição de etapa, só à aprovação em si
  (recusa/E1 vermelho não muda `current_step`, continua sem exigir nada).
- **`projeto` (Contex) × `projeto_parceiro` (terceiro) são DOIS CAMPOS
  DIFERENTES no `Dossier` (03/08/2026, esclarecimento direto do gestor:
  "o projeto que o terceiro define é para controle do próprio terceiro [...]
  o projeto que o gestor define é para controle da contabilidade").
  Antes dessa data havia só um campo (`projeto`), escrito tanto pelo
  gestor/admin (classificação da Contex) quanto pelo terceiro via `PATCH
  /terceiro-update` (com checagem de capacidade contra `projects.json`) —
  os dois usos colidiam. Agora:
  - `projeto`: só gestor/admin escrevem (painel "📁 Projeto" na aba
    Trabalho). É o campo com efeito real: capacidade/`contador_abertura`
    automático (client-side, `assignProjeto` em `page.tsx`), obrigatório
    pra aprovar a E1 (regra acima), e é o campo comparado com
    `User.terceiro_projeto` pro isolamento de visibilidade.
  - `projeto_parceiro`: só o terceiro escreve, via `PATCH /terceiro-update`
    (body `projeto_parceiro`, não mais `projeto`) — texto livre, SEM
    checagem de capacidade/catálogo (a função `getProjectCapacity` e a
    leitura de `projects.json` foram removidas dessa rota). Puramente
    informativo, pra ele organizar as próprias empresas; devolvido em
    `GET /api/terceiro/dossiers` e mostrado read-only pro time interno em
    `page.tsx` ("Projeto (parceiro)", só aparece se preenchido). Sem
    nenhum efeito em capacidade, contador ou isolamento.
  Se voltar a ver o terceiro mexendo em capacidade/lote da Contex, ou o
  gestor perdendo a própria classificação porque o terceiro sobrescreveu,
  é regressão dessa separação — não é comportamento esperado.
- **Busca ignora acento (04/08/2026):** `normalizeSearch()` (`src/lib/text.ts`,
  NFD + remove diacríticos + minúsculas) substituiu todo `.toLowerCase()`
  usado em busca por texto (busca global, filtro da Esteira, Concluídos por
  Certificador, filtro de captador, Agenda, Logs/Sessões, busca do portal do
  terceiro). "joao" agora encontra "João". Novo campo de busca por texto que
  não usar essa função é regressão.
- **Coluna "❌ Recusadas" (Esteira, só gestor/admin) não passava pelo filtro
  da Esteira (bug real, 04/08/2026, reportado pelo gestor):** era a ÚNICA
  coluna que filtrava `dossiers` direto (`d.status === 't1_vermelho'`) em vez
  de usar `getColumnDossiers`/`matchEsteiraFilters` como as outras — busca de
  texto e filtro de captador não tinham efeito nela. Corrigido acrescentando
  `matchEsteiraFilters(d)` ao filtro. Se adicionar uma coluna nova na
  Esteira, sempre passar pelo mesmo `matchEsteiraFilters`/`getColumnDossiers`
  — não filtrar `dossiers` direto.
- **Gestor/admin têm override nos endpoints do captador**
  (`/captador-agendar`, `/captador-update`): passam pela checagem de papel e
  pulam a de propriedade (`captured_by`); o captador comum segue restrito às
  próprias OS (#45).
- **Logout por inatividade (10 min)** via `useIdleLogout` nas 3 telas
  internas (kanban, admin de usuários, portal do terceiro). O captador fica
  DE FORA de propósito (PWA offline, sessão de campo longa) — não "corrigir"
  isso (#48).
- **Documentos avulsos:** 3 slots livres por OS (`doc_extra_1..3_url` +
  `_nome`, nome digitado por quem anexa); entram na exportação do dossiê, no
  ZIP e na trilha de auditoria com o nome digitado (#49).
- **Erros de salvamento aparecem pro usuário:** `updateDossierStatus` (usada
  por quase toda ação de salvar/avançar etapa) mostra o erro retornado pelo
  servidor — não reintroduzir chamadas que engolem resposta não-ok; isso já
  causou um bug real de "botão que não faz nada" (#50).
- **Formulários da OS não são resincronizados** com o servidor em refreshes
  com `keepView` (só na abertura inicial da OS) — resincronizar apagava
  edições não salvas ao trocar de aba (#41). O formulário do captador tem
  rascunho em localStorage (sem a senha Gov).
- **Fila do certificador** (`getCertColumnDossiers` em `page.tsx`): Prata e
  Ouro entram desde a E2 pro BIRD ID/SYNC (mudou — antes só Prata); após o
  e-CPF feito, some da lista ativa até o A1 liberar (grupo "Aguardando
  abertura" — evita ele ver e-CPFs já feitos como pendentes). **Incidente
  real (corrigido, ver `historico.md`):** quando o #54 mudou `a1ReadyOf` pra
  exigir BIRD também no Ouro, `getCertColumnDossiers`/`ativa()`/`certBadges`
  ficaram para trás tratando só Prata como "precisa de BIRD" — uma OS Ouro
  sem BIRD feito nunca aparecia na fila do certificador (caso real: Maysa
  Farias Leal). Se mexer nessa fila de novo, mantenha a regra simétrica
  entre os dois níveis — não reintroduza um `gov_level === 'prata'` isolado
  num dos três lugares sem os outros dois. **Existe um 4º lugar com o mesmo
  risco, fora da fila:** `isEarlyBirdEligible` (painel "BIRD ID antecipado"
  no detalhe da OS, libera o certificador agir no BIRD ID enquanto a OS
  ainda está em T2) também ficou Prata-only por um tempo — 2º incidente real
  (ver `historico.md`, 10/07/2026): Ouro aparecia disponível na fila mas o
  certificador só via "🔒 Somente leitura" ao abrir a OS. Antes de declarar
  uma correção de nível Prata/Ouro completa, rode `grep -n "gov_level ===
  'prata'"` no arquivo inteiro — visibilidade na fila e ação no painel da OS
  são pontos DIFERENTES, um grep parcial não pega os dois. **3º incidente do
  mesmo painel** (mesma correção, bug diferente): `isEarlyBirdEligible`
  também exigia `!bird_id_done` — assim que o certificador concluía o BIRD
  ID ainda em T2, o painel inteiro (status + "Dados de Acesso à
  Certificação" com certificadora/sistema/aparelho/e-mail já preenchidos)
  sumia até a OS avançar pra T3. Relatado como "não aparecem as informações
  do BIRD após anexados/preenchidos" — o dado tinha sido salvo certinho, só
  não tinha onde aparecer de volta. Corrigido separando `isEarlyBirdWindow`
  (mostra o painel, independe de `bird_id_done`) de `isEarlyBirdEligible`
  (mostra especificamente o formulário de conclusão, só quando ainda
  pendente). **4º incidente, o mais grave dos quatro** (11/07/2026): o bloco
  principal "SE SETOR FOR T3/T4" (`birdStep`/`a1Step`/`aberturaStep` +
  "Dados de Acesso à Certificação", que é o ÚNICO lugar do sistema com essa
  informação) só renderizava com `selectedOS.current_step === 't3'` — assim
  que a OS era finalizada (`current_step` vira `'finalizado'`, o desfecho
  normal e esperado de TODA empresa aberta com sucesso), o bloco inteiro
  desaparecia PERMANENTEMENTE, pra qualquer papel, em qualquer dispositivo.
  Relatado como "pelo celular não aparece" mas não era só celular — era
  universal, só que o usuário testou pelo celular primeiro. Corrigido
  ampliando a condição pra `current_step === 't3' || current_step ===
  'finalizado'`; seguro porque `canWorkStep('t3')` é chamado com a STRING
  FIXA `'t3'` (não olha o step real da OS), então isso não libera nenhuma
  ação nova — os botões de concluir já ficam escondidos sozinhos porque
  `birdDone`/`aberturaDone`/`a1Done` já são `true` numa OS finalizada de
  verdade. Escondido à parte: o widget "Agendar Certificação" (datepicker),
  que não fazia sentido continuar oferecendo numa OS já concluída. Cada
  certificação é distinta:
  `bird_id_done_em/por`, `a1_done_em/por` e (nova) `abertura_done_em/por`
  registram quem/quando concluiu — usado em badges e contadores de cobrança
  na tela "Certificação" (view separada do kanban
  principal — o certificador se confundia vendo a mesma OS "espelhada" em
  Abertura e Certificação ao mesmo tempo).
- **BIRD só é "ativo" com vínculo definido (pedido do gestor):** `ativa()`
  exige `vinculoReady(d)` (`t2_new_email` + `t2_new_phone` preenchidos) além
  de `!bird_id_done` — sem vínculo, a OS entra na fila (`getCertColumnDossiers`,
  current_step em t2/t3) mas não fica "ativa" pro certificador, só aparece no
  grupo "⏸ Aguardando abertura", que **só renderiza pro gestor** (`isManager
  &&`) — pedido explícito: o certificador só deve ver o que já está disponível
  pra trabalhar agora (livre/minha), sem clutter do que ainda não está pronto.
- **Tela Certificação — REDESENHADA pra lista única paginada (11/07/2026,
  substitui os grupos de cards de PR anteriores):** pedido explícito do
  gestor ("do jeito que está não está funcional... pensei em algo em lista
  e paginação"). O layout antigo (`group`/`groupPreview`/`groupConcluido`/
  `renderCard`/`renderConcluidoCard`, cards espalhados em várias seções)
  foi REMOVIDO — se ver referência a esses nomes em algum lugar, é resíduo
  de doc desatualizada, não existe mais no código. O que existe agora:
  - `listPool`: junta `getCertColumnDossiers()` (fila de trabalho ativo,
    t2/t3 não concluído) com OS `finalizado` que tenham `bird_id_done` ou
    `a1_done` (`finalizadasComCert`) — importante, porque
    `getCertColumnDossiers` exclui `finalizado` de propósito (é fila de
    TRABALHO, não de consulta), mas essa lista aqui é justamente pra
    CONSULTAR certificação mesmo depois da empresa aberta.
  - `isRelevantParaMim`: isolamento por atribuição — gestor/admin vê tudo;
    `operador_certificacao` vê livre + a sua + o que ele mesmo concluiu
    (mesmo padrão de `feitaPor` já usado nos contadores do topo).
  - `statusOf(d)`: classifica cada OS em `livre`/`andamento`/`aguardando`/
    `concluido` pra alimentar as abas de filtro (`certListViewTab`) — a
    aba "Aguardando abertura" continua `managerOnly` (mesma regra de
    antes: não é trabalho disponível de verdade pro certificador, só
    gestor acompanha).
  - Ordenação: por `relevantDate` (data de conclusão do A1, senão do BIRD,
    senão `created_at`) decrescente — mistura ativos e concluídos numa
    ordem só, sem precisar de toggle de ordenação separado.
  - Paginação: 15 por página (`certListViewPage`, `LIST_PAGE_SIZE`).
  - Cada linha (`renderListRow`) já mostra os badges de BIRD e A1
    (`certBadges`) e o status de pagamento inline — clicar na linha chama
    `handleSelectOS(d)` e abre o drawer da OS, mesmo padrão usado em todo
    o resto do app (sino, pop-up, tabela de Concluídos por Certificador).
  **Isolamento entre certificadores continua só de renderização, não de
  payload:** o GET `/api/dossiers` devolve o pool inteiro de
  t2/t3/finalizado pra `operador_certificacao` de propósito (ele precisa
  ver a fila "🔓 Livre" inteira pra poder assumir qualquer OS livre) — os
  dados de outro certificador chegam no fetch, só não são renderizados
  (`isRelevantParaMim` filtra antes de qualquer render). Se pedirem
  isolamento também no payload, é mudança de arquitetura maior (filtrar a
  listagem por atribuição no servidor), não só de UI.
- **Refinamentos na lista de Certificação (11/07/2026, mesma PR do
  redesenho acima):**
  - **Bug real de contagem corrigido:** `statusOf` exigia `bird_id_done`
    **e** `a1_done` (via `certConcluida`) pra classificar como `concluido`,
    deixando a aba "Concluídos" com uma contagem bem menor que os
    contadores do topo (`birdsFeitos.length`/`a1sFeitos.length`, que contam
    CADA certificação feita, não a OS inteira "toda concluída"). Corrigido
    pra OU: `d.bird_id_done || d.a1_done || d.current_step === 'finalizado'`.
    Lição: ao adicionar um contador/filtro novo, sempre comparar com os
    contadores já existentes na mesma tela — divergência entre eles é sinal
    de bug, não de "dado diferente por design".
  - Badge da linha trocado de um genérico `✓ concluído` (enganoso quando só
    BIRD **ou** só A1 estava feito, não os dois) pra `🏆 empresa aberta`,
    mostrado só quando `current_step === 'finalizado'` — o status granular
    de cada certificação já aparece nos badges do `certBadges(d)`.
  - **"Marcação geral leva pra Concluídos":** `completeSubStep`, ao marcar
    `step === 'bird'` ou `step === 'a1'` com sucesso, chama
    `setCertListViewTab('concluidos')` + `setCertListViewPage(0)` — ao
    voltar pra tela de Certificação depois de concluir uma certificação, a
    aba já está em "Concluídos" mostrando o que acabou de ser feito.
  - **Renomeado "SYNC" → "Syngular"** no seletor de sistema usado (dois
    lugares: painel T2 de acesso antecipado e painel T3 "Dados de Acesso à
    Certificação") — `(['BIRD ID', 'Syngular'] as const)`. Cosmético/só
    daqui pra frente: `cert_sistema_usado` é `string` livre no `Dossier`,
    então OS antigas com "SYNC" persistido continuam mostrando "SYNC" (não
    foi feita migração de dado).
  - **Nova aba "👤 Pessoa"** (`activeTab === 'pessoa'`, entre "⚙️ Trabalho"
    e "🔑 Senha Gov", oculta pra `captador`/`terceiro`): visão só-leitura
    consolidada, com toggle **Pessoa Física ⇄ Pessoa Jurídica**
    (`pessoaViewTab`), pedida pelo gestor pra parar de precisar caçar dado
    de e-CPF/e-CNPJ espalhado pela aba Trabalho. Pessoa Física reúne
    dados pessoais + documentos de identidade + bloco "BIRD ID/SYNC —
    e-CPF" (com revelação de senha, gate `canRevealBirdSenha`: gestor/admin
    sempre, `operador_certificacao`/`operador_abertura` só se livre ou
    atribuída a ele mesmo — mesma regra de atribuição usada no resto do
    app). Pessoa Jurídica reúne dados da empresa + documentos da abertura +
    bloco "Certificado A1 — e-CNPJ" com download do `.zip`/`.rar`, atrás de
    `canSeeA1File` (gestor/admin/`operador_certificacao` — **exclui
    `operador_abertura` de propósito**, mesma regra já documentada acima de
    "operador de abertura nunca vê dado de A1"). Essa aba não substitui a
    aba "⚙️ Trabalho" (que continua tendo os formulários editáveis) — é só
    uma visão de consulta/organização.
- **Aba "Pessoa" completada + paginação numerada (11/07/2026, PR seguinte):**
  gestor testou e reportou dois problemas reais:
  1. A aba Pessoa tinha campos **faltando** em relação ao que já existia
     na aba "📄 Documentos" (não era um bug de renderização, era um
     subconjunto incompleto de campos escrito da primeira vez). PF ganhou
     "Captado por"; PJ ganhou CNAE, Quadro Societário, e uma seção nova
     "Vínculo E-commerce" (Chip E-commerce = `t2_new_phone`, E-mail Empresa
     = `t2_new_email` com revelação de senha reaproveitando
     `t2EmailSenhaRevealed`/`revealedT2EmailSenha`/`has_t2_new_email_senha`
     já usados na aba Documentos, e Cód. Aparelho = `cert_aparelho`).
     Continua só-leitura — editar esses campos continua sendo só pela aba
     Documentos/Trabalho. **Se pedirem outro campo na aba Pessoa, primeiro
     `grep` pelo bloco "Pessoa Jurídica"/"Pessoa Física" da aba Documentos
     (~linha 3230-3315) pra ver se o campo já existe lá — é a fonte da
     verdade de "o que existe pra essa OS", a aba Pessoa é só uma
     reorganização de exibição, não introduz campo novo.**
  2. Lista da tela Certificação: `LIST_PAGE_SIZE` reduzido de 15 pra 10, e
     a paginação ganhou **botões numerados** (1, 2, 3…) além de
     Anterior/Próxima — janela de ±2 páginas ao redor da atual com "…"
     nas pontas quando há muita página.
  3. **Bug real de scroll (achado depois, mesmo PR):** a suposição inicial
     de que "a rolagem já funcionava" (item 2 acima, versão anterior desta
     nota) estava **errada** — o gestor reportou que só via o fim da
     página ajustando o zoom do navegador, sinal claro de "não tem
     scrollbar, o conteúdo estoura o viewport". Causa raiz: `<main
     className="flex-1 flex flex-col overflow-hidden">` (o container que
     envolve TODAS as views) corta qualquer conteúdo que passe da altura
     da tela — cada view precisa da própria `<div className="flex-1
     overflow-y-auto ...">` interna pra poder rolar (é o padrão usado no
     Dashboard, linha ~1827, e no Kanban). O bloco `view === 'certificacao'`
     tinha só `<div className="flex flex-col gap-4 max-w-4xl">` como
     wrapper — sem `overflow-y-auto`, sem `flex-1` — então o conteúdo
     simplesmente ficava cortado pelo `overflow-hidden` do `<main>` sem dar
     nenhuma pista visual de "tem mais lá embaixo, role pra ver". Fix:
     wrapper trocado pro padrão do Dashboard com `flex-1 overflow-y-auto`.
     **Correção da correção (13/07/2026, bug real reportado):** a primeira
     versão desse fix pôs o `max-w-4xl` NO PRÓPRIO container de rolagem —
     com a sidebar recolhida, o container (com seu fundo e sua scrollbar)
     ficava grudado à esquerda limitado a 896px, deixando uma faixa morta
     à direita e a barra de rolagem flutuando no meio da tela ("quando
     recolhe a guia lateral ela move para o lado esquerdo e corta").
     Estrutura correta (a atual): container de rolagem SEM max-w (`flex-1
     overflow-y-auto p-6 bg-slate-900/30 thin-scroll`, ocupa a área útil
     inteira) + wrapper interno com o limite centralizado (`max-w-4xl
     mx-auto w-full`). **Lição dupla:** (1) ao adicionar/reescrever uma
     view, sempre conferir se o wrapper mais externo tem `overflow-y-auto`
     — sem isso, conteúdo que não caiba na tela vira invisível sem erro
     nenhum no console ("dá pra ver ajustando o zoom" é o sintoma
     clássico); (2) `max-w-*` nunca vai no container de rolagem, vai num
     wrapper interno com `mx-auto` — senão o layout quebra exatamente
     quando a sidebar recolhe (teste os DOIS estados da sidebar).
  4. **Destaque de nome (mesma PR seguinte, pedido novo do gestor):** nas
     linhas da lista de Certificação (`renderListRow`), o nome em destaque
     (negrito, `<h4>`) era sempre `client_name` (pessoa física), mesmo numa
     OS onde o BIRD já tinha sido feito e o trabalho pendente/relevante era
     o A1 (empresa). Corrigido: `primaryIsEmpresa = d.bird_id_done &&
     !!d.empresa_nome` — antes do BIRD feito, destaque é o nome da pessoa
     (é o trabalho ativo); depois do BIRD feito, destaque passa a ser a
     razão social (ícone secundário 👤/🏢 indica o outro lado). Testado via
     Playwright real (`/opt/pw-browsers`, chromium pré-instalado no
     ambiente — não precisa instalar `playwright` como devDependency do
     projeto pra rodar um teste visual pontual, só `NODE_PATH` apontando
     pro pacote global) contra `npm run dev` local.
  5. **"Concluídos por Certificador" reorganizada (mesma PR):** layout
     anterior (grade 2 colunas de cards estreitos, `renderConcluidoRow`)
     ficava espremido/pouco responsivo — trocado pro mesmo padrão de linha
     única empilhada já aprovado em `renderListRow` (uma coluna, sempre).
     Também **ganhou botão de marcar pagamento direto no card**
     (`togglePagamentoConcluido`, grava `bird_pago`/`a1_pago` — antes só
     dava pra marcar pagamento na tela Certificação, não aqui, apesar do
     texto "pagamento pendente" já aparecer; faltava a ação, só o status).
     Confirmado visualmente com Playwright em desktop (1400px) e mobile
     (390px) — sem clipping, botão "Marcar como pago" alterna pra "✓ Pago"
     corretamente.
  6. **Filtro por status de pagamento (PR seguinte, 11/07/2026):** o
     gestor pediu pra filtrar "Concluídos por Certificador" também por
     pago/pendente, não só por nome. Adicionadas abas **Todos / Pendente
     de pagamento / Pago** (`concluidosPagoFilter`) acima da lista — o
     filtro é aplicado ANTES de agrupar por certificador
     (`rowsPagoFiltrados`), então tanto a contagem "N BIRD · M A1" de cada
     grupo quanto a paginação já refletem só o que está sendo mostrado; um
     certificador sem nenhuma linha no filtro atual simplesmente não
     aparece (não vira um grupo vazio). Contagem das abas usa `rows`
     (não-filtrado) pra "Todos" e soma de `pago`/`!pago` pra as outras
     duas. Confirmado visualmente com Playwright: cliquei em cada aba e
     conferi que os grupos certos aparecem/somem e a contagem bate.
  7. **Bug real: aba "Concluídos" sempre vazia, pra todo mundo (PR
     seguinte, 11/07/2026)** — `statusOf` retornava `'concluido'`
     (singular) mas `certListViewTab`/a `key` das abas usam `'concluidos'`
     (plural); a comparação nunca batia. Detalhe completo do incidente em
     `references/historico.md` — vale ler antes de mexer de novo em
     `statusOf`/`certListViewTab`/`tabs`, porque é fácil reintroduzir esse
     tipo de typo (dois union types de string literal distintos, sem
     checagem cruzada do TypeScript entre eles).
  8. **"SLA Estourado" zerado pro certificador (mesma PR, pedido
     explícito):** o card do Dashboard pra `operador_certificacao` usava
     `slaEst` calculado sobre `meus` (todo o pool de E3 visível pro papel,
     não só as OS atribuídas a ele) — inflava o número. Zerado
     (`{ n: 0, ... }`) por pedido do gestor até existir uma métrica
     corretamente escopada por atribuição — não é "consertado", é
     desligado de propósito por enquanto. Não fazer o mesmo silenciosamente
     pros outros papéis (gestor/admin e operador_abertura) sem pedido
     explícito — a fórmula deles é diferente e não foi questionada.
  9. **Coluna "Certificados Finalizados" da Esteira de Trabalho alinhada
     com os contadores da tela Certificação (mesma PR, pedido explícito
     "alinhe pra não ficar confuso"):** antes contava `certConcluida(d)`
     (BIRD **e** A1, o processo inteiro, sem escopo por operador) — número
     que não batia com os contadores do topo da tela Certificação
     (`birdsFeitos`/`a1sFeitos`, que contam cada certificação separada e
     só as do próprio operador). Pro papel `operador_certificacao`, a
     coluna virou **duas listas** — "🆔 E-CPF concluídos" (`bird_id_done`)
     e "📜 E-CNPJ concluídos" (`a1_done`) — usando a mesma fórmula de
     escopo (`feitaPor(d.bird_id_done_por, d.resp_certificacao) ===
     currentOperator`, idem A1) dos contadores da tela Certificação. Os
     dois lugares agora mostram exatamente o mesmo número pro mesmo
     operador — testado comparando os dois lado a lado com Playwright.
     Título da coluna também mudou de "🏆 CERTIFICADOS FINALIZADOS" pra
     "🏆 CERTIFICAÇÕES CONCLUÍDAS" (mais preciso — "finalizado" no sistema
     é um `current_step` específico da empresa, que não é o que essa
     coluna mede pro certificador). Comportamento de gestor/admin e
     `operador_abertura` nessa mesma coluna **não mudou** — só o branch do
     certificador foi reescrito.
- **Abas "📂 Documentos" + "👤 Pessoa" + "🔑 Senha Gov" UNIFICADAS numa só,
  "👤 Dossiê" (11/07/2026, pedido explícito do gestor):** as 3 mostravam
  informação sobrepondo-se (Documentos e Pessoa tinham os MESMOS dados de
  PF/PJ, só organizados diferente — Pessoa com o layout que o gestor achou
  melhor) e confundiam o usuário final ("vai confundir ter essas duas
  visualizações"). O que mudou:
  - `activeTab` perdeu os valores `'pessoa'` e `'gov'` do union type — só
    restou `'dados'` (que agora é a aba renderizada como "👤 Dossiê" na UI;
    o nome interno da variável não mudou pra reduzir o tamanho do diff,
    só o label visível e o conteúdo).
  - O toggle Pessoa Física ⇄ Pessoa Jurídica (`pessoaViewTab`, já existia)
    continua a estrutura principal da aba única.
  - **Pessoa Física** ganhou, além dos campos que já tinha: Documentos de
    Identidade (agora sempre no estilo `DocLink` — Ver/Baixar — que o
    gestor achou "mais organizado"; o vídeo de prova de vida é exceção,
    mantém player inline), **Documentos Avulsos** (os 3 slots
    `GenericDocAttach`, que antes só apareciam na aba Documentos — pedido
    explícito: "caso necessitem adicionar algum documento na pessoa física
    o usuário vai conseguir, tipo os três arquivos diversos... assim como
    em pessoa jurídica"), e o bloco inteiro de **Senha Gov.br** (login +
    revelar + editar, migrado da antiga aba própria — "penso em até
    unificar a senha gov nessa visualização").
  - **Pessoa Jurídica** ganhou os `FileAttach` de verdade (upload, não só
    `DocLink` de leitura) pros "Documentos do Processo" (cartão CNPJ,
    certidão, inscrições, simples nacional) — antes a aba Pessoa só
    mostrava esses como link de download, sem poder anexar; agora anexa
    igual a aba Documentos fazia.
  - **Cuidado de RBAC ao fundir (não regredir):** a antiga aba "Pessoa"
    era **oculta inteira** pra `captador`/`terceiro` (só não apareciam pra
    esses dois papéis); a aba Documentos e a aba Senha Gov, ao contrário,
    sempre foram visíveis pra todo mundo. Como a fusão vira uma aba só que
    PRECISA continuar visível pra captador/terceiro (eles usavam
    Documentos/Senha Gov normalmente), os blocos que eram exclusivos da
    Pessoa — os boxes "🆔 BIRD ID/SYNC — e-CPF" e "📜 Certificado A1 —
    e-CNPJ" — ganharam um gate explícito novo, `canSeeCertBlocks =
    currentRole !== 'captador' && currentRole !== 'terceiro'`, só pra
    recriar exatamente a visibilidade que a aba tinha antes. Os outros
    gates que já existiam dentro desses blocos (`canSeeA1File`,
    `canRevealBirdSenha`, gate de `t2_new_email_senha`) foram preservados
    sem alteração. **Se for tocar de novo nesses blocos, não remover esse
    gate approximando com "já não tem mais aba separada" — ele existe
    exatamente PRA simular a aba que sumiu.**
  - Testado por papel com Playwright real (gestor, `operador_certificacao`,
    `operador_abertura`) confirmando: Dossiê aparece com PF/PJ, Editar
    funciona, Documentos Avulsos e FileAttach fazem upload, Gov.br revela
    certo por papel, e o box de A1 continua ausente pro
    `operador_abertura` (regra "abertura nunca vê A1" preservada).
    `captador` não passou por esse teste porque o papel usa uma UI
    totalmente separada (`captador.html`, PWA própria) — nunca chega
    nesse `page.tsx` compartilhado, então as considerações de RBAC do
    Dossiê são teóricas pra esse papel especificamente (mas reais pro
    `terceiro`, que usa outro portal próprio, `terceiro/page.tsx`, também
    fora deste arquivo — o gate aqui é defensivo/vestigial pros dois, caso
    algum dia usem esta tela compartilhada).
- **Responsividade mobile (levantamento + correção, 10-11/07/2026):** app
  reportado como "nada responsivo" no celular. Achados reais e corrigidos:
  (1) quase todo `<input>`/`<select>`/`<textarea>` do sistema usa
  `text-xs` (12px) — Safari do iPhone dá zoom automático em qualquer campo
  com fonte menor que 16px ao focar, fazendo a tela pular em praticamente
  todo formulário; fix em `globals.css`, `@media (max-width: 640px) {
  input, select, textarea { font-size: 16px !important; } }` — não precisou
  tocar nenhuma das ~36 ocorrências individuais em `page.tsx`. (2) 3 modais
  (o antigo modal "Ver todos" da Certificação — removido no redesign de
  lista única, ver bullet acima —, `agendaAssignSlot`, `reagendaModal`)
  usavam `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` sem
  nenhuma margem de segurança — em tela estreita o conteúdo encostava na
  borda.
  Padronizados pro MESMO padrão já usado em outros 4 modais do arquivo
  (Lixeira, SLA em lote): `fixed inset-0 flex items-center justify-center
  p-4` como wrapper (com `onClick` de fechar) + `onClick={(e) =>
  e.stopPropagation()}` no card interno. Se criar modal novo, use esse
  padrão — não o `top-1/2`/`translate`. (3) As duas tabelas do "Log de
  Acessos" (Sessões, Ações) não tinham `overflow-x-auto` — risco de rolagem
  horizontal da PÁGINA inteira em tela estreita; adicionado
  `overflow-x-auto` no contêiner + `min-w-[560px]` na tabela (rola só a
  tabela, não a página). (4) A tela "Concluídos por Certificador" era uma
  tabela (ilegível no celular) — convertida pra grade de cards no mesmo
  estilo da fila de Certificação (`renderConcluidoCard`-like), paginada de
  10 em 10 por certificador (`concluidosPage`, `Record<string, number>`).
  **O que já estava OK e não precisou mexer:** kanban (já rola horizontal
  dentro da própria caixa), menu lateral (já vira gaveta/drawer no
  celular), painel de detalhe da OS (já é full-width no celular via
  `w-full md:w-[680px]`), grade da Agenda semanal (já rola dentro da
  própria caixa com `overflow-auto` + `minWidth`).
- **Pagamento das certificações — 3 marcadores independentes** (`bird_pago`,
  `a1_pago`, `colaborador_pago`, cada um com par `_em`/`_por`, em `Dossier`):
  pedido explícito do gestor — BIRD e A1 são certificados distintos com custo
  próprio, e o colaborador que executou é pago à parte. Botões (`pagamentoPill`
  em `page.tsx`, dentro de `renderConcluidoCard`) aparecem nos cards de
  concluídos (PF mostra BIRD+Colaborador, PJ mostra A1+Colaborador); quando os
  aplicáveis a uma OS já estão todos marcados (`pagoUnificado`), vira um selo
  único "✅ Pago". Escrita restrita a `gestor`/`admin` no PATCH
  `dossiers/[id]/route.ts` (mesmo padrão de `sla_deadline`/`gov_password`);
  `_em`/`_por` são sempre definidos no servidor (nunca confiados ao payload do
  cliente), e cada marcação/desmarcação gera log `PAGAMENTO_ALTERADO`.
  **Funciona retroativamente**: não há gate de `current_step` — dá pra marcar
  mesmo numa OS já `finalizado`/`empresa_aberta`, é só controle financeiro
  pra reconciliar pagamentos já feitos, não faz parte do fluxo de aprovação.
- **Central de Agendamentos — clique no slot ocupado abre a OS direto**
  (pedido do gestor, mesmo padrão de clique-e-vai-direto do sino/pop-up/tela
  de Concluídos): antes, clicar num slot ocupado só abria o modal de
  gerenciar/reagendar/cancelar. Agora o clique principal chama
  `handleSelectOS(d)` e abre o drawer da OS; o gerenciamento (reagendar,
  cancelar) continua acessível pelo ícone **⚙️** dentro do próprio slot
  (`stopPropagation` pra não disparar os dois). Vale tanto na visão do
  gestor/admin quanto na do certificador (próprio compromisso).
- **Cards de PF/PJ contextuais por sub-etapa** (aba ⚙️ Trabalho, dentro do
  bloco T3, `pfQuickCard`/`pjQuickCard` em `page.tsx`): BIRD ID trabalha com
  a pessoa física (mostra nome/CPF/telefone/e-mail/endereço), A1 trabalha
  com a pessoa jurídica (CNPJ/razão/fantasia/endereço da empresa); Abertura
  mostra os dois (precisa do CPF do sócio pra registrar a empresa, e vai
  construindo os dados da PJ). Existem só pra reduzir troca de aba — os
  dados completos continuam na aba "Dados e Documentos".
- **RBAC de documentos sensíveis (revisado):** dados de certificação
  (credenciais BIRD ID/SYNC, arquivo A1) são acessíveis a `terceiro`,
  `operador_certificacao` e `gestor`/`admin` (`reveal/route.ts` — `terceiro`
  foi adicionado aos `allowedRoles` de `cert_email_senha`/`cert_senha_acesso`,
  decisão de negócio; nunca ganha acesso à senha Gov.br do cliente, campo
  `gov`, que continua vedado). Documentos de identidade capturados pelo
  captador (selfie, selfie+RG, prova de vida, documentos) também foram
  liberados pro portal do terceiro (`api/terceiro/dossiers/route.ts` +
  `terceiro/page.tsx`) — antes eram bloqueados por padrão. Em contrapartida,
  `operador_abertura` teve o acesso ao anexo do Certificado A1 removido (só
  vê dados do dossiê pra abertura da empresa, nunca dados de certificação) —
  o `FileAttach` de `certificado_a1_url` só existe hoje dentro do bloco
  `canDoCert` (aba Trabalho), não mais duplicado no bloco genérico de
  "Documentos do Processo". **Revisado de novo (pedido do gestor):**
  `operador_abertura` agora vê um bloco **somente leitura** dos dados do
  BIRD ID/SYNC (e-CPF) — certificadora, sistema usado, aparelho, e-mail e
  status de conclusão — dentro da aba Trabalho (T3), sem poder editar e sem
  revelar senhas. Continua sem NENHUM acesso a A1 (arquivo, status ou
  qualquer dado). Ver `!canDoCert && currentRole === 'operador_abertura'`
  logo antes do bloco `canDoCert` de "Dados de Acesso à Certificação" — se
  mexer nessa RBAC de novo, mantenha essa distinção (BIRD sim, A1 nunca).
  **Estendido de novo (pedido do gestor, com auditoria):** `operador_abertura`
  também pode revelar `cert_email_senha` e `cert_senha_acesso` (senha do
  e-mail do certificado e senha de acesso ao app BIRD ID/SYNC) via
  `/reveal` — adicionado aos `allowedRoles` dos dois em `FIELD_CONFIG`
  (`reveal/route.ts`). Cada revelação gera log (`CERT_EMAIL_PASSWORD_REVEALED`/
  `CERT_ACCESS_PASSWORD_REVEALED`) igual já acontecia pros outros papéis —
  não foi criado nenhum caminho novo de leitura sem auditoria. A checagem de
  atribuição (`resp_abertura === session.name` ou OS livre) já existia no
  endpoint pra esse papel, então a extensão foi só no array de roles.
- **`operador_certificacao` — identidade pessoal restrita na aba Dossiê +
  quick card (18/07/2026, pedido explícito por confusão real):** o
  certificador vinha confundindo o e-mail PESSOAL do cliente (cadastrado
  pelo captador, `selectedOS.email`) com o e-mail de VÍNCULO e-commerce
  (`t2_new_email`, preenchido pelo terceiro) na hora de executar a
  certificação — os dois apareciam juntos na mesma tela, inclusive dentro
  do card de referência rápida ao lado do botão "Concluir BIRD ID"
  (`pfQuickCard`, aba ⚙️ Trabalho). Fix: gate novo `isCertLimited =
  currentRole === 'operador_certificacao'` (declarado duas vezes — uma
  dentro da IIFE de `activeTab === 'dados'`, outra dentro da IIFE de
  `activeTab === 'trabalho'` — são closures diferentes, não dá pra
  compartilhar a constante). Pra esse papel:
  - **Pessoa Física** (aba Dossiê): só Nome, CPF e um `GovChip` com o nível
    Gov.br. WhatsApp/E-mail/Endereço pessoal e "Captado por" somem.
    "Documentos Avulsos" também some — fora do escopo pedido.
    **Ajuste (mesmo dia, pedido de acompanhamento):** o card "Vínculo
    E-commerce" (Chip E-commerce/E-mail Empresa/Cód. Aparelho, com o mesmo
    fluxo de revelação de `t2_new_email_senha`) foi DUPLICADO aqui — antes
    só existia na aba Pessoa Jurídica, e o gestor pediu que aparecesse "no
    dossiê de pessoa física e pessoa jurídica". A cópia na PF é só leitura
    + revelação de senha (sem o input de editar/salvar senha, que continua
    só na PJ — evita ter dois lugares de escrita pro mesmo campo). Não é
    dado novo nem novo acesso — é o mesmo campo, mesma regra, só visível
    nos dois lugares agora. **2º ajuste (mesmo dia, pedido de
    acompanhamento seguinte):** o bloco "Documentos de Identidade"
    (Documento Frente/Verso/Completo, CNH, Selfie, Selfie+RG, Prova de
    Vida) tinha sido escondido na primeira versão desta restrição — o
    gestor pediu de volta explicitamente ("ele pode ter acesso a
    documentos de identidade, como rg ou cnh anexados"). Voltou a ficar
    visível pro certificador, sem gate de `isCertLimited` — segue igual
    pra todo mundo, como sempre foi antes desta feature. Lição: ao
    restringir um bloco inteiro "porque não foi citado na lista", prefira
    perguntar antes de assumir — a primeira versão errou pra mais
    (escondeu documento que o usuário queria manter) e precisou de um
    segundo pedido pra corrigir.
  - **Pessoa Jurídica** (aba Dossiê): CNPJ/Razão Social/Nome Fantasia
    continuam visíveis (decisão explícita do gestor ao ser perguntado —
    útil pra confirmar que está na OS certa), mas Endereço/CNAE/Capital
    Social/Regime Tributário/Quadro Societário somem. "Vínculo E-commerce"
    (Chip E-commerce = `t2_new_phone`, E-mail Empresa = `t2_new_email`,
    Cód. Aparelho = `cert_aparelho`) continua 100% visível — são
    exatamente os dados corretos que a certificação usa. "Documentos do
    Processo" vira só 2 itens, em modo LEITURA (`DocLink`, não
    `FileAttach` — quem anexa/substitui continua sendo a equipe de
    abertura): Comprovante/Cartão CNPJ e Certidão de Inteiro Teor.
  - **Card de referência rápida na aba Trabalho** (`pfQuickCard`, mostrado
    ao lado do botão "Concluir BIRD ID"): mesma troca — em vez de
    Tel./E-mail/Endereço pessoal, mostra Gov.br (chip) + E-mail
    Empresa/Chip/Aparelho (vínculo). `pjQuickCard` (mostrado no A1 e
    também reusado na Abertura pro `operador_abertura`) escondeu só o
    Endereço da empresa pro certificador — CNPJ/Razão/Fantasia continuam;
    o gate é local à variável `isCertLimited`, então pra `operador_abertura`
    (que também usa esse mesmo componente) nada muda, o endereço continua
    aparecendo pra ele.
  - **O que NÃO mudou** (perguntado explicitamente antes de implementar):
    Senha Gov.br (login + revelar) continua liberada pro certificador — ele
    precisa logar como o cliente pra fazer o BIRD ID/e-CPF. O bloco "Dados
    de Acesso à Certificação" (certificadora/sistema/aparelho/e-mail do
    certificado + revelação de senha, campos que ELE MESMO preenche) também
    não mudou — a restrição é só sobre dado de identidade/documento que ele
    CONSULTA, não sobre o fluxo de trabalho que ele EXECUTA.
  - Testado com Playwright real contra `npm run dev`: populei uma OS de
    teste (PATCH direto) com e-mail pessoal, endereço, CNAE, quadro
    societário, vínculo e-commerce e os 2 documentos; logado como
    `operador_certificacao`, confirmei por inspeção de texto que WhatsApp/
    Documentos de Identidade/CNAE/Quadro Societário NÃO aparecem e que
    vínculo e-commerce + Cartão CNPJ aparecem; logado como `admin` e
    `operador_abertura`, confirmei que nada mudou pra eles (WhatsApp,
    Documentos de Identidade e endereço da empresa continuam visíveis).
  - **REVERSÃO (21/07/2026, pedido explícito do gestor): "não deve aparecer
    dados de e-commerce para o certificador".** Isso desfaz os dois
    parágrafos acima sobre "Vínculo E-commerce" ficar visível pro
    `operador_certificacao` — se uma versão futura desta skill (ou o
    histórico) disser o contrário, **este item é o que vale**. Mudou:
    - **Aba Dossiê, Pessoa Física:** o card "Vínculo E-commerce" que tinha
      sido DUPLICADO aqui (parágrafo "Ajuste, mesmo dia" acima) foi
      **removido por completo** — não existe mais nessa aba pra nenhum
      papel além de quem já tinha (a duplicata só existia pro
      certificador).
    - **Aba Dossiê, Pessoa Jurídica:** o card "Vínculo E-commerce"
      continua existindo (gestor/admin/operador_abertura seguem vendo
      normalmente), mas agora tem `currentRole !== 'operador_certificacao'`
      envolvendo o bloco inteiro — pro certificador, o card simplesmente
      não renderiza mais nessa aba também. O reveal de senha do e-mail
      (`t2_new_email_senha_encrypted`) também perdeu `operador_certificacao`
      do array de roles que pode revelar/editar ali (ficou só
      gestor/admin/operador_abertura).
    - **Labels simplificados** nos campos que sobraram (PJ, pra quem ainda
      vê): "Chip E-commerce" → "Chip", "E-mail Empresa" → "E-mail", "Cód.
      Aparelho" → "Aparelho", "Senha e-mail Empresa" → "Senha e-mail".
    - **O que NÃO mudou (decisão deliberada, não confirmada explicitamente
      com o usuário — sinalizar se voltar a ser questionado):** os cards de
      referência rápida DENTRO dos painéis de trabalho onde o certificador
      efetivamente registra o BIRD ID/A1 (`pfQuickCard`/`pjQuickCard`, aba
      ⚙️ Trabalho, citados nos parágrafos "Card de referência rápida" acima
      e na entrada do 16º achado mais abaixo) continuam mostrando
      E-mail/Chip/Aparelho do vínculo. Raciocínio: sem esse dado ali, o
      certificador não sabe qual e-mail/telefone/aparelho usar pra
      registrar o e-CPF na plataforma externa — são dados operacionais
      necessários pro trabalho, diferente dos cards informativos/de
      consulta na aba Dossiê que foram removidos. Se o pedido for entendido
      como "remover em TODO lugar, inclusive esses", isso ainda precisa ser
      feito.
    - **2ª REVERSÃO (mesmo dia, pedido de acompanhamento): "Dados de
      vínculo e-commerce devem aparecer só não deve ter esse nome na
      label... pois o certificador precisa dessas informações".**
      Esclarecimento importante — a reversão acima entendeu "não deve
      aparecer dados de e-commerce pro certificador" como *ocultar o
      dado*, mas o pedido real era só *tirar o nome "e-commerce" da
      etiqueta* (ele confundia/não dizia respeito ao trabalho do
      certificador); o DADO em si (chip/e-mail/aparelho/senha) o
      certificador sempre precisou. Se essa skill ainda estiver
      desatualizada quando você ler isso: o estado que vale é este último.
      Mudou de volta (aba Dossiê, Pessoa Jurídica, `page.tsx` ~linha
      4752-4792):
      - O gate `currentRole !== 'operador_certificacao'` em volta do card
        foi **removido** — o card volta a aparecer pro certificador nessa
        aba (igual antes da 1ª reversão).
      - `operador_certificacao` voltou ao array de roles que pode
        revelar/editar a senha do e-mail ali (servidor, `PATCH
        /api/dossiers/[id]` e `/reveal`, já permitia esse papel pros dois
        — não foi preciso mexer no backend, só reverter o gate do
        frontend).
      - O título do card mudou de "Vínculo E-commerce" pra só **"Dados"**
        — os labels dos campos (Chip/E-mail/Aparelho/Senha e-mail, já
        simplificados na 1ª reversão) não mudaram de novo.
      - **Continua removido:** o card duplicado na aba Pessoa Física (a
        remoção completa dessa duplicata, parágrafo acima, não foi
        desfeita — o pedido de acompanhamento falou só em "aparecer",
        e a PJ já cobre a necessidade; não presumir que a duplicata na PF
        deva voltar sem perguntar).
      - Os cards de referência rápida (`pfQuickCard`/`pjQuickCard`) nunca
        tinham sido escondidos, então não mudam aqui.
    - **3º ajuste (mesmo dia, pedido de acompanhamento seguinte): "a
      informação de aparelho não precisa aparecer e nem senha de e-mail
      precisa aparecer pro certificador".** Corrige a suposição acima ("o
      DADO em si... o certificador sempre precisou") — na prática só
      **Chip** e **E-mail** são necessários pra ele; Aparelho e a senha do
      e-mail (revelar/editar) NÃO são. No card "Dados" (aba PJ), pro
      `operador_certificacao`: `Field label="Aparelho"` e o bloco inteiro
      de senha (`t2_new_email_senha`, revelar/corrigir) ficam atrás de
      `!isCertLimited` — Chip e E-mail continuam incondicionais. Não mudou
      pra mais ninguém (gestor/admin/operador_abertura seguem vendo
      Aparelho + senha normalmente). Se pedirem de novo pra ajustar esse
      card, considerar esse ping-pong de 3 rodadas no mesmo dia — talvez
      valha perguntar o resultado final desejado de uma vez, em vez de
      seguir aplicando ajustes incrementais.
- **`cnpj_number` obrigatório pro A1 liberar (21/07/2026, pedido do gestor:
  "tem que ter obrigatoriedade para preenchimento do cnpj quando empresa for
  para o A1... a informação pode não ser preenchida... e atrasar o serviço
  do certificador"):** `a1ReadyOf` (função central, `page.tsx` ~linha 1502)
  já exigia `cnpj_comprovante_url` + `certidao_inteiro_teor_url` +
  `bird_id_done`, mas NÃO exigia `cnpj_number` (o texto do CNPJ, campo
  digitado à parte — `t3Cnpj` no estado local, só vira `cnpj_number`
  persistido no clique de "Salvar Dados" ou "Concluir Abertura",
  `handleSaveEmpresa`/`completeSubStep('abertura')`). Bug real possível: o
  operador de abertura conseguia anexar os 2 arquivos (cartão CNPJ,
  certidão) sem nunca ter digitado/salvo o número do CNPJ — a OS chegava
  "pronta" pro certificador fazer o A1 sem o dado essencial. Fix: (1)
  `a1ReadyOf` agora também exige `!!d.cnpj_number` — como é função central
  usada em todos os lugares (fila do certificador, badges, dashboard), o
  gate se propaga sozinho, sem precisar tocar cada view; (2) botão "Concluir
  Abertura" (aba Trabalho, dentro do `aberturaStep`) fica `disabled` enquanto
  `t3Cnpj` estiver vazio, com aviso visível acima do botão — evita a OS ficar
  presa numa fila que ninguém vê o motivo. Não mexi em "Salvar Dados"
  (`handleSaveEmpresa`) — continua opcional lá, é só um salvamento parcial
  pra baixar a OS impressa, não uma conclusão de etapa.
  - **Gap real que sobrou (24/07/2026, caso reportado: "empresas abertas
    ou no processo de abertura com cartão CNPJ anexado mas o campo CNPJ
    vazio"):** a trava do 21/07 protegia "Concluir Abertura" (o botão
    fica desabilitado sem `t3Cnpj`), mas **não protegia o próprio upload
    do Cartão CNPJ** — o `FileAttach` desse campo é uma ação independente
    (não passa por `completeSubStep`/`handleSaveEmpresa`), então dava pra
    anexar o cartão sem nunca ter digitado o número. A OS ficava travada
    em `a1ReadyOf` sem nenhuma pista visível de fora da própria OS (o
    cartão "já estava lá", parecia pronto). Dois fixes:
    1. **Preventivo:** `FileAttach` ganhou props `disabled`/
       `disabledMessage` (genérico, reutilizável por qualquer outro
       campo que precise da mesma trava de ordem no futuro) — o upload
       do Cartão CNPJ (painel T3, `aberturaStep`) fica bloqueado
       (`disabled={!t3Cnpj.trim()}`) até o operador digitar o número,
       com aviso inline. Só esse campo — os outros documentos da
       abertura (Inscrição Municipal/Estadual, Simples, Certidão)
       continuam livres, não fazem parte desse gate.
    2. **Auditoria pros casos já existentes:** novo bloco `cnpjSemNumero`
       na tela Projetos (mesmo padrão visual/expansível de
       `finalizadasSemProjeto`, mas GLOBAL — não escopado por projeto,
       porque o problema é dado faltando em qualquer OS, com ou sem
       projeto) — `dossiers.filter(d => !!d.cnpj_comprovante_url &&
       !d.cnpj_number)`. Badge por linha indica se a empresa já está
       "🏆 empresa aberta" (finalizada) ou ainda "em processo" — os dois
       casos acontecem (empresa já finalizada antes da trava de
       21/07/2026 existir, ou ainda em andamento com o cartão anexado
       fora de ordem).
    - **Perguntado sobre OCR (auto-extrair o número do CNPJ direto da
      imagem do cartão ao anexar):** não é possível com o código atual —
      o app não tem nenhuma integração de OCR; extrair texto de uma
      imagem/PDF exigiria uma integração nova (Google Vision, Tesseract,
      etc.), fora do escopo desse fix pontual. Fica como possível item
      de v2, mencionado a título de registro caso o usuário peça
      depois — não implementado.
    - Testado com Playwright: campo de upload do Cartão fica com
      `disabled=true` (confirmado no atributo real do `<input
      type="file">`, não só visual) enquanto `t3Cnpj` vazio, libera
      (`disabled=false`) assim que o operador digita o número; simulei
      via PATCH direto uma OS com `cnpj_comprovante_url` setado e
      `cnpj_number` vazio (caso legado) — apareceu corretamente no
      bloco de auditoria da tela Projetos.
- **Captador vê seu próprio agendamento de certificação (21/07/2026, pedido
  do gestor: "ele precisa ter um modo... pra ele saber o dia e horário e
  pra quem ele agendou essa certificação"):** o captador agenda o horário
  via `POST /api/dossiers/[id]/captador-agendar` (chamado do modal de
  agenda em `public/captador.html`, não em `page.tsx` — o captador nunca
  teve acesso à view "📅 Agenda Certificação" do dashboard principal, essa
  é só de gestor/admin/operador_certificacao), mas depois de agendar não
  tinha nenhum lugar persistente pra conferir o que ficou marcado — só um
  `alert()` de confirmação na hora, que some. Fix: `GET /api/my-dossiers`
  (endpoint que já alimenta a aba "Meus Cadastros" do captador) passou a
  incluir `agendamento_cert` e `resp_certificacao` na projeção; a lista
  nessa aba agora mostra um badge "📅 Certificação agendada: dd/mm hh:mm —
  com {nome}" (ou "aguardando atribuição do certificador" se
  `resp_certificacao` ainda estiver vazio — é normal ficar vazio até o
  gestor atribuir depois, `agendamento_cert` e `resp_certificacao` não são
  preenchidos ao mesmo tempo). Não mexi na tela de tarefas — a tarefa de
  agendamento (`📅 Agendar certificação: ...`) já fica marcada "✓
  Concluído" depois que ele agenda, e cross-referenciar isso com o dado do
  dossiê na aba "Meus Cadastros" (que sobrevive mesmo se a tarefa for
  apagada) cobre a necessidade sem duplicar informação em dois lugares.
- **Selfie e selfie+documento deixam de ser obrigatórias na captação
  (21/07/2026, pedido do gestor: "a obrigatoriedade da selfie... não
  precisa ser obrigatório mais. Somente o envio dos documentos... RG
  frente e verso e documento completo ou CNH").** Reverte parte do #114
  ("torna obrigatórios os documentos de identidade e selfies") — a
  obrigatoriedade do **documento de identidade** (frente+verso, ou
  documento completo, ou CNH — 3 alternativas, não cumulativas) continua
  valendo, só a selfie e a selfie+RG deixaram de bloquear o envio. Mudou
  em 2 lugares que sempre precisam ficar sincronizados (mesmo padrão de
  defesa em profundidade do resto da captação — front bloqueia por UX,
  servidor é quem garante de verdade):
  - `public/captador.html` (`handleFormSubmit`): removidos os 2 `if` que
    bloqueavam envio por falta de `photo_selfie`/`photo_selfie_rg`; labels
    dos campos mudaram de "(obrigatória)" pra "(opcional)".
  - `api/captacao/route.ts` (`POST`): removida a mesma validação
    server-side. Os campos continuam aceitos e salvos normalmente
    (`photo_selfie_url`/`photo_selfie_rg_url`) se o captador enviar por
    conta própria — só pararam de ser exigidos.
- **Bug real: mesmo captador aparecendo 2x na tela "📸 Captadores" com
  contagens diferentes (21/07/2026, caso relatado: "FOGUINHO" duplicado,
  screenshot do usuário — 1 OS numa entrada, 7 OS na outra).** Causa raiz:
  `captured_by` é texto livre — a única forma de setá-lo manualmente era
  um `<input type="text">` na aba "Edição Rápida" (Operacional, só admin),
  então bastava um espaço a mais ou capitalização diferente numa OS pra
  criar uma segunda "grafia" do mesmo captador. O agrupamento da tela
  Captadores (`page.tsx` ~linha 4076) comparava `d.captured_by === nome`
  (igualdade EXATA de string) — duas grafias do mesmo nome viravam dois
  captadores distintos, cada um com sua fatia das OS. Fix em 2 frentes:
  1. **Agrupamento normalizado:** a tela agora agrupa por versão
     normalizada (`.trim().replace(/\s+/g, ' ')`, comparada
     case-insensitive) num `Map`, exibindo a grafia normalizada de
     qualquer uma das variantes — corrige a exibição na hora, sem precisar
     de migração de dados (os registros no banco continuam com a grafia
     antiga que tinham, só a exibição/agrupamento ficou tolerante).
  2. **Campo deixou de ser texto livre:** na aba "Edição Rápida" →
     "Operacional (Admin)", `captured_by` agora usa o componente
     `ResponsibleSelect` (mesmo componente já usado pra
     `resp_certificacao`/`resp_abertura` noutros lugares da tela) em vez
     de `<input type="text">` — as opções combinam captadores cadastrados
     (`operatorsList`, role `captador`, ativos) com qualquer valor de
     `captured_by` já em uso hoje (cobre OS antigas/anteriores ao sistema,
     de captadores que nunca tiveram login) — continua dando pra "setar
     quem é o captador de uma OS" pra controle, inclusive de processos
     legados, só que escolhendo de uma lista em vez de digitar (evita
     reintroduzir o mesmo bug de grafias divergentes no futuro). Os outros
     4 campos desse painel (`assigned_to`, `resp_certificacao`,
     `resp_abertura`, `protocolo`) continuam como texto livre — fora do
     escopo deste bug, não mexi neles.
  - **Dado histórico não foi corrigido** (as OS do "FOGUINHO" duplicado
    continuam com a grafia divergente que já tinham no banco — só a
    exibição passou a agrupar as duas). Se o usuário quiser consolidar de
    verdade (ex.: reatribuir todas pra uma grafia única via a nova tela de
    edição), é uma ação sobre dado de produção — não fazer sem confirmação
    explícita na conversa.
- **Portal do terceiro (Kanban) — datas nos cards, ordenação/filtro por
  coluna e check de "documentos conferidos" (21/07/2026, feedback real da
  gestora de e-commerce: "conforme eles colocam empresas novas eu não
  consigo saber qual é nova porque não fica na ordem").** Causa raiz: `GET
  /api/terceiro/dossiers` nunca teve `.sort()` nem expunha `created_at` —
  o kanban (`src/app/terceiro/page.tsx`) renderizava os cards na ordem
  bruta que `Database.getDossiers()` devolvia (arbitrária, principalmente
  no backend Postgres sem `ORDER BY`), então uma empresa nova podia
  aparecer no meio ou no fim da coluna "✅ Finalizadas" sem nenhum jeito de
  saber que era nova. Fix (3 partes):
  1. **Novo campo persistido `empresa_aberta_em`** (`src/lib/db.ts` +
     `db-postgres.ts` `TEXT_FIELDS`): timestamp gravado em
     `api/dossiers/[id]/route.ts` na transição `empresa_aberta` false→true
     (mesmo bloco que já seta `empresa_aberta = true`/gera protocolo) —
     não existia nenhum timestamp de "quando a empresa foi aberta" antes
     disso, só o booleano.
  2. **API `terceiro/dossiers` agora ordena por padrão** (`created_at`
     desc, mais novas primeiro) e expõe `created_at` + `empresa_aberta_em`
     na projeção.
  3. **UI do kanban:** cada card mostra "Entrou: dd/mm" e (se aplicável)
     "Aberta: dd/mm"; cada coluna ganhou um toggle de ordenação
     (novas/antigas primeiro, independente por coluna — a coluna
     Finalizadas ordena por `empresa_aberta_em`, as outras por
     `created_at`) — isso é o "filtro nas colunas" pedido.
  - **Check "documentos conferidos" — novo campo `terceiro_docs_baixados`
    (+ `_em`)**: controle PRÓPRIO do terceiro (não afeta `current_step` nem
    nenhuma regra de negócio, é só uma marcação pessoal dele pra saber o
    que já processou vs o que é novo). Aparece em TODO card (não só
    Finalizadas — pedido explícito: "conforme for sendo anexado no
    processo ou no final", ele pode marcar a qualquer momento) e também
    dentro do modal de detalhes, na seção "Documentos finais". A coluna
    Finalizadas tem um filtro extra "Só não conferidas" que usa esse
    campo — resolve o pedido da gestora de e-commerce direto (ela filtra
    pra ver só o que ainda não olhou). Gravado via
    `api/dossiers/[id]/terceiro-update` (mesmo endpoint do vínculo,
    parâmetro novo `terceiro_docs_baixados: boolean` — endpoint já é
    escopado a `session.role === 'terceiro'`, sem gate adicional
    necessário).
  - `MiniCard` deixou de ser um `<button>` e virou `<div role="button"
    tabIndex={0}>` — precisa aninhar um `<input type="checkbox">`
    interativo, e `<input>` dentro de `<button>` é HTML inválido. O
    checkbox tem `onClick={(e) => e.stopPropagation()}` no `<label>` pra
    não abrir o modal de detalhes ao marcar.
- **Portal do terceiro (Kanban) — filtro por captador + busca por
  número/e-mail do vínculo (24/07/2026, pedido direto do usuário):**
  - Novo `<select>` "Captador: Todos" no header, ao lado da busca —
    opções vêm de `Array.from(new Set(list.map(d => d.captured_by)))`,
    sem endpoint novo (o campo já era projetado por
    `api/terceiro/dossiers`, só não tinha UI de filtro). `match(d)`
    ganhou `&& (!captadorFilter || d.captured_by === captadorFilter)`.
  - Busca do header (`query`) passou a incluir `t2_new_email` e
    `t2_new_phone` — os dados que o PRÓPRIO terceiro digita no vínculo
    (Chip/E-mail da empresa), que antes não entravam na busca (só nome/
    CPF/OS/CNPJ/empresa, dados vindos da captação). Placeholder
    atualizado pra mencionar "número ou e-mail".
  - Ambos os filtros (texto + captador) são aplicados juntos em `match`,
    antes da divisão em colunas/buckets — mesmo padrão já usado no filtro
    de "só não conferidas" da coluna Finalizadas.
  - Testado com Playwright: busquei por um trecho do `t2_new_email` de
    uma OS com vínculo definido e ela apareceu; setei `captured_by` de 2
    OS diferentes via PATCH (gestor) e confirmei que o select populou com
    os 2 nomes e que filtrar por um deles esvaziou as colunas que só
    tinham a OS do outro.
- **Esteira de Trabalho (kanban interno) — mesmo filtro por captador +
  busca (24/07/2026, pedido explícito do usuário: "adicionar filtros na
  esteira kanban que nem fizemos para o acesso de terceiro"):**
  - Nova barra de filtro (`esteiraQuery`/`esteiraCaptadorFilter`) entre o
    header e o kanban, só na view `esteira` — **diferente** da busca
    global do header (`searchTerm`/`searchResults`), que é um dropdown de
    "pular direto pra uma OS" e não filtra os cards das colunas. A nova
    barra filtra os cards de TODAS as colunas ao mesmo tempo (Captados,
    E1, E2, E3, Finalizado).
  - `getColumnDossiers` (única função que monta cada coluna da Esteira,
    usada só ali — confirmado via grep antes de mexer) ganhou
    `matchEsteiraFilters(d)` aplicado no filtro final — texto (nome, CPF,
    OS, empresa, CNPJ, aparelho, telefone pessoal, `t2_new_phone`,
    `t2_new_email`, captador) + select de captador (mesmas opções
    derivadas de `dossiers`, sem endpoint novo).
  - Testado com Playwright: setei `captured_by` de 2 OS diferentes,
    filtrei pelo select num deles — só o card daquela OS apareceu na
    coluna certa, as outras colunas ficaram vazias (confirmado por
    screenshot, não só por busca de texto no DOM — o nome do outro
    captador ainda aparece como `<option>` não selecionada do próprio
    `<select>`, então checar só "o texto sumiu da página" dá falso
    negativo nesse caso específico).
- **Portal do terceiro — dossiê completado (13/07/2026, pedido do gestor:
  "terceiro precisa enxergar as informações do dossiê PF/PJ e documentos
  pra gerenciar a empresa nos e-commerces"):** o portal já mostrava a
  maior parte (dados PF, empresa, docs de identidade, docs finais,
  certificação com download do A1). Completados os gaps em relação ao
  Dossiê interno — `api/terceiro/dossiers/route.ts` (projeção) +
  `terceiro/page.tsx` (UI): `empresa_endereco`, `quadro_societario`,
  `cert_certificadora`, revelação de `cert_senha_acesso` (o endpoint
  `/reveal` JÁ permitia terceiro nesse campo, só a UI não mostrava o
  botão) e os documentos avulsos (`doc_extra_1..3_url`/`_nome`, exibidos
  em "Documentos finais" com o nome dado por quem anexou). A senha Gov.br
  continua 100% vedada ao terceiro — regra de negócio inalterada, não
  adicionar nunca sem pedido explícito.
- **Senha Gov.br editável por gestor/admin:** o PATCH geral
  (`api/dossiers/[id]/route.ts`) aceita `gov_password` (criptografa e grava
  em `gov_password_encrypted`), restrito a `gestor`/`admin`. O captador
  continua usando a via própria (`/captador-update`).
- **Diretório de operadores não é mais exclusivo de gestor/admin:**
  `GET /api/users/directory` (nome/papel/ativo, sem username) é liberado pra
  qualquer papel interno — sem isso, `operador_abertura`/`operador_certificacao`
  não conseguiam abrir tarefa pra ninguém (dropdown "Enviar para..." vazio,
  porque `operatorsList` só era buscado por gestor/admin via `/api/users`,
  que é restrito). `/api/users` (completo, com username) continua só
  gestor/admin, usado no painel de administração.
- **CNPJ na OS impressa depende de "Salvar Dados":** o campo de CNPJ digitado
  na etapa de abertura (`t3Cnpj`) só virava `cnpj_number` persistido no
  clique de "Concluir Abertura" — quem baixava o `.docx` logo após "Salvar
  Dados" recebia o documento sem CNPJ. `handleSaveEmpresa` agora persiste o
  CNPJ também.
- **Reatribuição de certificação concluída (13/07/2026, caso real):**
  gestores marcaram "Concluir BIRD/A1" por engano e passaram a aparecer
  como executores em "Concluídos por Certificador" (e nos contadores de
  cobrança). Agora cada linha dessa tela tem um `<select>` (ao lado do
  botão de pagamento) que grava `bird_id_done_por`/`a1_done_por` direto —
  o card muda de grupo no próximo render. **Gate no servidor**
  (`dossiers/[id]/route.ts`, bloco `REATRIB`): alterar `*_done_por` de uma
  certificação JÁ concluída (sem estar concluindo na mesma chamada) é
  restrito a gestor/admin e gera log `CERT_REATRIBUIDA` (quem trocou, de
  quem pra quem). A escrita desses campos JUNTO com a conclusão
  (`updates.X_done === true && !original.X_done`, fluxo do
  `completeSubStep`) continua livre pra quem pode concluir — não quebrar
  essa exceção, senão ninguém consegue mais concluir certificação.
  Testado: reatribuição real via UI (card mudou de grupo), log gravado,
  e 403 confirmado pra `operador_certificacao` tentando trocar via API.
- **Controle de pagamento centralizado na tela "Projetos" + notificação
  dedicada pro Caio de Sá (17/07/2026, pedido explícito):** antes dava pra
  marcar/desmarcar `bird_pago`/`a1_pago`/`colaborador_pago` em DOIS lugares
  (tela Certificação, `pagamentoPill`; e "Concluídos por Certificador",
  `togglePagamentoConcluido`) — o gestor pediu que o controle vire exclusivo
  da tela Projetos, com as outras telas virando só informativas. O que
  mudou:
  - `togglePagamento` (a única função que faz o PATCH) foi promovida pra
    escopo do componente (perto de `handleDeleteProject`) — antes existia
    uma cópia local em cada view que precisava dela.
  - Certificação e Concluídos por Certificador: os badges de pagamento
    viraram `<span>` sem `onClick` (só mostram ✓/○, não clicam mais).
    `togglePagamentoConcluido` (duplicata local da tela Concluídos) foi
    removida — não existe mais nenhum caminho de escrita fora da tela
    Projetos.
  - Tela Projetos: cada card de projeto ganhou "💰 Gerenciar pagamentos (N
    certificações)" — expande (`expandedProjectPagamentos`, só um projeto
    aberto por vez) uma lista das OS com `bird_id_done || a1_done`, cada
    linha com nome (clicável, abre a OS) + as pills clicáveis de BIRD/A1/
    Colaborador (mesmo componente visual de antes, `pagamentoPillClick`,
    só que local a essa view).
  - **Paginação da lista de projetos** (`projetosPage`, 10 por página,
    mesmo padrão de botões numerados ±2 já usado na Certificação) — antes a
    tela listava todos os projetos sem paginar, ia ficar ilegível conforme
    mais projetos fossem criados.
  - **Notificação ao concluir BIRD/A1** (`dossiers/[id]/route.ts`, os dois
    blocos logo depois do bloco `REATRIB`): antes notificava TODOS os
    gestores (`Database.getUsersByRole('gestor')`); agora notifica só o
    usuário de username fixo `cgs1010` (Caio de Sá) via
    `Database.getUserByUsername('cgs1010')` — pedido explícito: só ele
    controla pagamento, então só ele precisa ser avisado. Mensagem
    (task/push) inclui o nome do projeto quando a OS tem um
    (`d.projeto`), pra ele já saber onde ir marcar o pagamento. **Decisão
    consciente, não genérica:** se no futuro houver mais de um gestor
    financeiro, isso precisa virar configurável (ex.: campo "gestor
    responsável" por projeto, como já existe `contador_abertura`) — por
    ora é hardcoded porque só existe essa pessoa fazendo esse controle.
    Se o username mudar (ex.: conta recriada), atualizar a constante
    `'cgs1010'` nos dois blocos.
  - Testado com Playwright real contra `npm run dev`: criar 12+
    projetos confirma paginação (10/página, botões numerados); PATCH
    direto numa OS de teste (`bird_id_done`/`a1_done` + `projeto`) +
    "Recarregar" mostra a OS na lista de pagamentos pendentes da tela
    Projetos; clicar na pill "○ BIRD" marca como pago e atualiza o
    contador do card na hora; confirmado que os badges em Certificação e
    Concluídos por Certificador viraram `<span>` (não `<button>`) via
    inspeção do DOM.
- **8º incidente/achado — auditoria "finalizada sem certificação completa"
  na tela Projetos (18/07/2026, caso real reportado pelo gestor):** gestor
  notou que um projeto tinha 27 "Concluídas" (empresa aberta,
  `current_step === 'finalizado'`) mas só 14 OS apareciam em "Gerenciar
  pagamentos" (`colabFeitos`, que só conta OS com `bird_id_done ||
  a1_done`). Investigação confirmou que os NÚMEROS de pagamento em si
  batiam entre as 3 telas (Projetos, Certificação, Concluídos por
  Certificador — todos mostravam 11 BIRD + 8 A1 = 19 certificações
  pendentes) — não era bug de contagem. O problema real: **o servidor não
  trava a transição pra `current_step === 'finalizado'` exigindo
  `bird_id_done`/`a1_done`** (`dossiers/[id]/route.ts` — "Mover Etapa" do
  gestor e "Edição Rápida" aceitam qualquer step sem checar certificação).
  Isso permite (e aparentemente já aconteceu) uma empresa ser marcada como
  aberta sem a certificação correspondente ter sido marcada como
  concluída no sistema — hipótese mais provável do próprio gestor: o
  certificador fez o trabalho mas esqueceu de clicar em "Concluir BIRD
  ID"/"Concluir A1". Fix: NÃO foi adicionada trava de bloqueio (mudança de
  regra de negócio maior, fora de escopo por ora) — foi adicionada uma
  seção de AUDITORIA na tela Projetos, por projeto: `semCertFinalizadas =
  osDoProjeto.filter(d => d.current_step === 'finalizado' &&
  (!d.bird_id_done || !d.a1_done))`, renderizada como bloco âmbar "⚠️ N
  finalizada(s) sem certificação completa registrada" (só aparece quando
  há pelo menos 1 caso), expansível (`expandedProjectSemCert`, mesmo
  padrão de "só um projeto aberto por vez" já usado em
  `expandedProjectPagamentos`) mostrando cada OS com badges ✓/✕ BIRD e
  ✓/✕ A1 — clicar na linha abre a OS (`handleSelectOS`) pra investigar/
  corrigir manualmente (marcar a certificação como concluída se ela de
  fato foi feita, ou investigar se a empresa foi aberta fora do fluxo
  normal). **Não é uma métrica de pagamento** — é auditoria de
  consistência de dado, separada dos 3 contadores de pagamento (BIRD/A1/
  Colaborador) que já existiam. Testado com Playwright: 2 OS de teste
  (uma sem nenhuma certificação, outra com BIRD feito mas A1 não) —
  ambas apareceram corretamente na lista com os badges certos.
- **9º achado, mesmo caso real, resposta ao acompanhamento (18/07/2026):**
  o gestor apontou dois furos na auditoria acima. (1) **29 vs 27:** a
  coluna "🏆 Abertas/Concluídas" da esteira (`getColumnDossiers`) conta
  TODAS as OS `finalizado` do sistema, sem filtrar por projeto; cada card
  de "Projetos" só soma as suas (`osDoProjeto`, filtro por
  `d.projeto === p.nome`). OS finalizada sem projeto atribuído nunca
  aparecia em nenhum card — explica a diferença 29 (global) vs 27 (só
  daquele projeto). Fix: banner novo no topo da tela Projetos (antes da
  lista, fora de qualquer card), `finalizadasSemProjeto = dossiers.filter
  (d => d.current_step === 'finalizado' && !d.projeto)` — mesmo padrão
  visual (âmbar, expansível, `handleSelectOS` na linha) dos outros dois
  blocos de auditoria. (2) **"algumas têm 1 certificado com dado e outro
  sem"**: existem OS onde `bird_id_done`/`a1_done` JÁ estão `true`, mas o
  dado por trás nunca foi preenchido — BIRD concluído sem NENHUM dos 4
  campos de acesso (`cert_sistema_usado`/`cert_certificadora`/
  `cert_aparelho`/`cert_email`) preenchido, ou A1 concluído sem
  `certificado_a1_url` anexado (mesmo padrão de dado corrompido do "7º
  incidente" abaixo, mas ali o fix foi só reabrir o upload — aqui o
  gestor precisa de uma LISTA pra cobrar o certificador). Fix: 2º bloco de
  auditoria por projeto (`birdSemDados`, `a1SemArquivo`, unidos em
  `dadosIncompletos` — union por `id`, uma OS pode aparecer com os dois
  problemas ao mesmo tempo), mesmo padrão visual do bloco de
  `semCertFinalizadas` (âmbar, expansível, `expandedProjectDadosIncompletos`),
  badge por linha indicando exatamente qual falta ("🆔 BIRD sem dados" e/ou
  "📜 A1 sem arquivo" — não são mutuamente exclusivos). **Critério de
  "sem dados" é literal — todos os 4 campos vazios**, não "pelo menos 1
  vazio": se só faltar 1 campo dos 4, essa OS não aparece nesse bloco (só
  captura o caso "nada preenchido"); se pedirem detectar preenchimento
  parcial também, é um critério novo, perguntar antes de mudar (já foi
  testado que o critério atual não pega parcial: `cert_aparelho`
  preenchido sozinho, com os outros 3 vazios, NÃO entra na lista — só saiu
  da lista depois de eu limpar esse campo também no teste). Testado com
  Playwright: 3 cenários numa sessão só — OS finalizada sem projeto
  (aparece no banner do topo), BIRD concluído sem nenhum dado de acesso
  (aparece no bloco do projeto com "🆔 BIRD sem dados"), A1 concluído sem
  arquivo (aparece com "📜 A1 sem arquivo") — os 3 badges certos, nenhum
  cruzamento entre os blocos.
- **10º achado, mesmo caso real, 2ª resposta ao acompanhamento (18/07/2026):**
  o gestor perguntou se os 3 blocos de auditoria acima cobriam TUDO ou só
  `finalizado`, e pediu visão de quem ainda está PENDENTE de certificação
  (nem começou), não só de quem já foi marcado com problema. Confirmado:
  os 3 blocos anteriores só pegam `finalizado` (2 deles) ou já concluído
  com dado faltando (1 deles) — nenhum pegava "elegível mas nem
  começou". Pedido explícito de onde mostrar: tela Projetos (por
  projeto) **e** tela Certificação (pro próprio certificador), mesmo
  critério já usado na fila (`vinculoReady`/`a1ReadyOf`, ver
  `getCertColumnDossiers`/`ativa()` na tela Certificação).
  - **Tela Projetos — 4º bloco de auditoria** (cor **sky**, não âmbar —
    isso não é um problema de dado, é fila de trabalho normal ainda não
    feita): `birdPendentes`/`a1Pendentes` reaproveitam a MESMA regra da
    fila do certificador (`vinculoReady` redefinida localmente como
    `vinculoReadyProj` — está em duas IIFEs diferentes, não dá pra
    compartilhar a constante, mesma limitação já documentada no 9º
    achado; `a1ReadyOf` é função de escopo de componente, essa sim
    compartilhada) — filtra só pelo projeto (`osDoProjeto`) e por
    `current_step` em `['t2','t3']` (já passou da E1). "🔵 N
    certificação(ões) pendente(s)", badges "🆔 e-CPF pendente"/"📜
    e-CNPJ pendente" por linha (uma OS pode ter os dois ao mesmo tempo).
  - **Tela Certificação — badge do BIRD ganhou a MESMA distinção que o A1
    já tinha**: antes `certBadges` mostrava "🆔 BIRD pendente" pra
    qualquer OS sem `bird_id_done`, MESMO quando ainda bloqueada
    esperando o terceiro definir o vínculo e-commerce — sem abrir a OS
    não dava pra saber se dava pra trabalhar agora. Agora: `vinculoReady(d)
    ? "🆔 BIRD pendente" (sky, pronta) : "🆔 BIRD aguardando vínculo"`
    (slate, bloqueada) — mesmo padrão visual que "📜 A1 liberado" vs "📜 A1
    aguardando BIRD ID"/"aguardando abertura" já usava. **Se mexer de novo
    nesse badge, mantenha os dois lados (BIRD e A1) com a mesma
    granularidade — foi exatamente a assimetria entre eles que gerou esse
    pedido.**
  - Testado com Playwright: 2 OS pendentes num projeto (uma pronta pra
    e-CPF com vínculo definido, outra pronta pra e-CNPJ com cartão CNPJ +
    certidão + BIRD feito) — apareceram no bloco sky da tela Projetos com
    os badges certos; na tela Certificação, confirmado visualmente que
    uma OS sem vínculo mostra "BIRD aguardando vínculo" (cinza) e uma OS
    com vínculo mostra "BIRD pendente" (roxo/destacado) lado a lado na
    mesma lista.
  - **O bloco sky da tela Projetos (item acima) NÃO EXISTE MAIS** — passou
    por mais duas idas e voltas no mesmo dia, ver "12º achado" logo
    abaixo pro estado final. Fica registrado aqui só como histórico de
    decisão (o que foi tentado e por quê foi descartado).
- **12º achado, mesmo caso real, resolução final (18/07/2026) — pendentes
  não ganham lista própria, viram contador no resumo que já existia:**
  depois do 10º achado (bloco sky em Projetos) o gestor pediu pra mover
  esse bloco pra "Concluídos por Certificador" (11º achado, chegou a
  virar PR #103) — mas antes de mergear, ele mesmo questionou de novo:
  "essa informação já não aparece na tela Certificação?". Conferido no
  código: SIM — cada linha de `renderListRow` já mostra
  `<RespChip name={d.resp_certificacao} />` (quem tá atribuído, ou
  "Livre") e os badges de status via `certBadges` (inclui a distinção
  "BIRD pendente" vs "BIRD aguardando vínculo" do 10º achado, e
  "A1 liberado" vs "A1 aguardando..."). Confrontei de volta com essa
  informação (pedido explícito do gestor: "quero que você me confronte
  caso minha ideia não faça sentido") — criar uma lista separada
  (primeiro em Projetos, depois em Concluídos por Certificador) pra
  mostrar de novo o que já está linha a linha na tela Certificação é
  redundante; a lacuna real era só não ter um jeito rápido de ver
  "quem tem quantas pendências" sem escanear a lista inteira. Solução
  final, acordada com o gestor: **revertidos os blocos separados** (o de
  Projetos do 10º achado E o de Concluídos por Certificador do 11º —
  `git checkout -B` a partir do master antes de qualquer um dos dois
  merges, PR #103 fechada sem merge). Em vez disso, o resumo **"Por
  certificador"** que já existia no topo da tela Certificação (só com
  BIRD/A1 CONCLUÍDOS) ganhou os pendentes JUNTO, na mesma linha por
  pessoa: `{nome}: N BIRD · N A1` (concluídos, como já era) `· N BIRD ·
  N A1 pendentes` (novo, só aparece se >0). Pendentes agrupados por
  `resp_certificacao` (atribuído — reaproveita `vinculoReady`/`a1ReadyOf`
  já em escopo nessa mesma IIFE, não precisou redefinir de novo dessa
  vez), com "Livre" como mais uma linha do resumo (trabalho disponível
  que ninguém pegou ainda) — ordenado por último. **Zero lista nova,
  zero componente novo** — só estendeu um `Record` que já existia.
  Lição: quando um pedido de feature "mostrar X em algum lugar" aparece,
  primeiro checar se X já não está visível em outro formato antes de
  criar superfície nova — economizou 2 reversões nesse caso específico
  (poderia ter sido 1, se eu tivesse checado a tela Certificação antes
  de implementar o 10º achado). Testado com Playwright: "Resp.
  Certificação: 1 BIRD · 1 A1 · 1 BIRD · 0 A1 pendentes" e "Livre: 0 BIRD
  · 0 A1 · 1 BIRD · 0 A1 pendentes" apareceram corretamente lado a lado
  no resumo, sem nenhuma lista duplicada em nenhuma outra tela.
- **13º achado, mesmo caso real, extensão simétrica pro certificador
  (18/07/2026, mesma sessão do 12º achado):** logo depois de mergear o
  12º achado, o gestor perguntou se o bloco "certificação concluída com
  dado faltando" (auditoria da tela Projetos, `birdSemDados`/
  `a1SemArquivo` — gestor/admin-only) também aparecia pro certificador.
  Resposta honesta: NÃO — diferente do caso do 12º achado (onde a
  informação já estava visível em outro formato), aqui o badge do
  certificador mostrava só "🆔 BIRD ✓"/"📜 A1 ✓" sem nenhuma pista de que
  o dado por trás estava faltando. Diferente do padrão dos achados
  anteriores (não tinha onde reaproveitar) — dessa vez era mesmo uma
  lacuna nova, então implementei: `certBadges` (tela Certificação) ganhou
  dois badges de alerta extras (vermelho/rose, mesmo estilo do badge
  "🚫 docs recusados" que já existia ali), aparecendo JUNTO do badge de
  concluído, não no lugar dele — "⚠️ BIRD sem dados" quando
  `bird_id_done && !cert_sistema_usado && !cert_certificadora &&
  !cert_aparelho && !cert_email`, e "⚠️ A1 sem arquivo" quando `a1_done
  && !certificado_a1_url` — MESMO critério da auditoria de Projetos, sem
  duplicar lógica nova. Visível pra qualquer papel que já vê aquela
  linha (certificador só vê as dele/livres via `isRelevantParaMim`,
  gestor/admin vê tudo) — não precisou de gate de role adicional, é só
  informação sobre uma OS que a pessoa já enxerga. Testado com
  Playwright: logado como `operador_certificacao`, marquei um BIRD como
  concluído sem preencher nenhum dado de acesso — o badge "⚠️ BIRD sem
  dados" apareceu na linha da OS, ao lado do "🆔 BIRD ✓", na fila dele.
  **Critério de "sem dados" revisado no 14º achado logo abaixo — o texto
  do badge também mudou (de "BIRD sem dados" pra "BIRD dados
  incompletos") pra refletir que agora pega preenchimento parcial, não
  só tudo vazio.**
- **14º achado, mesmo caso real, correção de critério com caso real
  (18/07/2026, mesmo dia dos achados 9-13):** gestor mandou um print de
  produção real (OS Maysa Farias Leal) provando o limite documentado no
  9º achado — `cert_aparelho` = "Aparelho A65" preenchido, mas
  Certificadora/Sistema usado/E-mail do certificado vazios e nenhuma
  senha definida, e o alerta NÃO disparava porque o critério exigia os 4
  campos de texto TODOS vazios. Confirmado que é um caso que se repete
  (não foi só esse). Fix: critério mudou de "E" (todos vazios) pra "OU"
  (falta pelo menos 1) — perguntado e confirmado com o gestor antes de
  mudar, incluindo se as 2 senhas (`has_cert_email_senha`/
  `has_cert_senha_acesso`) entrariam no critério também (SIM, confirmado
  explicitamente — sem senha o certificador não acessa o e-mail/app de
  verdade). **Promovido a função de escopo de componente**,
  `birdDadosFaltando(d)` (perto de `a1ReadyOf`/`certConcluida`) — antes a
  MESMA regra estava copiada em 2 IIFEs diferentes (badge da tela
  Certificação + auditoria da tela Projetos), risco real de
  dessincronizar se alguém mudasse só uma cópia (mesmo padrão de risco já
  documentado pra `vinculoReady`, que continua duplicada por real
  limitação de escopo — aqui não tinha essa limitação, então virou
  função só). Texto do badge mudou de "⚠️ BIRD sem dados" pra "⚠️ BIRD
  dados incompletos" (mais preciso — não é mais "nada preenchido", é
  "falta pelo menos um campo"), nos dois lugares que mostram esse badge
  (tela Certificação e o card expandido da auditoria de Projetos).
  **Se adicionar um novo campo de "dados de acesso ao BIRD" no futuro,
  adicione na condição de `birdDadosFaltando` — é a única fonte da
  verdade agora, não mais 2 lugares.** Testado com Playwright:
  reproduzido o cenário exato do print (só `cert_aparelho` preenchido,
  resto vazio) — confirmado que "⚠️ BIRD dados incompletos" aparece na
  fila do certificador.
- **15º achado, mesmo caso real, 2 ajustes de acompanhamento (18/07/2026,
  mesma sessão do 14º achado):**
  1. **Empresas finalizadas sem NENHUM certificado marcado agora aparecem
     pro certificador.** Pergunta do gestor: "as OS finalizadas sem
     BIRD/A1 marcado devem aparecer pro certificador ter atenção e
     preencher o que falta". Antes NÃO apareciam em lugar nenhum da tela
     Certificação — `listPool` (a fonte da lista inteira) só incluía OS
     `finalizado` que já tivessem `bird_id_done || a1_done` (variável
     `finalizadasComCert`); uma empresa aberta sem NENHUM certificado
     nunca entrava no pool, só o gestor via isso (auditoria
     `semCertFinalizadas`, tela Projetos). Fix: `finalizadasComCert` virou
     `finalizadasParaConsulta = dossiers.filter(d => d.current_step ===
     'finalizado')` — SEM a condição de já ter cert marcado, qualquer
     finalizada entra no pool agora. Não precisou de badge novo: a própria
     `certBadges(d)` já mostra "BIRD pendente"/"BIRD aguardando vínculo" e
     equivalente de A1 pra quem não tem `bird_id_done`/`a1_done` — o
     alerta visual já existia, só faltava a OS estar na lista pra
     aparecer. Efeito colateral aceito conscientemente: `statusOf(d)`
     classifica QUALQUER `current_step === 'finalizado'` como
     `'concluidos'` (linha antes de checar `ativa()`/atribuição) — então
     essas OS "finalizadas mas pendentes" caem na aba "✅ Concluídos" da
     tela, não em "🔓 Livre"/"⚡ Em andamento" (mesmo que a badge mostre
     claramente que não está concluído). Não mexi em `statusOf` pra não
     arriscar quebrar a semântica de reconciliação de pagamento que já
     dependia dela — se o gestor achar confuso na prática (rótulo da aba
     "Concluídos" não bate com o conteúdo), é uma mudança separada a
     avaliar, não assumir de graça.
  2. **`a1ArquivoFaltando(d)` promovida a função de componente**, mesmo
     padrão do `birdDadosFaltando` do 14º achado — antes a condição
     `a1_done && !certificado_a1_url` estava copiada igual nos mesmos 2
     lugares (badge da Certificação + auditoria de Projetos). Hoje as
     duas cópias sempre concordavam (mesma condição, sem bug ativo), mas
     era risco pro FUTURO: se alguém mudasse o critério só numa cópia
     (ex.: adicionar outro campo obrigatório do A1), as duas telas
     sairiam divergentes pra mesma OS sem nenhum aviso. Perguntado
     explicitamente pelo gestor ("pode dar problema, o ideal é
     corrigir") antes de mexer.
  - Testado com Playwright: logado como `operador_certificacao`, uma OS
    `finalizado` sem nenhuma certificação marcada (`t2_new_email`
    preenchido, então elegível pro badge "BIRD pendente") apareceu na
    aba "Todos" com o selo "🏆 empresa aberta" ao lado de "🆔 BIRD
    pendente"/"📜 A1 aguardando BIRD ID" — visível e com sinal claro de
    pendência, sem precisar abrir a OS pra descobrir.
- **16º achado, mesmo caso real, raiz do problema de e-mail errado
  (18/07/2026, mesma sessão dos achados 9-15):** gestor mandou 2 prints
  mostrando a causa raiz de todo esse fio de achados sobre e-mail/número
  errado: o `pfQuickCard` (aba ⚙️ Trabalho, cards "🆔 BIRD ID (elevar
  Gov)" e "🏢 Abertura da Empresa") mostrava Tel./E-mail **PESSOAL** do
  cliente (`selectedOS.phone`/`selectedOS.email`, cadastrados pelo
  captador) — só que **nem o e-CPF (BIRD ID/SYNC) nem a Abertura usam
  esse dado**; os dois usam o vínculo e-commerce (e-mail/chip atribuídos
  pelo terceiro, `t2_new_email`/`t2_new_phone`). Confirmado que o padrão
  de confusão do 9º achado (aba Dossiê) era só a PONTA DO ICEBERG — o
  `pfQuickCard`, usado tanto no card BIRD quanto no card Abertura (MESMA
  variável, `{pfQuickCard}` aparece 2x — linhas do `birdStep` e do
  `aberturaStep`), continuava mostrando o dado pessoal pra TODOS os
  papéis (só o certificador tinha sido corrigido, 10º achado, e só
  dentro desse mesmo pfQuickCard). Perguntado e confirmado: sim, trocar
  por vínculo nos dois cards, pra todos os papéis (não só certificador).
  Fix: removido o `isCertLimited ? ... : ...` ramificado dentro do
  `pfQuickCard` — agora é **incondicional**, sempre mostra Nome/CPF/
  Gov.br/E-mail Emp./Chip/Aparelho (vínculo), nunca mais Tel./E-mail/
  Endereço pessoal, pra QUALQUER papel que abra o card BIRD ou Abertura.
  `isCertLimited` continua existindo nesse escopo só porque o
  `pjQuickCard` (Pessoa Jurídica, usado no A1 e reaproveitado na
  Abertura) ainda depende dela pra esconder o endereço da empresa só do
  certificador — não mexido, fora do escopo desse pedido. Sem automação
  nova: os campos de vínculo já eram lidos direto do dossiê (preenchidos
  pelo terceiro assim que ele salva), então "auto-preenche assim que
  disponível" já é o comportamento — só precisava exibir o campo certo.
  **Duplicação visual aceita conscientemente**: o mesmo bloco ainda
  aparece 2x na tela quando os dois cards (BIRD e Abertura) estão
  visíveis juntos — o gestor confirmou explicitamente que queria os DOIS
  cards com o mesmo conteúdo (vínculo), não só remover a repetição, então
  a duplicação continua, só que agora com o dado certo nos dois lugares.
  Testado com Playwright: reproduzido cenário do print — logado como
  `admin` (card BIRD) confirmei que o e-mail pessoal
  (`bruno.dias@email.com`) sumiu e o vínculo (`vinculo@ecommerce.com`)
  aparece; logado como `operador_abertura` (card Abertura, papel
  diferente do print original) confirmei o mesmo — nenhum dos dois mostra
  mais e-mail/telefone pessoal.
- **17º achado, mesmo caso real, separa "Concluídos" de "Necessita
  Atenção" na tela Certificação (18/07/2026):** consequência direta do
  15º achado (empresas finalizadas sem certificação passaram a entrar no
  pool pro certificador ver) — o gestor reparou que a aba "✅ Concluídos"
  virou uma mistura de 3 coisas bem diferentes, todas caindo no mesmo
  critério antigo de `statusOf` (`bird_id_done || a1_done ||
  current_step === 'finalizado'`): (1) empresa aberta sem NENHUM
  certificado, (2) só 1 dos 2 certificados feito, (3) os 2 marcados mas
  com dado/arquivo faltando (`birdDadosFaltando`/`a1ArquivoFaltando`, 14º
  achado) — junto com quem está genuinamente 100% ok. Pedido explícito:
  separar em duas abas, pra ficar claro pros responsáveis (certificador
  E gestor) o que precisa de correção vs. o que já está correto de
  verdade.
  - Nova função `certConcluidaSemPendencia(d)` — mais estrita que
    `certConcluida` (que só exige `bird_id_done && a1_done`, ignorando
    se o dado por trás está completo): exige também `!birdDadosFaltando(d)
    && !a1ArquivoFaltando(d)`. Reaproveita as funções do 14º achado, não
    duplica critério novo.
  - `statusOf` ganhou um novo retorno, `'atencao'`, entre `'aguardando'`
    e `'concluidos'`: `certConcluidaSemPendencia` → `'concluidos'`;
    senão, se tem qualquer coisa feita ou tá finalizado → `'atencao'`
    (era isso que ia tudo pra `'concluidos'` antes); senão segue a lógica
    de sempre (`aguardando`/`andamento`/`livre`).
  - Nova aba **"🚨 Necessita Atenção"** — **NÃO é `managerOnly`**, de
    propósito: o objetivo é o próprio certificador ver e corrigir, não só
    o gestor cobrar por fora do sistema (mesmo princípio dos achados
    13/15). Contagem de cada aba já funcionava genérica
    (`listPool.filter(d => statusOf(d) === t.key).length`), não precisou
    mexer nisso.
  - Testado com Playwright: preparei 1 OS "realmente limpa" (BIRD+A1
    concluídos, todos os campos de acesso preenchidos + arquivo A1
    anexado) e confirmei que só ela aparece em "Concluídos (1)"; a OS
    finalizada sem nenhuma certificação (do 15º achado) aparece sozinha
    em "Necessita Atenção (1)" — as duas contagens batem com o "Todos"
    e não se sobrepõem.
- **18º achado — feedback real do certificador ("não está aparecendo nada
  pra ele"), Dashboard desalinhado + Esteira redundante (21/07/2026):**
  três problemas reportados juntos sobre a tela Dashboard do papel
  `operador_certificacao` (`view === 'dashboard'`, cartões de KPI perto de
  `stepsForRole`).
  1. **Cartões "BIRD ID Pendente"/"A1 Pendente" desalinhados da tela
     Certificação:** o cálculo do Dashboard usava uma fórmula própria e
     mais restrita — `meus.filter(d => stepOf(d) === 't3' &&
     d.resp_certificacao === currentOperator)` — que só contava OS já
     ATRIBUÍDAS a ele em `t3`. A tela Certificação (fonte real do que ele
     deveria trabalhar) conta diferente: `isRelevantParaMim` (atribuída a
     ele OU livre) em `t2` OU `t3`, com o gate de "pronta pra trabalhar"
     (`vinculoReady`/`a1ReadyOf`) — por isso um certificador com só OS
     livres via "0 BIRD ID Pendente" no Dashboard enquanto a tela
     Certificação mostrava "🔓 Livre (2)". Fix: os cartões do Dashboard
     pra esse papel agora usam a MESMA lógica (`isRelevantDash` espelha
     `isRelevantParaMim`, `vinculoReadyDash` espelha `vinculoReady`,
     reaproveita `a1ReadyOf` que já é função de escopo de componente) —
     duplicação aceita conscientemente, mesmo padrão de `vinculoReady` já
     documentado em outros achados (React closures, não dá pra
     compartilhar direto entre as duas IIFEs). "Minhas OS (E3)" continua
     só as atribuídas a ele (`resp_certificacao === currentOperator`),
     mas agora dentro do mesmo pool relevante.
  2. **"Esteira de Trabalho" retirada do menu do certificador:** a
     coluna "Finalizado" do kanban da Esteira, pra esse papel, já vinha
     virando duas listas de só-concluídos ("🆔 E-CPF concluídos"/"📜
     E-CNPJ concluídos", ver comentário em `page.tsx` perto de
     `isCertRole`) — sem nada de pendente/livre, só histórico. Como a
     tela Certificação já cobre tudo que ele precisa (fila + concluídos +
     necessita atenção, com filtro por aba), o botão "🗂️ Esteira de
     Trabalho" da barra lateral foi condicionado a `currentRole !==
     'operador_certificacao'` — esse papel não vê mais essa opção no
     menu. **Não removido o `view === 'esteira'` em si** (só o caminho de
     navegação até ele pra esse papel) — mudança mínima, sem apagar
     código que outros papéis (gestor/admin/operador_abertura) ainda
     usam normalmente.
  3. **Atalho do Dashboard vai pra Certificação, não mais Esteira:** o
     botão "Ir para a Esteira de Trabalho →" agora checa o papel —
     `operador_certificacao` vê "🔐 Ir para Certificação →" e
     `setView('certificacao')`; os demais continuam com o botão/destino
     de antes, sem mudança.
  - Testado com Playwright (login `certificacao`/`cert123`): confirmado
    que o botão "Esteira de Trabalho" não existe mais no menu desse
    papel; que o atalho do Dashboard mostra "🔐 Ir para Certificação →" e
    de fato navega pra lá; e que o número "BIRD ID Pendente" do Dashboard
    (2, com 2 OS livres prontas) bate exatamente com "🔓 Livre (2)" da
    aba da tela Certificação — antes divergiam (0 vs 2).
- **19º achado, mesmo dia, troca "SLA Estourado" por "Necessita
  Atenção"/"Concluídos" no Dashboard do certificador (21/07/2026, pedido
  explícito):** o card "SLA Estourado" pra esse papel já estava zerado de
  propósito desde o 8º achado (`{ n: 0, ... }`, ver comentário no código
  — a fórmula certa por atribuição nunca foi implementada) e não agregava
  nada. Gestor pediu pra trocar por algo que agregasse mais valor:
  quantas OS relevantes pra ele têm certificação com dado faltando (17º
  achado, aba "🚨 Necessita Atenção") vs. quantas estão genuinamente
  completas (aba "✅ Concluídos"). Implementado replicando `listPool`/
  `statusOf`/`certConcluidaSemPendencia` da tela Certificação **dentro da
  mesma IIFE do Dashboard** (não deu pra importar as constantes de lá —
  são closures de blocos `view === X && (() => {...})()` diferentes,
  mesmo motivo já documentado pra `vinculoReady`/`feitaPor` — mas
  `getCertColumnDossiers`/`a1ReadyOf`/`birdDadosFaltando`/
  `a1ArquivoFaltando`/`isManager`, que já são funções de escopo de
  componente, foram reaproveitados sem duplicar). Card fica em 5 (grid
  `grid-cols-2 md:grid-cols-4` — o 5º card quebra linha sozinho,
  aceitável). **Se o critério de "Necessita Atenção"/"Concluídos" mudar
  de novo na tela Certificação (`statusOf`), replicar a mudança aqui
  também** — é a mesma armadilha de sincronização já documentada pra
  `vinculoReady`, só que agora com mais uma cópia (`statusOf`/
  `certConcluidaSemPendencia`, antes só na tela Certificação, agora
  também no Dashboard). Testado com
  Playwright: Dashboard mostrou "Necessita Atenção: 1" / "Concluídos: 0"
  pro certificador, e abrindo a tela Certificação em seguida (mesma
  sessão) as abas mostraram exatamente "🚨 Necessita Atenção (1)" / "✅
  Concluídos (0)" — números idênticos.
- **BUG REAL DE VERDADE (24/07/2026) — critério de "Necessita Atenção"
  contava até OS sem NENHUM problema:** o próprio certificador reportou:
  "tem os que está como precisa de atenção e não tem alerta de nenhum
  item faltando... e em concluídos está zero". Causa raiz em `statusOf`
  (tela Certificação) e nas 2 cópias no Dashboard
  (`necessitaAtencaoDash`/`emAndamentoDash`, 19º/20º achados acima): a
  condição `d.bird_id_done || d.a1_done || d.current_step === 'finalizado'`
  jogava em "atenção" QUALQUER OS com só uma das duas certificações
  feita — inclusive o caso 100% normal "BIRD feito, A1 ainda aguardando a
  abertura terminar" (não é problema, é só o fluxo seguindo seu curso
  normal). Como não havia nenhum dado incompleto de verdade
  (`birdDadosFaltando`/`a1ArquivoFaltando` ambos falsos), nenhum badge de
  alerta aparecia — a OS ficava rotulada "🚨 Necessita Atenção" sem
  explicação nenhuma, inflando essa aba e esvaziando "✅ Concluídos" ao
  mesmo tempo (praticamente todo mundo no meio do processo cai nessa
  situação transitória em algum momento). Fix: nova função
  `precisaAtencao`/`precisaAtencaoDash` (mesmas 3 cópias de sempre, uma
  por closure) — só considera atenção de verdade quando `birdDadosFaltando
  (d) || a1ArquivoFaltando(d) || d.current_step === 'finalizado'` (empresa
  JÁ aberta sem certificação limpa continua sendo atraso real; o resto
  precisa ter um alerta de dado incompleto por trás). Efeito colateral
  bom: OS que antes ficavam presas em "atenção" sem motivo agora caem
  corretamente em "⏸ Aguardando abertura" (via `!ativa(d)`) ou "⚡ Em
  andamento" — a aba "Aguardando abertura" provavelmente estava
  artificialmente vazia por causa desse bug. Testado com Playwright: antes
  do fix a aba "Necessita Atenção" tinha uma OS (BIRD feito, A1 aguardando
  abertura, sem nenhum badge de alerta); depois do fix ela sumiu dessa
  aba e as 2 que sobraram mostravam claramente "⚠️ BIRD dados
  incompletos" — todo item da aba agora tem um motivo visível.
  - **2º ajuste (mesmo dia, pedido de acompanhamento) — a 1ª correção
    ainda era ampla demais.** O certificador apontou o caso que sobrava:
    uma empresa já FINALIZADA (aberta) com só uma das duas certificações
    feita também caía em "atenção", mesmo sem nenhum badge de dado
    incompleto — "a pendência é o próximo processo... BIRD concluído
    (e-CPF, pessoa física), vai precisar fazer o A1 (e-CNPJ, pessoa
    jurídica)... não precisa ver tudo junto". BIRD e A1 são certificados
    INDEPENDENTES — ter um feito e o outro ainda pendente é o fluxo
    normal (o A1 é literalmente o próximo passo), não uma pendência.
    Fix: `precisaAtencao`/`precisaAtencaoDash` agora só tratam
    `finalizado` como atenção quando faltam AS DUAS certificações
    (`!d.bird_id_done && !d.a1_done`) — o caso que continua sinalizando
    de verdade é uma empresa já aberta em que NINGUÉM sequer começou a
    certificar (o cenário original do 15º achado). Testado com
    Playwright: forcei via PATCH direto (gestor) uma OS pra
    `current_step: 'finalizado'` com BIRD 100% completo (todos os campos
    de `birdDadosFaltando` preenchidos) e A1 ainda não feito — antes
    dessa 2ª correção ela apareceria em "Necessita Atenção" sem badge
    algum; depois, ela nem aparece nas abas do certificador (cai em
    `aguardando`, que é `managerOnly` — comportamento correto, pois não
    há nada pra ELE fazer agora, é o time de abertura que está
    trabalhando). Restaurei o dado de teste ao estado original depois
    (backup/restore do `local_db.json`, não é dado real).
- **Filtro por data + ordenação na tela Certificação (24/07/2026, pedido
  explícito — mesmo padrão já aplicado no kanban do terceiro no dia
  anterior): "ter uma forma de filtrar por datas... e ter as datas que a
  OS entrou no fluxo do certificador e quando foi finalizada".** Não
  existe nenhum timestamp específico de "entrou na fila do certificador"
  — `created_at` (entrada na esteira como um todo) já era usado como
  proxy em `relevantDate` pra ordenação, então virou o campo "Entrada"
  do filtro também. "Finalização" usa `empresa_aberta_em` (existe só a
  partir do fix do portal do terceiro, 23/07/2026 — OS finalizadas antes
  disso não têm essa data, mesma limitação de lá). Implementado na tela
  Certificação (`page.tsx`, view `certificacao`):
  - Novo estado: `certListSortDir` (novas/antigas), `certListDateField`
    (entrada/finalização), `certListDateFrom`/`certListDateTo`.
  - Filtro de data aplicado **ANTES** da divisão por aba
    (`poolDateFiltered`, substituindo `listPool` cru nas contagens e no
    `tabbed`) — importante pra manter a contagem de cada aba batendo com
    o que a lista realmente mostra (mesma lição do bug de contagem
    divergente já documentado nesta skill).
  - Cada card da lista (`renderListRow`) ganhou uma linha "Entrou: dd/mm"
    + "Finalizado: dd/mm" (só quando `empresa_aberta_em` existe).
  - Botão de ordenação (mesmo texto/ícone do kanban do terceiro: "↓ Mais
    novas primeiro" / "↑ Mais antigas primeiro") inverte o `relevantDate`
    já usado por padrão.
- **Aba "Concluídos" separada em "🆔 Concluído e-CPF" e "✅ Concluído
  e-CPF + e-CNPJ" (24/07/2026, pedido explícito do certificador — ele é
  pago por certificado, então precisa ver quando só o BIRD está pronto,
  não só quando os dois estão):** `certConcluidaSemPendencia` (BIRD **e**
  A1 limpos) continua existindo, mas agora só cobre a aba final
  "✅ Concluído e-CPF + e-CNPJ". Nova função `certConcluidaEcpf` alimenta a
  aba nova "🆔 Concluído e-CPF" — só o "meio do caminho" (BIRD feito, A1
  ainda não feito). Como o A1 exige `bird_id_done` como pré-requisito
  (`a1ReadyOf`), não existe caso de A1 feito sem BIRD feito, então essas
  duas funções são mutuamente exclusivas por construção — não precisou de
  terceiro estado. `statusOf` ganhou o retorno `'concluido_ecpf'` (checado
  ANTES de `'atencao'`, senão uma OS com BIRD feito mas ainda sem A1 cairia
  em atenção por engano). `completeSubStep` (que já pulava pra aba
  "Concluídos" ao marcar BIRD/A1) agora manda pra `'concluido_ecpf'` quando
  `step === 'bird'` e só pra `'concluidos'` quando `step === 'a1'`
  (assumindo que A1 sempre vem depois do BIRD, pela mesma regra de
  pré-requisito acima). **Dashboard do certificador (achados 18-20) NÃO foi
  alterado** — o card "Concluídos" de lá continua contando só
  `concluidaSemPendenciaDash` (os dois feitos); se pedirem o mesmo
  detalhamento no Dashboard, replicar `certConcluidaEcpf` lá também (mesmo
  padrão de duplicação por closure já documentado nos achados anteriores).
  **Ida e volta no mesmo dia sobre o critério de `certConcluidaEcpf`
  (24/07/2026) — REGRA FINAL, confirmada explicitamente pelo usuário, é a
  que está no código hoje:** primeiro pedido de acompanhamento ("só tem
  dois e-CPF concluído e eles são Pratas, creio que tem mais aí") me levou
  a tirar a exigência `!birdDadosFaltando(d)` do critério, achando que era
  bug de exibição. Na sequência, olhando produção de verdade (99 OS: 60 em
  "Necessita Atenção", só 2/3 em "Concluído e-CPF"), o usuário corrigiu o
  entendimento e fechou a regra definitiva: **"se estiver com dados
  faltando precisa estar em Necessita Atenção, só muda após ser resolvido
  o que está pendente; se o e-CPF foi feito (dado completo) e está
  aguardando o A1, ele deve ir para Concluído e-CPF"**. Ou seja, dado
  incompleto SEMPRE fica em atenção até ser corrigido — não é pra aparecer
  em "Concluído e-CPF" só com um badge de aviso do lado. Restaurado
  `!birdDadosFaltando(d)` no critério (`certConcluidaEcpf = bird_id_done &&
  !a1_done && !birdDadosFaltando(d)` — idêntico à primeira versão do PR
  #125). Os "60 em Necessita Atenção" da produção são um retrato real de
  quantas OS têm dado de acesso do BIRD incompleto — **não é bug, é volume
  de trabalho pendente de correção mesmo**. **Não reverter essa exigência
  de novo sem pedido explícito novo** — já foi tentado e desfeito no mesmo
  dia.
  - **Nome da pessoa física escondido nas linhas da lista, pra qualquer
    papel (mesmo pedido de acompanhamento):** antes, `hideSecondaryForCert`
    só escondia o nome secundário (pessoa física, depois que o BIRD é
    concluído e o destaque vira a empresa) pro papel `operador_certificacao`
    — gestor/admin continuavam vendo os dois nomes na linha. Pedido
    explícito: **depois que o e-CPF é concluído, não deve aparecer nome de
    pessoa física em nenhuma linha desta lista, só da empresa** — não é
    mais restrito a um papel. `hideSecondaryForCert` foi removido;
    `secondaryName` agora é sempre `undefined` quando `primaryIsEmpresa` é
    true, pra qualquer `currentRole`. **Escopo desta mudança é só a lista
    da tela Certificação** (`renderListRow`) — não mexi no cabeçalho do
    dossiê nem nos `pfQuickCard`/`pjQuickCard` (que já têm suas próprias
    regras de RBAC documentadas acima, inalteradas).
  - Testado com Playwright: 2 OS de teste, uma com BIRD concluído e 3
    campos de acesso vazios (dado incompleto) e outra com todos os 6
    campos preenchidos (dado completo) — a incompleta ficou em "Necessita
    Atenção" com o badge "⚠️ BIRD dados incompletos"; a completa foi pra
    "Concluído e-CPF"; nenhuma das duas linhas mostrou nome de pessoa
    física, só o nome da empresa, logado como gestor.
- **Cabeçalho do dossiê esconde CPF pro certificador depois do e-CPF
  concluído, mostra CNPJ (24/07/2026, gap real reportado pelo
  certificador — o nome já trocava pra razão social nessa condição, mas a
  linha "OS #{id} • CPF: {cpf}" ficava incondicional, vazando dado pessoal
  mesmo depois de "só falta trabalhar com a empresa"):** mesma condição já
  usada pra trocar o nome (`currentRole === 'operador_certificacao' &&
  selectedOS.bird_id_done`), aplicada agora também nessa linha — troca CPF
  por `selectedOS.cnpj_number` (com `CopyButton` próprio) quando
  disponível; se a abertura ainda não salvou o CNPJ, mostra só "OS #{id}"
  sem nenhum dos dois (nunca mostra CPF nesse caso, pra não reabrir o
  vazamento). Gestor/admin/`operador_abertura` não mudam — continuam
  vendo CPF sempre. `pfQuickCard`/`pjQuickCard` e a lista da tela
  Certificação já faziam essa separação; só o cabeçalho do dossiê tinha
  ficado pra trás. Testado com Playwright: certificador logado, OS com
  BIRD concluído e CNPJ salvo — header mostrou "OS #S1T2U3 • CNPJ:
  12345678000199", sem nenhum CPF visível na linha.
- **Filtro por nível Gov (Ouro/Prata) e por tipo (e-CPF/e-CNPJ) + remoção
  da aba "Aguardando abertura" na tela Certificação (24/07/2026, pedido
  direto do usuário):** dois selects novos ao lado do filtro de data
  (`certListGovFilter`/`certListTipoFilter`), aplicados em `poolFiltered`
  (antes da divisão por aba, mesma ordem de `poolDateFiltered` — filtro de
  data primeiro, depois gov/tipo, então as contagens das abas já refletem
  os três filtros combinados). Nível Gov filtra direto por
  `d.gov_level`. Tipo usa `tipoOf(d) = d.bird_id_done ? 'ecnpj' : 'ecpf'`
  — mesmo critério já usado por `primaryIsEmpresa` (uma vez que o BIRD é
  concluído, o trabalho relevante passa a ser o A1; nunca fica "sem
  tipo", mesmo com os dois certificados já feitos). A aba "⏸ Aguardando
  abertura" foi retirada da lista de abas (`tabs`) — `statusOf` ainda
  pode retornar `'aguardando'` internamente (usado só pra excluir da
  aba "Em andamento"/"Livre"), essas OS continuam aparecendo normalmente
  em "📋 Todos", só não têm mais botão de filtro dedicado. Testado com
  Playwright: filtro Nível Gov = Prata reduziu "Todos" de 4 pra 1 OS,
  mostrando só a OS Prata da lista.
  **REVERTIDO EM PARTE (mesmo dia, pedido de acompanhamento seguinte):
  "só deve aparecer pro certificador o que está disponível pra ele
  trabalhar"** — não bastava tirar o botão da aba, as OS "aguardando"
  (bloqueadas esperando o terceiro definir vínculo, ou esperando a
  abertura terminar os documentos) ainda apareciam dentro de "📋 Todos"
  pro certificador, sem nenhuma pista visual clara de que não tinham
  nada pra ele fazer ali. Novo `listPoolVisible` — pro certificador
  (`!isManager`), filtra `listPool` removendo `statusOf(d) ===
  'aguardando'` ANTES do filtro de data/gov/tipo; gestor/admin continuam
  vendo tudo (`listPoolVisible = listPool` sem filtro, é quem precisa
  enxergar o gargalo completo pra cobrar o outro setor). Efeito: a
  contagem de "Todos" agora bate exatamente com a soma das abas visíveis
  pro certificador (antes havia uma diferença silenciosa — "aguardando"
  entrava no total sem aparecer em nenhuma aba). Testado com Playwright:
  OS sem vínculo definido (`t2_new_email` vazio) — certificador logado
  não via essa OS em "Todos" nem em nenhuma aba; gestor logado via
  normalmente, com o badge "⏸ com a abertura".
  **BUG REAL, o mesmo problema voltou pro lado do gestor/admin
  (11/08/2026, reportado com screenshot: "a somatória está com
  discrepâncias de números, não estão batendo a contagem" — Todos (126)
  vs soma das abas visíveis (114), diferença de 12).** O fix acima só
  cobriu o `!isManager` (`listPoolVisible` filtra `'aguardando'` só pro
  certificador) — pra `isManager`, `listPoolVisible = listPool` continua
  SEM filtro (correto, gestor precisa ver o gargalo completo), mas a
  aba "⏸ Aguardando abertura" nunca foi recriada pra ele depois de
  removida da lista `tabs` (comentário acima já dizia "só não têm mais
  botão de filtro dedicado" — literal: nenhum papel tinha esse botão,
  não só o certificador). Resultado: as OS "aguardando abertura" entravam
  em "Todos" pro gestor/admin sem aparecer em NENHUMA aba, exatamente o
  mesmo sintoma que o fix anterior já tinha corrigido pro certificador.
  Fix: `tabs` ganhou de volta `{ key: 'aguardando', label: '⏸ Aguardando
  abertura', managerOnly: true }` — `managerOnly` é o que evita
  reabrir a aba pro certificador (pra ele, `listPoolVisible` já exclui
  essas OS de "Todos" inteiro, então a aba nem faria sentido/apareceria
  vazia). **Se a soma das abas divergir de "Todos" de novo no futuro,
  primeiro conferir se um novo valor de retorno foi adicionado a
  `statusOf` sem entrada correspondente em `tabs`** — é a 2ª vez que essa
  classe de bug acontece exatamente por esse motivo (um estado novo em
  `statusOf` sem aba visível pra ele, pro papel que enxerga esse estado).
  Testado com Playwright: criei uma OS em t2 sem vínculo definido (fica
  'aguardando') — logado como admin, "Todos" e a soma de todas as abas
  (incluindo a nova "Aguardando abertura") bateram; logado como
  certificador, a aba nova não aparece e a soma das abas dele continua
  batendo com "Todos" (sem regressão no fix de 24/07).
- **20º achado, mesmo dia, "Minhas OS (E3)" trocado por "Em andamento"
  (21/07/2026, pedido explícito — "hoje todo o fluxo de certificação vai
  pra um certificador apenas, quero reduzir ao máximo a possibilidade de
  erro dele"):** confrontei a ideia original do gestor (usar "Minhas OS"
  como proxy de "Em andamento") antes de implementar, porque não são a
  mesma coisa — `minhas` (`isRelevantDash` + t2/t3) conta TODA OS
  atribuída a ele **independente do estado**, inclusive uma que já esteja
  em "Necessita Atenção" ou "Concluídos"; a aba "⚡ Em andamento" da tela
  Certificação (`statusOf(d) === 'andamento'`) exige adicionalmente que a
  OS ainda esteja `ativa()` (pronta pra trabalhar: BIRD pendente com
  vínculo pronto, OU A1 pendente com documentos prontos) e que não tenha
  caído antes em atencao/concluidos. Gestor confirmou explicitamente:
  "melhor alterar pra mesma informação da tela de certificação". Fix:
  card 1 do Dashboard virou "Em andamento", com `emAndamentoDash`
  espelhando `statusOf`/`ativa()` exatamente (mesma ordem de prioridade:
  não é concluído-sem-pendência, não tem nada marcado/finalizado, está
  atribuída, e está `ativaDash`). Reaproveita `listPoolDash`/
  `concluidaSemPendenciaDash`/`vinculoReadyDash`/`a1ReadyOf` já
  calculados no 19º achado — não duplicou o pool, só adicionou o filtro
  de estado. **3ª cópia de `ativa()`** agora no arquivo (Certificação,
  Projetos via `vinculoReadyProj`, e Dashboard) — mesmo padrão de
  duplicação por closure já aceito, mesmo alerta de sincronização do 19º
  achado se o critério mudar. Testado com Playwright: atribuí uma OS
  livre (com vínculo pronto, BIRD pendente) ao próprio certificador via
  PATCH direto — Dashboard passou a mostrar "Em andamento: 1", e a aba
  "⚡ Em andamento" da tela Certificação mostrou exatamente "(1)" com a
  mesma OS dentro — números batendo.
- **21º achado — painel "BIRD ID antecipado" (T2) tinha sua PRÓPRIA cópia
  esquecida do bug de e-mail/telefone pessoal (21/07/2026, caso real: OS
  #EO2VHZ1, "Carlos Vinicius"):** gestor reportou dois sintomas juntos —
  (1) o ajuste do 16º achado (pfQuickCard sempre mostra vínculo
  e-commerce, nunca dado pessoal do captador) "funciona em outras OS mas
  não nessa"; (2) a mesma OS aparecia pro admin mas sumia da fila do
  certificador. Os dois tinham causas DIFERENTES:
  1. **Causa do e-mail/telefone errado:** o painel "🆔 BIRD ID (elevar
     Gov) — antecipado" (`isEarlyBirdWindow`, só renderiza quando a OS
     ainda está em T2 — ver "Fila do certificador" acima) tem seu **próprio
     bloco JSX de Pessoa Física**, definido bem antes do bloco T3 no
     arquivo — não é o mesmo `pfQuickCard` (que só existe dentro da IIFE
     do bloco T3, mais abaixo, escopo diferente). Quando o 16º achado
     tirou o dado pessoal do `pfQuickCard`, essa cópia mais antiga (que já
     existia desde antes, com Tel./E-mail pessoal hardcoded) ficou pra
     trás — igual já aconteceu antes com `vinculoReady`/`ativa()`
     duplicados, só que dessa vez ninguém sabia que essa 2ª cópia existia
     porque ela só aparece numa janela estreita (OS ainda em T2, ainda não
     chegou em T3). Por isso "funciona nas outras" (a maioria das OS já
     está em T3 quando o certificador olha) mas não nessa (ainda em T2).
     Fix: mesmos campos do `pfQuickCard` (Nome/CPF/Gov.br chip/E-mail
     Emp./Chip/Aparelho, todos de vínculo) replicados nesse painel — não
     dava pra importar a constante por estarem em closures diferentes,
     mesmo padrão já aceito no projeto. **Se o critério de RBAC/campos do
     `pfQuickCard` mudar de novo, `grep` por "BIRD ID (elevar Gov) —
     antecipado" também — é a 2ª cópia real, não só a documentada.**
  2. **Causa real de "sumir" — não era `cert_docs_recusados` (descartado
     via auditoria: sem nenhum evento de recusa na linha do tempo da OS),
     era a BUSCA GLOBAL do topo (`searchResults`, perto de `stepOf`/
     `getColumnDossiers`).** Ela restringe o pool de busca por
     `stepsForRole(currentRole)` — e pro `operador_certificacao` esse
     array é só `['t3', 'finalizado']`, **sem `t2`**. Isso está certo pra
     visibilidade de COLUNA do kanban (Esteira) — mas a tela Certificação
     tem um recurso à parte (`isEarlyBirdWindow`, "BIRD ID antecipado")
     que libera esse papel pra trabalhar em OS ainda em T2, e a busca
     nunca soube disso. A OS **não estava escondida da tela Certificação**
     (ela não usa `stepsForRole`/`canSeeStep`, lê `dossiers` direto) — só
     ficava impossível de achar pelo nome/CPF pela busca do topo, e com
     dezenas de OS na lista (74 no caso relatado) é fácil nunca escanear
     manualmente até achar. Não tinha relação com o nível Gov (Ouro/Prata)
     — confirmado lendo `isEarlyBirdWindow`/`getCertColumnDossiers`, nenhum
     dos dois filtra por `gov_level`. Fix: `searchResults` agora usa um
     pool específico pro certificador (`current_step` em
     `['t2','t3','finalizado']`, o mesmo que o servidor já devolve pra
     ele e que `getCertColumnDossiers` já busca) em vez do `stepsForRole`
     genérico — outros papéis continuam com o comportamento de antes.
     **Se um "sumiço" parecido for reportado de novo, checar primeiro se
     a OS realmente não aparece na TELA relevante (aqui, Certificação)
     antes de assumir isolamento por atribuição/recusa — pode ser só a
     busca global, que tem sua própria lista de exceções agora.** Testado
     com Playwright: uma OS em T2 (antes invisível na busca do
     certificador) passou a aparecer digitando o primeiro nome.
  3. **Nomenclatura antiga na auditoria — corrigida em PR seguinte
     (21/07/2026):** a aba "Auditoria" da OS mostrava o valor cru dos
     campos `current_step`/`status` em maiúsculo nos logs
     `STEP_CHANGED`/`STATUS_CHANGED` (`dossiers/[id]/route.ts`) — ex.:
     "Mapeou OS para a fila do setor: 'T2'", "Alterou status da OS de
     'T1_PENDENTE' para 'T2_PENDENTE'" — resíduo do modelo antigo, já que
     o resto do sistema usa E1-E4 há tempo (`STEP_LABELS_NAV` em
     `page.tsx`). Fix: dois mapas novos **no lado servidor**
     (`STEP_LABELS`/`STATUS_LABELS`, topo de `dossiers/[id]/route.ts`,
     não dá pra importar o `STEP_LABELS_NAV` do client num route handler)
     traduzem os valores crus pra label E1-E4 igual ao resto do app, com
     fallback pro valor cru maiúsculo se aparecer algo fora do mapa
     (`stepLabel`/`statusLabel`). **Só o TEXTO do log mudou** — os campos
     `current_step`/`status` em si continuam com os mesmos valores
     internos (`t1`, `t2_pendente`, etc.), nenhuma migração de dado foi
     feita nem é necessária; logs ANTIGOS já gravados continuam com o
     texto cru de antes (details é string congelada no momento do log,
     não recalculada na leitura). Testado com Playwright: transição real
     Captação→E1 (via "Iniciar Análise de Risco") gerou os logs "Mapeou
     OS para a fila do setor: 'Análise de Risco (E1)'" e "Alterou status
     da OS de 'Captado' para 'Aguardando Análise de Risco (E1)'".
- **22º achado — senha revelada e aba PF/PJ vazavam pra OS seguinte na
  mesma sessão (21/07/2026, caso real reportado):** gestor notou que ao
  revelar a senha do e-mail do vínculo e-commerce (ou selecionar a aba
  Pessoa Jurídica) numa OS, abrir uma OS DIFERENTE em seguida (mesma
  sessão de navegador) já vinha com a senha da OS ANTERIOR visível e/ou
  na mesma aba PF/PJ — sem precisar clicar em "Revelar" de novo. Causa:
  `handleSelectOS` (chamado sempre que uma OS é aberta) já resetava 3 dos
  4 estados de revelação de senha (`passwordRevealed`/Gov,
  `certEmailSenhaRevealed`, `certSenhaAcessoRevealed`) dentro do bloco
  `if (!opts.keepView)`, mas **esqueceu o 4º**
  (`t2EmailSenhaRevealed`/`revealedT2EmailSenha`, a senha do e-mail do
  vínculo e-commerce) — e `pessoaViewTab` (toggle Pessoa Física/Jurídica
  da aba Dossiê) nunca era resetado em lugar nenhum, nem nesse bloco.
  Fix: os dois adicionados ao mesmo bloco de reset. **Se adicionar um
  novo campo revelável (`xxxRevealed`/`revealedXxx`) no futuro, sempre
  registrar o reset dele aqui também** — é fácil esquecer porque o bloco
  já existe e parece "genérico", mas cada campo novo precisa ser listado
  individualmente (não há um loop/wildcard). Testado com Playwright:
  revelei a senha do vínculo numa OS (PJ), abri uma OS diferente — a nova
  abriu na aba Pessoa Física, sem nenhuma senha revelada.
- **23º achado — documentos do captador viravam opcionais de fato, sem
  nenhuma trava (21/07/2026, caso real: 2 OS em "Captados" sem NENHUM
  anexo):** gestor suspeitou de duas hipóteses — captador não anexando
  (falha de processo) ou dado se perdendo no envio (bug). Investigação
  confirmou a 1ª: **não havia perda de dado nenhuma** — `/api/captacao`
  sempre salvou exatamente o que veio no payload (`if (photo_x)
  saveBase64Any(...)`, nunca teve validação de obrigatoriedade); o
  formulário (`captador.html`) só tinha `required` HTML nos campos de
  texto (nome/CPF/telefone/e-mail) e uma checagem JS pro checkbox do
  2FA — nenhum dos 7 campos de documento (frente/verso/completo/cnh/
  selfie/selfie+RG/vídeo) bloqueava o envio se vazio, apesar de alguns já
  dizerem "(obrigatório)" no rótulo (texto sem função real). Captador
  conseguia enviar zero anexos e o cadastro era aceito normalmente.
  **Regra de negócio definida pelo gestor** (perguntado explicitamente
  antes de implementar, inclusive se a selfie solo — sem documento —
  continuava obrigatória além da selfie com documento: confirmado que
  SIM, as duas): obrigatório enviar (1) um documento de identidade — **
  Frente + Verso**, OU **Documento Completo (RG)**, OU **CNH** (as 3 são
  alternativas entre si, não cumulativas) — e (2) **Selfie** solo e (3)
  **Selfie com o documento (RG/CNH)**. **Vídeo de prova de vida virou
  OPCIONAL** (pedido explícito — antes o rótulo dizia "obrigatório" sem
  nenhuma trava real, e a regra nova é assumida como a verdadeira,
  substituindo o texto antigo). Fix em dois lugares, mesmo padrão de
  defesa em profundidade do CPF duplicado:
  - **Servidor** (`api/captacao/route.ts`): 3 checks novos logo após a
    validação do 2FA (ANTES de `Database.createDossier`, então uma
    rejeição não cria OS nenhuma — nada de "OS órfã sem documento" pra
    limpar depois), retornando 400 com mensagem específica por caso.
    **Esta é a validação que garante de verdade** — o client pode ser
    contornado (chamada direta à API), o servidor não.
  - **Cliente** (`captador.html`, `handleFormSubmit`): mesmas 3 checagens
    replicadas ANTES do fetch, com `showToast` + `scrollIntoView` no
    campo faltando — só pra dar feedback imediato sem round-trip de
    rede, não é a fonte de verdade.
  - Rótulos da UI atualizados pra bater com a regra nova: "Selfie com RG"
    ganhou "(obrigatória)" (tanto no HTML quanto no `defaultLabels` de
    `resetForm` — **os dois lugares**, senão o texto novo some depois do
    primeiro cadastro enviado, quando o formulário reseta); "Prova de
    vida" mudou de "(obrigatório)" pra "(opcional)"; nota nova em negrito
    âmbar no topo da seção "Documentos Anexos" explicando o grupo
    alternativo (Frente+Verso/Completo/CNH). "RG Completo (opcional)" e
    "CNH (opcional)" continuam com esse texto — são opcionais
    INDIVIDUALMENTE (é o grupo que é obrigatório, não cada um).
  - `sw.js` `CACHE_NAME` de `v7` pra `v8` (mudança em `captador.html`,
    exige hard refresh do usuário pra pegar a versão nova).
  - Testado com Playwright: submissão sem nenhum documento — bloqueada
    no cliente (toast + scroll até "Doc. Frente") E confirmada bloqueada
    também via chamada direta à API (bypass do form), nos dois casos sem
    criar nenhuma OS no banco.
- **7º incidente no painel de certificação — anexo do A1 travava pra sempre
  depois de concluído (13/07/2026, mesma sessão da reatribuição acima):**
  gestor reportou "algumas OS constam como certificado finalizado, porém
  podem estar sem dados — vi algumas com e-CPF sem informação". Investigado
  e confirmado com Playwright real (reproduzi o cenário: `a1_done: true`
  mas `certificado_a1_url` vazio numa OS de teste): o `FileAttach` do
  Certificado A1, dentro do bloco T3/T4 (`a1Step`, aba ⚙️ Trabalho), só
  renderizava com `!a1Done && active && canDoCert` — uma vez marcado
  concluído, o widget de upload sumia PRA SEMPRE, mesmo que o arquivo
  nunca tivesse sido anexado de verdade (bug de outra sessão/dado
  corrompido). Sem esse widget, não havia NENHUM outro lugar no sistema
  pra reanexar o A1 — a aba Dossiê só tem `DocLink` (visualização,
  sem upload). **Mesmo padrão de risco já documentado no incidente do
  "dados de certificação sumiam ao finalizar"**: um bloco de UI que só
  renderiza baseado em `done`/`current_step`, sem re-exposição depois.
  Fix (`a1Step` em `page.tsx`): condição virou `(a1Done || active) &&
  canDoCert` — o FileAttach (visualizar/substituir/baixar/excluir) fica
  disponível sempre que o certificador puder mexer na OS, concluída ou
  não; só o botão "Concluir A1" continua condicionado a `!a1Done` (não
  faz sentido reconcluir). Achado extra no meio do teste: `active`
  (`a1Ready`) também podia virar `false` numa OS já concluída, se os
  documentos de abertura que ele depende (`cnpj_comprovante_url`/
  `certidao_inteiro_teor_url`) também estivessem faltando pelo mesmo tipo
  de bug — por isso o gate usa `a1Done || active`, não só `active`: uma
  vez concluído, a checagem de "pré-requisito pronto pra começar" deixa
  de fazer sentido, só a de permissão (`canDoCert`) importa. Os dados de
  acesso do BIRD (certificadora/sistema/aparelho/e-mail/senhas) **já**
  eram editáveis independente de `birdDone` (bloco "Dados de Acesso à
  Certificação" só checa `canDoCert`) — não precisou mexer nesse lado,
  só no anexo do A1. Testado ponta a ponta: upload real de um arquivo de
  teste numa OS finalizada com A1 "concluído" mas sem anexo — apareceu
  "Substituir/Ver/Baixar/Excluir" depois do upload.
- **Cobrança direcionada:** além de "Cobrar Setor" (SLA, com mensagem
  customizada e tarefa pro responsável atual da OS), cada tarefa individual
  tem um botão "Cobrar" (`POST .../tasks/[taskId]/cobrar`) que notifica quem
  recebeu a tarefa, não só "o setor". Notificações do sino são clicáveis e
  levam direto pra OS/tarefa (`operador_abertura` vai pra aba Trabalho, não
  Tarefas — é onde ele de fato atua).
- **Projeto com contador padrão:** `Project.contador_abertura` — ao atribuir
  um projeto a uma OS (dashboard ou portal do terceiro), o `contador_abertura`
  da OS é preenchido automaticamente se ainda não tiver um definido (não
  sobrescreve atribuição manual existente).
- **Tela dedicada "📁 Projetos" (gestor/admin) — criação saiu de dentro da
  OS:** antes dava pra criar projeto novo de dentro do painel de qualquer OS
  (`page.tsx`, aba Trabalho) e também do portal do terceiro — o gestor pediu
  visão consolidada de escopo/números/pagamentos, então a criação/edição/
  remoção de projeto agora é só na tela `view === 'projetos'` (menu lateral).
  Dentro da OS (e no portal do terceiro) só dá pra **selecionar** um projeto
  já criado — os formulários inline de "+ Criar" foram removidos dos dois
  lugares (havia inclusive duplicação visual de dois widgets de projeto na
  mesma aba Trabalho, um deles com criação embutida). `POST/PATCH/DELETE
  /api/projects` teve `ALLOWED_ROLES` restrito de
  `['gestor','admin','terceiro']` pra `['gestor','admin']` — terceiro
  continua podendo selecionar (GET livre pra qualquer sessão), só não cria
  mais. A tela agrega, por projeto: total/em andamento/concluídas e
  pagamentos de BIRD/A1/colaborador (pago × pendente, via `bird_pago`/
  `a1_pago`/`colaborador_pago`), com breakdown por colaborador — mesmo
  padrão de agrupamento (`feitaPor`) da tela "Concluídos por Certificador".
  `usados` continua sendo calculado ao vivo (`withUsados` filtra
  `dossiers` por `d.projeto === p.nome` a cada request) — nunca foi um
  contador incrementado/decrementado, então não há como ele "sair de
  sincronia" ao finalizar uma OS.
- **Tela "Projetos" — scroll travado + "Projeto 01"/"Projeto 02" impossíveis
  de remover (17/07/2026, bug real reportado, mesmo padrão do incidente de
  scroll da Certificação):** dois problemas na mesma tela. (1) O wrapper da
  view (`view === 'projetos'`) era só `<div className="space-y-5">`, sem
  `overflow-y-auto`/`flex-1` — mesmo bug já documentado acima pra
  Certificação (`<main className="... overflow-hidden">` corta qualquer
  view que não tenha o próprio scroll interno). Fix: mesmo padrão —
  container externo `flex-1 overflow-y-auto p-6 ... thin-scroll` sem
  `max-w`, wrapper interno `max-w-4xl mx-auto w-full`. (2) "Projeto 01" e
  "Projeto 02" (os dois projetos-exemplo criados no seed) tinham DUAS
  camadas de proteção contra exclusão — o botão "🗑️ Remover" nem
  renderizava pra eles no frontend (`isDefault` em `page.tsx`) **e** o
  `DELETE /api/projects` recusava com 400 mesmo se o botão existisse
  (`defaultNames.includes(name)` em `api/projects/route.ts`). Isso nunca
  foi uma trava de integridade de dado — só impedia limpar os dois
  projetos de demonstração depois que projetos reais já existiam. Ambas as
  camadas foram removidas; `DELETE` agora trata "Projeto 01"/"Projeto 02"
  como qualquer outro projeto (mesma regra de negócio já documentada
  acima: remover projeto não apaga nem desvincula OS já classificadas
  nele, só tira da lista de opções). `DEFAULT_PROJECTS` continua existindo
  em `route.ts` só como seed inicial (primeira vez que `readProjects()` não
  encontra o arquivo `projects.json`) — não é mais usado como lista de
  nomes protegidos contra remoção.
- **Tela dedicada "📸 Captadores" (gestor/admin, 18/07/2026):** pedido do
  gestor pra ver TODAS as OS de um captador de uma vez (a busca do topo já
  encontrava por `captured_by`, mas mistura com outros tipos de match e
  `.slice(0, 12)` limita o resultado) e controlar pagamento por captação.
  View `captadores` no menu lateral: lista os nomes distintos de
  `captured_by` entre os dossiês, cada um expansível pra ver a lista
  completa de OS (sem limite), com stats (total/em andamento/empresas
  abertas/pago·pendente) e um botão de toggle por OS. Novo campo
  `captador_pago` (+ `_em`/`_por`) no `Dossier` — **mesmo padrão** de
  `bird_pago`/`a1_pago`/`colaborador_pago`: marcação manual, só
  gestor/admin (`PAGAMENTO_FIELDS` em `api/dossiers/[id]/route.ts`, mesmo
  gate/auditoria dos outros três, só adicionou o campo na lista), não
  depende da OS estar finalizada/aberta. Adicionado em `db.ts`
  (interface), `db-postgres.ts` (`TEXT_FIELDS`/`BOOL_FIELDS`, migra sozinho
  via `ALTER TABLE ADD COLUMN IF NOT EXISTS`) e `postgres/schema.sql`
  (mirror pra provisionamento novo — `supabase/schema.sql` é um schema
  antigo/não usado, sem nem os campos `*_pago` existentes, não precisou
  mexer nele).
- **1º Pagamento + Mensalidade recorrente do captador (18/07/2026, mesmo
  dia, pedido de follow-up):** o gestor esclareceu que o pagamento do
  captador tem duas partes — um **1º pagamento** (liberado quando o BIRD é
  certificado) e depois uma **mensalidade recorrente** enquanto o cliente
  segue ativo (empresa aberta). `captador_pago` já existente virou
  semanticamente o "1º Pagamento" (rótulo mudou na UI, campo/lógica no
  servidor não mudaram). Mensalidade é um conceito novo — **não é um
  booleano só**, é recorrente por competência (mês) indefinidamente, então
  criou-se `captador_pagamentos_mensais?: string` no `Dossier`: um array
  JSON serializado de competências pagas, formato `"YYYY-MM"` (ex.:
  `'["2026-07","2026-08"]'`). Decisão de design: **não existe uma tabela
  separada de pagamentos** — ficou tudo dentro do próprio dossiê pra não
  precisar de novas rotas/métodos de DB; a UI só expõe "mês atual pago?"
  (toggle), o histórico completo fica no array mas não tem uma tela própria
  de histórico ainda (se pedirem, dá pra listar `mesesPagos` direto).
  Alternar mês **não é um PATCH genérico de boolean** — o cliente manda
  `{ toggle_mes_captador: 'YYYY-MM' }` e o servidor (`api/dossiers/[id]/
  route.ts`) calcula o diff (adiciona/remove a competência do array lido de
  `original`, nunca confia no array que o cliente mandaria) — evita duas
  abas do gestor se pisando e sobrescrevendo o histórico uma da outra. Só
  gestor/admin, mesma auditoria `PAGAMENTO_ALTERADO`. Na tela "Captadores",
  o botão "Mensal AAAA-MM" só aparece pra OS com `empresa_aberta` (não faz
  sentido cobrar mensalidade de cliente que ainda não tem empresa aberta).
- **Recusa de documentos:** certificador seta `cert_docs_recusados` (timestamp)
  → OS some da fila dele até o captador reenviar via
  `/api/dossiers/[id]/captador-update`, que limpa a flag automaticamente.
- **Isolamento de terceiro:** `terceiro_responsavel` — a primeira conta
  terceiro que grava dados numa OS fica dona dela. Hoje só existe UMA conta
  terceiro em produção (sem efeito prático ainda), mas protege se um segundo
  parceiro for adicionado no futuro.
- **Exclusão de OS:** só gestor/admin (`canDelete`). É soft-delete
  (`deleted_at`) com Lixeira na UI (`GET /api/dossiers/deleted`,
  `POST /api/dossiers/[id]/restore`) pra restaurar.
- **Endereços são DOIS campos distintos:** `empresa_endereco` (endereço da
  abertura/empresa) ≠ `address` (endereço pessoal do cliente). Não confundir —
  já causou um bug histórico real (ver Incidentes). Renderizados via
  `EmpresaAberturaFields`, reusado no formulário da E2 e no painel de trabalho
  da E3, com trava: campos já preenchidos na E2 ficam `readOnly` pro
  `operador_abertura` na E3 (só gestor/admin sobrescrevem).
- **Auto-fill de CNPJ** (`/api/cnpj/[cnpj]/route.ts`, via `publica.cnpj.ws`):
  preenche razão social, nome fantasia, CNAE, capital social (formatado em BRL
  via `formatCurrencyBRL`), quadro societário, regime tributário. O campo
  "Gov.br dos Sócios" (login/senha manual de cada sócio) vem pré-semeado com os
  nomes do quadro societário.
- **Captador — anexo de documento aceita imagem recebida por WhatsApp
  (16/07/2026, pedido real):** os 4 uploads de documento (Doc. Frente/Verso/
  Completo/CNH) em `captador.html` tinham dois botões — 📷 Foto (câmera) e
  📎 PDF — mas o input do segundo botão só aceitava `application/pdf`. Se o
  captador recebesse a foto do documento por WhatsApp (cenário comum: o
  cliente manda a imagem pro colaborador em vez de tirar a foto na hora), não
  tinha como anexar aquele arquivo de imagem — só PDF ou tirar foto nova pela
  câmera. Fix: os 4 `<input type="file">` passaram a aceitar
  `accept="image/*,application/pdf"` (o botão virou "📎 Arquivo"); o handler
  `handleDocFile` já tratava os dois tipos de mime (imagem comprimida via
  canvas, PDF direto como data URL) — não precisou mexer na lógica de
  processamento, só no `accept` do input e no rótulo do botão. **Mudou
  `sw.js`** (`CACHE_NAME` de `v4` pra `v5`) — qualquer edição em
  `captador.html`/`sw.js` exige isso pra usuários existentes verem a versão
  nova (e hard refresh, ver regra abaixo). O modal de reenvio pós-recusa
  (`upd-frente`/`upd-verso`/etc.) já aceitava `image/*,application/pdf` desde
  antes — só os 4 uploads da tela principal de cadastro tinham essa
  limitação.
- **Captador — Selfie/Selfie+RG também aceitam galeria (17/07/2026, pedido
  real, mesma motivação):** os inputs de Selfie e Selfie+RG tinham só um
  botão (`capture="user"`, força câmera frontal) — sem opção de escolher da
  galeria. Adicionado um segundo `<input type="file" accept="image/*">`
  (sem `capture`) + botão "📎 Arquivo" pra cada um, mesmo padrão dos 4
  documentos acima; `handleDocFile` é chamado com a mesma `key`
  (`photo_selfie`/`photo_selfie_rg`) independente de qual input disparou,
  não precisou mudar a lógica de processamento. **`sw.js` `CACHE_NAME` de
  `v5` pra `v6`** — mesma regra de hard refresh. Diferente dos documentos,
  aqui o botão "📷 Selfie" continua sendo o padrão recomendado na UI (texto
  de ajuda deixa claro que "📎 Arquivo" é só pra quando a selfie já foi
  recebida por outro canal) — não existe trava de negócio contra usar a
  galeria pra selfie, foi decisão explícita do gestor.
- **Aviso "Fotos/Galeria, não Arquivos" (17/07/2026, PR #95, SUPERADO no dia
  seguinte — ver item abaixo):** primeira tentativa foi só um aviso (⚠️) de
  texto orientando a tocar em Fotos/Galeria em vez de Arquivos no seletor do
  celular. O gestor testou ao vivo (iPhone e Android) e confirmou que o
  seletor **ainda abria direto o explorador de arquivos**, mesmo com o aviso
  — ou seja, o problema não era só falta de orientação, era técnico. Ver o
  fix real logo abaixo; o texto de aviso foi removido (substituído pelos tex
  tos dos botões "🖼️ Galeria"/"📄 PDF").
- **Fix real: 🖼️ Galeria e 📄 PDF viram botões separados + CSS do input
  trocou de `display:none` (18/07/2026):** duas causas técnicas por trás do
  problema acima:
  1. Os 4 uploads de documento (Frente/Verso/Completo/CNH) tinham um único
     input com `accept="image/*,application/pdf"` combinando as duas
     categorias de mime — no Android, quando o `accept` mistura
     imagem+documento, o sistema geralmente abre o gerenciador de arquivos
     genérico em vez do seletor de fotos otimizado (que só aparece com
     `accept="image/*"` puro, sem outro mime junto). Fix: cada upload de
     documento agora tem **dois inputs separados** — um só `image/*`
     (botão "🖼️ Galeria") e um só `application/pdf` (botão "📄 PDF") — em
     vez de um input combinado com botão único "📎 Arquivo". Selfie/Selfie+RG
     já usavam só `image/*` (não precisou separar, só renomear o botão de
     "📎 Arquivo" pra "🖼️ Galeria" por consistência).
  2. `.upload-input { display: none; }` — no Safari/iOS, clicar via JS
     (`.click()`) num `<input type="file">` que está totalmente fora da
     árvore de renderização (`display:none`) às vezes faz o menu do seletor
     perder as opções "Biblioteca de Fotos"/"Tirar Foto" e cair direto no
     "Procurar" (Arquivos) — bug conhecido do WebKit. Fix: trocado pro
     padrão "visualmente oculto" (`position:absolute; width:1px; height:1px;
     clip:rect(0,0,0,0); overflow:hidden;` em vez de `display:none`) —
     mantém o input fora da vista mas presente na árvore de renderização.
  `handleDocFile` continua recebendo a mesma `key` (`photo_frente`, etc.)
  não importa qual dos inputs disparou — não mudou lógica de compressão/
  upload, só o HTML/CSS dos inputs e botões. `sw.js` `CACHE_NAME` de `v6`
  pra `v7`. Se um usuário reportar de novo que "não acha a foto no
  seletor", **não repita o aviso de texto** — já foi tentado e não resolveu;
  verifique primeiro se o input em questão ainda está com `accept` puro
  (sem misturar mime) e sem `display:none`.
- **Gestor não conseguia anexar/corrigir documento de identidade
  (19/07/2026, bug real reportado — caso concreto: captador não subiu pelo
  sistema, mandou por WhatsApp, gestor não tinha como colocar o
  documento):** dois problemas distintos, mesma causa raiz (documentos de
  identidade só entravam via `/captador-update` ou na captação inicial,
  nunca por um `FileAttach` genérico como os outros documentos da OS).
  1. **No dashboard principal**, a seção "Documentos de Identidade" (aba
     Dossiê → Pessoa Física) usava só `DocLink` (link de visualização,
     nunca upload) pra TODOS os papéis, inclusive gestor/admin — não tinha
     como anexar nada ali, só ver o que já existia. Fix:
     `photo_doc_frente_url`, `photo_doc_verso_url`,
     `photo_doc_completo_url`, `photo_cnh_url`, `photo_selfie_url`,
     `photo_selfie_rg_url` e `video_prova_url` entraram no
     `ALLOWED_FIELDS` de `api/dossiers/[id]/upload/route.ts` (endpoint
     genérico já usado por `FileAttach` pros outros documentos da OS —
     Cartão CNPJ, Certidão, A1 etc.), com uma trava adicional
     (`IDENTITY_FIELDS`) restringindo esses 7 campos especificamente a
     gestor/admin (defesa em profundidade, mesmo padrão de
     `CERT_FIELD_WRITE_ROLES`) — o gate geral da rota já bloqueava
     captador/terceiro, mas não os outros papéis internos. No
     `page.tsx`, a seção agora renderiza `FileAttach` (editável) pra
     gestor/admin e continua `DocLink` (só visualização) pros demais
     papéis. **Funciona em qualquer etapa da OS, inclusive ainda em
     "Captados"** — não tem gate de `current_step`, só de papel.
     Aproveitado pra corrigir de brinde um bug latente em `extFromMime`:
     a chamada em `saveDataUrl` nunca passava o parâmetro `field`,
     então o fallback especial pro Certificado A1 (zip/rar sem mime
     reconhecível) nunca era realmente alcançado — corrigido, e mimes de
     vídeo (`video/mp4`, `video/webm`, `video/quicktime`) adicionados ao
     mapa (precisava pro upload de vídeo de prova de vida).
     **2ª rodada deste mesmo bug (24/07/2026, reportado: "o .rar do
     certificado A1 tá baixando como .bin"):** mesmo depois do fix acima
     (que passou a repassar `field`), `extFromMime`
     (`api/dossiers/[id]/upload/route.ts`) ainda tinha
     `'application/octet-stream': 'pfx'` no MAPA GENÉRICO, checado ANTES
     do fallback específico do A1 — e `.rar` é exatamente o tipo de
     arquivo que mais aparece como `application/octet-stream` (extensão
     sem associação nativa de mime no navegador/SO, comum em Windows sem
     WinRAR instalado). Resultado: um `.rar` de A1 virava `.pfx`
     (formato errado, mas legível como arquivo) num upload NOVO. **OS
     antigas, enviadas ANTES do fix de `field` (item acima), tinham
     ficado com `.bin` de verdade GRAVADO NO DISCO — corrigir a função só
     afeta uploads futuros, não o arquivo já salvo.** Fix: `field ===
     'certificado_a1_url'` agora é checado ANTES do fallback genérico de
     `octet-stream`, então A1 sempre cai em `.zip` quando o mime não é um
     zip/rar explicitamente reconhecido, nunca mais em `.pfx`/`.bin`.
     Testado (via chamada direta ao endpoint de upload, dois cenários de
     mime que navegadores realmente mandam pra `.rar`):
     `application/octet-stream` → salvou `certificado_a1_url.zip`;
     `application/x-rar-compressed` (reconhecido) → salvou
     `certificado_a1_url.rar`. Nenhum dos dois gerou `.bin`/`.pfx`.
     **Correção pontual pro arquivo JÁ salvo errado (mesma sessão, pedido
     de acompanhamento: "não é possível aproveitar o que já está
     anexado?"):** renomear extensão não altera os bytes do arquivo — a
     correção acima só valia pra uploads NOVOS, mas o conteúdo antigo
     continua intacto, só com nome errado. Criado
     `POST /api/dossiers/[id]/fix-a1-extension` (só gestor/admin): lê os
     8 primeiros bytes do arquivo (assinatura ZIP `PK\x03\x04`/variantes,
     ou RAR `Rar!\x1a\x07`), detecta o formato real e RENOMEIA (não
     reenvia, não reprocessa conteúdo) pra extensão certa — atualiza
     `certificado_a1_url` no dossiê e, se `NEXUS_FILES_DIR` estiver
     configurado, tenta renomear o espelho de rede também (melhor
     esforço). Se a assinatura não bater com ZIP nem RAR (arquivo
     genuinamente corrompido), devolve erro pedindo reenvio de verdade —
     não força uma correção arriscada. Log de auditoria
     `A1_EXTENSAO_CORRIGIDA`. Botão **"🔧 Corrigir extensão do arquivo"**
     aparece no painel de trabalho (T3, ao lado do `FileAttach` do A1) só
     pra gestor/admin e só quando `certificado_a1_url` termina em
     `.bin`/`.pfx` (regex client-side) — não polui a tela pra OS que já
     estão certas. Testado ponta a ponta: criei um arquivo com assinatura
     RAR de verdade salvo como `certificado_a1_url.bin` (simulando o
     estado legado real), apontei o campo do dossiê pra ele via PATCH,
     chamei o endpoint — arquivo renomeado no disco pra `.rar`,
     `certificado_a1_url` atualizado no banco pra refletir, confirmado
     lendo o dossiê de volta.
  2. **No modal de "✏️ Atualizar Cadastro" do captador (`captador.html`,
     `update-modal`)**, o formulário só tinha campos pra Doc.
     Frente/Verso/Completo/CNH — **Selfie, Selfie com RG e o vídeo de
     Prova de Vida nunca tiveram campo no modal**, mesmo o backend
     (`captador-update/route.ts`) já aceitando `photo_selfie`/
     `photo_selfie_rg`/`video_prova` no payload há tempo. Adicionados os
     3 inputs faltantes + `readFileBase64Raw` (sem recompressão via
     canvas, mesmo padrão de `handleVideoFile` do formulário principal —
     Selfie/Selfie+RG reusam `readFileBase64` normal, que já comprime
     imagem). `sw.js` `CACHE_NAME` de `v8` pra `v9`.
  Não confundir com a tentativa de dar acesso via `/api/my-dossiers` pro
  gestor: **não foi esse o caminho escolhido** — aquele endpoint é
  self-service do captador (filtra por `captured_by === session.name`,
  que nunca bate com o nome do gestor) e mantê-lo assim é intencional;
  o gestor edita pela OS no dashboard principal, não fingindo ser o
  captador dentro de `captador.html`.
- **Botões de anexo do captador "travavam" (mesmo dia, follow-up do item
  acima) — os 13 controles "🖼️ Galeria"/"📄 PDF"/"📷 Selfie"/"📷 Selfie+RG"/
  "📁 Selecionar arquivo" em `captador.html` eram `<button onclick=
  "triggerUpload(id)">` que chamava `document.getElementById(id).click()`
  via JS pra abrir um `<input type="file">` separado e escondido. Esse
  padrão (clique programático via JS num input desconectado do botão) é
  conhecido por falhar silenciosamente em algumas versões de Safari/PWA
  standalone no iOS — o toque não faz NADA, sem erro, sem diálogo (o
  usuário descreve como "o botão fica travado"). O padrão robusto —
  já usado sem problema reportado tanto no modal "Atualizar Cadastro" do
  próprio `captador.html` quanto no componente `FileAttach` do dashboard
  React — é `<label for="inputId">` associando nativamente o rótulo ao
  input, sem depender de `.click()` via JS. Convertidos os 13 controles de
  `<button onclick="triggerUpload(...)">` pra `<label for="...">`
  (mesmas classes CSS, `.doc-action-btn` não tem nada `button`-specific);
  função `triggerUpload` removida (ficou sem uso). Os botões "📷 Foto"
  (`openDocCamera`, abre um modal próprio de câmera) e "🎥 Gravar vídeo"
  (`toggleVideoRecord`) continuam `<button>` normal — não usam input de
  arquivo, não têm esse problema. Testado com Playwright (clique disparou
  o evento `filechooser` corretamente) — não é garantia de que resolve o
  bug real em iOS Safari (headless Chromium não reproduz a falha
  original), mas é a técnica padrão recomendada pra esse cenário e elimina
  a única diferença estrutural entre os controles que "travavam" e os que
  nunca tiveram problema.
- **Otimização de fluidez mobile do `captador.html` (mesmo dia, pedido
  real — "testei pelo Android de um captador e não está fluido,
  principalmente quando muda de sessão/tela"):** o suspeito principal era
  `backdrop-filter: blur()` em três lugares — `header` (16px), `.form-card`
  (16px, o container que as 3 abas Cadastro/Meus Cadastros/Tarefas
  compartilham e alternam via `display:none`/`flex` em `switchTab()`) e
  `.doccam-modal` (8px, overlay da câmera). **Nenhum dos três tinha
  justificativa visual real**: `header` e `.form-card` não são
  `position:fixed`/`sticky` (não tem nada "atrás" pra borrar de verdade,
  já que não há conteúdo visível se movendo por trás deles), e
  `.doccam-modal` já tem fundo 90% opaco (`rgba(0,0,0,0.9)`) — o blur
  mudava pouco visualmente e ainda por cima rodava durante o preview de
  câmera ao vivo, o pior momento pra empilhar mais trabalho de
  composição. `backdrop-filter` é conhecido por ser caro no Android
  (recompõe a cada repaint) — removido dos três, sem perda visual
  perceptível. Segundo suspeito: `--transition: all 0.3s ...` (usado em
  4 seletores) e mais 4 usos inline de `transition: all 0.2s` (incluindo
  os **3 botões de aba** — exatamente os elementos tocados ao "trocar de
  tela"). `transition: all` faz o navegador observar toda propriedade
  animável, inclusive as que disparam reflow — trocado por listas
  explícitas das propriedades que de fato mudam em cada caso
  (background-color/border-color/color/box-shadow/transform, ou só
  opacity no botão de tema). `sw.js` `CACHE_NAME` de `v9` pra `v10`.
  Testado com Playwright emulando viewport+user-agent de Android (390×844,
  Chrome Mobile) — troca de aba sem erro de console, layout idêntico.
  **Não é garantia de eliminar 100% da lentidão** (não dá pra medir FPS
  real de um Android físico a partir daqui) — se o usuário reportar que
  ainda está lento depois do deploy, o próximo suspeito é o tamanho do
  próprio HTML/JS (arquivo único, sem code splitting) ou imagens/preview
  não otimizadas, não mais backdrop-filter/transition (já eliminados).
- **Leva de ajustes de certificação/tarefas (21/07/2026, transcrição de
  pedidos do gestor):**
  1. **`cert_email` auto-preenchido do vínculo e-commerce:** `setCertForm`
     (no `handleSelectOS`) passa a usar `dd.cert_email || dd.t2_new_email`
     — só preenche se `cert_email` ainda estiver vazio, nunca sobrescreve
     um valor já salvo. Senha: **não criou endpoint novo** — o
     `POST /reveal` com `field: 't2_new_email_senha'` já existia e já era
     permitido pro certificador/abertura; botão novo "🔗 Usar do vínculo"
     (`handleUseSenhaVinculo`) só chama esse endpoint existente e copia o
     resultado pra `certForm.cert_email_senha`, aparecendo só quando ainda
     não existe uma senha de certificado própria salva
     (`!has_cert_email_senha && has_t2_new_email_senha`).
     - **Ajuste de acompanhamento (mesmo dia): auto-preenchimento movido pro
       servidor, disparado no momento em que o terceiro salva o vínculo —
       não mais só no client quando alguém abre a OS depois.** O prefill
       original (`dd.cert_email || dd.t2_new_email` em `setCertForm`) só
       existia em memória local do formulário; se ninguém abrisse/salvasse
       o formulário de certificação, `cert_email` persistido continuava
       vazio (a OS podia ficar sem esse dado gravado por um bom tempo). Fix
       em `api/dossiers/[id]/terceiro-update/route.ts` (`PATCH`, único
       endpoint que o papel `terceiro` usa pra gravar `t2_new_email`/
       `t2_new_phone`/`cert_aparelho`): quando `t2_new_email` é salvo e
       `dossier.cert_email` ainda está vazio, grava `updates.cert_email =
       t2_new_email` no mesmo PATCH (nunca sobrescreve um `cert_email` já
       existente). Mesma lógica pro "número": se `t2_new_phone` for salvo
       e `cert_aparelho` ainda estiver vazio (o terceiro não preencheu esse
       campo à parte, que também está neste mesmo endpoint), usa o próprio
       número/chip como valor inicial de `cert_aparelho` — de novo, nunca
       sobrescreve um `cert_aparelho` já definido. O prefill client-side em
       `setCertForm` continua existindo como fallback (não fazia mal
       manter), mas na prática o valor já chega salvo no banco antes disso.
     - **Backfill retroativo (24/07/2026, pedido explícito: "essa
       atualização já deve ocorrer em todas as OS que já possuem os
       dados definidos pelo terceiro").** O auto-preenchimento acima só
       dispara na GRAVAÇÃO (quando `t2_new_email`/`t2_new_phone` mudam de
       valor no PATCH) — OS que já tinham o vínculo definido ANTES dessa
       lógica existir nunca disparam esse gatilho de novo, então
       ficaram pra trás com `cert_email`/`cert_aparelho` vazios mesmo
       tendo `t2_new_email`/`t2_new_phone` preenchidos. Fix: 2 `UPDATE`
       idempotentes em `db-postgres.ts` (`runSchemaMigration`, roda a
       cada subida do processo, mesmo lugar dos `ALTER TABLE ADD COLUMN`)
       — só tocam `cert_email`/`cert_aparelho` quando estão vazios E o
       campo de origem (`t2_new_email`/`t2_new_phone`) não está, nunca
       sobrescrevem um valor já definido pelo certificador. Não mexe no
       backend JSON local (`db.ts`) — é só fixture de dev, sem dado real
       de produção acumulado pra corrigir.
     - **Confirmado (pergunta explícita do gestor): sim, o terceiro
       também define a SENHA do e-mail** (`t2_new_email_senha`, campo
       "Senha do e-mail da empresa" no portal do parceiro,
       `src/app/terceiro/page.tsx`). Diferente de e-mail/aparelho, essa
       senha NUNCA é auto-copiada silenciosamente pro `cert_email_senha`
       — exige clique explícito no botão "🔗 Usar do vínculo"
       (`handleUseSenhaVinculo`, só aparece no painel T3 quando
       `!has_cert_email_senha && has_t2_new_email_senha`), porque copiar
       senha é ação sensível e precisa ficar na trilha de auditoria (é
       o mesmo endpoint `/reveal` já auditado, não um caminho novo de
       leitura). **Gap corrigido no mesmo dia (24/07/2026, pedido
       explícito: "pode já incluir esse gap para não atrasar o
       processo"):** o painel "🆔 BIRD ID — antecipado" (T2, mesma tela,
       `page.tsx` ~linha 5133) tem sua PRÓPRIA cópia do formulário "Dados
       de Acesso à Certificação" (não reaproveita o bloco do T3, mesmo
       motivo de sempre — closures diferentes) e essa cópia não tinha os
       2 campos de senha nem o botão "Usar do vínculo" — só existiam no
       painel T3. Copiados os 2 blocos (senha do e-mail com
       revelar/"Usar do vínculo", senha de acesso ao app com revelar) +
       aviso de auditoria, idênticos ao painel T3 (mesmos estados/handlers
       de escopo de componente — `certEmailSenhaRevealed`,
       `handleRevealCertField`, `handleUseSenhaVinculo` etc. — já
       acessíveis em qualquer closure). Testado com Playwright: forcei uma
       OS pra `current_step: 't2'` com `bird_id_done: false` (via PATCH
       direto, papel gestor) — o painel antecipado passou a mostrar os 2
       campos de senha com botão "Revelar" (dado de teste já tinha senha
       definida). Dado restaurado depois.
  2. **Recusa T1 exige justificativa:** `handleT1Decision('vermelho')`
     agora bloqueia (alert + `return`) se `t1Justification` estiver vazio;
     o botão "🔴 Recusar" também fica `disabled` até o campo ser
     preenchido. Aprovação (`'verde'`) continua sem exigir nada — só a
     recusa precisa de motivo.
  3. **Bug real corrigido: recusa de documento do certificador não criava
     tarefa nenhuma.** `handleCertRejectDoc` postava pra `/api/tasks` —
     rota que só tem `GET`, nunca teve `POST` — então a tarefa pro
     captador nunca era criada (a chamada falhava silenciosamente, sem
     checar `res.ok`), mas o certificador via a mensagem de "sucesso" e
     achava que tinha funcionado. Corrigido pra usar o endpoint certo
     (`POST /api/dossiers/[id]/tasks`, o mesmo já usado pela recusa T1 e
     pelo formulário "Nova Tarefa"). Continua endereçando
     `selectedOS.captured_by` (já estava certo — não é "captador errado",
     é a tarefa que nunca existia). Sem `captured_by`, não cria mais
     tarefa fantasma — só avisa que a OS saiu da fila sem notificar
     ninguém.
  4. **Risco de atribuir tarefa ao captador errado:** o formulário "Nova
     Tarefa" (aba Tarefas de uma OS) listava TODOS os operadores ativos
     misturados (qualquer papel), sem destacar quem é o captador desta OS
     especificamente — fácil escolher o errado numa lista longa. Fix: se
     `selectedOS.captured_by` existir e estiver ativo, aparece destacado
     no topo do `<select>` ("📸 Nome — Captador desta OS"), fora da lista
     genérica dos demais operadores.
  5. **Apagar tarefa (gestor/admin):** não existia em lugar nenhum (só
     criar + concluir). Adicionado `Database.deleteTask` (JSON `db.ts` +
     Postgres `db-postgres.ts`, `DELETE FROM os_tasks WHERE id = $1`) e
     `DELETE /api/dossiers/[id]/tasks/[taskId]` (só gestor/admin, audita
     como `TAREFA_APAGADA`). Botão "🗑️ Apagar" na aba Tarefas, visível só
     pra gestor/admin, funciona em tarefa pendente ou já concluída.
  6. **Nomenclatura simplificada dos documentos da abertura:** label
     "Comprovante / Cartão CNPJ" → "Cartão", "Certidão de Inteiro Teor" →
     "Certidão" (nos 3 `FileAttach`/`DocLink` de cada um, `page.tsx` +
     `manual.html`) — só o texto do rótulo mudou, `field`/dado por trás
     continuam os mesmos (`cnpj_comprovante_url`/`certidao_inteiro_teor_url`).
  7. **Certificador não vê mais nome de pessoa física depois do e-CPF
     (BIRD) feito** — só o nome da empresa. Aplicado em 3 lugares, todos
     escopados a `currentRole === 'operador_certificacao'` (gestor/admin/
     operador_abertura continuam vendo o nome da pessoa normalmente):
     header do drawer (antes sempre mostrava `client_name`, incondicional),
     card "Dados Pessoais" na aba Dossiê (campo "Nome" some quando
     `bird_id_done && empresa_nome`, CPF continua visível), e a lista da
     tela Certificação (`primaryIsEmpresa` já existia — mas ainda mostrava
     o nome da pessoa como secundário; agora esconde o secundário
     especificamente pro certificador) e a lista "🆔 E-CPF concluídos" do
     kanban (mostrava sempre `client_name`, agora mostra
     `empresa_nome || cpf`).
  8. **Busca global agora encontra por nome da empresa:** `empresa_nome`
     adicionado à lista de campos do filtro de busca (`searchResults`),
     que antes não incluía esse campo — só CPF, nome da pessoa, OS,
     captador, telefone, CNPJ e aparelho. Placeholder da busca atualizado
     pra mencionar "empresa".
- **TRAVA DE FINALIZAÇÃO — servidor agora exige certificação + documentos
  completos antes de aceitar `current_step: 'finalizado'` (24/07/2026,
  pedido explícito: "vários casos de abertura da empresa sem os dados de
  certificado serem adicionados").** Antes disso, `dossiers/[id]/route.ts`
  aceitava a transição pra `finalizado` sem checar NADA — só existia
  auditoria PÓS-FATO na tela Projetos (8º/9º achados, bloco âmbar
  "finalizada sem certificação completa"), que descobria o problema depois
  de já ter acontecido. Agora a transição em si é bloqueada com `422` se
  faltar qualquer um destes (checados sobre `original` mesclado com
  `updates`, ou seja, já considera o que está vindo NESSE mesmo PATCH):
  `bird_id_done` + os 6 campos de acesso do BIRD (mesmo critério de
  `birdDadosFaltando` do frontend); `abertura_done`; `cnpj_number`;
  `cnpj_comprovante_url`; `certidao_inteiro_teor_url`; `a1_done` +
  `certificado_a1_url`. A resposta de erro lista TODOS os itens faltando
  de uma vez (não só o primeiro) + quem são os responsáveis atuais
  (`resp_certificacao`/`resp_abertura`), pra já servir de base de cobrança
  sem precisar abrir a OS pra investigar. **Vale pra QUALQUER caminho que
  leve a `finalizado`** — conclusão normal (`completeSubStep`), "Mover
  Etapa" do gestor, "Edição Rápida" do admin — todos passam pelo mesmo
  PATCH, então a trava é única, não replicada 3x.
  - **Bug real corrigido de brinde, achado ao implementar a trava:**
    `handleGestorMoveStep` (botão "Mover Etapa" do gestor, `page.tsx`)
    tinha seu próprio `fetch` cru que NUNCA checava `res.ok` — uma rejeição
    do servidor (como esta trava nova, ou qualquer outra) ficava muda: o
    modal fechava normalmente e a OS não mudava de etapa, sem nenhuma
    explicação. Mesmo padrão de bug já corrigido em `updateDossierStatus`
    (#50), só que este `fetch` vivia fora dali. Corrigido pro mesmo padrão
    — checa `res.ok`, mostra `alert(err.error)` se falhar.
  - Testado com Playwright (via PATCH direto): OS sem nada preenchido →
    422 com lista de 6 itens faltando; mesma OS depois de preencher tudo
    (BIRD completo, abertura completa, A1 completo) → 200, finaliza
    normalmente.
  - **AJUSTE (mesmo dia, follow-up com screenshot real): "Certificadora"
    saiu da lista de campos obrigatórios.** O usuário mandou print
    mostrando "Certificadora" vazio (texto livre, ex.: Serasa/Soluti)
    enquanto "Sistema usado" (BIRD ID/Syngular, botão de seleção) já
    estava marcado — achou que parecia bug ("do lado já tem a opção pra
    selecionar a certificadora usada"). Perguntado e confirmado
    explicitamente: Sistema usado sozinho já é suficiente, Certificadora
    vira campo complementar opcional. Removido `cert_certificadora` de
    `birdDadosFaltando` (`page.tsx`, função central reaproveitada em
    todo lugar que mostra "dado incompleto") e da trava de finalização
    (`dossiers/[id]/route.ts`) — os únicos 2 lugares que exigiam esse
    campo (não havia cópia duplicada, já estava centralizado desde o
    14º achado). O campo/input continuam existindo no formulário, só não
    bloqueiam mais nada. Testado: OS com Sistema usado + todos os outros
    campos preenchidos, MAS Certificadora vazio → finaliza normalmente
    (200, antes seria 422).
- **Dois bugs reais de senha reportados pelo certificador, mesma sessão
  (24/07/2026):**
  1. **"Tenta revelar a senha do e-mail cadastrado e dá bug, não revela."**
     Causa: `decrypt()` (`src/lib/crypto.ts`) engole qualquer falha de
     descriptografia (chave incorreta, dado corrompido) e devolve string
     vazia — o endpoint `/reveal` tratava isso como SUCESSO normal
     (`200`, `password: ''`), a tela mostrava "(vazia)" no lugar da senha,
     indistinguível de "senha realmente vazia" e sem nenhuma mensagem de
     erro. Fix (`api/dossiers/[id]/reveal/route.ts`): se `stored` (a
     senha criptografada) existe mas `decrypt(stored)` volta vazio, é
     falha REAL de descriptografia — agora retorna `500` com mensagem
     explícita ("dado corrompido ou chave alterada, peça pra recadastrar")
     em vez de fingir sucesso. Vale pros 4 campos revogáveis (`gov`,
     `cert_email_senha`, `cert_senha_acesso`, `t2_new_email_senha`), é o
     mesmo endpoint genérico. **Se o mesmo sintoma voltar em produção de
     verdade** (não só em teste), o log do servidor agora grava
     `[reveal] Falha ao descriptografar ... — chave incorreta ou dado
     corrompido` com a OS e o campo — é sinal de dado gravado com uma
     `GOV_ENCRYPTION_KEY` diferente da atual (troca de `.env` sem migrar
     dado antigo), não bug de lógica.
  2. **"Quando o campo está limpo (senha do e-mail ou senha de acesso ao
     certificado), não aparece o que está sendo preenchido — só dá pra ver
     depois de salvo, aí é possível revelar."** Causa: os 2 campos de
     senha do certificado (`cert_email_senha`/`cert_senha_acesso`) sempre
     usavam `type="password"` (mascarado) enquanto sendo DIGITADOS, e o
     botão "👁️ Revelar" só existe pra senha JÁ SALVA
     (`selectedOS.has_cert_*`) — pra uma senha nova ainda não salva, não
     tinha NENHUM jeito de conferir o que foi digitado antes de clicar
     "Salvar Dados de Acesso" (typo passava despercebido). Fix: 2 estados
     novos de escopo de componente, `showTypedCertEmailSenha`/
     `showTypedCertSenhaAcesso` — toggle local (👁/🙈) que alterna
     `type="password"`/`type="text"` do PRÓPRIO campo de digitação, **sem
     nenhuma chamada ao servidor** (não confundir com
     `certEmailSenhaRevealed`/`handleRevealCertField`, que busca a senha
     JÁ SALVA via `/reveal` com auditoria — são dois mecanismos
     diferentes: um é "mostrar o que estou digitando agora", o outro é
     "revelar o que já está salvo no banco"). Aplicado nos 2 lugares que
     têm essa cópia do formulário (painel "BIRD ID antecipado" em T2 e o
     painel principal em T3, mesma duplicação por closure já documentada
     em outros achados). Resetado em `handleSelectOS` (bloco
     `!opts.keepView`), mesmo padrão de higiene do 22º achado — não fica
     "ligado" ao trocar de OS.
  - Testado com Playwright: reveal de senha salva funcionou normalmente
    (200, senha correta) nos dois painéis (T2 antecipado e T3); toggle de
    digitação confirmado por screenshot — texto digitado
    ("minhaSenhaDigitada") ficou visível em texto plano com o ícone
    trocando pra 🙈.
- **BUG DE SEGURANÇA real corrigido (24/07/2026, reportado pelo
  certificador: "às vezes o campo de senha de e-mail/certificado
  preenche sozinho com a senha de login dele no Nexus"):** não era bug de
  lógica do app — é o comportamento padrão de autofill do
  navegador/gerenciador de senha. Todo `<input type="password">` sem
  atributo `autocomplete` explícito é candidato a ser preenchido
  automaticamente com QUALQUER credencial salva pro domínio, inclusive o
  próprio login do usuário no NexusFlow — o navegador não distingue "isto
  é um campo de login" de "isto é uma senha de terceiro que o app
  também usa `type=password`" sem essa sinalização explícita. Nenhum dos
  campos de senha do app (Gov.br, e-mail/acesso do certificado, e-mail
  do vínculo e-commerce) tinha `autocomplete` definido. Fix: `autoComplete
  ="new-password"` adicionado em TODOS (sinaliza "não é login, não
  preencha com senha salva, não ofereça salvar este valor como senha"):
  - `page.tsx`: `govPasswordEdit`, `t2EmailSenhaEdit`,
    `certForm.cert_email_senha`/`cert_senha_acesso` (as 2 cópias, T2
    antecipado e T3, ambos os campos = 4 inputs).
  - `terceiro/page.tsx`: componente genérico `Field` ganhou
    `autoComplete={type === 'password' ? 'new-password' : 'off'}` — cobre
    o campo "Senha do e-mail da empresa" automaticamente, e qualquer
    `Field type="password"` futuro também (não precisa lembrar de
    adicionar de novo).
  - `captador.html`: os 2 campos de senha Gov.br (cadastro principal +
    modal de reenvio pós-recusa). `sw.js` `CACHE_NAME` de `v10` pra `v11`
    (exige hard refresh do usuário).
  - **Deliberadamente NÃO mexido:** o campo de senha da própria tela de
    LOGIN (`login/page.tsx`) — esse sim é uma credencial de login de
    verdade, faz sentido o navegador poder oferecer autofill/salvar ali;
    mudar isso seria piorar a UX de login sem nenhum ganho de segurança.
  - Testado com Playwright: confirmado via `getAttribute('autocomplete')`
    que os 2 campos de senha do painel de Trabalho (T3) saem com
    `new-password` — checagem simples e direta, já que autofill de
    verdade não é reproduzível em Playwright headless (depende de
    credenciais salvas reais no perfil do navegador do usuário).
- **MODO CONSULTA (`/consulta`) — tela enxuta pra máquina de emissão
  (30/07/2026, pedido detalhado do próprio certificador em reunião):** ele
  emite os certificados com o cliente por perto e a certificadora podendo
  auditar/gravar a tela, mas precisava abrir o dashboard completo — que
  mostra telefone e e-mail **pessoais** do cliente. O risco que ele
  descreveu é concreto: telefone pessoal + e-mail pessoal + acesso ao
  certificado é material suficiente pra fraude. Rota nova, só-leitura,
  **mesmo login e mesma sessão** (nada de papel/usuário novo — reaproveita
  RBAC e auditoria existentes); rota separada em vez de toggle na tela
  atual porque um toggle pode ser desligado por engano com o cliente na
  frente. Papéis: `operador_certificacao`, `gestor`, `admin` (403 para os
  demais, testado com `operador_abertura`).
  **ENDURECIDO no mesmo dia, ANTES de qualquer deploy (04/08/2026, pedido de
  acompanhamento: "não pode haver nada que comprometa o certificador em
  auditorias das certificadoras... consultar apenas o necessário").** A 1ª
  versão listava a fila inteira num payload só e não gravava log nenhum —
  numa auditoria, o certificador não teria como provar acesso mínimo. As 4
  regras abaixo são o que sustenta essa prova; não afrouxar nenhuma sem
  pedido explícito novo.
  1. **BUSCA PRIMEIRO, uma OS por vez — a tela NÃO lista a fila.**
     `GET /api/consulta/dossiers?q=` exige 3+ caracteres, devolve no máximo 8
     resultados e **só identificação** (nome, CPF/CNPJ **mascarados** via
     `maskDigits`, nível, status) — zero dado de emissão. O dado real vem de
     `GET /api/consulta/dossiers/[id]`, uma OS por vez. Sem `q`, resposta
     vazia. Isso é o oposto de conveniência de UI: é o que impede outros
     clientes de aparecerem na tela com o cliente da vez do lado, e o que
     torna "acessei só o necessário" verificável.
  2. **TODO ACESSO É REGISTRADO.** Abrir uma OS grava `CONSULTA_ACESSO`;
     baixar documento grava `CONSULTA_DOCUMENTO_BAIXADO` (via `POST
     /api/consulta/dossiers/[id]`, um beacon — o arquivo em si é servido por
     `/uploads/[...path]`, que não audita). Mesmo `Database.createLog` +
     `getClientIp` do `/reveal`. **Se adicionar qualquer leitura nova nessa
     tela, adicione o log junto** — o valor da tela pro certificador é a
     trilha, não só o que ela esconde.
  3. **ISOLAMENTO POR ATRIBUIÇÃO**, mesmo padrão de `/reveal` e `/files-zip`:
     gestor/admin sem restrição; `operador_certificacao` só consulta OS que é
     dele ou ainda livre. Vale nos 3 pontos (busca, detalhe, beacon) — na
     busca o gate roda ANTES do filtro de texto, então OS de outro
     certificador nem aparece como resultado.
  4. **A whitelist é aplicada NO SERVIDOR**, não só na renderização:
     `phone`, `email`, `address`, `captured_by` e qualquer campo de senha
     **não saem no payload**. Se pedirem um campo novo, adicione
     conscientemente ali. (Contraste com o isolamento entre certificadores na
     tela Certificação, que continua sendo só de renderização — ver bullet
     correspondente.)
  - **Identidade visual fixa e distinta do dashboard, de propósito** — a tela
    **ignora o tema salvo** (`nexus-theme`): fundo claro, faixa verde-escura
    com tarja âmbar "MODO CONSULTA · somente leitura · sem credenciais ·
    acesso registrado", e **marca d'água** repetida com nome do operador +
    data/hora. Numa gravação da certificadora, isso registra no próprio vídeo
    que o modo restrito estava ativo e quem operava. Não "padronizar" essa
    tela com o resto do app — a distinção visual é requisito, não estética.
  - **Auto-fecha a OS após 3 min sem interação** (`AUTO_FECHAR_MS`) voltando
    pra busca vazia, sem deslogar. É diferente do `useIdleLogout(10)`, que
    continua valendo — um esconde o dado do cliente, o outro encerra a
    sessão.
  - **SEM abas Pessoa Física/Pessoa Jurídica (04/08/2026, pedido de
    acompanhamento explícito: "não precisa ter o identificador de pessoa
    física e jurídica").** A 1ª versão tinha um toggle PF⇄PJ (`pessoaTab`);
    removido — é a mesma OS, então tudo aparece numa lista única: Nome, CPF,
    Tipo de certificado (ver bullet seguinte), Razão Social, Nome Fantasia,
    CNPJ, Telefone/E-mail **do vínculo** (`t2_new_phone`/`t2_new_email`, uma
    vez só — antes apareciam duplicados, uma cópia em cada aba), Quadro
    societário, e a seção de Documentos de identidade. Campos que só existem
    depois da abertura (Razão Social/Fantasia/CNPJ) mostram "—" enquanto
    vazios, mesmo componente `Field` de antes. **Se pedirem separar de novo,
    é reversão explícita — não reintroduzir o toggle por conta própria.**
  - **Nível Gov.br (Ouro/Prata) trocado por "Tipo de certificado" (mesmo dia,
    pedido de acompanhamento seguinte: "não precisa aparecer nem o nível
    gov, só o tipo de certificado que vai ser feito, tipo E-CPF ou
    E-CNPJ").** `gov_level` saiu do payload dos dois endpoints (busca e
    detalhe) — não é mais exposto pelo Modo Consulta em lugar nenhum,
    inclusive na lista de resultados da busca (antes mostrava o selo 🥈/🥇).
    Novo helper `tipoCertificado(d)` em `src/lib/consulta.ts` (compartilhado
    pelos dois endpoints, evita divergir o critério — motivo pra virar
    arquivo próprio em vez de duplicar: os dois são route handlers comuns,
    sem limitação de closure como as duplicações já documentadas em
    `page.tsx`): `!bird_id_done` → "🆔 e-CPF" (ainda não fez o e-CPF, é o que
    vai emitir); `bird_id_done && !a1_done` → "📜 e-CNPJ" (e-CPF feito, falta
    o e-CNPJ); ambos feitos → "✅ e-CPF e e-CNPJ concluídos" (mesma OS pode
    continuar aparecendo na busca depois de finalizada, pra ele consultar
    documento). Aparece tanto na lista de resultados da busca quanto no
    campo "Tipo de certificado" da tela de detalhe (substituiu o antigo
    campo "Nível Gov.br"). **Se adicionar um campo novo que dependa de nível
    Gov.br no Modo Consulta no futuro, é pedido novo — o nível não está mais
    disponível nesse payload nenhum dos dois endpoints.**
  - **Rótulos de identificação e rodapé removidos da TELA (05/08/2026,
    pedido explícito): "não precisa ter identificação tipo, modo de
    consulta, somente leitura, acesso registrado e nem as informações de
    rodapé".** Header perdeu a tarja "MODO CONSULTA" e o texto "Somente
    leitura · sem credenciais · acesso registrado"; ficou só operador+data e
    o botão Sair. Removidos também os parágrafos explicativos "Cada download
    fica registrado na auditoria." (fim da seção de documentos) e "Esta
    consulta se fecha sozinha após 3 minutos... Senhas... não aparecem
    aqui..." (fim da tela de detalhe). **Isso é só texto/UI — nenhum
    mecanismo foi desligado:** log `CONSULTA_ACESSO`/
    `CONSULTA_DOCUMENTO_BAIXADO`, whitelist server-side, isolamento por
    atribuição e o auto-fechamento de 3 min (`AUTO_FECHAR_MS`) continuam
    intactos, só pararam de se anunciar em texto na tela. A cor/faixa
    verde-escura com borda âmbar e a marca d'água continuam — não foram
    pedidas pra sair, são identidade visual, não rótulo textual. Dica sob o
    campo de busca ("Nada é exibido antes da busca...") **não foi tocada**
    — não é rodapé, é texto de ajuda junto ao formulário; se pedirem
    remover essa também, é extensão do mesmo pedido, não presumir.
  - **Contexto importante dado junto com esse pedido, ainda não implementado:
    "essa visualização é apenas para um tipo de acesso novo que vamos criar
    pro certificador".** Ou seja, o plano do usuário é que o `/consulta`
    deixe de ser um "modo" alternável dentro do papel `operador_certificacao`
    (que também usa o dashboard completo) e vire a tela de um **acesso/papel
    dedicado novo**, exclusivo pra isso. Explica por que os rótulos de
    "modo restrito" pararam de fazer sentido no texto (se é o único acesso
    dele, não precisa se anunciar como modo alternativo) — mas **o RBAC
    ainda não mudou**: os dois endpoints continuam checando
    `operador_certificacao`/`gestor`/`admin`, não existe papel novo no
    `UserRole` nem em `db.ts`. Se o usuário pedir pra criar esse papel, é
    tarefa nova (schema, seeds, RBAC, provavelmente um login que já cai
    direto em `/consulta` sem passar pelo dashboard) — não assumir escopo
    além do que foi pedido explicitamente até lá.
  - **NENHUMA credencial DE TERCEIRO aparece** — senha Gov.br fica só no
    dashboard normal, onde a revelação já é auditada. **Atualizado pelo item
    abaixo (papel `certificador` + endpoints de escrita):** a tela PASSOU a
    ter 2 campos de senha, mas são as senhas do PRÓPRIO certificado
    (e-mail/acesso BIRD ID-Syngular) que o certificador está CRIANDO ao
    concluir o e-CPF — não é revelação de segredo alheio, ele mesmo definiu
    esse acesso. Continua sem Gov.br e sem contato pessoal do cliente.
  - CPF dos sócios secundários **não existe no sistema** (a consulta pública
    de CNPJ traz só nomes) — `quadro_societario` é nome puro.
  - **Papel `certificador` + fila de trabalho + "fazer a certificação"
    (05/08/2026, pedido explícito): "vamos criar esse papel novo pro
    certificador... ter uma forma de vincular essas OS que são atribuídas
    para o certificador ele conseguir consultar e fazer a certificações".**
    Fecha os dois pontos em aberto deixados pelo bullet acima — cria o papel
    dedicado E dá a ele um jeito de achar/executar o trabalho, não só olhar.
    - **Novo papel `certificador`** (`UserRole` em `db.ts`, `VALID_ROLES` em
      `api/users/route.ts`, `Role`/`ROLE_LABELS` em `admin/usuarios/page.tsx`
      — "🖥️ Certificador (emissão)"). Login redireciona direto pra
      `/consulta` (`login/page.tsx`), e o guard de `page.tsx` (mesmo bloco
      que já redireciona captador/terceiro) bloqueia acesso à esteira mesmo
      navegando direto pra "/". **Isolamento tratado como papel "de campo",
      não "quase interno"**: novo helper `isFieldRole(role)` em
      `src/lib/auth.ts` (`captador | terceiro | certificador`) substitui os
      `role === 'captador' || role === 'terceiro'` inline em 5 endpoints da
      esteira geral (`dossiers/[id]` GET+PATCH, `dossiers` GET,
      `dossiers/[id]/upload`, `dossiers/[id]/alert-sla`,
      `dossiers/[id]/files-zip`, `users/directory`) — importante porque
      esses endpoints eram BLOCKLIST (bloqueiam só captador/terceiro
      explicitamente), então um papel novo os atravessaria por padrão sem
      esse fix. `os-abertura/route.ts` foi tratado à parte (bloqueia
      `captador` e agora `certificador`, mas **não usa `isFieldRole`** —
      teria bloqueado `terceiro` também, que já tinha acesso ali por decisão
      de negócio anterior; não mudar isso sem pedido). **Se criar um
      endpoint novo da esteira geral, bloquear com `isFieldRole`, não copiar
      o check inline** — é o que garante que um 4º papel de campo no futuro
      herde o bloqueio automaticamente.
    - **Fila de trabalho, não mais só busca**: `GET /api/consulta/dossiers`
      sem `q` agora devolve a fila (OS atribuída a ele ou livre, já pronta
      pra agir — mesmo critério de `ativa()`/`vinculoReady`/`a1ReadyOf` do
      dashboard, reimplementado em `route.ts` porque são closures diferentes
      de `page.tsx`, mesma limitação já documentada pra essas funções em
      outros pontos desta skill). **Isso substitui a regra antiga "sem `q`,
      resposta vazia"** — decisão consciente: o objetivo de "não listar a
      fila" era proteger contra expor a ESTEIRA INTEIRA (outros clientes),
      não contra o certificador ver o PRÓPRIO trabalho pendente. Continua a
      mesma whitelist mínima (id/display/cpf_mask/cnpj_mask/tipo_certificado)
      — só muda o gatilho de quando aparece. A tela (`/consulta/page.tsx`)
      carrega a fila automaticamente ao abrir (`carregarFila`, chamado no
      `useEffect` de `ready` e depois de "← Fechar e fazer outra consulta")
      — busca por texto troca temporariamente pro resultado da busca
      (`modoFila` controla o rótulo "Sua fila"/"Resultados da busca").
    - **Dois endpoints novos pra "fazer" a certificação**, cada um com
      whitelist própria (nunca o PATCH genérico de `dossiers/[id]`, que
      devolveria o dossiê inteiro):
      - `POST /api/consulta/dossiers/[id]/bird` — conclui o e-CPF. **Exige
        os 5 campos de acesso (sistema/aparelho/e-mail/2 senhas) na MESMA
        chamada que marca `bird_id_done`** — diferente do fluxo do
        dashboard (`completeSubStep`), que separa "Salvar Dados de Acesso"
        de "Concluir BIRD ID" e cujo botão de concluir não valida nada (é a
        causa raiz do badge "⚠️ BIRD dados incompletos" já documentado
        nesta skill). Por ser rota NOVA, fecha essa lacuna por construção —
        impossível concluir por aqui com dado incompleto. 422 se faltar
        campo, 409 se já concluído.
      - `POST /api/consulta/dossiers/[id]/a1` — anexa o Certificado A1
        (.zip/.rar, mesmo `saveDataUrl`/detecção de extensão do upload
        genérico, extraídos pra `src/lib/uploads.ts` pra não duplicar uma
        3ª cópia). Mesma regra de negócio do dashboard (`a1ReadyOf`): o
        arquivo é SEMPRE salvo, mas só marca `a1_done` quando CNPJ + Cartão
        CNPJ + Certidão de Inteiro Teor (anexados pela abertura) + BIRD ID
        já estão prontos — senão devolve `faltando: string[]` dizendo o que
        falta, sem nunca expor a URL desses documentos (só os booleans
        `cnpj_comprovante_pronto`/`certidao_inteiro_teor_pronta`, novos no
        payload do GET `.../[id]`).
      - Os dois notificam o Caio de Sá (`cgs1010`) com tarefa + push, MESMO
        texto/formato que `dossiers/[id]/route.ts` já usa quando
        `bird_id_done`/`a1_done` mudam por lá — replicado deliberadamente
        (não importado, são route handlers diferentes) pra manter o
        controle de pagamento (tela Projetos) funcionando igual não importa
        qual caminho concluiu a certificação.
      - Auditoria: `CONSULTA_BIRD_CONCLUIDO`, `CONSULTA_A1_ANEXADO` (salvo,
        ainda não concluído) e `CONSULTA_A1_CONCLUIDO`.
      - **Checagem de papel+atribuição centralizada**: `autorizarConsulta`
        (movida pra `src/lib/consulta.ts`, junto com `tipoCertificado` que
        já morava lá) é usada pelos 4 endpoints do Modo Consulta (busca,
        detalhe, bird, a1) — antes de gestor/admin, `operador_certificacao`
        e agora `certificador` acessam OS seguindo a MESMA regra de sempre
        (sua ou livre). `CONSULTA_ALLOWED_ROLES` também centralizado lá.
    - **UI**: dentro do card da OS aberta, depois de "Documentos de
      identidade", uma seção condicional — `!bird_id_done` mostra o
      formulário de e-CPF (seletor BIRD ID/Syngular + 4 campos, senhas com
      `autoComplete="new-password"`, mesmo cuidado do bug de autofill já
      documentado nesta skill); `bird_id_done && !a1_done` mostra o upload
      do A1 com um checklist de prontidão (✅/⏳ por item); os dois feitos
      mostra só "✅ Certificação concluída". Ao concluir cada etapa, o
      estado local (`selected`) é atualizado com a resposta do próprio
      endpoint (`bird_id_done`/`a1_done`/`tipo_certificado`) — sem
      re-buscar o dossiê inteiro de novo.
    - **`operador_certificacao` continua podendo usar o Modo Consulta** (não
      foi restringido a só `certificador`) — os 4 endpoints aceitam os dois
      papéis + gestor/admin (`CONSULTA_ALLOWED_ROLES`). O papel novo é
      aditivo, não substitui o anterior.
    - Testado via `npm run dev` + curl + Playwright: usuário `certificador`
      criado via `/api/users`; 7 endpoints da esteira geral confirmados
      403 (`dossiers`, `dossiers/[id]` GET/PATCH, `upload`, `os-abertura`,
      `files-zip`, `users/directory`); fila carrega puxando OS
      atribuída/livre pronta; ciclo completo pela API (BIRD sem campos →
      422; BIRD completo → 200 + log; BIRD de novo → 409; A1 sem docs de
      abertura → salva sem concluir + `faltando`; A1 depois de completar os
      docs → conclui) e pela UI (login → fila → abre OS → preenche e
      conclui e-CPF → tela troca sozinha pro upload do A1 → seleciona
      arquivo real via `filechooser` → concluído → fila não mostra mais
      essa OS). Confirmado que `operador_abertura`/`captador` continuam 403
      no Modo Consulta, e que `operador_certificacao`/gestor/admin não
      regrediram (fila, PATCH geral, conclusão de BIRD todos funcionando).
      Tela `/admin/usuarios` mostra a opção nova no `<select>` e lista o
      usuário criado. Dados de teste restaurados ao final (backup/restore
      do `local_db.json`).
    - **Extensão (mesmo dia, pedido de acompanhamento): "estende agendamento
      e A1 em lote pro certificador também".** O bullet original tinha
      deixado esses dois de fora, deliberadamente (item "Escopo FORA desta
      entrega", removido daqui — não é mais verdade). O que mudou:
      - **`POST /api/consulta/dossiers/[id]/agendamento`** (endpoint novo,
        4º do Modo Consulta) — aprova/recusa o agendamento do captador,
        `{ decisao: 'aprovar'|'recusar', motivo? }`. Replica a lógica de
        `decidir_agendamento` do PATCH geral (`dossiers/[id]/route.ts`),
        não importa de lá (route handlers diferentes — se o critério mudar
        num lugar, replicar no outro): recusa sem motivo → 422; recusa
        libera o slot (`agendamento_cert=''`) e recria a tarefa
        `📅 Agendar certificação:` pro captador (mesmo prefixo que
        `captador.html` casa pra reabrir "Agendar"); aprova notifica o
        captador. Log `AGENDAMENTO_APROVADO`/`AGENDAMENTO_RECUSADO` — MESMO
        action_type do PATCH geral, de propósito, pra não fragmentar a
        auditoria por canal de origem (um gestor olhando o histórico da OS
        não precisa saber se a decisão veio do dashboard ou do Modo
        Consulta).
      - **Fila passou a incluir agendamento pendente**: `GET
        /api/consulta/dossiers` sem `q` agora também retorna OS com
        `agendamento_cert` + `agendamento_status === 'pendente'`, mesmo que
        ainda não estejam "ativas" pro e-CPF/e-CNPJ — decidir o agendamento
        é trabalho pendente também. Cada resultado ganhou
        `agendamento_pendente: boolean` (`toResult`). GET `.../[id]`
        ganhou `agendamento_cert`/`agendamento_status` no payload (só
        horário e status, nunca outro dado do captador).
      - **UI**: painel âmbar "⏳ Agendamento aguardando sua decisão" aparece
        no TOPO do card da OS aberta, ANTES dos dados de identificação —
        mesma prioridade visual do dashboard completo (decidir isso vem
        antes de qualquer outro trabalho na OS). Botões Aprovar/Recusar;
        recusar abre um textarea de motivo obrigatório. Badge "⏳
        agendamento aguardando decisão" nas linhas da fila/busca.
      - **A1 em lote — sem endpoint novo**, mesmo princípio já usado no
        lote do dashboard ("sem endpoint novo... mantém auditoria"): botão
        "📦 Vários A1" na tela de busca/fila (não precisa abrir uma OS
        primeiro) abre um modo próprio (`loteAtivo`) que aceita múltiplos
        arquivos e chama o MESMO `POST .../a1` um de cada vez,
        sequencialmente, client-side. **Diferença forçada pelo payload
        restrito do Modo Consulta**: o lote do dashboard casa por CNPJ OU
        nome; aqui só por **nome normalizado**
        (`normalizarNome`, reimplementado em `page.tsx` — o CNPJ chega
        MASCARADO no payload restrito, não dá pra casar por dígito). O
        **pool de candidatos é sempre `resultados`** (a fila ou busca já
        carregada na tela, filtrada por `tipo_certificado === '📜
        e-CNPJ'`) — nunca uma listagem própria, porque não existe endpoint
        de "listar tudo" no Modo Consulta, de propósito (romperia a regra
        "nunca lista a esteira inteira"). `abrirLote` sempre recarrega a
        fila antes de abrir, pra garantir o pool mais atual. Revisão antes
        de enviar (✓ casou/⚠️ ambíguo/✕ não encontrado, `<select>` manual
        pros dois últimos) igual ao lote original; nada é gravado antes de
        "Confirmar e enviar".
      - **INCIDENTE nesta sessão, registrado aqui pra não repetir**: ao
        implementar esta extensão, um `git commit`+`git push` anterior
        (deste mesmo item de papel `certificador`, ainda sem a extensão)
        tinha "sumido" do working tree local — `git log`/`git status`
        mostravam o commit ANTERIOR a ele, sem erro nenhum na hora, e nem
        `git reflog` nem `git fsck --unreachable` achavam o commit
        "perdido". Antes de reconstruir tudo do zero, um `git fetch` +
        `git log --oneline origin/<branch>` mostrou que o commit **estava
        no remoto o tempo todo** — só o working tree LOCAL tinha revertido
        (causa não identificada, possível reset de sessão/container).
        **Lição: se um commit anterior "sumiu", SEMPRE `git fetch` e
        comparar com `origin/<branch>` antes de reconstruir/recommitar do
        zero** — reconstruir em cima de um HEAD desatualizado (o que
        aconteceu numa primeira tentativa, antes de perceber o fetch) gera
        um commit local divergente do remoto (`push` rejeitado por
        "fetch first"), obrigando a descartar o trabalho duplicado
        (`git reset --hard origin/<branch>`) e reaplicar só o incremento
        real em cima do commit que já estava lá.
      - Testado: mesmo roteiro do bullet anterior, mais o ciclo de
        agendamento completo pela API (recusa sem motivo → 422; aprova →
        200; recusa com motivo → libera slot + recria tarefa pro captador
        com o texto certo) e o lote de A1 ponta a ponta pela UI real
        (arquivo `.zip` casando sozinho com a OS certa pelo nome, upload
        via `filechooser`, resultado "✓ enviado e concluído" na linha).
  - **REVERTIDO no mesmo dia (06/08/2026), pedido explícito de correção de
    rumo: "essa função de envio de arquivos deve ser apenas para o acesso
    normal do certificador, o acesso de consulta não deve ter qualquer
    outra função a não ser os dados que o certificador precisa para fazer
    o certificado".** Tudo que os dois bullets acima descrevem como
    "endpoints de escrita do Modo Consulta" **não existe mais no código**:
    - Os 3 endpoints (`.../[id]/bird`, `.../[id]/a1`,
      `.../[id]/agendamento`) foram **deletados** (`rm -rf`), não apenas
      desativados. `src/app/api/consulta/dossiers/[id]/` só tem `route.ts`
      (GET+POST de auditoria de download).
    - GET `.../[id]` voltou a devolver só a whitelist original (removeu
      `cnpj_comprovante_pronto`/`certidao_inteiro_teor_pronta`/
      `agendamento_cert`/`agendamento_status` do payload).
    - GET `/api/consulta/dossiers` (fila) voltou ao critério original — só
      e-CPF/e-CNPJ pendente (`!bird_id_done && vinculoReady` ||
      `a1Ready && !a1_done`); removeu a inclusão de agendamento pendente e
      o campo `agendamento_pendente` de `toResult`.
    - `src/app/consulta/page.tsx` foi **reescrito** removendo TODO o estado
      e JSX de escrita: formulário de conclusão de e-CPF, upload de A1
      (um a um e em lote, incluindo o botão "📦 Vários A1" e o modo
      `loteAtivo`), e o painel de decisão de agendamento. O card da OS
      aberta agora termina em "Documentos de identidade" — não sobra
      nenhuma seção depois.
    - **O que NÃO foi tocado** (continua igual): o papel `certificador`
      dedicado em si, `isFieldRole`, RBAC/isolamento por atribuição, busca,
      fila (só informativa, ajuda a achar a OS — não é mais "trabalho a
      fazer"), download de documento com log de auditoria
      (`CONSULTA_DOCUMENTO_BAIXADO`), identidade visual (cor/faixa/marca
      d'água), auto-fechamento por inatividade. O agendamento por aprovação
      do certificador e o upload de A1 em lote **continuam existindo — só
      que exclusivamente no "acesso normal"** (dashboard completo,
      `operador_certificacao`/gestor/admin via PATCH geral e
      `POST /api/dossiers/[id]/upload`), descritos nos dois bullets
      seguintes, que NÃO foram alterados por esta reversão.
    - A lição do incidente de commit "sumido" (git fetch antes de
      reconstruir) continua válida e não foi afetada por esta reversão.
    - **Se pedirem escrita de volta no Modo Consulta no futuro, é pedido
      novo e explícito** — não reintroduzir a partir do histórico acima
      só porque ele existiu numa sessão anterior.
    - `public/manual.html` (card "🖥️ Modo Consulta") atualizado no mesmo
      commit, removendo os passos de conclusão de e-CPF/e-CNPJ e aprovação
      de agendamento, e o aviso de "Vários A1". `npx tsc --noEmit` limpo.
  - **Nomenclatura dos documentos simplificada pra "Documento" (mesmo dia,
    pedido de ajuste): "ter a nomenclatura, documento apenas, tanto para
    documento de pessoa física ou jurídica".** `IDENTITY_DOCS` em
    `page.tsx` perdeu os rótulos específicos ("Documento (frente)",
    "Documento (verso)", "Documento completo", "CNH") — na tela o item
    mostra só "Documento" (ou "Documento 1"/"Documento 2"... quando há mais
    de um anexado, pra continuar dando pra distinguir o link de download).
    **A auditoria não mudou**: `DOCUMENTOS` em
    `api/consulta/dossiers/[id]/route.ts` continua com os rótulos
    específicos nos logs `CONSULTA_DOCUMENTO_BAIXADO` — é registro interno,
    não texto exibido, então manter o detalhe ali tem valor (útil numa
    auditoria da certificadora) sem contradizer o pedido de simplificar a
    TELA. Se pedirem simplificar a auditoria também, é escopo novo.
- **Agendamento do captador agora passa por aprovação do certificador
  (30/07/2026, mesma reunião):** antes o captador agendava e estava
  agendado. Motivos reais de recusa que ele deu: documento ilegível, e
  horários espalhados que não justificam o deslocamento. Campos novos:
  `agendamento_status` (`pendente`/`aprovado`/`recusado`),
  `agendamento_recusa_motivo`, `agendamento_decidido_por`/`_em`.
  - **O slot fica RESERVADO enquanto pendente** (`agendamento_cert` é
    gravado já na criação) — senão dois captadores marcam o mesmo horário.
    O que muda é só o status.
  - **COMPATIBILIDADE (não quebrar):** OS antiga com `agendamento_cert` e
    `agendamento_status` vazio conta como **aprovada** — `agendamentoPendente`
    (`page.tsx`, escopo de componente) exige `status === 'pendente'`
    explicitamente. Não inverter essa checagem, senão todo compromisso já
    firmado vira "aguardando aprovação" retroativamente.
  - Decisão vem por **COMANDO** (`decidir_agendamento: 'aprovar'|'recusar'`
    no PATCH), mesmo padrão de `toggle_mes_captador`: o servidor calcula o
    resultado e os campos `agendamento_status`/`_decidido_*`/`_recusa_motivo`
    são **deletados do payload** antes do spread — o cliente nunca escreve
    esses campos direto. Gate: gestor/admin, ou `operador_certificacao`
    responsável/OS livre. Recusa **sem motivo → 422**.
  - Recusa **limpa `agendamento_cert`** (libera o slot) e recria a tarefa
    com o prefixo `📅 Agendar certificação:` — é a string que
    `captador.html:1179` casa pra reabrir o botão "Agendar", então o ciclo
    fecha sozinho sem ninguém pedir nada.
  - **Escrita direta de `agendamento_cert` pelo PATCH já nasce `aprovado`**
    (widget "Agendar Certificação" do dossiê, aprovação de reagendamento,
    edição rápida) — esse PATCH é vedado a captador/terceiro, então quem
    chega ali é a autoridade que aprovaria de qualquer jeito. Sem isso, um
    agendamento pendente remarcado pelo gestor ficaria preso em
    "aguardando aprovação".
  - UI: painel "⏳ Agendamentos aguardando aprovação" no topo da view Agenda
    (acima do painel de reagendamento já existente, mesmo padrão de
    aprovar/recusar-com-modal); slot pendente em **âmbar tracejado** na
    grade; badge "⏳ dd/mm aguardando aprovação" nas linhas da tela
    Certificação; badge âmbar/vermelho em `captador.html` (Meus Cadastros).
    `sw.js` `CACHE_NAME` v11 → v12.
- **Upload de certificados A1 em lote (30/07/2026, mesma reunião):** ele
  emite vários A1 de uma vez e anexava um por um. Descartada a alternativa
  que ele mesmo levantou (pasta no servidor que o sistema varre) — o gestor
  preferiu pelo sistema, e varredura de filesystem sairia do fluxo
  auditado. Botão "📦 Subir certificados em lote" na tela Certificação.
  - **Sem endpoint novo:** cada arquivo vai num request próprio pro
    `POST /api/dossiers/[id]/upload` que já existe — mantém auditoria
    `FILE_UPLOADED`, a detecção de extensão corrigida no #130 (zip/rar) e
    evita mexer em limite de body.
  - Casamento (`matchArquivoParaOS`/`normalizeEmpresa`, escopo de módulo em
    `page.tsx`): CNPJ nos dígitos do nome do arquivo primeiro (identificador
    exato), depois nome da empresa normalizado (sem acento/pontuação/
    extensão/sufixo societário). Regra de negócio dada por ele: "todo
    certificado hoje tem o nome da empresa; se divergir, está errado" — por
    isso a **conferência antes de gravar é parte do pedido**, não um extra.
    1 candidato → ✓ casou; 2+ → ⚠️ ambíguo; 0 → ✕ não encontrado (os dois
    últimos exigem escolha manual; nada é gravado antes do Confirmar).
  - **`a1ReadyOf` não é burlado pelo lote:** o arquivo é sempre anexado, mas
    `a1_done` só é marcado quando a OS está liberada (BIRD + CNPJ + cartão +
    certidão); senão a linha do relatório diz o que falta. Testado com uma
    OS pronta e uma não-pronta.
  - **Não finaliza OS** (diferente do `completeSubStep`, que finaliza quando
    tudo fica completo): a finalização tem trava de servidor com mensagem
    detalhada (#129) que ficaria ilegível em lote, e finalizar dezenas de
    empresas como efeito colateral de um upload é grande demais pra ser
    silencioso. O modal diz isso explicitamente.
- **"Certificadora" saiu do formulário (30/07/2026, mesma reunião):**
  continuação do ajuste do #129, que já tinha tirado o campo de
  `birdDadosFaltando` e da trava de finalização. Agora os **dois** `<input>`
  foram removidos (painel BIRD antecipado em T2 e painel principal em T3 —
  as duas cópias de sempre). `cert_certificadora` **continua no `Dossier`,
  no `certForm` e no PATCH** — o valor de OS antigas não se perde e volta a
  aparecer só-leitura na aba Dossiê, agora condicionado a existir valor.
  Se pedirem o campo de volta, é só reinserir o input nas duas cópias.
- **Abas "⚡ Em andamento" e "🔓 Livre" fundidas em "⚡ A fazer" pro
  certificador (30/07/2026, mesma reunião: "o andamento e o livre estava
  confuso"):** são a mesma pilha de trabalho pra quem certifica — a
  distinção é de atribuição, não de estado, e hoje existe um certificador
  só. Gestor/admin continuam com as duas separadas (pra eles "Livre" é
  justamente o que ninguém assumiu). **`statusOf` NÃO mudou** — a fusão vive
  numa função nova `matchesTab(d, key)`, usada tanto no filtro da lista
  quanto na contagem das abas, justamente pra não tocar nas 3 cópias do
  critério (Certificação, Dashboard, Projetos) que já são armadilha
  conhecida de sincronização.
- **NÃO FEITO de propósito, mesma reunião (não reabrir sem pedido novo):**
  backfill de `cert_sistema_usado`/senha em OS antigas ("vazio depois de
  06/06 é Syngular", "senha padrão 11111111") — é edição direta de dado de
  produção a partir de uma regra dita de memória, e gravar senha adivinhada
  faria o certificador confiar num dado possivelmente errado. Além disso
  **essas OS já estão visíveis**: a aba "🚨 Necessita Atenção" com o badge
  "⚠️ BIRD dados incompletos" lista exatamente esse conjunto — criar
  relatório novo repetiria superfície existente (lição do 12º achado).

## Incidentes e lições aprendidas

1. **Migração de schema sem retry.** `ensureSchema()` em `db-postgres.ts`
   cacheia a promise de setup mesmo se ela falhar no meio — se um `ALTER TABLE`
   quebrar, o erro se repete pra sempre até reiniciar o processo manualmente.
   Já causou um incidente real (coluna `deleted_at` fazendo parecer que
   registros tinham "sumido" — na real era erro de query, nenhum dado foi
   perdido). Ainda não corrigido — é item de prioridade baixa numa lista de
   gaps já levantada.
2. **Sessões paralelas se sobrescrevendo.** Uma sessão implementou upload de
   "Comprovante de Endereço" e "Antecedentes Criminais" no captador; outra
   sessão, depois, reescreveu o mesmo `captador.html` pra adicionar
   selfie/selfie+RG/vídeo prova de vida e apagou esses campos sem querer (o
   usuário confirmou depois que não precisava mais deles, então ficou como
   está — mas o padrão de risco é real). **Por isso o passo 3 no topo deste
   arquivo existe:** sempre `grep` antes de reescrever uma seção inteira.
3. **Bug histórico de endereço.** Antes do commit `be3369a` (30/06/2026), o
   formulário da E2 gravava o endereço da empresa dentro do campo `address`
   (pessoal do cliente) porque `empresa_endereco` ainda não existia. OS
   antigas (ex: Tiago Henrique, Wendell Lopez, Israel Cruz) ficaram com esse
   dado sujo — endereço da empresa dentro do campo do cliente, e
   `empresa_endereco` vazio. **Pendente:** localizar e corrigir esses
   registros em produção — não faça isso sem confirmação explícita do usuário
   na conversa, é edição direta de dado de produção.
4. **Verificar antes de assumir gap.** Várias vezes nesta base de código algo
   que parecia faltar já estava implementado (formatação de moeda do capital
   social, trava de campos E2→E3, quadro societário no autofill), e várias
   vezes um "bug" reportado era cache de navegador desatualizado, não código.
   Leia o código real antes de propor ou implementar uma correção.
5. **`<main>` tem `overflow-hidden` fixo — toda view nova precisa do próprio
   wrapper de scroll, senão o conteúdo é cortado sem aviso (21/07/2026,
   confirmado como bug recorrente pelo próprio usuário: "esse bug sempre se
   repete em novas funções e tela desenvolvidas").** O `<main>` principal em
   `page.tsx` (~linha 1879) usa `flex-1 flex flex-col overflow-hidden` —
   qualquer `view === '...'` renderizada direto como filho dele PRECISA
   trazer seu próprio wrapper com scroll, senão fica sem scrollbar nenhuma
   assim que o conteúdo passar da altura da tela (não trava com erro, só
   corta silenciosamente — mais difícil de notar em telas com poucos dados
   de teste). Já aconteceu 2x: primeiro na tela "Projetos", depois de novo na
   tela "Captadores" (criada sem copiar o wrapper). Padrão correto, usado por
   `dashboard`/`esteira`/`certificacao`/`agenda`/`logs`/`concluidos`/
   `projetos`/`captadores`:
   ```jsx
   <div className="flex-1 overflow-y-auto p-6 bg-slate-900/30 thin-scroll">
     <div className="space-y-5 max-w-4xl mx-auto w-full">
       {/* conteúdo da view */}
     </div>
   </div>
   ```
   Reparar: o `max-w` fica só no `div` INTERNO — se for colocado no externo
   (o que tem `overflow-y-auto`), a barra de scroll fica "flutuando" com
   espaço morto ao lado (bug visual já reportado antes pelo gestor). Ao criar
   qualquer view nova, copiar esse wrapper de cara — não esperar o usuário
   notar que não tem scroll.
6. **Todo fetch de dossiê precisa de `cache: 'no-store'` — um sem essa opção
   já causou "dado em branco até hard refresh" (11/08/2026, relato real do
   gestor: editou dados de duas OS pela aba Editar e viu os campos em branco
   depois de salvar, sem nenhuma mensagem de sucesso).** `fetchDossiers`
   (lista) sempre teve `cache: 'no-store'`, mas `handleSelectOS`
   (`page.tsx` ~linha 1122 — chamado depois de TODO save/upload de uma OS
   pra atualizar `selectedOS`) não tinha; era a única exceção entre todos os
   `fetch('/api/dossiers...')` do arquivo. Corrigido. **Se adicionar um novo
   fetch de dossiê, sempre incluir essa opção** — mesmo o `headers()` do
   `next.config.ts` já forçando `no-cache, no-store` pra `/api/*`, é
   melhor não depender só disso. Mesmo incidente também expôs que a aba
   "✏️ Editar" (Edição Rápida) nunca dava NENHUMA confirmação de sucesso —
   `updateDossierStatus` só alertava em falha; corrigido pra retornar
   `Promise<boolean>` (sucesso/falha), usado por `handleSave` pra
   confirmar ("Alterações salvas com sucesso.") ou avisar quando não havia
   nada pra salvar. Se criar uma ação de salvar nova que não passa por
   `updateDossierStatus`, garanta feedback explícito de sucesso — como
   `handleSaveEmpresa`/`handleAssignResp` já fazem — não assumir que a
   ausência de erro é confirmação suficiente pro usuário.
7. **`dossiers` e `projectsList` (states de escopo de componente) só se
   atualizam por AÇÃO DE ESCRITA do próprio usuário, nunca por navegação
   entre telas nem pelo polling de 45s — qualquer view que dependa deles
   mostra uma "fotografia" congelada de quando a página foi carregada
   (mesmo caso real acima, mesmo dia: 2 gestores vendo contagens diferentes
   pro mesmo projeto, 26 vs 27, um deles mesmo após hard refresh — nesse
   caso porque o outro tinha aberto a página bem antes e nunca tinha saído/
   voltado à tela Projetos; um hard refresh de fato corrige, mas só quem
   sabe fazer isso reflexivamente percebe o problema).** `dossiers` é
   populado no mount (`page.tsx` ~linha 996) e só reescrito depois por
   `fetchDossiers()` — chamado de dentro de `updateDossierStatus` e de um
   punhado de handlers específicos (upload, exclusão, restauração, lote de
   A1, `SlaBulkModal`). O polling de notificações a cada 45s (~linha 1041,
   `poll()`) BUSCA `/api/dossiers` mas o resultado (`dos`) é usado só pra
   montar a lista de notificações — nunca chama `setDossiers`, então não
   conta como fonte de atualização apesar de rodar a cada 45s.
   `projectsList` tem o mesmo padrão (só populado no mount + depois de o
   próprio usuário criar/editar/excluir um projeto). Fix aplicado só na
   tela "Projetos" (rebusca os dois junto de `useEffect([view])` quando
   `view === 'projetos'`) — **as outras telas que leem de `dossiers`
   (Esteira, Certificação, Dashboard, Captadores) têm o MESMO risco
   estrutural e não foram tocadas** (fora do escopo do pedido original);
   se um relato parecido aparecer numa dessas ("meu colega vê uma coisa,
   eu vejo outra, mesmo depois de horas"), replicar o mesmo padrão
   (`useEffect` com `[view]` chamando `fetchDossiers()`) em vez de assumir
   cache de rede — o gap mais provável é este, não uma central nova de
   caching. **Antes de investigar isso como bug de rede/CDN**, confirme
   primeiro se a pessoa afetada literalmente NUNCA saiu/voltou daquela
   tela nem deu hard refresh desde antes da mudança — se sim, é este
   padrão, não infraestrutura.

## Checklist antes de abrir PR

O padrão de qualidade real deste projeto (visível nas mensagens de commit
#39–#52):

1. `npx tsc --noEmit` limpo (nunca `npm run build` com o dev ativo).
2. Testar o fluxo afetado contra servidor real — o padrão das últimas
   sessões é Playwright + `npm run dev`, cobrindo **cada papel afetado**
   (bugs de RBAC são invisíveis testando só como admin; o #52 validou com 7
   OS, uma por cenário).
3. Mexeu em `public/sw.js` ou `captador.html`? Avisar que o usuário precisa
   de hard refresh (Ctrl+Shift+R) pra trocar de versão.
4. Mudou fluxo ou regra visível ao usuário? Atualizar `public/manual.html`.
5. Mudou regra de negócio, papel ou fluxo? Atualizar esta skill **no mesmo
   PR** (ver "Como atualizar esta skill" no final).
6. Escrever a mensagem de commit no padrão do repo: causa raiz, o que mudou
   e como foi testado — as mensagens são a fonte de atualização desta skill.

## Regras de trabalho obrigatórias

- **Nunca commitar/dar push em `master` sem confirmação explícita do usuário
  na conversa atual** ("pode mergear" ou equivalente). Autorização de uma
  sessão anterior não vale pra sessão nova.
- **Sempre rodar `npx tsc --noEmit` limpo antes de qualquer commit.**
- **Credenciais não ficam no repositório.** VPS, banco, tokens vivem na
  memória persistente do Claude Code do usuário e no `.env` da VPS — nunca
  proponha commitá-los.
- **Seja econômico com subagentes.** O usuário monitora o limite de gastos da
  conta; prefira leitura direta (Read/Grep) a disparar vários subagentes em
  paralelo sem necessidade clara. Em revisões grandes, fracione em blocos,
  reporte progresso e espere confirmação antes de continuar.
- **Seja específico, não genérico.** Ao revisar ou propor mudanças, cite
  `arquivo:linha` real. Não sugira "boas práticas" de mercado sem ter lido o
  código de verdade primeiro — este projeto já teve sessões que assumiram
  gaps que não existiam.

## Notificação push (Web Push/VAPID)

Implementada (#56-#59 + branch `feat/push-captador`) — não é mais item pendente.
`src/lib/push.ts` (`sendPushToUser`), tabela/coleção `push_subscriptions`,
rotas `/api/push/{vapid-public-key,subscribe,unsubscribe}`. Dois service
workers distintos, cada um só com os handlers que precisa:

- `public/sw-dashboard.js` — dashboard interno (gestor/admin/operadores).
  **Sem fetch handler**, só push + notificationclick + badge.
- `public/sw.js` — do captador (offline-first). Ganhou os MESMOS handlers de
  push/notificationclick, mas o handler de `fetch` (cache-first só de
  `isCaptadorAsset`) continua intocado — não confundir os dois arquivos nem
  fundir a lógica.

**Todos os papéis** (incluindo `captador` e `terceiro`) podem receber push —
`vapid-public-key`/`subscribe` não têm mais exclusão de papel. Todo
`Database.insertTask()` que gera uma notificação relevante tem
`sendPushToUser()` ao lado — se adicionar um novo ponto de criação de tarefa,
adicione o push junto (não é automático). Ao concluir uma tarefa (`PATCH
.../tasks/[taskId]`), quem ATRIBUIU (`from_user`) recebe push (pulando o
pseudo-usuário "Sistema NexusFlow" e autoconclusão) — o bell in-app já
mostrava isso via `task_done` computado client-side; o push só complementa.

**`PushToggle` NÃO é um ícone próprio na barra** — isso já causou confusão
real (dois "sinos" lado a lado). Ele é uma linha de rodapé (`w-full`, borda
superior) dentro do dropdown do sino existente (`page.tsx`: dentro do bloco
`notifOpen &&`, depois da lista de notificações) ou dentro do dropdown do
`TaskBell` do terceiro (mesmo padrão). Se adicionar push a uma tela nova,
siga esse padrão — não crie um botão de sino separado na toolbar.

`terceiro` não tinha NENHUMA UI de tarefas (nem pra ver, nem pra concluir) até
o `feat/push-captador` — o backend (`/api/tasks`, `PATCH
.../tasks/[taskId]`) já não tinha restrição de papel, só faltava a tela. Agora
`src/app/terceiro/page.tsx` tem um sino `TaskBell` (reaproveitando o mesmo
`/api/tasks`) com o `PushToggle` dentro do próprio dropdown (reaproveita
`public/sw-dashboard.js`, o mesmo do dashboard interno — terceiro não tem SW
próprio como o captador). Disparo automático: dossiê sai de `t1` (aprovado na
análise de risco) → notifica o `terceiro_responsavel` (ou todos os
`terceiro` ativos, se a OS ainda não tiver um dono) que o vínculo já pode ser
preenchido (`src/app/api/dossiers/[id]/route.ts`, guarda
`original.current_step === 't1' && updates.current_step !== 't1'`). Pedido de
correção de dado é ad-hoc — sem flag dedicada (diferente de
`cert_docs_recusados`): qualquer papel interno abre uma tarefa normal pro
terceiro pelo dropdown "Enviar para..." do dashboard, que agora aparece no
sino dele.

Pendência real: ícones do manifest são placeholder (sem arte da marca); clique
na notificação do dashboard abre só a home (sem deep-link pra OS específica);
chaves VAPID vivem no `.env` da VPS, não no repo.

- **BUG REAL corrigido — seletor de projeto no isolamento por acesso,
  substitui `window.prompt` de texto livre (10/08/2026, reportado pelo
  usuário com screenshot: "colocar os projetos para ficar visível... parece
  que eles estão sumindo").** Causa raiz: `handleEditProjeto`/
  `handleEditGestorProjetos` (`src/app/admin/usuarios/page.tsx`) pediam o(s)
  nome(s) do projeto por `window.prompt` (texto livre), e tanto
  `dossierInGestorScope` (`src/lib/gestor-scope.ts`) quanto o filtro de
  `GET /api/terceiro/dossiers` comparam esse valor com `d.projeto` por
  **igualdade EXATA de string** — qualquer divergência de espaço/caixa (ex.:
  "PJ 10 ALEX" digitado vs "PJ 10 Alex" cadastrado na OS) faz o escopo
  apontar pra um projeto que não bate com nenhuma OS, e como "vazio = sem
  restrição" é a regra oposta (documentada acima), o resultado é "essa conta
  não vê ABSOLUTAMENTE NENHUMA OS" sem nenhum erro — exatamente o sintoma
  "os projetos estão sumindo". Reproduzido de propósito antes do fix: criei
  um projeto "PJ 10 Alex", atribuí a 2 OS, criei uma conta terceiro com
  `terceiro_projeto: "PJ 10 ALEX"` (grafia digitada errada de propósito) —
  `GET /api/terceiro/dossiers` devolveu 0 OS.
  - Fix: os dois `window.prompt` viraram um componente `ProjetoPicker`
    (checkbox, multi-seleção — ver ajuste do mesmo dia logo abaixo) que
    lista o catálogo real de `GET /api/projects` — elimina a classe inteira
    do bug de digitação, porque não dá mais pra digitar um nome que não
    exista. Usado tanto no formulário de criação (`role === 'terceiro' |
    'gestor'`) quanto num modal novo (`escopoModal`, mesmo padrão responsivo
    `fixed inset-0 flex items-center justify-center p-4` já documentado
    nesta skill — nunca `top-1/2`/`translate`) aberto pelo botão "📁
    Projeto(s)" da lista.
  - Cada item do seletor mostra a contagem `usados` (quantas OS já estão
    classificadas nele, vinda de `GET /api/projects`) — um projeto com "0
    OS" já avisa ANTES de salvar que o acesso vai abrir vazio.
  - **Migração automática de escopo já quebrado**: se o valor já gravado no
    usuário (`terceiro_projeto`/`gestor_projetos`) não bate com nenhum nome
    do catálogo, ele aparece listado mesmo assim (marcado, com "⚠️ não
    cadastrado") tanto no picker quanto como aviso inline na linha da
    tabela — não sumiu silenciosamente, o gestor vê o valor quebrado e troca
    pelo projeto certo. Não foi feita correção automática de dado (ex.:
    normalizar case) — o usuário escolhe explicitamente o projeto certo.
  - Testado com Playwright: reproduzi o bug real (escopo com grafia errada
    → 0 OS visíveis), abri o modal e confirmei o aviso "⚠️ não cadastrado" +
    "não vê nenhuma OS", selecionei o projeto certo da lista, salvei —
    aviso sumiu da linha da tabela. Testado também o modal em viewport
    mobile (390px), sem clipping. Dados de teste (projetos e conta criados)
    removidos ao final — só existiam no backend JSON local de dev.
  - **`terceiro_projeto` passou a aceitar MAIS DE UM projeto (mesmo dia,
    pedido de acompanhamento: "tem um acesso que vê mais de 1 projeto...
    preciso conseguir selecionar mais de 1").** Até aqui só `gestor_projetos`
    suportava lista; `terceiro_projeto` era string única (radio no picker) e
    o servidor comparava com `d.projeto` por igualdade EXATA
    (`escopoProjeto && dossier.projeto !== escopoProjeto`). Agora
    `terceiro_projeto` guarda o MESMO formato de lista separada por vírgula
    que `gestor_projetos` já usava — reaproveita diretamente
    `parseGestorProjetos`/`dossierInGestorScope` (`src/lib/gestor-scope.ts`,
    já eram genéricas na implementação, só o nome ficou "Gestor" por serem
    o 1º caso de uso; não renomeadas pra não gerar diff nos ~15 importadores
    já existentes) nas 3 rotas que liam `terceiro_projeto`:
    `GET /api/terceiro/dossiers`, `PATCH /terceiro-update`, `POST /reveal`.
    `ProjetoPicker` perdeu a prop `multi` (sempre multi-seleção agora pros
    dois papéis, virou checkbox só) — dead code do modo radio removido.
    Textos de aviso ("não existe na lista"/"não vê nenhuma OS") ajustados
    pra não overstate: com múltiplos projetos, só 1 nome quebrado entre
    vários válidos não zera o acesso — a mensagem agora distingue
    "ignorado, não bate com nada" (parcial) de "não enxerga nenhuma OS"
    (todos quebrados). Botão da lista virou sempre "📁 Projeto(s)" (não
    mais singular pro terceiro). Testado com Playwright: conta terceiro
    criada com `terceiro_projeto: "Projeto A, Projeto B"` via API viu as OS
    dos dois projetos e NÃO viu a de "Projeto C"; `PATCH /terceiro-update`
    confirmado 200 numa OS do escopo e 403 numa fora; UI confirmou os 2
    checkboxes já marcados ao abrir o modal, adicionei um 3º e salvei —
    linha da tabela atualizou pra "Projeto A, Projeto B, Projeto C".

- **BUG REAL — fundo da tela "Gestão de Usuários" (`/admin/usuarios`)
  ficava metade azul/metade branco (10/08/2026, reportado com screenshot:
  "a cor de fundo da tela ta metade azul e a outra metade branca").** Causa
  raiz é um gotcha de flexbox, não específico desta tela mas só visível
  nela: `<body className="min-h-full flex flex-col">` (`src/app/layout.tsx`)
  torna QUALQUER filho direto de `body` um item flex; o wrapper desta
  página usa só `min-h-screen` (`min-height: 100vh`, sem `flex-shrink-0`) —
  como `flex-shrink` é `1` por padrão, o item é ENCOLHIDO de volta pra
  exatamente 100vh sempre que `body` tem uma altura definida (via a cadeia
  `html,body{height:100%}` de `globals.css`), mesmo que o conteúdo real
  precise de mais espaço. Resultado: a `<div className="min-h-screen
  bg-slate-900">` fica travada em 900px (ou a altura da viewport, qualquer
  que seja) enquanto o conteúdo real (lista de usuários comprida) continua
  renderizando ABAIXO dela (CSS `overflow: visible` não corta, só não
  expande a caixa) — contra o fundo transparente do `<html>`, que deixa
  aparecer o branco padrão do navegador. Confirmado com Playwright: sem o
  fix, `offsetHeight` fica preso em 900px mesmo com `scrollHeight` real de
  2826px; aplicando `flex-shrink:0` via JS no console, a caixa cresce
  corretamente pro tamanho real do conteúdo. Fix: `shrink-0` adicionado nos
  3 wrappers `min-h-screen` do arquivo (loading, acesso negado, tela
  principal). **Por que só apareceu aqui:** as outras páginas fora do
  dashboard principal que também usam `min-h-screen` direto (`login`,
  `consulta`) têm conteúdo curto/centralizado que nunca precisa de mais de
  uma tela — o bug está lá também (mesmo wrapper, mesmo `body` pai), só
  nunca ficou visível por falta de conteúdo suficiente pra estourar 100vh.
  Se alguma dessas páginas ganhar conteúdo mais longo no futuro (ou
  aparecer relato parecido de "fundo dividido"), aplicar o mesmo
  `shrink-0`. Diferente do padrão já documentado nesta skill pro
  dashboard principal (item 5 de "Incidentes e lições aprendidas" —
  `<main overflow-hidden>` + wrapper `flex-1 overflow-y-auto` interno por
  view): aquele padrão assume rolagem INTERNA de uma tela de altura fixa;
  aqui o problema é o oposto — a página PRECISA rolar como documento
  normal (`min-h-screen`, sem `overflow-hidden` em lugar nenhum), e é isso
  que o flexbox do `body` atrapalha sem o `shrink-0`.
- **Paginação na lista de usuários (mesmo dia, pedido explícito):** lista
  de acessos crescia sem limite (dúzias de captadores). Mesmo padrão
  numerado já usado em Certificação/Projetos — 10 por página, botões ±2 ao
  redor da atual com "…" nas pontas, "Anterior"/"Próxima". Estado
  `usersPage`, clampado com `Math.min(usersPage, totalPages - 1)` (mesmo
  padrão dos outros — evita ficar numa página vazia depois de excluir
  usuário). Testado com Playwright: 46 usuários (40 de teste + 6 seed) →
  "Página 1 de 5", clicar em "2" mostra os usuários 11-20 corretamente.
- **Reatribuição de `terceiro_responsavel` (mesmo dia, caso real investigado
  a partir do bug de isolamento por projeto acima): "OS apareceram para o
  acesso gerencia22 e os dados de email/número/celular foram preenchidos
  por esse acesso antes do gerente00t ser criado".** Explica por que um
  parceiro escopado corretamente pro projeto certo ainda via 0 OS: a regra
  "primeira conta terceiro que grava dados na OS fica dona dela"
  (`terceiro_responsavel`, ver `/terceiro-update`) é permanente e
  INDEPENDENTE do projeto — uma OS já vinculada por um parceiro (ex.:
  `gerencia22`, criado antes de existir isolamento por projeto) nunca
  aparece pra outro parceiro (`gerente00t`), mesmo que ambos apontem pro
  mesmo projeto. Até este ponto não existia NENHUMA forma de corrigir isso
  pela UI — só editando o banco direto. Fix: novo seletor **"🤝 Responsável
  Terceiro (vínculo e-commerce)"** (aba Trabalho, bloco `isManager`,
  logo abaixo de "📁 Projeto" — mesma visibilidade: gestor/admin, qualquer
  etapa, não só T3). Usa o mesmo componente `ResponsibleSelect` já usado
  pra `resp_certificacao`/`resp_abertura`, com `options` = contas
  `terceiro` ativas (`operatorsList`, já vem de `/api/users/directory`,
  que devolve qualquer papel). Estado `respTerceiro`, sincronizado em
  `handleSelectOS` como `respCert`/`respAbertura`.
  - **Confirmação explícita antes de reatribuir uma OS já vinculada**
    (`window.confirm`, só dispara se já havia um responsável diferente):
    avisa que os dados já preenchidos (e-mail/telefone) NÃO são apagados,
    só a VISIBILIDADE muda — o parceiro antigo para de enxergar a OS no
    portal dele. Decisão consciente de UX porque a ação afeta a
    visibilidade de um TERCEIRO externo, não só um campo interno.
  - **Servidor** (`api/dossiers/[id]/route.ts`, PATCH geral): antes deste
    fix, `terceiro_responsavel` não tinha NENHUM gate explícito nessa rota
    — como o handler é só-permitido pra papéis internos
    (`isFieldRole`/`terceiro` já bloqueado no topo), na prática só
    gestor/admin/operador_certificacao/operador_abertura chegavam até
    aqui, mas nada impedia um desses últimos dois de reatribuir o campo
    via chamada direta à API (gap latente, nunca explorado pela UI porque
    nenhum front-end mandava esse campo antes). Fechado junto: só
    gestor/admin podem alterar `terceiro_responsavel` por este PATCH
    (mesmo padrão de `resp_certificacao`/`resp_abertura`, mas SEM a
    exceção de auto-claim — essa só existe pro próprio `terceiro` via
    `/terceiro-update`, rota separada, que este PATCH geral nem alcança).
    Gera log `TERCEIRO_REATRIBUIDO` (de/para) toda vez que muda.
  - Testado ponta a ponta: OS de teste com `terceiro_responsavel` de uma
    conta já excluída — reatribuída via UI (dialog de confirmação
    apareceu com o texto certo) pra outra conta `terceiro` real; conferido
    por API que o campo mudou, o log `TERCEIRO_REATRIBUIDO` foi gravado
    com `user_name` do gestor (nunca do payload), e que a conta nova
    passou a ver a OS em `GET /api/terceiro/dossiers` (antes não via, a
    antiga não aparece mais no dela). Confirmado 403 tentando o mesmo
    PATCH logado como `operador_certificacao`.
- **Auditoria "OS sem projeto" generalizada pra qualquer etapa (mesmo dia,
  pedido explícito: "validar quantas OS estão sem projetos atribuídos
  independente do estágio que ela esteja"):** o banner âmbar no topo da
  tela Projetos (`finalizadasSemProjeto`) só cobria `current_step ===
  'finalizado'`, motivado originalmente por outra necessidade (explicar
  divergência entre a soma de "Concluídas" dos projetos e o total global
  da esteira). Renomeado pra `semProjeto` e ampliado: `!d.projeto &&
  d.status !== 'cancelado' && d.current_step !== 'captacao' &&
  d.current_step !== 't1'` — **exclui `captacao`/`t1` de propósito**,
  porque a trava de servidor só exige `projeto` na aprovação da E1
  (transição `t1→t2`, ver regra "Projeto obrigatório na aprovação da E1"
  acima); uma OS ainda não aprovada não ter projeto é normal, não é bug,
  incluir essas infla a contagem sem sinalizar nada acionável. Cada linha
  agora mostra um badge de etapa (`STEP_LABELS_NAV`/"🏆 empresa aberta" em
  vez dos badges BIRD/A1 específicos de certificação, que só faziam
  sentido pro caso finalizado). Motivação real: o caso de isolamento por
  projeto do `terceiro_responsavel` (mesmo dia, achado logo acima) —
  encontrou 13 OS reais em `t2` ("Aguardando vínculo") sem projeto, que
  nenhuma tela do sistema mostrava antes disso. Testado com Playwright: 7
  OS de teste em `captacao`/`t1`/`t2`/`t3`(x2)/`finalizado`, todas sem
  projeto — o banner listou exatamente as 4 esperadas (t2, t3×2,
  finalizado), com o badge de etapa certo em cada uma; as 3 em
  captação/E1 ficaram de fora corretamente.
- **Campo novo `porte_empresa` (ME/EPP) no bloco "🏢 Dados da Abertura"
  (mesmo dia, pedido explícito):** campo selecionável (não texto livre),
  preenchido manualmente na E3, mesmo bloco/fluxo dos demais campos de
  empresa (`EmpresaAberturaFields`, reusado no formulário da E2 e no
  painel de trabalho da E3 — ganha o campo automaticamente nos dois
  lugares, sem duplicar nada). `EMPRESA_FIELDS` ganhou uma prop opcional
  `options?: { value; label }[]` — quando presente, o loop genérico
  renderiza `<select>` em vez de `<input type="text">`; só esse campo usa
  essa opção até agora. Valor persistido é o código curto ("ME"/"EPP"), a
  descrição completa ("ME (Micro Empresa)"/"EPP (Empresa de Pequeno
  Porte)") fica só no texto da `<option>` — mesmo padrão de
  `cert_sistema_usado` (guarda o valor "limpo", não o rótulo decorado).
  **Sem auto-fill do CNPJ** — diferente de outros campos desse bloco
  (nome/CNAE/capital/quadro societário/regime tributário, que vêm de
  `publica.cnpj.ws` via `autoFillFromCnpj`), decisão consciente porque o
  schema de retorno da API pra um campo de "porte" não foi verificado;
  preenchido manualmente. Também aparece read-only na aba "👤 Dossiê" →
  Pessoa Jurídica ("Dados da Empresa"), ao lado de Regime
  Tributário/Quadro Societário — mesmo padrão de todo campo desse bloco.
  Backend: `Dossier.porte_empresa` (`db.ts`), `TEXT_FIELDS` em
  `db-postgres.ts` (migração automática via `ALTER TABLE ADD COLUMN IF
  NOT EXISTS`, já é genérica — não precisou de linha nova), espelhado em
  `postgres/schema.sql`. `manual.html` atualizado com o campo no mockup
  da tela de Abertura. Testado com Playwright: selecionei "EPP" no
  formulário, salvei via "💾 Salvar Dados" (**cuidado**: existe outro
  botão "💾 Salvar Dados de Acesso" no mesmo painel T3 — um clique por
  texto não-exato pega o errado, usar `getByRole('button', { name: '💾
  Salvar Dados', exact: true })`), confirmei `porte_empresa: 'EPP'` via
  API e vi aparecer corretamente na aba Dossiê → Pessoa Jurídica.
- **Badge de projeto em TODO card do kanban (Esteira) + filtro por
  responsável/projeto (mesmo dia, pedido explícito):** antes só a coluna
  "Finalizado" mostrava `📁 {d.projeto}`, condicionalmente (sumia se
  vazio, sem indicar "sem projeto"). Novo componente de escopo de módulo
  `ProjetoChip({ projeto })` (perto de `RespChip`, mesmo padrão) — mostra
  o nome em verde ou "📁 sem projeto" em cinza quando vazio; usado nos 7
  blocos de card da Esteira (Captação, E1, E2, E3-Abertura, Recusadas, e
  as 2 sub-listas E-CPF/E-CNPJ da coluna Finalizado pro papel
  `operador_certificacao`, além da lista normal de Finalizado que já
  tinha o badge — agora padronizada pra usar o componente também).
  **Cards em E1/Recusadas normalmente vão mostrar "sem projeto" sempre**
  — não é bug, é esperado: a trava de servidor só exige `projeto` na
  aprovação da E1 (transição t1→t2), então nenhuma OS ainda em
  captação/E1 tem projeto de verdade.
  - **4 filtros novos na barra da Esteira** (mesma barra do filtro por
    Captador, `matchEsteiraFilters`): "Gestor (E1/E2)" (por
    `d.assigned_to` — é sempre um gestor/admin, quem tá com a OS no
    período E1/E2, ver "Operador responsável (E1/E2)"), "Abertura" (por
    `d.resp_abertura`), "Certificador" (por `d.resp_certificacao`),
    "Projeto" (por `d.projeto`). Todos com o mesmo padrão dos já
    existentes: `<select>` com opções = valores distintos presentes em
    `dossiers`, `!filtro || d.campo === filtro` combinado com AND no
    `matchEsteiraFilters` (que já era usado por `getColumnDossiers` E
    pela coluna "Recusadas" direto — os filtros novos valem pras 6
    colunas automaticamente, sem precisar tocar em cada uma). Botão "✕
    limpar" resetando os filtros (texto + captador + os de responsável/
    projeto) juntos.
  - Testado com Playwright: 3 OS de teste com `projeto`/`resp_abertura`/
    `resp_certificacao`/`assigned_to` preenchidos — badge correto em
    cada card (verde com nome do projeto vs cinza "sem projeto"); filtro
    por Projeto reduziu a Esteira de 7 pra 2 OS (só as do projeto),
    zerando as demais colunas; filtro por Certificador isolou
    corretamente 1 OS. Dado de teste revertido ao final.
  - **REVERTIDO em parte no mesmo dia (pedido de acompanhamento): filtro
    "Gestor (E1/E2)" (por `d.assigned_to`) removido — "não foi
    qualificado como necessário".** Ficaram só 3 filtros de
    responsável/projeto na barra: Abertura, Certificador, Projeto (+
    Captador, que já existia antes). Removidos: o estado
    `esteiraGestorFilter`, o `<select>` correspondente, `matchesGestor`
    dentro de `matchEsteiraFilters`, e a referência no botão "✕ limpar".
    O badge `ProjetoChip` nos cards **não foi afetado** — só o filtro por
    `assigned_to` saiu, o resto do pedido original (badge de projeto nos
    cards + filtros de Abertura/Certificador/Projeto) continua de pé.
- **2 correções pontuais no card "Contador Responsável" (mesmo dia,
  reportado com screenshot):**
  1. **Campo CRC duplicava a palavra "CRC"** — o valor bruto salvo em
     `CONTADORES_INFO` (constante hardcoded, 3 contadores da Contex, não
     é dado de OS) já incluía o prefixo `'CRC 347659/0-9'`, exibido sob
     um `<label>` que TAMBÉM já dizia "CRC" (`<span>CRC</span><span>{c.crc}</span>`)
     — duplicava visualmente ("CRC CRC 347659/0-9" em efeito, seguido de
     quebra de linha no layout real do card). Fix: removido o prefixo
     `"CRC "` dos 3 valores da constante — o label já basta.
  2. **Nome do contador sem botão de copiar** — os outros campos do card
     (CRC/CPF/E-mail/Telefone/Endereço) já tinham `<CopyButton>`, só o
     `<span>{c.nome}</span>` do topo do card não. Adicionado
     `<CopyButton value={c.nome} keepSpaces />` ao lado do nome (mesmo
     componente, `keepSpaces` porque nome de pessoa não deve ter espaços
     removidos ao copiar, diferente de CRC/CPF que são compactados).
  - Único `card()` reaproveitado tanto pra `operador_abertura` (só o
    contador da própria OS) quanto pra gestor/admin (lista completa ou
    filtrada) — um fix só cobriu os dois. Testado com Playwright: card
    de "João Nakayama Filho" mostrou "CRC 347659/0-9" (sem duplicar) e
    ícone de copiar (⧉) ao lado do nome.
- **Download do Certificado A1 aparecia com o nome do CAMPO
  ("certificado_a1_url"), não do certificado (10/08/2026, pedido
  explícito):** causa raiz — os arquivos são salvos em disco como
  `<field>.<ext>` (ex.: `certificado_a1_url.zip`, ver `src/lib/storage.ts`/
  `saveDataUrl`), e os links de "⬇️ Baixar" usavam `<a href={url}
  download>` com o atributo `download` VAZIO — sem valor explícito, o
  navegador usa o nome real do arquivo salvo (o nome do campo, não do
  certificado). O nome ORIGINAL do arquivo que o operador selecionava no
  seletor de arquivos nunca era capturado nem enviado ao servidor — se
  perdia por completo no upload.
  - **Novo campo `certificado_a1_nome`** (`Dossier`, `TEXT_FIELDS` em
    `db-postgres.ts` — migração automática já genérica, sem linha nova —,
    espelhado em `postgres/schema.sql`): guarda o nome original do
    arquivo como foi anexado. Só existe pra `certificado_a1_url` — os
    demais campos de anexo já têm nome amigável fixo
    (`FILE_FIELDS`/`ALLOWED_FIELDS`), não precisam disso. Diferente dos
    `doc_extra_N_nome` (digitados manualmente), este é capturado
    AUTOMATICAMENTE do `file.name` no momento do upload.
  - **`FileAttach`** (componente genérico, `src/app/page.tsx`) ganhou 2
    props opcionais: `sendOriginalName` (manda `original_name: file.name`
    no POST de upload — só ligado no uso do Certificado A1) e
    `downloadName` (valor explícito do atributo `download` do link
    "Baixar" — `download={downloadName || true}`, o `|| true` preserva o
    comportamento antigo quando não há nome calculado). **`DocLink`**
    (outro componente genérico, usado na aba Dossiê) ganhou o mesmo
    `downloadName` opcional.
  - **`POST /api/dossiers/[id]/upload`** aceita `original_name` no body;
    só persiste em `certificado_a1_nome` quando `field ===
    'certificado_a1_url'` — os demais campos ignoram o parâmetro
    silenciosamente (não é erro mandar, só não faz nada). O upload EM
    LOTE de A1 (`loteA1Itens`, já capturava `it.nome = file.name` pra
    casar com a OS certa, mas nunca enviava) passou a mandar
    `original_name: it.nome` no mesmo request.
  - **Novo helper `certificadoA1FileName(empresaNome, nomeOriginal, url)`**
    em `src/lib/text.ts` (mesmo arquivo de `normalizeSearch`, importado
    tanto por `page.tsx` quanto por `terceiro/page.tsx` — evita duplicar a
    lógica de prioridade em 2 lugares): prioridade 1 = nome da empresa
    (sanitizado, sem caracteres inválidos de path) + " - Certificado
    A1.<ext>" (extensão detectada da própria URL, sempre `.zip`/`.rar`
    graças ao fix do #130); prioridade 2 = nome original do arquivo
    anexado (`certificado_a1_nome`); sem nenhum dos dois, retorna
    `undefined` e o link cai de volta no comportamento antigo (nome bruto
    da URL) — nunca finge ter um nome bonito quando não tem dado pra isso.
  - Aplicado nos 3 lugares que mostram o download do A1: painel de
    Trabalho T3 (`FileAttach`), aba Dossiê → Pessoa Jurídica (`DocLink`),
    e portal do parceiro (`terceiro/page.tsx` — ganhou `certificado_a1_nome`
    na projeção de `GET /api/terceiro/dossiers` e no tipo local; o link lá
    trocou `target="_blank"` por `download`, já que a intenção real
    sempre foi baixar, não visualizar no navegador).
  - Testado com Playwright: upload real de "Certificado-Empresa-XPTO.zip"
    numa OS COM `empresa_nome` definido → `download="Fast Comércio Ltda -
    Certificado A1.zip"` (nos 2 lugares do dashboard); mesmo upload numa
    OS SEM `empresa_nome` → `download="Certificado-Empresa-XPTO.zip"`
    (fallback pro nome original). Confirmado via API que
    `certificado_a1_nome` persiste corretamente nos dois casos. **Cuidado
    ao testar de novo**: o painel T3 tem VÁRIOS links "⬇️ Baixar" (cartão
    CNPJ, certidão, inscrições, A1) — um seletor Playwright sem escopo
    (`.first()`) pega o do campo errado; escopar pelo `<label>` "Certificado
    A1" antes de buscar o link, como feito no teste real.
  - **Retroatividade, respondendo pergunta real do usuário**: a correção
    do nome de download NÃO exige reanexar — funciona automaticamente pra
    OS já com `certificado_a1_url` antigo, DESDE QUE `empresa_nome` já
    esteja preenchido (prioridade 1 do helper). Só fica com o nome cru
    (`certificado_a1_url.zip`) quem não tem `empresa_nome` preenchido E
    nunca teve o nome original capturado (upload anterior à correção) —
    não há como recuperar esse dado retroativamente sem reanexar, o nome
    original nunca foi salvo antes.
  - **2º ajuste, mesmo dia (pedido de acompanhamento com screenshot):
    seletor nativo de arquivo do SO abria com "Arquivos personalizados"
    em vez de "Todos os arquivos" ao anexar o A1.** Causa: o `accept` do
    input, quando não passado, cai no default do componente
    (`'image/*,application/pdf,.pfx'`) — que nem inclui `.zip`/`.rar`, o
    tipo real esperado do A1! `FileAttach` ganhou a distinção entre "não
    passei nada" (usa o default) e "passei vazio de propósito" (sem
    filtro nenhum) trocando `accept || default` por `accept ?? default`
    (nullish coalescing — com `||`, uma string vazia cairia no default
    mesmo assim). O uso do A1 (`field="certificado_a1_url"`) passou
    `accept=""` — resto dos campos (`cnpj_comprovante_url` etc.)
    continuam com o default de sempre, não foram tocados. Testado:
    `input#file_certificado_a1_url` renderiza com `accept=""` no DOM,
    enquanto os outros inputs do mesmo painel (`file_cnpj_comprovante_url`
    etc.) continuam com `'image/*,application/pdf,.pfx'` — o seletor
    nativo do SO não é testável via Playwright headless (é chrome do
    SO, não da página), então a verificação foi no atributo HTML real,
    que é o que o navegador usa pra decidir o filtro padrão do diálogo.

- **Tela "Projetos" no Portal do Parceiro + filtro/badge de projeto no
  kanban do terceiro + regra de nome do card generalizada (12/08/2026,
  pedido explícito do parceiro e-commerce).** Três mudanças relacionadas:
  1. **`GET /api/terceiro/dossiers` passou a expor `projeto`** (a
     classificação da Contex, definida por gestor/admin — não confundir com
     `projeto_parceiro`, o texto livre que o próprio terceiro usa pra
     organizar as empresas dele). Antes esse campo nunca chegava ao portal
     do parceiro; agora é só-leitura lá, sem risco de vazamento entre
     projetos porque a listagem já é escopada por `terceiro_projeto`
     (`dossierInGestorScope`) antes desse ponto — só OS's que a própria
     conta já pode ver.
  2. **Nova tela "📁 Projetos"** (`src/app/terceiro/page.tsx`,
     `ProjetosView`) — toggle no cabeçalho ao lado da busca
     ("🗂️ Kanban" / "📁 Projetos"). Agrupa as OS's visíveis (`visible`, já
     passando pelos filtros de busca/captador/projeto ativos) por
     `d.projeto` — cada grupo expansível mostra contagem de
     aguardando vínculo/em processo/finalizadas e a lista de OS's, clicável
     pra abrir o mesmo `DetailModal` do kanban. Nenhum endpoint novo — é só
     uma visão diferente do que `/api/terceiro/dossiers` já retorna, sem
     expor capacidade/contador_abertura (campos internos de
     `GET /api/projects`, que não é usado aqui de propósito — evita vazar
     nome/capacidade de projetos de OUTROS parceiros pra esta tela).
  3. **Filtro "Projeto: Todos" e badge de projeto no `MiniCard`** do
     kanban do terceiro — mesmo padrão já usado no filtro de Captador
     (lista de nomes distintos vem do próprio `list` carregado).
  4. **Regra "nome da empresa no card depois do e-CPF" generalizada pra
     TODO card do sistema, não só a lista da tela Certificação** (pedido
     explícito: "para todos os acessos essa visualização... deve ser
     aplicada"). Novo helper `empresaOuPessoa(clientName, empresaNome)`
     em `src/lib/text.ts` (mesmo arquivo de `certificadoA1FileName`,
     importado tanto por `page.tsx` quanto por `terceiro/page.tsx` —
     evita duplicar a mesma condição em 2 módulos como já documentado em
     outros achados desta skill). Aplicado nos 6 títulos de card da
     Esteira interna (Captação, E1, E2, E3-Abertura, Recusadas,
     Finalizado — as 5 colunas principais mais a lista de finalizados
     pra quem não é `operador_certificacao`, que já tinha sua própria
     lógica separada e não foi tocada) e no `MiniCard`/`DetailModal` do
     portal do terceiro. **Escopo deliberadamente limitado a cards de
     kanban** — não foi aplicado em listas de auditoria (tela Projetos:
     `semProjeto`, `birdSemDados` etc.), slots de agenda, nem no
     dropdown de busca global — esses contextos mostram o nome da pessoa
     de propósito; se pedirem estender a esses lugares também, é escopo
     novo.
  - **Correção no mesmo dia (bug real reportado pelo usuário): a versão
    inicial de `empresaOuPessoa` exigia `bird_id_done && empresaNome`**
    (copiado do critério `primaryIsEmpresa` da tela Certificação, achando
    que era o mesmo caso) — isso deixava cards com razão social já
    atribuída (ex.: via autofill de CNPJ ainda na E2/E3, antes do e-CPF
    ser feito) mostrando o nome da pessoa física, contrariando o que o
    usuário queria. Perguntado explicitamente e confirmado: o critério
    certo é só `!!empresaNome`, **sem depender de `bird_id_done`**.
    `empresaOuPessoa` perdeu o 3º parâmetro; os 9 call sites (6 na
    Esteira + 3 no portal do terceiro) atualizados. **A lista da tela
    Certificação (`primaryIsEmpresa`/`primaryName`) NÃO foi alterada** —
    continua exigindo `bird_id_done` de propósito, é uma regra própria e
    já documentada daquela tela especificamente (motivo: lá o objetivo é
    indicar QUAL É O TRABALHO ATIVO do certificador — pessoa física até
    o e-CPF, empresa depois —, não só "a empresa já existe"). Se pedirem
    mexer nesse critério de novo, `grep -n "empresaOuPessoa("` pra
    confirmar todos os call sites antes de mudar a assinatura.
  - Testado: `npx tsc --noEmit` limpo + Playwright contra `npm run dev`
    nas duas rodadas (versão inicial e a correção) — confirmado
    visualmente que uma OS com `empresa_nome` preenchido e
    `bird_id_done` ainda `false` mostra o nome da empresa no card da
    Esteira (coluna E3-Abertura) e no kanban/Projetos do portal do
    terceiro. Dado de teste revertido ao final (ambiente de dev local).

- **BUG REAL — compressão de imagem do captador destruía detalhe fino de
  documentos (12/08/2026, reportado pelo usuário: "a qualidade dos
  documentos anexados em imagem estão ficando muito ruim, como se fosse
  renderizado a foto pra uma qualidade menor").** Confirmado com um teste
  controlado (imagem sintética 3024×4032 com padrão de linhas finas,
  simulando texto pequeno de documento): com os parâmetros antigos
  (`MAX_WIDTH=1200` + JPEG `quality=0.7`), o padrão fino sumia por
  completo — virava um gradiente cinza liso, só o texto grande sobrevivia
  — e o arquivo comprimido ficava com só ~20KB pra uma imagem retrato de
  1200×1600. Com `MAX_WIDTH=1600` + `quality=0.85`, o mesmo padrão
  permanece nítido, arquivo ~400KB. Não era regressão desta sessão — os
  valores antigos (1200/0.7 no formulário principal e no modal "Atualizar
  Cadastro"; 900px de largura de saída no "Câmera de Documento" in-app)
  já estavam assim desde a criação do arquivo (confirmado via `git log
  -p`), agressivos demais pra fotos de câmera de celular moderna
  (12MP+) com texto fino de RG/CNH/CNPJ.
  - Fix em `public/captador.html`: 2 constantes novas de escopo do
    `<script>`, `DOC_IMG_MAX_WIDTH = 1600` e `DOC_IMG_QUALITY = 0.85`
    (perto de `DOC_NAMES`) — substituem os `const MAX_WIDTH`/literais
    duplicados em `handleDocFile` (upload do formulário principal:
    Frente/Verso/Completo/CNH/Selfie/Selfie+RG) e `readFileBase64`
    (modal "✏️ Atualizar Cadastro", reenvio pós-recusa) — as DUAS cópias
    do mesmo critério, mesmo padrão de risco de sincronização já
    documentado noutros pontos desta skill, agora com uma fonte só. A
    "Câmera de Documento" in-app (`captureDocPhoto`, moldura 3:4) teve só
    `OUT_W` elevado de 900 pra 1400 (mantém a lógica de recorte própria,
    não usa as constantes compartilhadas porque o enquadramento é outro
    — largura fixa de saída, não "reduz só se maior que").
  - **Não há motivo de armazenamento pra manter agressivo**: a fila
    offline do captador usa **IndexedDB** (`NexusFlowOfflineDB`), não
    `localStorage` — não tem o teto de ~5-10MB por origem que
    justificaria comprimir mais que o necessário.
  - `sw.js` `CACHE_NAME` de `v13` pra `v14` (mudança em `captador.html`,
    exige hard refresh do usuário pra pegar a versão nova).
  - **Se o mesmo tipo de relato aparecer de novo** ("foto ficou
    borrada"/"documento ilegível"), reproduza com uma imagem de alto
    contraste/detalhe fino (não uma foto qualquer — JPEG a baixa
    qualidade pode parecer "aceitável" numa foto lisa e ainda assim
    destruir texto pequeno) antes de mexer nos parâmetros de novo — foi
    esse teste que expôs o problema de forma inequívoca aqui.
  - **Não verificado nesta sessão** (sem acesso à VPS): se o nginx/proxy
    de produção tem `client_max_body_size` baixo o suficiente pra rejeitar
    o payload maior (upload de cadastro completo, 6 imagens, pode passar
    de ~2-4MB agora vs bem menos antes). Se aparecer erro 413 depois do
    deploy, é o próximo lugar a olhar — fora do escopo deste repo/sessão.
  - Testado: `npx tsc --noEmit` limpo (arquivo é HTML/JS estático, não
    afeta rotas TS) + verificação de sintaxe do `<script>` via
    `new Function(...)`. Prova visual real com Playwright + `npm run dev`:
    gerei uma imagem de teste 3024×4032 com padrão de linhas finas + texto
    grande, subi pelo campo "Doc. Frente" → "🖼️ Galeria", comparei o
    resultado com os parâmetros antigos (revertidos temporariamente,
    depois restaurados) vs os novos — diferença visual gritante, o padrão
    fino só sobrevive com os parâmetros novos.

- **Filtro/auditoria "empresa sem nome ou CNPJ atribuídos" (24/08/2026,
  pedido explícito: "preciso de uma forma de filtrar as empresas que ainda
  não tem nome empresarial ou cnpj atribuídos").** Perguntado onde aplicar
  e confirmado: Esteira interna **e** tela Projetos (as duas; portal do
  terceiro ficou de fora de propósito, não foi pedido). Critério é **OU**,
  não E: `!d.empresa_nome || !d.cnpj_number` — basta faltar UM dos dois
  pra entrar.
  - **Esteira**: novo `esteiraSemEmpresaFilter` (booleano) somado ao
    `matchEsteiraFilters` já existente — como é um toggle, virou
    **checkbox** "Sem nome/CNPJ" na barra de filtros, não um `<select>`
    como os outros 5 (Captador/Abertura/Certificador/Projeto/Contador).
    Entra no botão "✕ limpar" junto com os demais. **Sem nenhuma restrição
    de etapa** — pedido explícito de acompanhamento no mesmo dia ("na
    esteira deve filtrar tudo"), confirmando que é pra valer nas 6 colunas
    igual (`matchEsteiraFilters` já é a única porta de entrada de
    `getColumnDossiers` e da coluna Recusadas, então isso já saiu certo
    desde a 1ª versão — não precisou mudar nada aqui).
  - **Tela Projetos**: 5º bloco de auditoria global (âmbar, expansível,
    `semEmpresaOuCnpjExpanded` — mesmo padrão visual/estrutural de
    `semProjeto`/`cnpjSemNumero`/duplicidade). **Critério final: só
    `t3`/`finalizado`** (E3 em diante) — a 1ª versão excluía só
    `captacao`/`t1` (mesma exclusão do `semProjeto`), mas pedido de
    acompanhamento no mesmo dia apertou mais: "só deve aparecer... se caso
    ela estiverem na E3 em diante sem esses dados" — E2 também ficou de
    fora, porque até ali é normal esses campos ainda não existirem
    (preenchidos tipicamente perto da abertura, via cadastro/autofill de
    CNPJ); só a partir da E3 a falta desses dados passa a travar o
    andamento de verdade. Cada linha tem badge indicando **exatamente o
    que falta** ("sem nome" e/ou "sem CNPJ" — não são mutuamente
    exclusivos) além do badge de etapa. **Se pedirem mexer nesse recorte
    de novo, o critério atual é só E3/finalizado — não confundir com a
    exclusão mais ampla (pós-E1) que `semProjeto` usa, são regras
    diferentes por decisão consciente.**
  - **Diferente do bloco `cnpjSemNumero` que já existia** (esse exige
    `cnpj_comprovante_url` anexado + `cnpj_number` vazio — é sobre uma
    ordem de preenchimento específica que trava o A1). O novo é mais
    amplo: qualquer OS em E3/finalizado sem razão social e/ou sem CNPJ,
    tenha ou não o cartão anexado. Os dois coexistem de propósito, com
    recortes diferentes — não unificar sem pedido.
  - Testado com Playwright + `npm run dev` (papel gestor) nas duas rodadas
    (versão inicial e o ajuste de recorte): dados de teste cobrindo OS em
    E2/E3/finalizado sem nome/CNPJ — confirmado que a versão final do
    bloco da tela Projetos exclui a OS em E2 (só lista as 3 de E3/
    finalizado) e que o checkbox da Esteira continua valendo pras 6
    colunas sem nenhuma restrição de etapa. Dado de teste revertido ao
    final. `npx tsc --noEmit` limpo.

## Último commit refletido nesta skill

`8026fe6` ("fix(esteira): filtro de Contador lista os 3 nomes fixos, não só
os em uso" — #157), incluindo tudo entre `142839f` e este hash (#142-#157:
isolamento entre GESTORES de projetos diferentes, seletor de projeto no
lugar do `window.prompt`, `terceiro_projeto` com múltiplos projetos, fundo
dividido/paginação/reatribuição de responsável terceiro em
`/admin/usuarios`, auditoria "sem projeto" ampliada, campo "Porte da
Empresa", badge/filtros de projeto na Esteira interna, aviso de nova versão
no captador, nome de download do A1, endurecimento da rota de arquivos +
"Forma de Atuação", fix de contadores da tela Projetos, fix da soma das
abas de Certificação, filtro por Contador na Esteira) — todos já refletidos
nas seções acima. Em cima desse commit, a tela "Projetos" do Portal do
Parceiro + generalização da regra de nome do card (ver bullet logo acima,
12/08/2026) — mais recente que o hash acima, ainda sem commit no momento
desta atualização da skill.

Anteriormente: `6e5e412` ("Esteira: filtro por captador e busca de texto no
kanban interno" — #134), mais a leva de ajustes do certificador desta mesma
branch (Modo Consulta com busca+fila, papel `certificador` dedicado,
"Certificadora" fora do formulário, abas "A fazer") — todos já refletidos
nas seções acima.
**Importante:** a mesma branch chegou a dar escrita ao Modo Consulta
(conclusão de e-CPF/e-CNPJ, aprovação de agendamento, A1 em lote) e depois
**reverteu tudo isso no mesmo dia (06/08/2026)** por pedido explícito — o
Modo Consulta é só-leitura de novo, ver o bullet "REVERTIDO" na seção do
papel `certificador` acima. Qualquer commit posterior pode invalidar regras
acima — leia as mensagens dele antes de confiar nesta skill (passo 2 do
topo).
Entre `168daee` e aqui: dados de PF/PJ contextuais por sub-etapa
(BIRD/A1/Abertura), grids responsivos, SLA removido da fila do certificador
(#67 — já refletido acima); vínculo do e-commerce gatilhando BIRD "ativo",
listas de concluídos separadas por PF/PJ, grade de no máximo 2 colunas (#68 —
já refletido acima). Em andamento (branch `feat/pagamento-certificacao`,
ainda não mergeada no momento desta atualização): pagamento das
certificações com 3 marcadores independentes (BIRD/A1/Colaborador) — já
refletido acima.

Antes disso — entre `c21c1d7` (#55) e `168daee`: certificação SYNC/BIRD +
RBAC de documentos (#54 — já refletido acima), senha do e-mail da empresa
revelável por terceiro/certificador/gestor (#56), log de acessos com IP
(#57), ajuste de SLA individual/lote (#58), push notification completo pra
todos os papéis
(#59-#60, #63), fix de IDOR/RBAC de auditoria de segurança (#61 — ver seção
"Pontos de controle RBAC na API" acima), fix de schema migration cache (#65,
não teve mudança de regra de negócio visível), skill de revisão diária de
erros de produção (#62, ferramenta nova — não mexe em regra de negócio),
fix da fila do certificador escondendo Ouro pendente de BIRD ID (ver
"Fila do certificador" acima e "Incidente" no `historico.md`).

### Pendências de DADO DE PRODUÇÃO

Exigem confirmação explícita do usuário na conversa atual antes de mexer —
é edição direta de dado de produção:

- **Endereços históricos sujos** (item 3 dos Incidentes): OS antigas com
  endereço da empresa gravado em `address` e `empresa_endereco` vazio.
- **Protocolos duplicados "A560"**: 4 pastas de dossiê exportadas em produção
  com o mesmo protocolo. A causa foi corrigida no `924ec20` (#44), mas os
  registros e pastas já duplicados não foram corrigidos.

### Pendências de código/produto

Verifique antes se um commit recente já não resolveu:

- `public/manual.html`: atualizado no #55 pro fluxo de BIRD ID/SYNC + A1
  .zip e pras novas regras de RBAC/tarefas — mas confira de novo se o fluxo
  avançou desde então.
- Push notification real: ver seção própria acima — implementada, não é
  mais item pendente.
- Da auditoria de segurança: limite de capacidade de "Projetos" é decorativo
  (não bloqueia de verdade); `terceiro` tem CRUD amplo demais sobre a lista
  global de Projetos; `ensureSchema()` cacheia promise que falhou (item 1 dos
  Incidentes).
- **Rate limiting de login — IMPLEMENTADO (24/07/2026), não é mais item
  pendente.** `src/lib/rate-limit.ts`: limiter em memória por janela
  deslizante, chave = IP (`login:{ip}`, via `getClientIp`). 8 tentativas
  malsucedidas em 10 minutos bloqueiam esse IP por mais 10 minutos (429 +
  header `Retry-After`); sucesso limpa o bucket do IP
  (`clearRateLimit`) — só falha conta. Aplicado só em
  `api/auth/login/route.ts` (o único endpoint de autenticação por
  senha do sistema). **Seguro em memória porque o PM2 roda
  `instances: 1`** (fork único, ver `ecosystem.config.js`) — se algum dia
  virar cluster/múltiplas instâncias, esse limiter precisa migrar pra algo
  compartilhado (Redis etc.), porque cada processo teria seu próprio Map
  e o limite real seria N processos × 8, não 8. Testado via curl direto:
  8 tentativas com senha errada devolvem 401, a 9ª devolve 429 mesmo
  com senha CORRETA (ainda bloqueado); IP diferente (`X-Forwarded-For`
  forjado) não é afetado pelo bloqueio do primeiro.

- **"Tela travada enviando" na correção de documento recusado — causa raiz era
  cache de versão antiga, não um bug de lógica novo (11/08/2026, relato real de
  captador):** captador tentou corrigir um documento recusado
  ("fora do padrão") pelo modal de reenvio (`update-modal`/`submitUpdate` em
  `captador.html`) e o botão "Enviando..." nunca terminava. Investigado: o
  sintoma exato ("botão fica em Enviando... indefinidamente") já tinha sido
  corrigido no `e0b9116` (14/07/2026) — `submitUpdate` já tem `AbortController`
  com timeout de 30s + reset do botão em qualquer erro (rede lenta, falha de
  leitura de arquivo etc.), e o endpoint server-side
  (`captador-update/route.ts`) é síncrono/rápido, sem nenhuma chamada externa
  que pudesse travar de verdade. Ou seja, **não havia bug de lógica ativo** —
  a causa mais provável é o captador estar com o app aberto no celular há
  muito tempo (PWA que nunca foi fechada/recarregada), rodando uma versão de
  `captador.html` anterior a essa correção. Causa raiz estrutural: `sw.js` usa
  cache-first pra `/captador.html` (ver `isCaptadorAsset`) e, embora
  `skipWaiting`/`clients.claim()` já façam o Service Worker trocar de versão
  sozinho em segundo plano a cada deploy, **a aba já aberta continua
  executando o JS antigo** até a página recarregar — não existia nenhum aviso
  pro usuário de que uma versão nova estava disponível (só a regra manual
  "avisar que precisa de hard refresh", que depende de alguém lembrar de
  avisar o captador em campo).
  - **Fix estrutural (não é só reafirmar o fix de 14/07):** `captador.html`
    ganhou detecção de atualização — captura `hadControllerAtLoad` (se a
    página já nasceu controlada por um SW) antes de registrar; se o
    `controllerchange` disparar depois com `hadControllerAtLoad` true (uma
    troca de versão de verdade em sessão já aberta, não a primeira instalação
    — a primeira também dispara `controllerchange` por causa do
    `clients.claim()`, por isso a distinção é necessária), mostra um banner
    fixo no topo ("🔄 Uma nova versão do app foi carregada" + botão "Atualizar
    agora" que chama `location.reload()`). Não recarrega sozinho — evita
    perder algo que o captador esteja digitando no meio de um formulário.
  - `sw.js` `CACHE_NAME` de `v12` pra `v13` (**necessário pra este fix
    chegar a quem já tem o app aberto — sem bump de versão, o SW não
    detecta o arquivo como mudado e o banner novo nunca seria baixado**).
  - **Se um relato parecido aparecer nesta tela ("trava enviando") de novo:**
    primeiro confirmar se o timeout de 30s de `submitUpdate` está mesmo
    presente na versão em produção (`grep -n "AbortController" 
    public/captador.html`) antes de assumir bug novo — é fácil reabrir
    investigação de um sintoma que já tem correção, só não propagada. A
    partir desta mudança, o próprio banner de atualização deve reduzir esse
    tipo de relato (usuário é avisado e pode atualizar sem precisar saber o
    que é "hard refresh").
  - Testado: `npx tsc --noEmit` limpo (mudança é só HTML/JS estático, não
    afeta rotas TS). Tentativa de E2E completo com Playwright
    (`chromium` headless) esbarrou numa limitação do próprio sandbox de
    teste — o Service Worker fica preso em `installing` nesse ambiente
    específico (sem indício de falha de rede real, mesma classe de
    limitação já documentada nesta skill pra autofill de senha do
    navegador) — validado por leitura de código e pela ausência de
    qualquer erro de console/`pageerror` ao carregar a página com o script
    novo.

## Como atualizar esta skill

Esta skill vive no repo — mantê-la atualizada faz parte de qualquer mudança,
não é opcional:

- Todo PR que muda regra de negócio, papel, fluxo ou aprende uma lição nova
  deve atualizar o `SKILL.md` no mesmo diff — inclusive o hash em "Último
  commit refletido nesta skill".
- Onde cada coisa mora: regra estável/invariante → seção correspondente do
  `SKILL.md`; história e decisões de escopo fechadas → `references/historico.md`;
  campo novo/alterado no `Dossier` → `references/campos.md`.
- Pendência nova: prefira abrir uma Issue no GitHub; registre aqui só o que é
  armadilha pra próxima sessão (dado sujo de produção, decisão pendente do
  usuário, comportamento contraintuitivo de propósito).
- Pode e deve podar: quando uma regra descrita aqui sair do código, remova-a
  daqui (registrando a lição no `historico.md` se ela valer a pena). Skill
  inchada e desatualizada é pior que skill curta e correta.
