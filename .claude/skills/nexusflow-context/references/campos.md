# Glossário dos campos do `Dossier`

Fonte da verdade: `interface Dossier` em `src/lib/db.ts` (espelhada em
`db-postgres.ts` com auto-migração `ALTER TABLE ADD COLUMN IF NOT EXISTS`).
Este glossário resume **o que cada campo significa, quem escreve e quando** —
consulte antes de grepar/editar campos em `page.tsx`. Se um campo daqui não
existir mais no código (ou existir um novo que não está aqui), o código
ganha; atualize este arquivo no mesmo PR.

## Identidade e fluxo

| Campo | Significado |
|---|---|
| `client_name`, `cpf`, `phone`, `email` | Dados do cliente, capturados pelo captador. CPF é chave de duplicidade: captação recusa (409) CPF já ativo. |
| `address` | Endereço **PESSOAL do cliente** (usado no BIRD ID; obrigatório pro nível Prata avançar E2→E3). NÃO confundir com `empresa_endereco`. |
| `status` | Sub-estado fino (`captado`, `t1_pendente`, `t1_verde`, `t1_vermelho`, `t2_pendente`, `t3_bird_id`, `t3_abertura`, `t4_a1`, `finalizado`, `cancelado`). |
| `current_step` | Etapa macro (`captacao`, `t1`..`t4`, `finalizado`). UI mostra E1–E4. E3 e E4 compartilham `t3` (sub-fluxos paralelos). |
| `protocolo` | Identificador oficial gerado na finalização (vínculo e-commerce). Único pra sempre — `getNextProtocolo()` considera até excluídos (#44). Nunca regerar/alterar um já emitido. |
| `empresa_aberta` | Flag de finalização. Forçada `true` pelo backend em QUALQUER transição pra `finalizado`; resetada se a OS voltar de etapa (#46). Dispara exportação do dossiê. |
| `deleted_at` | Soft-delete (Lixeira). Listagens normais filtram por ele. |
| `created_at` / `updated_at` | Timestamps ISO em TEXT (compatibilidade com backend JSON). |

## Atribuições (quem trabalha a OS)

| Campo | Significado |
|---|---|
| `captured_by` | Captador dono da OS. Gestor/admin têm override nos endpoints do captador (#45). |
| `assigned_to` | Operador responsável nas etapas E1/E2 (atribuído pelo gestor). |
| `resp_abertura` | Responsável pela abertura (E3). Filtra tudo que o `operador_abertura` vê. Sem auto-atribuição — sempre manual ou o operador assume OS livre (#42). |
| `resp_certificacao` | Responsável pela certificação (E4). Mesma regra de atribuição manual. |
| `terceiro_responsavel` | Conta `terceiro` (parceiro e-commerce) dona do vínculo — primeira que gravar dados fica dona. Terceiro só vê/edita após a E1 (#43). |
| `contador_abertura` | Contador da Contex responsável pela abertura (definido pelo gestor). |

## Gov.br e certificação

| Campo | Significado |
|---|---|
| `gov_level` | `prata` ou `ouro` — desde #54, os DOIS seguem BIRD ID/SYNC (e-CPF) → Abertura (paralelo) → A1 (e-CNPJ); antes só Prata passava pelo e-CPF. |
| `gov_login` / `gov_password_encrypted` | Acesso Gov.br do cliente. Senha AES-256-GCM (`src/lib/crypto.ts`, chave `GOV_ENCRYPTION_KEY`). NUNCA expor em listagem; revelação é auditada. Editável por `gestor`/`admin` via PATCH geral (campo `gov_password`, texto puro na entrada); captador usa `/captador-update`. |
| `gov_2fa_disabled` | Atestação do captador de que desativou o 2FA do gov.br do cliente. |
| `bird_id_done`, `abertura_done`, `a1_done` | Conclusão de cada sub-etapa da E3/E4. `a1_done` só pode ser `true` depois de `bird_id_done` (`a1ReadyOf` em `page.tsx` exige os dois, mais os anexos da abertura). |
| `bird_id_done_em/por`, `a1_done_em/por`, `abertura_done_em/por` | Quem/quando concluiu cada sub-etapa — base de cobrança e do badge "✓ concluído por...". Os dois últimos pares (`abertura_done_*`) são novos (#54) — antes a abertura não registrava quem fez. |
| `cert_docs_recusados` | Timestamp de recusa de documentos pelo certificador — OS sai da fila dele até o captador reenviar via `/captador-update` (que limpa a flag). |
| `agendamento_cert` | Agendamento da certificação. Gestor/admin criam/editam pelo dossiê e pela Agenda; o captador marca pela própria PWA (`/captador-agendar`), mas o horário dele nasce pendente de aprovação (abaixo). |
| `agendamento_status`, `agendamento_recusa_motivo`, `agendamento_decidido_por/_em` | Aprovação, pelo certificador, do horário marcado pelo captador. `'pendente'` = slot já reservado em `agendamento_cert` mas ainda sem ciência dele; `'aprovado'` = compromisso firme; `'recusado'` = `agendamento_cert` foi limpo (slot liberado) e a tarefa de agendar voltou pro captador com o motivo. **Vazio conta como aprovado** — OS anterior a esse fluxo não pode virar "pendente" retroativamente. Escrito só via comando `decidir_agendamento: 'aprovar'\|'recusar'` no PATCH (nunca direto pelo payload). |
| `reagendamento_*` (`pendente`, `de`, `justificativa`, `por`, `em`) | Pedido de reagendamento do certificador — fica pendente até o gestor aprovar (`pendente` guarda o novo horário ISO, ou `'CANCELAR'`). |
| `cert_certificadora`, `cert_sistema_usado`, `cert_aparelho`, `cert_email`, `cert_email_senha_encrypted`, `cert_senha_acesso_encrypted` | Dados de acesso ao BIRD ID/SYNC (e-CPF). `cert_sistema_usado` agora é um seletor de dois botões (`'BIRD ID'` ou `'SYNC'`), não mais texto livre. `cert_aparelho` é texto livre de propósito. Acessível (incl. reveal das senhas) por `terceiro`, `operador_certificacao`, `gestor`/`admin` — nunca `operador_abertura`. |
| `has_gov_password`, `has_cert_email_senha`, `has_cert_senha_acesso` | Flags **computadas no GET**, não persistidas — indicam senha cadastrada sem expor o valor. Também presentes na projeção do terceiro (`api/terceiro/dossiers`). |
| `certificado_a1_url` | O A1 (e-CNPJ) — anexo do processo. Desde #54 é um **`.zip`/`.rar`** (pfx + senha num `.txt` dentro), não mais `.pfx` solto. `FileAttach` desse campo só existe dentro do bloco `canDoCert` (aba Trabalho) — não duplicar no bloco genérico de documentos, isso já vazou acesso pro `operador_abertura` uma vez. |

## Abertura da empresa (E3 / OS de Abertura)

| Campo | Significado |
|---|---|
| `empresa_nome`, `nome_fantasia`, `cnae`, `capital_social`, `quadro_societario`, `regime_tributario` | Dados da empresa; pré-preenchidos pelo auto-fill de CNPJ (`/api/cnpj/[cnpj]`). Preenchidos na E2 ficam `readOnly` pro operador na E3. |
| `empresa_endereco` | Endereço **ONDE A EMPRESA SERÁ ABERTA** — distinto de `address` (já causou bug histórico real; ver Incidentes na skill). |
| `gov_socios` | Login/senha gov.br de cada sócio (texto), pré-semeado com nomes do quadro societário. |
| `forma_pagamento`, `codigo_acesso` | Dados operacionais da abertura. |
| `cnpj_number` | CNPJ obtido na abertura. |
| `cad_junta`, `cad_receita`, `cad_estado`, `cad_prefeitura`, `planilha_mensalidade`, `planilha_simples`, `envio_tfe`, `opcao_simples`, `criar_pasta_rede` | Checklist operacional da abertura (booleans). |
| `t2_new_email`, `t2_new_phone` | Contatos novos criados na E2. |
| `t1_justification` | Justificativa da decisão de risco (E1). |
| `projeto` | Projeto ao qual a empresa foi alocada (gestor/admin). Limite de capacidade ainda é decorativo (pendência conhecida). |
| `gestor_note` | Anotação de colaboração do gestor/admin, visível à equipe. |
| `sla_deadline` | Prazo de SLA da etapa (lógica em `src/lib/sla.ts`). |

## Anexos (URLs servidas por rota autenticada `/uploads/[...path]`)

| Campo | Significado |
|---|---|
| `photo_doc_frente/verso/completo_url`, `photo_cnh_url` | Documento de identidade do cliente (captador). Também visível pro `terceiro` desde #54. |
| `photo_selfie_url`, `photo_selfie_rg_url`, `video_prova_url` | Prova de vida (captador). Também visível pro `terceiro` desde #54. |
| `comprovante_endereco_url`, `antecedentes_url` | **Legados — fora do fluxo atual**, não reintroduzir sem pedido explícito. |
| `bird_id_cert_url` | (BIRD ID/SYNC em si NÃO tem anexo — só dados de acesso; ver `cert_sistema_usado`/`cert_email` na tabela acima.) |
| `certificado_a1_url` | Ver detalhe na tabela "Gov.br e certificação" acima (formato `.zip`, RBAC). |
| `cnpj_comprovante_url`, `certidao_inteiro_teor_url` | Anexos da abertura — liberam a OS pra fila do certificador (Ouro e Prata, junto com o BIRD ID/SYNC concluído). |
| `inscricao_municipal/estadual_url`, `opcao_simples_url`, `documento_b_url` | Demais documentos da abertura. |
| `doc_extra_1..3_url` + `doc_extra_1..3_nome` | 3 slots de documentos avulsos com nome digitado por quem anexa (#49); entram na exportação e no ZIP. |

## Entidades relacionadas (mesmo arquivo)

- `ActivityLog` — trilha de auditoria por dossiê (revelações de senha,
  mudanças críticas, uploads). Imutável.
- `OsTask` — tarefas/cobranças entre usuários dentro de uma OS.
- `UserRole` — papéis ativos: `captador`, `gestor`, `admin`,
  `operador_abertura`, `operador_certificacao`, `terceiro` (os `operador_t*`
  antigos foram removidos no #39).
