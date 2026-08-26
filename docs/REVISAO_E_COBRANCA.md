# NexusFlow — Revisão de Ponta a Ponta (Código, Segurança e Aderência ao PRD) + Guia de Cobrança

> Data: 2026-06-21 · Base: branch `claude/affectionate-pasteur-eeu698` · PRD: `NexusFlow - Sistema.docx`

Este documento tem três partes:
1. **Aderência ao PRD** — o que foi entregue, o que falta e o que foi além do escopo.
2. **Revisão de segurança e código** — achados priorizados com arquivo:linha e correção sugerida.
3. **Guia de cobrança** — proposta comercial estruturada a partir do seu plano (R$ 2.000 + R$ 400/mês).

---

## 1. Aderência ao PRD

### 1.1 Entregue e funcional ✅

| # PRD | Requisito | Onde |
|------|-----------|------|
| 1, 18 | Página Captador HTML + offline (Service Worker, retry) | `public/captador.html`, `public/sw.js` |
| 2 | Geração automática de OS na captação | `src/app/api/captacao/route.ts` |
| 3 | Dossiê com documentos e metadados | `src/lib/db.ts`, `/api/dossiers/[id]` |
| 4 | T1 — checklist de risco + decisão Verde/Vermelho com justificativa | `src/app/page.tsx` |
| 5 | Bifurcação Gov Prata → BIRD ID (T3) / Gov Ouro → T2 | fluxo de `current_step` |
| 6 | T2 — complemento cadastral (e-mail/telefone novos) | `t2_new_email`, `t2_new_phone` |
| 8 | Fluxos de certificação Ouro/Prata (BIRD ID, A1) | sub-etapas `bird_id_done`, `a1_done`, `abertura_done` |
| 10 | Upload de A1, Documento B, comprovante CNPJ; marcar "Empresa Aberta" | `/api/dossiers/[id]/upload`, `empresa_aberta` |
| 12 | Dashboard do gestor (Kanban por setor, SLA, gargalos) | `src/app/page.tsx`, `src/lib/sla.ts` |
| 13 | Histórico/audit log por OS | `Database.createLog` |
| 14 | Notificações automáticas — base/hooks de n8n prontos | `src/lib/notify.ts`, `notifications.ts` |
| 16 | Exportação de dossiê (DOCX + anexos + ZIP) | `dossie-export.ts`, `/files-zip` |
| 17 | Criptografia em repouso de dados sensíveis (AES-256-GCM) | `src/lib/crypto.ts` |
| 21 | RBAC — 9 papéis | `src/lib/auth.ts`, `defaultUsers()` |

### 1.2 Parcial / divergente ⚠️

- **#14 Cobrança de SLA por e-mail e WhatsApp**: a base/hooks de n8n existem (`notify.ts`, `notifications.ts`), mas o **envio real por e-mail e WhatsApp ainda será implantado** (feature planejada, não defeito).
- **#9 Integração real BIRD ID / A1**: hoje é **manual** (operador marca etapas e faz upload). Não há chamada de API ao provedor de certificado. PRD coloca como *Must have* na integração básica.
- **#15 OCR**: não implementado (sem Tesseract/Vision). Era *Could have* no MVP, *Should* na Fase 2.
- **#19 Relatórios/métricas** (conversão por etapa, tempo médio, taxa de recusa por motivo): só parcial via dashboard de SLA; não há tela de relatórios/export CSV.
- **#24 Anexos grandes (até 50 MB)**: uploads usam **data URL base64 em JSON** — ineficiente, infla payload ~33% e não há upload resumível (tus/multipart). Risco real de estourar limite de body em arquivos grandes.
- **Masking de CPF na UI**: a revelação de senha exige permissão (OK), mas o CPF não é mascarado parcialmente conforme PRD pede ("mostrar CPF parcialmente").
- **Animações**: Framer Motion presente; GSAP/Lottie do PRD não entraram (não crítico).

### 1.3 Não implementado (planejado p/ fases futuras) ❌

- **#11/#20 API pública/terceiros restritos**: papel `terceiro` existe, mas não há endpoint/escopo que limite o terceiro a ver só e-mail/número/CNPJ (ver achado de segurança S-04).
- **MFA** para papéis sensíveis (PRD, segurança).
- **#25 Backup multi-região / DR** (depende de infra na VPS).
- Open banking / antecedentes via API, QR DNI automatizado, risk scoring ML (Fase 3).

### 1.4 Além do PRD (entregue a mais) 🎁

Funcionalidades construídas que **não estavam no PRD** e agregam valor (relevante para a cobrança):

- **Central de Agendamentos de Certificação** com slots de 30 min, cancelar/reagendar.
- **Manual interativo completo** filtrado por papel (`public/manual.html`).
- **OS de Abertura em DOCX** no modelo da Contex (`os-abertura-doc.ts`).
- **Protocolo sequencial** (A560, A561…) sincronizado com o celular do e-commerce.
- **Contador de abertura** atribuível (João/Kely/Arnaldo).
- **Espelhamento de arquivos em pasta de rede interna** (`NEXUS_FILES_DIR`) e export do dossiê para a pasta da empresa na finalização.
- **Upload de antecedentes criminais** e busca por código do aparelho.
- **Dois backends plugáveis** (JSON local e PostgreSQL) sob a mesma interface.

---

## 2. Revisão de Segurança e Código

> **Status (2026-06-21):** os itens **S-01, S-02, S-03 e S-05 foram CORRIGIDOS** nesta branch (commit de hardening). O **S-04 foi reclassificado como comportamento esperado** — o terceiro é o responsável pela empresa e deve acessar os dados do dossiê/empresa (celular/identificador, e-mail e número cadastrados). As cobranças de SLA por **e-mail e WhatsApp** ainda **não estão configuradas** — são features planejadas, não defeitos.

### 🔴 CRÍTICO

**S-01 ✅ CORRIGIDO — Endpoints de dossiê sem autenticação (IDOR / vazamento de dados de cliente)**
`src/app/api/dossiers/[id]/route.ts` — `GET` (linha 12) e `PATCH` (linha 44) **não chamam `getSessionFromRequest`**. Qualquer pessoa na internet que conheça/adivinhe um ID de OS pode:
- **Ler** o dossiê completo + toda a trilha de auditoria (`GET`);
- **Alterar** status, etapa, CNPJ, gravar senhas de certificação e marcar "Empresa Aberta" (`PATCH`).

Os IDs são `Math.random().toString(36)` de 7 chars (`db.ts:163`) — **não criptográficos e enumeráveis**. O `DELETE` da mesma rota valida sessão, mas GET/PATCH não. **Isto é exposição direta de dados pessoais sensíveis (LGPD).**

> Correção: exigir sessão em GET/PATCH; aplicar whitelist de campos no PATCH (ver S-06); usar `crypto.randomUUID()` para IDs.

**S-02 ✅ CORRIGIDO — Upload de anexos sem autenticação**
`src/app/api/dossiers/[id]/upload/route.ts` (`POST`, linha 66) não verifica sessão. Qualquer um anexa arquivos a qualquer OS (defacement / armazenamento abusivo / phishing com PDF malicioso servido pelo domínio).

> Correção: exigir sessão e bloquear papéis `captador`/`terceiro`.

**S-03 ✅ CORRIGIDO — Mais endpoints de OS sem sessão**
- `/api/dossiers/[id]/os-abertura` (`GET`) — gera/baixa a OS de Abertura em DOCX de qualquer OS sem login.
- `/api/dossiers/[id]/alert-sla` (`POST`) — dispara notificações/e-mails de qualquer OS sem login (abuso/spam em nome da empresa).

> Correção: exigir sessão (e papel adequado) em ambos.

### 🟠 ALTO

**S-04 — ⓘ Reclassificado: comportamento esperado (não é falha)**
Decisão do cliente (2026-06-21): o `terceiro` é o **responsável pela empresa** e precisa acessar os dados do dossiê/empresa — incluindo o **celular cadastrado (identificador)**, o **e-mail cadastrado** e o **número cadastrado**. Portanto o acesso de leitura do terceiro é intencional. Mantida apenas a exigência de **login** (resolvida no S-01) e a proibição de **editar/excluir** a OS.

**S-05 ✅ CORRIGIDO — Segredos com fallback inseguro em produção (não falham, só logam)**
`auth.ts` e `crypto.ts`: se `JWT_SECRET`/`GOV_ENCRYPTION_KEY` faltarem em produção, o sistema **continuava rodando** com chaves de dev que estão **no código-fonte**. Agora ambas as funções **lançam erro e abortam** em `NODE_ENV==='production'` quando a chave está ausente/fraca.

**S-06 — Mass assignment no PATCH (backend JSON)**
`db.ts:254` faz `{ ...dossier, ...updates }` sem whitelist. Via S-01, dá para sobrescrever qualquer campo. (No Postgres há whitelist `ALL_FIELDS`, mas o modo JSON é o default e o usado em parte das instalações.)

> Correção: whitelist de campos atualizáveis também no backend JSON.

**S-07 — Sem rate limiting / proteção contra força bruta**
- `/api/auth/login` aceita tentativas ilimitadas (sem lockout/backoff) — `login/route.ts`.
- `/api/captacao` é público e sem throttle/captcha → spam de OS e enchimento de disco com base64.

> Correção: rate limit por IP (ex.: middleware + contador em memória/Redis) e captcha no captador.

### 🟡 MÉDIO

- **S-08 — Sem `middleware.ts` central.** A autenticação é feita rota a rota; foi justamente aí que S-01/S-02/S-03 escaparam. Um middleware que exija sessão em `/api/**` (exceto `login`, `health`, `captacao`) seria defesa em profundidade.
- **S-09 — `gov_2fa_disabled` obrigatório** na captação (`captacao/route.ts:53`): o fluxo exige desativar a verificação em duas etapas do gov.br do cliente e guardar login/senha. É um requisito de negócio, mas é **dado altamente sensível** — reforça a necessidade de S-05 (criptografia real) e de logs de acesso (já existe em `reveal`). Documentar base legal/consentimento LGPD.
- **S-10 — `reveal` sem escopo por OS:** qualquer usuário de papel permitido revela a senha de **qualquer** cliente. É auditado (bom), mas considere restringir ao responsável da OS.
- **S-11 — Cookie de sessão:** falta flag `secure` explícita (depende de HTTPS na frente). Em produção (HTTPS) adicionar `secure: true`.
- **S-12 — `local_db.json` em texto** no disco da VPS guarda PII (CPF, e-mail, telefone). Garantir permissões de FS restritas e backup criptografado.

### 🟢 BOAS PRÁTICAS JÁ PRESENTES

- AES-256-GCM correto (IV aleatório, authTag) com migração de legado — `crypto.ts`.
- Sessão assinada com HMAC e `timingSafeEqual` — `auth.ts:51`.
- bcrypt com migração de senhas legadas no login.
- SQL parametrizado no Postgres (`$1…`) e whitelist de colunas.
- Proteção contra path traversal no serving de uploads — `storage.ts:33`.
- Segredos e `local_db.json` no `.gitignore`.
- Senhas removidas das respostas de lista/detalhe; revelação auditada.

### Qualidade de código / dívida técnica

- `src/app/page.tsx` com **3.296 linhas** — concentra toda a UI; difícil de manter/testar. Recomenda-se quebrar em componentes por papel/aba.
- **Sem testes automatizados** (nenhum arquivo de teste) e sem CI de typecheck/lint além do deploy.
- Credenciais default fracas em `defaultUsers()` (`admin/admin123` etc.) — OK para dev (autoseed desligado em prod), mas confirmar que **não** foram para produção.
- Uploads via base64 em vez de multipart — custo de memória/banco.

---

## 3. Guia de Cobrança

> Seu ponto de partida: **R$ 2.000 de implementação + R$ 400/mês de suporte e otimizações.**
> Recomendação: manter a entrada acessível, mas estruturar em escopo claro + parcelas, porque o sistema entregue já vai **além do PRD** e lida com **dados sensíveis (LGPD)** — isso justifica e protege o valor.

### 3.1 O que o cliente está recebendo (resumo de valor)

Sistema completo de onboarding contábil em produção (https://app.validafluxo.com.br): fluxo Captação→T1→T2→T3/T4→Finalizado, dossiê digital, Kanban por setor, dashboard de SLA, RBAC com 9 papéis, criptografia de credenciais, auditoria, captador offline (PWA), geração de OS/dossiê em DOCX, central de agendamentos e manual interativo. Backend pronto para JSON local **ou** PostgreSQL.

### 3.2 Proposta — Implantação (entrada)

**Implantação e ativação: R$ 2.000** (pode ser 1+1 ou 2x sem juros)

> **Nota de infraestrutura:** a **hospedagem, o domínio e a VPS são da própria Contex**. Você **desenvolveu a solução, implantou e faz o gerenciamento de tudo** (deploy, banco, ambiente, segredos, manutenção). A cobrança é sobre **desenvolvimento + implantação + gestão técnica** — não há repasse de custo de hospedagem.

Inclui:
- Implantação da solução no ambiente da Contex (deploy, configuração do app sobre a VPS/domínio existentes).
- Migração para PostgreSQL e definição de variáveis de ambiente seguras (`JWT_SECRET`, `GOV_ENCRYPTION_KEY`).
- Cadastro de usuários reais e papéis (troca das senhas default).
- **Pacote de correções de segurança críticas** (S-01, S-02, S-03, S-05 — já aplicadas nesta branch).
- Treinamento (1 sessão) + entrega do manual.

> Observação honesta: R$ 2.000 está **abaixo do valor de mercado** para o escopo entregue (um sistema desse porte custaria, sob encomenda, faixa de R$ 15–40 mil). Se o preço já foi combinado, vale registrar isso como "valor promocional/parceria" na proposta para ancorar futuros projetos.

### 3.3 Proposta — Suporte mensal (recorrência)

**Mensalidade: R$ 400/mês** — sugiro vender como **plano com escopo definido** (evita virar suporte ilimitado):

Inclui por mês:
- **Gestão técnica do ambiente** (deploy, banco, monitoramento, backups e disponibilidade) — a infra é da Contex, mas quem opera e mantém é você.
- Correção de bugs e pequenos ajustes (até ~4h/mês).
- 1 melhoria/otimização pequena por mês.
- Suporte por canal combinado (horário comercial), SLA de resposta em até 1 dia útil.

Não inclui (vira projeto à parte — ver 3.4): novas integrações, novos módulos, mudanças estruturais.

### 3.4 Roadmap de evolução (vendas futuras / upsell)

Itens do PRD ainda não entregues, ótimos para orçar separadamente:

| Item | Valor sugerido (faixa) |
|------|------------------------|
| Integração real BIRD ID + Certificado A1 (API) | R$ 3.000 – 6.000 |
| OCR de documentos (extração automática) | R$ 2.000 – 4.000 |
| Módulo de relatórios/métricas + export CSV | R$ 1.500 – 3.000 |
| Portal restrito do Terceiro (e-commerce) | R$ 1.500 – 3.000 |
| API pública para ERP/e-commerce | R$ 2.500 – 5.000 |
| MFA + endurecimento LGPD completo | R$ 1.500 – 3.000 |

### 3.5 Modelo de texto para a proposta

> **Proposta NexusFlow — Contex Contabilidade**
> 1. **Implantação e ativação:** R$ 2.000 (entrega em produção no ambiente da Contex, migração para PostgreSQL, segurança e treinamento).
> 2. **Suporte e otimizações:** R$ 400/mês (gestão técnica do ambiente, backups, correções, até 4h de ajustes e 1 melhoria/mês).
> 3. **Evoluções sob demanda:** orçadas por projeto (ver roadmap).
> Condições: mensalidade com fidelidade mínima de X meses; reajuste anual pelo IPCA; pagamentos via [forma].

### 3.6 Recomendação final de precificação

- **Antes de cobrar a implantação como "concluída", fechar os achados críticos (S-01 a S-05).** Entregar com endpoints abertos a dados de clientes é risco de LGPD para você e para a Contex.
- Manter R$ 2.000 / R$ 400 se já combinado, **mas deixar registrado o escopo** (3.2/3.3) para que suporte não vire balcão infinito.
- Usar o roadmap (3.4) como pipeline de receita: o sistema tem espaço claro para mais 5–6 projetos pagos.

---

## 4. Plano de ação sugerido (ordem)

1. ✅ **Feito:** S-01, S-02, S-03 (exigir sessão) e S-05 (falhar sem segredos em prod) — aplicados nesta branch.
2. **Semana 1:** S-06 (whitelist JSON), S-07 (rate limit) e `middleware.ts` (S-08). (S-04 reclassificado como esperado.)
3. **Backlog:** refatorar `page.tsx`, adicionar testes/CI, masking de CPF, migrar uploads para multipart.
4. **Features planejadas (cobráveis):** envio real de SLA por e-mail e WhatsApp.
</content>
</invoke>
