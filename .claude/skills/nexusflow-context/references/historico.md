# Histórico do projeto NexusFlow

Linha do tempo condensada das decisões e marcos principais desde o início do
MVP. Referências a arquivo:linha de código antigo foram omitidas de propósito
— o código mudou muito desde então; use `grep`/`Read` pra achar o estado atual.
Datas aproximadas, ordem cronológica.

## Fase 0 — MVP local, custo zero (maio/2026)

- Decisão de abordagem: **low-code**, começar com custo ZERO pra validar com a
  Contex antes de investir em infra. MVP rodava sem nenhuma integração externa
  (A1/BIRD ID reais ficaram pra v2 — no início eram só campos manuais).
- Dados de acesso Gov.br sempre desenhados pra ficar visíveis só a papéis
  autorizados, mascarados, com log de auditoria — isso é um requisito de
  design desde o começo, não um adendo de segurança posterior.
- Backend inicial: JSON local (`src/lib/local_db.json`), zero custo de banco.
- Kanban com etapas T1 (risco) → T2 (cadastro) → T3/T4 (certificação BIRD
  ID/A1 + abertura) → Finalizado — os nomes visíveis E1-E4 vieram depois,
  numa reformulação de nomenclatura pro usuário final entender melhor.

## Bugs de infraestrutura local resolvidos (maio-junho/2026)

Esses já foram corrigidos, mas o padrão de causa vale lembrar caso algo
parecido apareça de novo:

- **Service Worker cacheando API antiga**: o `sw.js` tinha escopo `/` e
  cacheava toda resposta GET 200 same-origin, inclusive `/api/dossiers` —
  parecia que "o cadastro não caía no sistema" quando na real o dado existia,
  só não aparecia porque o dashboard servia a lista do cache. Fix definitivo:
  o service worker do captador (`public/sw.js`) hoje só intercepta os assets
  do captador (`isCaptadorAsset`) — nunca intercepta `/api/` nem o bundle do
  dashboard principal. Se alguém tocar em `sw.js` de novo, checar esse escopo.
- **Cache do Turbopack corrompido**: rodar `npm run build` com o `npm run dev`
  ainda ativo na mesma porta corrompe o `.next` (Jest worker/EPIPE) e faz
  rotas dinâmicas (`/api/dossiers/[id]/*`) caírem em 404 mesmo com código
  correto. Sintoma confunde muito porque `tsc`/`build` isolado passam limpo.
  Fix: matar o processo da porta, apagar `.next` e `node_modules/.cache`,
  subir o dev de novo. **Regra: nunca rodar build com o dev ativo.**
- **Tela travada pós-login / hydration mismatch**: extensões de tradução do
  navegador alteram `<html lang>` no cliente (en→pt), causando mismatch de
  hidratação do Next. Fix: `lang="pt-BR"` fixo + `suppressHydrationWarning`
  em html/body no `layout.tsx`. Sempre pedir hard-refresh (Ctrl+Shift+R) pro
  usuário depois de qualquer mudança de Service Worker — ele não troca sozinho.

## RBAC, uploads e geração de documento (início-junho/2026)

- Introdução de login real com sessão (inicialmente cookie base64 não
  assinado — depois evoluiu pra HMAC assinado, ver abaixo) e usuários fixos
  em `local_db.json`.
- `canWorkStep()` nasceu aqui como o gate central de quem pode agir em cada
  etapa — a função continua existindo hoje (em `page.tsx`), só ficou mais
  sofisticada (ver regras de isolamento por atribuição na skill principal).
- Gerador da OS de Abertura em `.docx` (`src/lib/os-abertura-doc.ts`, lib
  `docx@9`) seguindo o modelo real usado pela Contex. Teve retrabalho de
  formatação (tabela colapsava no Google Docs por usar % de largura em vez de
  DXA fixo — lição: sempre usar `TableLayoutType.FIXED` + larguras fixas em
  DOCX gerado programaticamente, célula percentual não é confiável entre
  visualizadores).
- Upload de anexos via `POST /api/dossiers/[id]/upload` (base64 → disco) +
  componente `FileAttach`, base do que hoje é o sistema de documentos por OS.
- SLA visual: badges de tempo restante/estourado nos cards do kanban, painel
  "Gargalos por Setor" pro gestor. Lógica em `src/lib/sla.ts` (funções puras).

## Modelo de dupla atribuição, sub-etapas e n8n (início-junho/2026)

- Aqui nasceram `resp_certificacao`, `resp_abertura`, `bird_id_done`,
  `abertura_done`, `a1_done` no Dossier — o modelo que a auditoria mais
  recente (ver skill principal) refinou bastante (isolamento por atribuição,
  gates de A1 por anexo em vez de checklist inteiro, etc).
- Regra original: Ouro = Abertura + A1 em paralelo (dois responsáveis
  trabalhando juntos); Prata = sequencial BIRD ID → Abertura → A1. Essa lógica
  de fundo continua válida hoje, só ficou mais precisa sobre QUANDO cada etapa
  libera (ver "Fluxo de trabalho" na skill principal).
- Integração com n8n criada (workflow "NexusFlow — Notificações & OS" na
  instância `n8n.mvhometech.com.br`) — webhook recebe eventos
  (`os_created`, `step_changed`, `sla_due`, e depois vários outros conforme o
  sistema cresceu) via `src/lib/notify.ts` (fire-and-forget, só dispara se
  `N8N_WEBHOOK_URL` estiver configurado no ambiente).

## Produção na VPS da Contex (10/06/2026)

Decisão de infraestrutura definitiva: VPS + domínio + Postgres fornecidos
pela própria Contex (não Vercel/Supabase) — acesso administrativo via
Cloudflare Zero Trust (Tunnel + Access com OTP por e-mail; desligar um
colaborador = só remover o e-mail autorizado, sem gerenciar senha de VPN).
Dossiês finalizados sincronizados via Syncthing pro servidor interno da
Contex (fora do escopo de credenciais desta skill).

Implementado nessa fase (ainda é a base do backend atual):
- `src/lib/db-postgres.ts`: backend Postgres ativado quando `DATABASE_URL`
  está setado, auto-provisiona schema e usuários padrão na primeira conexão.
  Datas armazenadas como TEXT em formato ISO (não `TIMESTAMP` nativo) — pra
  manter compatibilidade exata com o backend JSON de desenvolvimento.
- Hardening de autenticação: bcrypt via `bcryptjs` (com upgrade automático de
  senha legada em texto puro no primeiro login bem-sucedido), cookie de
  sessão assinado com HMAC-SHA256 (`JWT_SECRET`, expira em 12h).
- `UPLOADS_DIR` configurável (produção usa um caminho fora do diretório de
  build, ex. `/var/nexusflow/uploads`, pra sobreviver a deploys) servido por
  rota autenticada `/uploads/[...path]`.
- Ao finalizar uma OS (`empresa_aberta`), exportação automática do dossiê
  completo (DOCX + anexos + resumo) pra uma pasta nomeada
  `DOSSIES_DIR/{EMPRESA - PROTOCOLO}/`.
- Deploy via PM2 (`ecosystem.config.js`) + pipeline documentado em
  `deploy/DEPLOY.md`.

## Incidente de deploy silencioso (16/06/2026)

Um `GH_TOKEN` revogado quebrou o `git pull` no processo de deploy — mas o
script não checava o código de saída, então o GitHub Actions reportava
"sucesso" mesmo rodando build/restart em cima de código VELHO, por cerca de
1 hora, até alguém notar que as mudanças não apareciam no ar. Fix aplicado:
o workflow de deploy agora usa `set -e` e checa explicitamente que o `HEAD`
local bate com `origin/master` depois do pull, abortando (exit 1) antes de
buildar se não bater. **Esse é o mesmo tipo de falha silenciosa do health
check raso mencionado na skill principal — vale lembrar que "o pipeline
disse sucesso" não é garantia suficiente sozinha.**

## Incidente: fila do certificador escondia Ouro pendente de BIRD ID (10/07/2026)

Relato real do certificador e do gestor: a OS da cliente **Maysa Farias
Leal** não apareceu pro certificador fazer o A1, mesmo com o cartão CNPJ e
a Certidão de Inteiro Teor já anexados pela abertura. Causa raiz: o commit
`d6d2da9` (#54) mudou `a1ReadyOf` pra exigir `bird_id_done` também pro nível
Ouro (regra nova: os dois níveis precisam do e-CPF antes do A1), mas só
tocou essa uma função — `getCertColumnDossiers` (membership da fila),
`ativa()` (bucket "trabalho ativo" vs "aguardando") e `certBadges` (o badge
"🆔 BIRD pendente") continuaram checando `gov_level === 'prata'`
isoladamente, herdado de quando só Prata precisava de BIRD. Resultado: uma
OS Ouro sem BIRD feito nunca entrava na fila do certificador — nem pra
fazer o próprio BIRD ID — e nem o badge que avisaria isso aparecia. Ninguém
recebia notificação de nada estar "preso"; a OS simplesmente ficava
invisível pro papel que precisava agir nela.

Fix: unificada a regra de fila/bucket/badge pros dois níveis (ver
`SKILL.md`, seção "Fila do certificador"). Lição pro padrão de trabalho:
quando uma regra de negócio muda um predicado central (`a1ReadyOf`,
`canWorkStep`, etc.), sempre `grep` por TODOS os lugares que replicam a
mesma condição em vez de reusar a função (aqui, `gov_level === 'prata'`
aparecia em 3 lugares diferentes fazendo a mesma pergunta de formas
ligeiramente distintas) — nenhum teste automatizado pega esse tipo de gap
porque não existe suíte de testes no projeto; só descoberto por relato
manual de usuário em produção.

## Incidente: 4º lugar com o mesmo `gov_level === 'prata'` isolado — painel de ação, não só a fila (10/07/2026)

Segunda ocorrência do MESMO padrão do incidente acima, num lugar diferente
que o `grep` da correção anterior não cobriu porque a busca focou nos 3
pontos da FILA (membership/bucket/badge) — havia um **4º lugar**, o painel
de AÇÃO dentro do detalhe da OS: `isEarlyBirdEligible` (bloco "BIRD ID
antecipado", `page.tsx`, dentro do card da OS) exigia `gov_level ===
'prata'` pra liberar o certificador agir no BIRD ID enquanto a OS ainda
está em T2 (antes da Abertura empurrar pra T3). Relato do gestor: "cadastros
com e-mail e número já atribuídos [pelo terceiro] que não avançaram pro
certificador" — a causa real: pra Ouro, a fila (já corrigida) mostrava a OS
como disponível (`ativa()` não depende do nível), o certificador abria a OS
e via só "🔒 Somente leitura", porque o painel que de fato libera a ação
(`isEarlyBirdEligible`) continuava tratando só Prata como elegível pra
adiantar o BIRD ID em T2. Uma vez que a Abertura empurra a OS pra T3, o
bloco normal (`birdStep`/`a1Step`, dentro de `canWorkStep('t3')`) já era
level-agnostic — o buraco só existia na janela "vínculo pronto, mas ainda
em T2".

Fix: removida a restrição `gov_level === 'prata'` de `isEarlyBirdEligible`;
mesma correção no card do dashboard do certificador que só contava "BIRD ID
Pendente" pra Prata.

**Lição adicional** (além do "grep todos os lugares" do incidente anterior):
quando o predicado de negócio muda, não basta corrigir os pontos de
MEMBERSHIP/VISIBILIDADE (quem vê o quê na fila) — precisa também caçar os
pontos de AÇÃO (o que a pessoa consegue efetivamente fazer ao abrir o
item), que costumam ficar em outro lugar do arquivo (aqui, ~1500 linhas de
distância) e não aparecem numa busca só por `getCertColumnDossiers`/`ativa`/
`certBadges`. `grep -n "gov_level === 'prata'"` no arquivo inteiro antes de
declarar a correção completa.

## Incidente: painel "BIRD antecipado" (T2) escondia os dados já preenchidos assim que concluído (10/07/2026)

3º bug no mesmo painel (`isEarlyBirdEligible`), depois da correção Prata/Ouro
acima. Relato do gestor: "não está aparecendo as informações do BIRD (e-CPF)
e nem A1 (e-CNPJ) após serem anexados ou os dados preenchidos". Investigado:
o painel inteiro (incluindo a seção "Dados de Acesso à Certificação" —
certificadora, sistema usado, aparelho, e-mail) só renderizava quando
`!bird_id_done` — ou seja, assim que o certificador clicava "Concluir BIRD
ID" ainda em T2 (a janela que o incidente anterior liberou), TODO o bloco
sumia da tela, inclusive os dados que ele mesmo tinha acabado de preencher e
salvar. Não era um bug de gravação (os dados estavam certinhos no banco,
confirmado via API) — era um bug de onde exibir esse dado de volta: o único
lugar que mostrava esses campos ficava condicionado a "ainda não concluído".

Fix: separado `isEarlyBirdWindow` (mostra o painel — status + dados de
acesso — independente de `bird_id_done`) de `isEarlyBirdEligible` (mostra
especificamente o formulário/botão de conclusão, só quando ainda pendente).

Same pedido trouxe uma mudança de RBAC deliberada (não um bug): o
`operador_abertura` passou a ver os dados do BIRD ID/SYNC (e-CPF) em modo
somente leitura (certificadora/sistema/aparelho/e-mail/status) dentro da
aba Trabalho — nunca dados de A1, que continua 100% fora do alcance dele
(nem arquivo, nem status, nem nada). Ver bloco `!canDoCert && currentRole
=== 'operador_abertura'` logo antes do formulário `canDoCert` de "Dados de
Acesso à Certificação".

**Lição**: "os dados não aparecem" pode ser um bug de GRAVAÇÃO (dado nunca
chegou a persistir) ou um bug de EXIBIÇÃO (dado persistiu certinho, só não
tem onde ser mostrado de volta pro papel certo, ou some quando algum estado
como "concluído" muda). Sempre confirmar via API/banco antes de assumir
qual dos dois é — aqui era puramente exibição, a gravação nunca esteve
quebrada.

## Incidente: healthcheck do deploy dava falso-positivo e o rollback ficava pela metade (10/07/2026)

Relato do usuário: "não vejo os certificados em produção, desconfio que a
mudança não foi feita". Investigado via `mcp__github__actions_list` +
`get_job_logs` (não assumido — conferido log por log). Achado real, **duas
vezes na mesma noite** (deploys de #70 e de outro merge logo depois): o
deploy pull+build+`pm2 restart` rodava limpo, mas o healthcheck
(`deploy.yml`) só dava `sleep 10` e testava UMA vez — 10s às vezes não é
suficiente pro processo novo do PM2 (modo fork) responder, e o healthcheck
recebia HTTP 500/000 por pura lentidão de boot, não por bug de verdade.
Isso disparava rollback automático — e o rollback tinha um bug próprio:
tentava `npm run build` de novo sem limpar o cache/lock do Turbopack
(`.next/`) deixado pelo build anterior (bem-sucedido), e falhava com
`Another next build process is already running`. Resultado: o rollback
ficava pela metade — `git checkout` voltava pro commit antigo, mas o
`pm2 restart` de volta pro código antigo NUNCA rodava (o script já tinha
morrido no `npm run build` que falhou) — então o PM2 continuava, na
prática, servindo a build NOVA (a que tinha acabado de passar no restart),
enquanto o working tree em disco ficava desatualizado. Essa inconsistência
dura até o próximo push corrigir tudo de novo com um fast-forward limpo.

Fix (`deploy.yml`): healthcheck agora tenta por até 30s (retry a cada 3s,
para no primeiro 200) em vez de um único `sleep 10` + 1 tentativa; e o
caminho de rollback faz `rm -rf .next` antes de reconstruir, garantindo
build limpo sem risco do lock preso.

**Lição**: quando o usuário relata "não vejo a mudança em produção" logo
depois de vários merges seguidos numa mesma sessão, checar os logs reais do
deploy (`actions_list` + `get_job_logs`, method `get`/`list_workflow_jobs`)
antes de assumir que é um bug de código ou de cache do navegador — pode ser
o próprio pipeline de deploy que ficou instável no meio do caminho. "O
pipeline disse sucesso" (ou até "falha" seguida de outro "sucesso") não
conta a história inteira sozinho; ler o log de cada job envolvido sim.

## Incidente: dados de certificação sumiam pra sempre assim que a empresa era finalizada (11/07/2026)

4º incidente no mesmo painel de certificação (depois dos 3 documentados
acima), e o mais grave: relato "pelo celular não aparecem as informações
de certificado (e-CPF/e-CNPJ) quando a empresa é aberta... não aparecem
lugar nenhum". Investigado: o usuário mencionou celular, mas o bug não
tinha nada a ver com responsividade — era universal, em qualquer
dispositivo, pra qualquer papel.

Causa raiz: o bloco "SE SETOR FOR T3/T4" em `page.tsx` (que contém
`birdStep`/`a1Step`/`aberturaStep` e a seção "Dados de Acesso à
Certificação" — o ÚNICO lugar do sistema com certificadora, sistema
usado, aparelho, e-mail do certificado e o arquivo do A1) só renderizava
com `selectedOS.current_step === 't3'`. Assim que uma OS terminava com
sucesso (o desfecho NORMAL e ESPERADO de toda empresa aberta),
`current_step` virava `'finalizado'` — e o bloco inteiro desaparecia
permanentemente. Ou seja: **toda empresa aberta com sucesso perdia acesso
aos próprios dados de certificação exatamente no momento em que o processo
terminava** — o pior timing possível, já que é quando mais se precisa
consultar essa informação (repassar credencial, baixar o A1 pra
contabilidade mensal).

Fix: condição ampliada pra `current_step === 't3' || current_step ===
'finalizado'`. Seguro porque `canWorkStep('t3')` (o gate de permissão
dentro do bloco) é chamado com a STRING FIXA `'t3'`, não com o step real
da OS — então isso não libera nenhuma ação nova pra ninguém. Os botões de
"Concluir X" já ficam escondidos sozinhos porque `birdDone`/
`aberturaDone`/`a1Done` já são `true` numa OS finalizada de verdade
(regra de negócio: só finaliza depois de tudo concluído). Escondido à
parte, por não fazer sentido mais: o widget "Agendar Certificação"
(datepicker do gestor/admin) numa OS já concluída.

**Lição**: quando um bloco de UI depende de `current_step` pra decidir SE
renderiza (não só o que renderiza dentro), sempre perguntar "e depois que
esse step termina, pra onde vai esse dado?" — um estado terminal
(`finalizado`) não é "mais um step qualquer", é o desfecho de TODOS os
fluxos anteriores, e qualquer informação que só existisse condicionada a
um step intermediário vira inacessível pra sempre a partir dali. Vale
auditar se existe algum outro dado no sistema com esse mesmo padrão de
risco (gated só por step intermediário, sem re-exposição no estado
terminal).

## Incidente: mesmo o listPool ainda não listava OS finalizada, e contagem de "concluídos" divergia do topo (11/07/2026)

Depois do fix acima (dados de certificação re-expostos numa OS finalizada),
o gestor continuou reportando "não aparecem os dados do BIRD/A1" —
inicialmente parecia o mesmo bug recorrendo. Na real era um QUINTO lugar
com o mesmo padrão: `getCertColumnDossiers()` (a fila que alimenta a
própria tela de Certificação) exclui `current_step === 'finalizado'` de
propósito, por ser fila de TRABALHO ativo — só que isso também significa
que uma OS finalizada nunca aparecia listada ali, então não tinha como
chegar nela clicando a partir da tela que o gestor realmente usa no
dia-a-dia. Motivou o redesenho pra lista única paginada (`listPool` =
`getCertColumnDossiers()` ∪ OS finalizadas com BIRD/A1 feito — ver
`SKILL.md`).

Nesse mesmo redesenho apareceu um bug de contagem: `statusOf` classificava
como "concluído" só quando BIRD **e** A1 estavam feitos
(`certConcluida`), enquanto os contadores do topo da tela
(`birdsFeitos.length`/`a1sFeitos.length`) contam qualquer certificação
feita, uma a uma. Resultado: a aba "Concluídos" mostrava 3, o topo dizia
outro número maior. Fix: trocar o `&&` implícito por `||`
(`d.bird_id_done || d.a1_done || d.current_step === 'finalizado'`).

**Lição (reforça a de cima):** "está listado" e "está com dado
visível/preenchido" são dois bugs diferentes, mesmo quando parecem o
mesmo relato do usuário — sempre confirmar qual das duas coisas está
quebrada antes de aplicar o fix da última vez. E: qualquer contador/filtro
novo que meça "quantos concluídos" deve ser comparado contra os
contadores já existentes na mesma tela antes de considerar pronto —
divergência entre eles é sinal de bug de critério, não "são coisas
diferentes mesmo".

## Incidente: aba "Concluídos" da tela Certificação sempre vazia — typo de singular/plural entre dois union types (11/07/2026)

6º bug real no mesmo painel (contando os 5 documentados acima). Relatado
pelo certificador ("teo"): "não aparece nada quando clica no filtro".
Passou despercebido em TODAS as sessões de teste anteriores (incluindo as
que testaram visualmente com Playwright, ver incidentes acima) porque
ninguém prestou atenção ao número entre parênteses ao lado da aba
"Concluídos" — os screenshots já mostravam "Concluídos (0)" desde o
redesenho original (PR #80), inclusive nos screenshots tirados pra validar
OUTRAS mudanças (destaque de nome, paginação), sempre com linhas
visivelmente concluídas (badge "✓ 10/07") logo abaixo do "(0)".

Causa raiz: `certListViewTab` (estado) e a `key` de cada aba no array
`tabs` usam a string **`'concluidos'`** (plural — coerente com o nome da
variável e das outras chaves `'todos'`/`'andamento'`/`'livre'`). Mas a
função `statusOf(d)` retornava **`'concluido'`** (singular) pro mesmo
caso. `listPool.filter(d => statusOf(d) === t.key)` e
`listPool.filter(d => statusOf(d) === certListViewTab)` nunca batiam —
`'concluido' !== 'concluidos'` — então a contagem da aba e a lista
filtrada ficavam sempre vazias, pra QUALQUER papel (gestor e
certificador), desde o commit que introduziu o redesenho. TypeScript não
pegou o erro porque são dois union types de string literal distintos,
sem relação declarada entre si — comparar um contra o outro com `===` é
válido pro compilador mesmo sem nenhum literal em comum.

Fix: unificado pra `'concluidos'` (plural) em `statusOf` e nos dois
lugares que comparavam contra o valor antigo (`status !== 'concluido'`
na renderização da linha).

**Lição:** quando dois `useState`/union types precisam concordar em
valores (uma função classifica, um estado filtra pelo mesmo valor),
considerar declarar UM tipo só e reusar (`type CertStatus = ...`) em vez
de escrever a union duas vezes — o TypeScript não avisa sobre comparação
`===` entre literais de unions diferentes mesmo quando nenhum valor em
comum existe de verdade. E: **sempre ler os números entre parênteses nos
screenshots de teste, não só a lista visível** — o "(0)" estava lá desde
o primeiro screenshot desta sessão inteira e ninguém (inclusive esta IA)
reparou até o usuário reportar "não aparece nada ao clicar no filtro".

## Decisões explícitas de escopo (16/06/2026, confirmadas em call com o Dm)

Estes pontos foram revisados e **deixados de propósito como estão** — não são
gaps esquecidos, são decisões conscientes de priorização:
1. Quem define o agendamento de certificação: hoje só gestor/admin cria/edita
   o agendamento; o certificador só visualiza/gerencia o próprio dentro de
   regras específicas. O Dm disse explicitamente "ainda não decidido" sobre
   abrir mais autonomia aqui — **não mudar isso sem validação dele.**
2. Identificador de aparelho/chip da certificação (`cert_aparelho`) continua
   texto livre — ideia de padronizar (ex. "China 1/China 2") ficou pra depois.
3. Gestão financeira de comissões/valores por CPF/CNPJ é explicitamente
   **fase 2** ("segundo momento") — fora do escopo do MVP e de qualquer
   trabalho atual, a menos que o usuário abra essa frente explicitamente.

## Onde estava o projeto até a sessão de auditoria mais recente

A partir daqui, o histórico mais detalhado (isolamento por atribuição, fila
de certificação reescrita por regra de negócio, Lixeira, terceiro isolado,
bug histórico de endereço, skill de contexto) está na seção principal da
skill (`SKILL.md`), que é o resumo mais atual e vivo — este arquivo é só o
"como chegamos até aqui".
