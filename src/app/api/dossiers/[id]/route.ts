import { NextRequest, NextResponse } from 'next/server';
import { Database, shortId } from '@/lib/db';
import { getSessionFromRequest, getClientIp, isFieldRole } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';
import { notifyN8n } from '@/lib/notify';
import { exportDossierFolder } from '@/lib/dossie-export';
import { encrypt } from '@/lib/crypto';
import { sendPushToUser } from '@/lib/push';

type RouteContext = {
  params: Promise<{ id: string }>
}

// Nomenclatura E1-E4 pra trilha de auditoria — antes os logs de
// STATUS_CHANGED/STEP_CHANGED gravavam o valor cru dos campos
// (`current_step`/`status`) em maiúsculo (ex.: "T2_PENDENTE"), resíduo do
// modelo antigo. O resto do sistema usa E1-E4 há tempo (STEP_LABELS_NAV em
// page.tsx); a auditoria continuava com o nome interno. Cosmético — os
// campos em si (`current_step`/`status`) não mudam, só o texto do log.
// Fallback pro valor cru (maiúsculo) se aparecer um valor fora do mapa.
const STEP_LABELS: Record<string, string> = {
  captacao: 'Captação',
  t1: 'Análise de Risco (E1)',
  t2: 'Complemento Cadastral (E2)',
  t3: 'Certificação / Abertura (E3)',
  t4: 'Certificação (E4)',
  finalizado: 'Finalizado',
};
const STATUS_LABELS: Record<string, string> = {
  captado: 'Captado',
  t1_pendente: 'Aguardando Análise de Risco (E1)',
  t1_verde: 'Aprovado na Análise de Risco (E1)',
  t1_vermelho: 'Recusado na Análise de Risco (E1)',
  t2_pendente: 'Aguardando Complemento Cadastral (E2)',
  t3_bird_id: 'Certificação BIRD ID (E3/E4)',
  t3_abertura: 'Abertura da Empresa (E3)',
  t4_a1: 'Certificação A1 (E4)',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};
const stepLabel = (step: string) => STEP_LABELS[step] || step.toUpperCase();
const statusLabel = (status: string) => STATUS_LABELS[status] || status.toUpperCase();

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  try {
    // Leitura exige sessão válida (dados pessoais de clientes — LGPD).
    // Qualquer papel autenticado pode ler (inclusive o terceiro responsável
    // pela empresa); o captador não acessa a esteira.
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
    }
    // Terceiro usa a projeção segura (/api/terceiro/dossiers); certificador
    // usa a projeção do Modo Consulta (/api/consulta/dossiers/[id]); nenhum
    // dos dois acessa o detalhe completo (com logs e URLs de documentos
    // pessoais) — ver `isFieldRole`.
    if (isFieldRole(session.role)) {
      return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
    }

    const dossier = await Database.getDossierById(id);
    if (!dossier) {
      return NextResponse.json({ error: 'Ordem de Serviço não encontrada.' }, { status: 404 });
    }

    // Isolamento entre gestores de projetos diferentes (ver src/lib/gestor-scope.ts)
    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (!dossierInGestorScope(dossier, escopo)) {
        return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
      }
    }

    // Excluir senhas nos detalhes padrões para evitar exposição desnecessária
    const { gov_password_encrypted, cert_email_senha_encrypted, cert_senha_acesso_encrypted, t2_new_email_senha_encrypted, ...safeDossier } = dossier;

    // Buscar logs específicos desta OS
    const logs = await Database.getLogsByDossier(id);

    return NextResponse.json({
      dossier: {
        ...safeDossier,
        has_gov_password: !!gov_password_encrypted,
        has_cert_email_senha: !!cert_email_senha_encrypted,
        has_cert_senha_acesso: !!cert_senha_acesso_encrypted,
        has_t2_new_email_senha: !!t2_new_email_senha_encrypted,
      },
      logs
    });
  } catch (e) {
    console.error('Erro ao buscar dossiê:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  try {
    // Alteração exige sessão; captador e terceiro não modificam a OS
    // (terceiro tem acesso de leitura ao dossiê, mas não edita o fluxo).
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
    }
    if (isFieldRole(session.role)) {
      return NextResponse.json({ error: 'Seu perfil não tem permissão para alterar a OS.' }, { status: 403 });
    }

    const body = await request.json();
    // operator_name segue extraído aqui só pra NUNCA cair em `updates` (spread
    // abaixo) — não é mais usado como identidade de auditoria (ver `operator`
    // mais abaixo, que usa session.name).
    const { operator_name: _operator_name, cert_email_senha, cert_senha_acesso, gov_password, t2_new_email_senha, gestor_override_reason, field_edit_summary, ...updates } = body;

    const original = await Database.getDossierById(id);
    if (!original) {
      return NextResponse.json({ error: 'Ordem de Serviço não encontrada.' }, { status: 404 });
    }

    // Isolamento entre gestores de projetos diferentes (ver src/lib/gestor-scope.ts)
    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (!dossierInGestorScope(original, escopo)) {
        return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
      }
    }

    // Senhas de certificação chegam em texto puro do formulário; nunca persistimos
    // sem criptografar (mesmo padrão da senha Gov.br — ver src/lib/crypto.ts).
    // Escrita restrita aos mesmos papéis que já podem LER essas credenciais em
    // /reveal (FIELD_CONFIG) — consistência entre leitura e escrita.
    // operador_abertura nunca teve acesso a dados de certificação (só à
    // abertura da empresa); terceiro grava por /terceiro-update, não por aqui.
    const CERT_FIELD_WRITE_ROLES = ['operador_certificacao', 'gestor', 'admin'];
    if (typeof cert_email_senha === 'string' && cert_email_senha.length > 0) {
      if (!CERT_FIELD_WRITE_ROLES.includes(session.role)) {
        return NextResponse.json({ error: 'Seu nível de acesso não permite definir a senha do e-mail de certificação.' }, { status: 403 });
      }
      updates.cert_email_senha_encrypted = encrypt(cert_email_senha);
    }
    if (typeof cert_senha_acesso === 'string' && cert_senha_acesso.length > 0) {
      if (!CERT_FIELD_WRITE_ROLES.includes(session.role)) {
        return NextResponse.json({ error: 'Seu nível de acesso não permite definir a senha de acesso ao certificado.' }, { status: 403 });
      }
      updates.cert_senha_acesso_encrypted = encrypt(cert_senha_acesso);
    }
    // Senha Gov.br do cliente: por este PATCH geral, só gestor/admin editam
    // (o captador continua usando /captador-update, que tem sua própria trava).
    if (typeof gov_password === 'string' && gov_password.length > 0) {
      if (session.role !== 'gestor' && session.role !== 'admin') {
        return NextResponse.json({ error: 'Apenas gestor ou admin podem editar a senha Gov.br por aqui.' }, { status: 403 });
      }
      updates.gov_password_encrypted = encrypt(gov_password);
    }
    // Ajuste manual de prazo (SLA): só gestor/admin — evita qualquer operador
    // "resolver" um atraso mudando o próprio prazo.
    if (typeof updates.sla_deadline === 'string' && updates.sla_deadline.length > 0) {
      if (session.role !== 'gestor' && session.role !== 'admin') {
        return NextResponse.json({ error: 'Apenas gestor ou admin podem ajustar o prazo (SLA).' }, { status: 403 });
      }
    }
    // Pagamento (BIRD/A1/Colaborador): 3 marcadores independentes, só
    // gestor/admin gravam — é controle financeiro, nunca uma etapa do fluxo
    // (funciona retroativamente, inclusive em OS já finalizada). Metadados
    // de quem/quando são sempre definidos no servidor, nunca confiados ao
    // cliente. Desmarcar (correção de erro) limpa os metadados.
    const PAGAMENTO_FIELDS = ['bird_pago', 'a1_pago', 'colaborador_pago', 'captador_pago'] as const;
    for (const field of PAGAMENTO_FIELDS) {
      if (typeof updates[field] === 'boolean') {
        if (session.role !== 'gestor' && session.role !== 'admin') {
          return NextResponse.json({ error: 'Apenas gestor ou admin podem marcar pagamento.' }, { status: 403 });
        }
        if (updates[field]) {
          updates[`${field}_em`] = new Date().toISOString();
          updates[`${field}_por`] = session.name;
        } else {
          updates[`${field}_em`] = '';
          updates[`${field}_por`] = '';
        }
      }
    }

    // Mensalidade recorrente do captador: alterna UMA competência ("YYYY-MM")
    // no array captador_pagamentos_mensais, sem confiar no cliente pra mandar
    // o array inteiro (evita corrida entre duas abas sobrescrevendo o histórico
    // uma da outra). Só gestor/admin.
    const toggleMesCaptador = updates.toggle_mes_captador;
    delete updates.toggle_mes_captador;
    if (typeof toggleMesCaptador === 'string' && /^\d{4}-\d{2}$/.test(toggleMesCaptador)) {
      if (session.role !== 'gestor' && session.role !== 'admin') {
        return NextResponse.json({ error: 'Apenas gestor ou admin podem marcar mensalidade.' }, { status: 403 });
      }
      let atuais: string[] = [];
      try {
        atuais = original.captador_pagamentos_mensais ? JSON.parse(original.captador_pagamentos_mensais) : [];
      } catch { atuais = []; }
      const idx = atuais.indexOf(toggleMesCaptador);
      const marcando = idx === -1;
      if (marcando) atuais.push(toggleMesCaptador); else atuais.splice(idx, 1);
      updates.captador_pagamentos_mensais = JSON.stringify(atuais.sort());
      await Database.createLog({
        ip_address: getClientIp(request),
        dossier_id: id,
        user_name: session.name,
        action_type: 'PAGAMENTO_ALTERADO',
        details: `${marcando ? 'Marcou' : 'Desmarcou'} mensalidade do captador (${toggleMesCaptador}) — ${original.client_name}.`,
      });
    }

    // DECISÃO DO AGENDAMENTO feito pelo captador: o certificador dá ciência
    // ou recusa com motivo (documento ilegível, horários espalhados que não
    // justificam o deslocamento). Mesmo padrão de `toggle_mes_captador` — o
    // cliente manda um COMANDO (`decidir_agendamento`) e o servidor calcula
    // o resultado; os campos `agendamento_status`/`_decidido_*` nunca são
    // escritos direto pelo payload (deletados logo abaixo).
    const decidirAgendamento = updates.decidir_agendamento;
    const motivoRecusa = typeof updates.agendamento_recusa_motivo === 'string'
      ? updates.agendamento_recusa_motivo.trim()
      : '';
    delete updates.decidir_agendamento;
    delete updates.agendamento_status;
    delete updates.agendamento_recusa_motivo;
    delete updates.agendamento_decidido_por;
    delete updates.agendamento_decidido_em;
    let agendamentoDecidido: 'aprovado' | 'recusado' | null = null;
    if (decidirAgendamento === 'aprovar' || decidirAgendamento === 'recusar') {
      const isManagerRole = session.role === 'gestor' || session.role === 'admin';
      // Mesma regra de atribuição usada no resto do app: o certificador só
      // age na OS dele ou numa ainda livre; gestor/admin sem restrição.
      const podeDecidir = isManagerRole || (
        session.role === 'operador_certificacao'
        && (!original.resp_certificacao || original.resp_certificacao === session.name)
      );
      if (!podeDecidir) {
        return NextResponse.json({ error: 'Apenas o certificador responsável (ou gestor/admin) pode decidir o agendamento.' }, { status: 403 });
      }
      if (!original.agendamento_cert) {
        return NextResponse.json({ error: 'Esta OS não tem agendamento para decidir.' }, { status: 422 });
      }
      if (decidirAgendamento === 'recusar' && !motivoRecusa) {
        return NextResponse.json({ error: 'Informe o motivo da recusa — ele volta pro captador junto com o pedido de reagendamento.' }, { status: 422 });
      }
      agendamentoDecidido = decidirAgendamento === 'aprovar' ? 'aprovado' : 'recusado';
      updates.agendamento_status = agendamentoDecidido;
      updates.agendamento_decidido_por = session.name;
      updates.agendamento_decidido_em = new Date().toISOString();
      updates.agendamento_recusa_motivo = agendamentoDecidido === 'recusado' ? motivoRecusa : '';
      // Recusa libera o slot pra outra OS — o horário deixa de estar
      // reservado assim que deixa de ser um compromisso válido.
      if (agendamentoDecidido === 'recusado') updates.agendamento_cert = '';
    }

    // Agendamento escrito DIRETO por esta rota (widget "Agendar Certificação"
    // do dossiê, aprovação de reagendamento, edição rápida) já nasce aprovado:
    // este PATCH é vedado a captador/terceiro, então quem chega aqui é
    // gestor/admin/operador — a autoridade que aprovaria de qualquer forma.
    // Sem isto, um agendamento pendente do captador remarcado pelo gestor
    // continuaria preso em "aguardando aprovação".
    if (!agendamentoDecidido && typeof updates.agendamento_cert === 'string'
        && updates.agendamento_cert !== original.agendamento_cert) {
      if (updates.agendamento_cert) {
        updates.agendamento_status = 'aprovado';
        updates.agendamento_decidido_por = session.name;
        updates.agendamento_decidido_em = new Date().toISOString();
      } else {
        // Cancelamento: sem compromisso, não há o que aprovar.
        updates.agendamento_status = '';
        updates.agendamento_decidido_por = '';
        updates.agendamento_decidido_em = '';
      }
      updates.agendamento_recusa_motivo = '';
    }

    // REATRIBUIÇÃO de certificação já concluída (bird_id_done_por/a1_done_por):
    // corrige o caso real de um gestor marcar "Concluir" no próprio nome por
    // engano — a certificação aparecia como feita POR ELE em "Concluídos por
    // Certificador" e nos contadores de cobrança. Só gestor/admin podem
    // trocar o executor de uma certificação JÁ concluída, e a troca é
    // auditada. A escrita desses campos JUNTO com a conclusão (updates.X_done
    // vindo true na mesma chamada, fluxo normal do completeSubStep) continua
    // liberada pra quem pode concluir — este gate só pega a alteração
    // posterior, isolada.
    const REATRIB = [
      { por: 'bird_id_done_por', done: 'bird_id_done', label: 'BIRD ID (e-CPF)' },
      { por: 'a1_done_por', done: 'a1_done', label: 'Certificado A1 (e-CNPJ)' },
    ] as const;
    for (const { por, done, label } of REATRIB) {
      const novo = updates[por];
      const concluindoAgora = updates[done] === true && !original[done];
      if (typeof novo === 'string' && novo !== (original[por] || '') && !concluindoAgora) {
        if (session.role !== 'gestor' && session.role !== 'admin') {
          return NextResponse.json({ error: 'Apenas gestor ou admin podem reatribuir uma certificação concluída.' }, { status: 403 });
        }
        await Database.createLog({
          ip_address: getClientIp(request),
          dossier_id: id,
          user_name: session.name,
          action_type: 'CERT_REATRIBUIDA',
          details: `Reatribuiu a conclusão do ${label} de "${original[por] || original.resp_certificacao || '(sem executor)'}" para "${novo}".`,
        });
      }
    }

    // Atribuição de responsável (resp_certificacao/resp_abertura): gestor/admin
    // podem setar para qualquer valor (é o fluxo normal de "Atribuir
    // Responsáveis"). Fora isso, só é permitida a AUTO-atribuição de uma OS
    // ainda LIVRE — o próprio operador_certificacao/operador_abertura assumindo
    // o trabalho ao executá-lo (regra de negócio real, ver canWorkStep/"mine"
    // em src/app/page.tsx). Qualquer outra tentativa (setar pra outro nome, ou
    // sobrescrever uma OS já atribuída a outra pessoa) é negada.
    if (session.role !== 'gestor' && session.role !== 'admin') {
      if (typeof updates.resp_certificacao === 'string' && updates.resp_certificacao !== (original.resp_certificacao || '')) {
        const isSelfClaim = session.role === 'operador_certificacao' && !original.resp_certificacao && updates.resp_certificacao === session.name;
        if (!isSelfClaim) {
          return NextResponse.json({ error: 'Você não pode alterar o responsável pela certificação desta OS.' }, { status: 403 });
        }
      }
      if (typeof updates.resp_abertura === 'string' && updates.resp_abertura !== (original.resp_abertura || '')) {
        const isSelfClaim = session.role === 'operador_abertura' && !original.resp_abertura && updates.resp_abertura === session.name;
        if (!isSelfClaim) {
          return NextResponse.json({ error: 'Você não pode alterar o responsável pela abertura desta OS.' }, { status: 403 });
        }
      }
    }
    // Reatribuição de terceiro_responsavel (10/08/2026, caso real: OS já
    // vinculada — e-mail/telefone já preenchidos — por um parceiro precisava
    // ser passada pra outro parceiro do mesmo projeto, sem depender de editar
    // o dado direto no banco). Até aqui esse campo nunca era escrito por este
    // PATCH — só o próprio terceiro definia via /terceiro-update, na PRIMEIRA
    // gravação de uma OS livre ("primeira conta que grava fica dona dela").
    // Diferente de resp_certificacao/resp_abertura, não existe auto-claim
    // aqui: esta rota geral só é alcançada por papéis internos (terceiro é
    // bloqueado por isFieldRole no topo do handler), então só gestor/admin
    // podem setar/trocar esse campo por aqui.
    if (typeof updates.terceiro_responsavel === 'string' && updates.terceiro_responsavel !== (original.terceiro_responsavel || '')) {
      if (session.role !== 'gestor' && session.role !== 'admin') {
        return NextResponse.json({ error: 'Apenas gestor ou admin podem reatribuir o responsável do vínculo e-commerce.' }, { status: 403 });
      }
      await Database.createLog({
        ip_address: getClientIp(request),
        dossier_id: id,
        user_name: session.name,
        action_type: 'TERCEIRO_REATRIBUIDO',
        details: `Reatribuiu o responsável do vínculo e-commerce de "${original.terceiro_responsavel || '(livre)'}" para "${updates.terceiro_responsavel || '(livre)'}".`,
      });
    }
    // Senha do e-mail da empresa (vínculo e-commerce): normalmente cadastrada
    // pelo terceiro (via /terceiro-update), mas qualquer papel interno com
    // acesso a essa OS (gestor/admin, operador_certificacao,
    // operador_abertura) também pode corrigir erro de digitação/senha —
    // já passou pela checagem de captador/terceiro no topo desta rota.
    if (typeof t2_new_email_senha === 'string' && t2_new_email_senha.length > 0) {
      updates.t2_new_email_senha_encrypted = encrypt(t2_new_email_senha);
    }

    // TRAVA DE FLUXO: a OS só avança para a certificação (T3) depois que o parceiro
    // de e-commerce (terceiro) define o vínculo da empresa — e-mail + número. Sem
    // isso, a certificação não tem como prosseguir (regra de negócio).
    // Para Prata, o endereço também é obrigatório (usado no Bird ID).
    if (updates.current_step === 't3' && original.current_step !== 't3') {
      const emailVinculo = updates.t2_new_email ?? original.t2_new_email;
      const phoneVinculo = updates.t2_new_phone ?? original.t2_new_phone;
      if (!emailVinculo || !phoneVinculo) {
        return NextResponse.json(
          { error: 'Aguardando vínculo do e-commerce: defina o e-mail e o número da empresa antes de enviar para a certificação (T3).' },
          { status: 422 }
        );
      }
      const govLevel = updates.gov_level ?? original.gov_level;
      const address = updates.address ?? original.address;
      if (govLevel === 'prata' && !address) {
        return NextResponse.json(
          { error: 'Para nível Prata, o endereço do cliente é obrigatório antes de avançar para o Bird ID (T3).' },
          { status: 422 }
        );
      }
    }

    // TRAVA DE FLUXO: aprovar a E1 (t1 → t2) exige que o gestor já tenha
    // classificado o projeto da OS (03/08/2026, pedido do gestor: o projeto
    // precisa estar definido logo na aprovação de risco, pra OS já nascer
    // visível pro terceiro certo — com o isolamento por projeto, uma conta
    // terceiro escopada não enxerga nada sem esse campo preenchido, e sem
    // essa trava era fácil esquecer e só notar o problema quando o parceiro
    // reclamasse "não vejo a empresa"). Não se aplica a nenhuma outra
    // transição de etapa — só à aprovação em si.
    if (updates.current_step === 't2' && original.current_step === 't1') {
      const projetoDaOS = updates.projeto ?? original.projeto;
      if (!projetoDaOS) {
        return NextResponse.json(
          { error: 'Defina o projeto da OS antes de aprovar a análise de risco (E1) — sem isso ela não fica visível para o parceiro terceiro.' },
          { status: 422 }
        );
      }
    }

    // Entrar em T3 NÃO atribui operador automaticamente — atribuição de
    // responsável (certificação/abertura) é sempre manual, feita pelo
    // gestor/admin em "Atribuir Responsáveis". OS fica "livre" até lá.

    // TRAVA DE FINALIZAÇÃO (24/07/2026, pedido explícito do usuário —
    // "vários casos de abertura da empresa sem os dados de certificado
    // serem adicionados"): antes disso, a transição pra 'finalizado' não
    // exigia NADA (só a auditoria pós-fato na tela Projetos, 8º/9º achados
    // — bloco âmbar "finalizada sem certificação completa", que descobria
    // o problema depois de já ter acontecido). Agora a transição em si é
    // bloqueada (422) se faltar qualquer dado — vale pra QUALQUER caminho
    // que leve a 'finalizado' (conclusão normal via completeSubStep,
    // "Mover Etapa" do gestor, "Edição Rápida" do admin), porque todos
    // passam por este mesmo PATCH. Mesmo critério já usado no frontend
    // (`birdDadosFaltando`/`a1ArquivoFaltando`/`certConcluidaSemPendencia`
    // em page.tsx) — replicado aqui porque o servidor não pode confiar
    // que o client sempre valida antes de mandar o PATCH.
    if (updates.current_step === 'finalizado' && original.current_step !== 'finalizado') {
      const eff = { ...original, ...updates };
      const faltando: string[] = [];
      if (!eff.bird_id_done) {
        faltando.push('BIRD ID / e-CPF não concluído');
      } else {
        // "Certificadora" (texto livre) NÃO entra aqui de propósito
        // (24/07/2026, pedido explícito) — o Sistema usado (BIRD ID/
        // Syngular) já é suficiente pra identificar quem certifica;
        // Certificadora virou campo complementar opcional.
        if (!eff.cert_sistema_usado) faltando.push('Sistema usado (BIRD ID/Syngular)');
        if (!eff.cert_aparelho) faltando.push('Aparelho/Chip');
        if (!eff.cert_email) faltando.push('E-mail do certificado');
        if (!eff.cert_email_senha_encrypted) faltando.push('Senha do e-mail do certificado');
        if (!eff.cert_senha_acesso_encrypted) faltando.push('Senha de acesso ao BIRD ID/Syngular');
      }
      if (!eff.abertura_done) {
        faltando.push('Abertura da empresa (etapa "Concluir Abertura") não finalizada');
      }
      if (!eff.cnpj_number) faltando.push('Número do CNPJ');
      if (!eff.cnpj_comprovante_url) faltando.push('Cartão CNPJ');
      if (!eff.certidao_inteiro_teor_url) faltando.push('Certidão de Inteiro Teor');
      if (!eff.a1_done) {
        faltando.push('Certificado A1 / e-CNPJ não concluído');
      } else if (!eff.certificado_a1_url) {
        faltando.push('Arquivo do Certificado A1 (.zip/.rar)');
      }
      if (faltando.length > 0) {
        return NextResponse.json(
          {
            error: `Não é possível finalizar — faltam ${faltando.length} item(ns): ${faltando.join('; ')}. ` +
              `Resp. certificação: ${eff.resp_certificacao || '(livre)'}. Resp. abertura: ${eff.resp_abertura || '(livre)'}.`,
            missing: faltando,
          },
          { status: 422 }
        );
      }
    }

    // "Finalizado" SEMPRE implica empresa aberta — não importa por qual
    // caminho a OS chegou nessa etapa (fluxo normal de conclusão, override do
    // gestor, ou edição rápida do admin mudando a etapa direto). Sem isso, uma
    // OS podia ficar marcada "Finalizado" na tela sem nunca gerar protocolo
    // nem exportar o dossiê pra pasta da Contex — já aconteceu em produção com
    // 3 OS reais (edição rápida do admin mudou a etapa sem passar pelo botão
    // "Concluir", que é o único lugar que setava empresa_aberta).
    if (updates.current_step === 'finalizado' && original.current_step !== 'finalizado') {
      updates.empresa_aberta = true;
    }

    // Timestamp de quando a empresa foi de fato aberta — não existia até
    // agora (só o booleano `empresa_aberta`), e o portal do terceiro
    // precisa mostrar essa data no card (pedido do gestor: gestora de
    // e-commerce não conseguia saber quais empresas eram novas porque o
    // kanban não tem nenhuma ordenação/data visível). Só grava na transição
    // false→true — reabrir e finalizar de novo atualiza a data.
    if (updates.empresa_aberta && !original.empresa_aberta) {
      updates.empresa_aberta_em = new Date().toISOString();
    }

    // O inverso também precisa ser verdade: se o gestor devolve uma OS já
    // finalizada pra uma etapa anterior (correção pós-verificação), ela deixa
    // de estar "aberta" até ser finalizada de novo. Sem isso, a OS some da
    // fila de pendências do setor (que filtra por !empresa_aberta) e o
    // dashboard continua contando como "Empresa Aberta" mesmo voltando pra
    // trabalho ativo. O protocolo já emitido é mantido (é o identificador
    // oficial usado no celular do e-commerce, não pode mudar) — quando a OS
    // for finalizada de novo, o dossiê é reexportado automaticamente (abaixo)
    // com os documentos atualizados, mas o mesmo protocolo é reaproveitado.
    if (original.current_step === 'finalizado' && updates.current_step && updates.current_step !== 'finalizado') {
      updates.empresa_aberta = false;
    }

    // Ao finalizar (empresa aberta), gera o PROTOCOLO oficial uma única vez.
    // Padrão sequencial A560, A561, ... — o MESMO identificador usado no celular
    // do e-commerce. Estável para o pós-processo.
    if (updates.empresa_aberta && !original.protocolo && !updates.protocolo) {
      updates.protocolo = await Database.getNextProtocolo();
    }

    // Atualiza o dossiê
    const updated = await Database.updateDossier(id, updates);

    // Gravação de auditoria automática baseada em mudanças críticas.
    // FALHA DE INTEGRIDADE DE AUDITORIA (corrigida): antes usava
    // `operator_name || 'Operador Nexus'` — um campo enviado pelo CLIENTE no
    // corpo da requisição, sem qualquer checagem contra a sessão. Qualquer
    // papel interno autenticado podia gravar log/notificação em nome de
    // OUTRA pessoa só editando o payload (dá pra fazer isso pelo devtools do
    // navegador sem nenhuma ferramenta especial). Além do risco de abuso
    // deliberado, isso também explica divergências reais entre "quem
    // interagiu com a OS" e "o que aparece na auditoria" — se o estado do
    // frontend (`currentOperator`) ficasse dessincronizado da sessão (ex.:
    // aba antiga aberta, computador compartilhado sem logout/login completo),
    // o log saía com um nome diferente do usuário de fato autenticado.
    // `session.name` vem do cookie assinado (HMAC, ver src/lib/auth.ts) —
    // não é confiável só o suficiente, é a ÚNICA fonte de identidade que o
    // servidor pode garantir sem confiar no cliente.
    const operator = session.name;
    
    if (updates.status && updates.status !== original.status) {
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'STATUS_CHANGED',
        details: `Alterou status da OS de "${statusLabel(original.status)}" para "${statusLabel(updates.status)}"`
      });
    }

    if (updates.current_step && updates.current_step !== original.current_step) {
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'STEP_CHANGED',
        details: `Mapeou OS para a fila do setor: "${stepLabel(updates.current_step)}"`
      });
      // Intervenção manual do gestor: grava justificativa separada na trilha
      if (gestor_override_reason) {
        await Database.createLog({
      ip_address: getClientIp(request),
          dossier_id: id,
          user_name: operator,
          action_type: 'GESTOR_OVERRIDE',
          details: `[INTERVENÇÃO DO GESTOR] Justificativa: ${gestor_override_reason}`
        });
      }
      // Notifica o n8n que a OS avançou de etapa (aciona o responsável da nova fila).
      if (updated) notifyN8n('step_changed', updated);

      // DEMANDA DE CERTIFICAÇÃO: ao entrar em T3, avisa SÓ o certificador
      // responsável — tarefa interna (sino do app) + evento dedicado p/ o n8n.
      if (updates.current_step === 't3' && updated?.resp_certificacao) {
        await Database.insertTask({
          id: shortId(),
          dossier_id: id,
          from_user: 'Sistema NexusFlow',
          to_user: updated.resp_certificacao,
          text: `📜 Nova demanda de certificação: ${updated.client_name} (${updated.gov_level === 'prata' ? 'Prata — BIRD ID + A1' : 'Ouro — A1'}). Agende e execute a certificação.`,
          done: false,
          created_at: new Date().toISOString(),
        });
        await sendPushToUser(updated.resp_certificacao, {
          title: '📜 Nova demanda de certificação',
          body: `${updated.client_name} (${updated.gov_level === 'prata' ? 'Prata' : 'Ouro'}) — agende e execute a certificação.`,
        });
        notifyN8n('cert_demanded', updated);
      }

      // OS LIBERADA PRO TERCEIRO: sai de T1 (análise de risco) — o parceiro de
      // e-commerce já pode preencher o vínculo (e-mail/telefone da empresa).
      // Antes disso o terceiro nem enxerga a OS (GET /api/terceiro/dossiers
      // filtra captacao/t1). Notifica só o terceiro dono da OS, se já houver
      // um definido; senão, avisa todos os parceiros ativos (fila livre).
      if (original.current_step === 't1' && updates.current_step !== 't1') {
        const terceiroTargets = updated?.terceiro_responsavel
          ? [updated.terceiro_responsavel]
          : (await Database.getUsersByRole('terceiro')).filter((u) => u.active).map((u) => u.name);
        for (const nomeTerc of terceiroTargets) {
          await Database.insertTask({
            id: shortId(),
            dossier_id: id,
            from_user: 'Sistema NexusFlow',
            to_user: nomeTerc,
            text: `🤝 OS liberada para vínculo: ${updated?.client_name || id} passou na análise de risco. Preencha e-mail e telefone da empresa.`,
            done: false,
            created_at: new Date().toISOString(),
          });
          await sendPushToUser(nomeTerc, {
            title: '🤝 OS liberada para vínculo',
            body: `${updated?.client_name || id}: preencha e-mail e telefone da empresa.`,
          });
        }
      }
    }

    // DECISÃO DO AGENDAMENTO: audita e devolve o resultado pro captador.
    // Na recusa, a tarefa recriada usa o MESMO prefixo "📅 Agendar
    // certificação:" que `captador.html` casa pra reabrir o botão "Agendar"
    // — é o que fecha o ciclo sem o captador precisar pedir nada a ninguém.
    if (agendamentoDecidido) {
      const slotAntigo = original.agendamento_cert
        ? new Date(original.agendamento_cert).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        : '—';
      await Database.createLog({
        ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: agendamentoDecidido === 'aprovado' ? 'AGENDAMENTO_APROVADO' : 'AGENDAMENTO_RECUSADO',
        details: agendamentoDecidido === 'aprovado'
          ? `Aprovou o agendamento de certificação para ${slotAntigo}.`
          : `Recusou o agendamento de ${slotAntigo} e liberou o horário. Motivo: ${motivoRecusa}`,
      });
      const alvo = original.captured_by;
      if (alvo) {
        const nome = original.client_name || id;
        if (agendamentoDecidido === 'aprovado') {
          await Database.insertTask({
            id: shortId(),
            dossier_id: id,
            from_user: 'Sistema NexusFlow',
            to_user: alvo,
            text: `✅ Agendamento de "${nome}" (OS #${id}) APROVADO por ${operator} para ${slotAntigo}.`,
            done: false,
            created_at: new Date().toISOString(),
          });
          await sendPushToUser(alvo, {
            title: '✅ Agendamento aprovado',
            body: `${nome}: certificação confirmada para ${slotAntigo}.`,
          });
        } else {
          await Database.insertTask({
            id: shortId(),
            dossier_id: id,
            from_user: 'Sistema NexusFlow',
            to_user: alvo,
            text: `📅 Agendar certificação: "${nome}" (OS #${id}). O horário de ${slotAntigo} foi recusado por ${operator}. Motivo: ${motivoRecusa}`,
            done: false,
            created_at: new Date().toISOString(),
          });
          await sendPushToUser(alvo, {
            title: '❌ Agendamento recusado',
            body: `${nome}: ${motivoRecusa} — escolha um novo horário.`,
          });
        }
      }
    }

    // REAGENDAMENTO (aprovação do gestor): registra na trilha e notifica.
    if (updates.reagendamento_pendente && !original.reagendamento_pendente) {
      // Certificador SOLICITOU a troca → notifica o gestor para aprovar/recusar.
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'REAGENDAMENTO_SOLICITADO',
        details: `Solicitou ${updates.reagendamento_pendente === 'CANCELAR' ? 'CANCELAMENTO' : 'reagendamento'} do compromisso de certificação. Justificativa: ${updates.reagendamento_justificativa || '—'}`,
      });
      if (updated) notifyN8n('reagendamento_solicitado', updated, { reagendamento_pendente: updates.reagendamento_pendente, reagendamento_justificativa: updates.reagendamento_justificativa });
    } else if (original.reagendamento_pendente && updates.reagendamento_pendente === '') {
      // Gestor RESOLVEU (aprovou/recusou) → a mudança de agendamento_cert indica qual.
      const aprovado = updates.agendamento_cert !== undefined && updates.agendamento_cert !== original.agendamento_cert
        || (original.reagendamento_pendente === 'CANCELAR' && updates.agendamento_cert === '');
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'REAGENDAMENTO_RESOLVIDO',
        details: `${aprovado ? 'APROVOU' : 'RECUSOU'} o pedido de ${original.reagendamento_pendente === 'CANCELAR' ? 'cancelamento' : 'reagendamento'} de ${original.reagendamento_por || 'certificador'}.`,
      });
      if (updated) notifyN8n('reagendamento_resolvido', updated, { aprovado });
      // Se aprovado, notifica o captador para realinhar com o colaborador.
      if (aprovado && updated?.captured_by) {
        const novoAgend = updates.agendamento_cert
          ? new Date(updates.agendamento_cert).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
          : 'cancelado';
        await Database.insertTask({
          id: shortId(),
          dossier_id: id,
          from_user: 'Sistema NexusFlow',
          to_user: updated.captured_by,
          text: `✅ Reagendamento APROVADO para "${updated.client_name}": novo horário ${novoAgend}. Confirme com o colaborador.`,
          done: false,
          created_at: new Date().toISOString(),
        });
        await sendPushToUser(updated.captured_by, {
          title: '✅ Reagendamento aprovado',
          body: `${updated.client_name}: novo horário ${novoAgend}. Confirme com o colaborador.`,
        });
      }
      // Avisa quem pediu (certificador) se foi recusado — se foi aprovado, ele já vê a mudança na própria agenda.
      if (!aprovado && original.reagendamento_por) {
        await Database.insertTask({
          id: shortId(),
          dossier_id: id,
          from_user: 'Sistema NexusFlow',
          to_user: original.reagendamento_por,
          text: `❌ Pedido de ${original.reagendamento_pendente === 'CANCELAR' ? 'cancelamento' : 'reagendamento'} RECUSADO para "${original.client_name}". O compromisso atual foi mantido.`,
          done: false,
          created_at: new Date().toISOString(),
        });
        await sendPushToUser(original.reagendamento_por, {
          title: '❌ Reagendamento recusado',
          body: `${original.client_name}: o pedido foi recusado, o compromisso atual foi mantido.`,
        });
      }
    }

    // Quando gestor/admin define o vínculo T2 pela primeira vez via edição direta,
    // cria tarefa para o captador agendar a certificação.
    {
      const wasReady = !!(original.t2_new_email && original.t2_new_phone);
      const emailNow = updates.t2_new_email ?? original.t2_new_email;
      const phoneNow = updates.t2_new_phone ?? original.t2_new_phone;
      const isReady = !!(emailNow && phoneNow);
      if (!wasReady && isReady && updated?.captured_by) {
        await Database.insertTask({
          id: shortId(),
          dossier_id: id,
          from_user: 'Sistema NexusFlow',
          to_user: updated.captured_by,
          text: `📅 Agendar certificação: o vínculo da empresa "${updated.client_name}" foi definido. Alinhe a disponibilidade com o colaborador e selecione o horário na agenda.`,
          done: false,
          created_at: new Date().toISOString(),
        });
        await sendPushToUser(updated.captured_by, {
          title: '📅 Agendar certificação',
          body: `${updated.client_name}: vínculo definido. Alinhe a disponibilidade e selecione o horário.`,
        });
      }
    }

    if (updates.cnpj_number && updates.cnpj_number !== original.cnpj_number) {
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'CNPJ_LINKED',
        details: `Vinculou CNPJ ${updates.cnpj_number} ao Dossiê da empresa.`
      });
    }

    // Ajuste manual de prazo (SLA) — só gestor/admin editam por aqui (a UI já
    // restringe, mas a auditoria vale registrar de qualquer forma).
    if (updates.sla_deadline && updates.sla_deadline !== original.sla_deadline) {
      await Database.createLog({
        dossier_id: id,
        user_name: operator,
        action_type: 'SLA_AJUSTADO',
        details: `Ajustou o prazo (SLA) para ${new Date(updates.sla_deadline).toLocaleString('pt-BR')}.`,
        ip_address: getClientIp(request),
      });
    }

    // Auditoria de pagamento — registra cada marcação/desmarcação individual.
    const PAGAMENTO_LABELS: Record<string, string> = {
      bird_pago: 'BIRD ID', a1_pago: 'Certificado A1', colaborador_pago: 'Colaborador',
      captador_pago: 'Captador',
    };
    for (const field of PAGAMENTO_FIELDS) {
      if (typeof updates[field] === 'boolean' && updates[field] !== !!original[field]) {
        await Database.createLog({
          ip_address: getClientIp(request),
          dossier_id: id,
          user_name: operator,
          action_type: 'PAGAMENTO_ALTERADO',
          details: `${updates[field] ? 'Marcou' : 'Desmarcou'} pagamento de ${PAGAMENTO_LABELS[field]} — ${original.client_name}.`,
        });
      }
    }

    // Certificações são distintas e cobradas individualmente — cada conclusão
    // (BIRD ou A1) notifica o gestor financeiro (Caio de Sá, username
    // 'cgs1010'), que controla os pagamentos de certificados/colaboradores
    // pela tela "Projetos" (pedido explícito: o controle de pagamento é
    // centralizado ali, não em qualquer gestor que esteja de plantão).
    const projetoLabel = (d: typeof original) => d.projeto ? ` (projeto: ${d.projeto})` : '';
    if (updates.bird_id_done && !original.bird_id_done) {
      const caio = await Database.getUserByUsername('cgs1010');
      if (caio) {
        await Database.insertTask({
          id: shortId(),
          dossier_id: id,
          from_user: 'Sistema NexusFlow',
          to_user: caio.name,
          text: `🆔 BIRD ID (e-CPF) concluído por ${operator} — ${original.client_name}${projetoLabel(original)}. Marque o pagamento na tela Projetos.`,
          done: false,
          created_at: new Date().toISOString(),
        });
        await sendPushToUser(caio.name, { title: '🆔 BIRD ID concluído', body: `${operator} concluiu — ${original.client_name}${projetoLabel(original)}.` });
      }
      if (updated) notifyN8n('bird_id_done', updated);
    }
    if (updates.a1_done && !original.a1_done) {
      const caio = await Database.getUserByUsername('cgs1010');
      if (caio) {
        await Database.insertTask({
          id: shortId(),
          dossier_id: id,
          from_user: 'Sistema NexusFlow',
          to_user: caio.name,
          text: `📜 Certificado A1 (e-CNPJ) concluído por ${operator} — ${original.client_name}${projetoLabel(original)}. Marque o pagamento na tela Projetos.`,
          done: false,
          created_at: new Date().toISOString(),
        });
        await sendPushToUser(caio.name, { title: '📜 Certificado A1 concluído', body: `${operator} concluiu — ${original.client_name}${projetoLabel(original)}.` });
      }
      if (updated) notifyN8n('a1_done', updated);
    }

    if (updates.empresa_aberta && !original.empresa_aberta) {
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'COMPANY_OPENED',
        details: `Finalizou o processo de abertura. Empresa marcada como "ABERTA".`
      });

      // Exporta o dossiê completo (DOCX + anexos + resumo) para a pasta da
      // empresa em DOSSIES_DIR — sincronizada com o servidor interno da Contex.
      if (updated) {
        try {
          const dir = await exportDossierFolder(updated);
          await Database.createLog({
      ip_address: getClientIp(request),
            dossier_id: id,
            user_name: 'Sistema NexusFlow',
            action_type: 'DOSSIE_EXPORTADO',
            details: `Dossiê exportado para a pasta da empresa: ${dir}`,
          });
        } catch (e) {
          console.error('Falha ao exportar dossiê:', e);
        }
      }
    }

    // Edição direta de campos (gestor/admin via painel de edição rápida).
    if (field_edit_summary) {
      await Database.createLog({
      ip_address: getClientIp(request),
        dossier_id: id,
        user_name: operator,
        action_type: 'FIELD_EDITED',
        details: field_edit_summary,
      });
    }

    return NextResponse.json({ success: true, dossier: updated });
  } catch (e) {
    console.error('Erro ao atualizar dossiê:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/dossiers/[id] — exclui o cadastro (soft-delete). Restrito a gestor/admin
// (exclusão é destrutiva o suficiente pra não ficar liberada pra qualquer operador;
// restauração fica disponível na Lixeira — ver /api/dossiers/[id]/restore).
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  if (session.role !== 'gestor' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas gestor ou admin podem excluir cadastros.' }, { status: 403 });
  }
  try {
    const dossier = await Database.getDossierById(id);
    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (dossier && !dossierInGestorScope(dossier, escopo)) {
        return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
      }
    }
    const ok = await Database.deleteDossier(id);
    if (!ok) {
      return NextResponse.json({ error: 'Ordem de Serviço não encontrada.' }, { status: 404 });
    }
    await Database.createLog({
      ip_address: getClientIp(request),
      dossier_id: id,
      user_name: session.name,
      action_type: 'DOSSIE_EXCLUIDO',
      details: `Excluiu o cadastro de "${dossier?.client_name || id}". Pode ser restaurado pela Lixeira.`,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao excluir dossiê:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
