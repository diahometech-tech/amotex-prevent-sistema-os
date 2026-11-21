import { NextRequest, NextResponse } from 'next/server';
import { Database, FinalizacaoBloqueadaError } from '@/lib/db';
import { hojeISO, normalizarDataProgramada } from '@/lib/os-agenda';
import { getSessionFromRequest, getClientIp, podeVerOS, podeLerOS, condominioParaPapel } from '@/lib/auth';
import { isScopedToOwnCondominio, podeAgendarOS, podeApagarOS, podeCancelarOS, podeOperarCampo } from '@/lib/roles';
import { saveAssinaturaDataUrl, saveOsPdfBuffer } from '@/lib/uploads';
import { generateOsPdf } from '@/lib/os-pdf';
import { notifyN8n } from '@/lib/notify';
import { avisarCorretiva } from '@/lib/notificacao-corretiva';
import { vinculosDaOS } from '@/lib/os-vinculos';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  // Leitura: o técnico também lê OS ENCERRADAS dos condomínios que atende
  // (histórico do condomínio). Escrever (PATCH, checklist, fotos) segue
  // exigindo podeVerOS.
  if (!(await podeLerOS(session, os))) {
    return NextResponse.json({ error: 'Sem acesso a esta OS.' }, { status: 403 });
  }

  const [checklist, fotos, condominio, contatosTodos, logs, vinculos] = await Promise.all([
    Database.getChecklistByOS(id),
    Database.getFotosByOS(id),
    Database.getCondominioById(os.condominio_id),
    Database.getContatosByCondominio(os.condominio_id),
    Database.getAuditLogsByEntidade('os', id),
    vinculosDaOS(os, session),
  ]);
  // Contrato do condomínio só pro escritório; auditoria (logs) não vai pro
  // síndico — ele vê a OS pelo Painel, não o histórico interno.
  return NextResponse.json({
    os, checklist, fotos,
    // Contatos ativos do local (zelador etc.): a tela monta os botões "Ligar".
    // Quem vê a OS já pode ver os contatos do condomínio.
    contatos: contatosTodos.filter((c) => c.ativo),
    condominio: condominio ? condominioParaPapel(session.role, condominio) : condominio,
    // Auditoria (IP, destinatários de aviso) não vai pro síndico nem pro técnico
    // que só LÊ a OS de outro (histórico do condomínio).
    logs: isScopedToOwnCondominio(session.role) || !(await podeVerOS(session, os)) ? [] : logs,
    vinculos,
  });
}

// PATCH /api/os/[id] — atualiza campos, registra assinatura, e finaliza
// (aplicando a trava de qualidade: não finaliza com checklist obrigatório
// pendente — ver Database.finalizarOS). Cada campo é checado por papel:
// campo (chegada, status, assinaturas, finalizar) = gestor e técnico; agenda
// (técnico, prioridade, chamado) = escritório e técnico; data da visita = só
// escritório; cancelar = escritório. Sempre só nas OS que a sessão vê.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!podeAgendarOS(session.role) && !podeOperarCampo(session.role) && !podeCancelarOS(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const original = await Database.getOSById(id);
  if (!original) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await podeVerOS(session, original))) {
    return NextResponse.json({ error: 'Sem acesso a esta OS.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      finalizar, cancelar, motivo, assinatura_zelador, assinatura_tecnico,
      assinatura_zelador_nome, assinatura_zelador_documento, ...rest
    } = body;

    // Cancelar: gestor e secretária, com motivo. Passa por Database.cancelarOS (nota na
    // observação + auditoria), nunca por um PATCH solto de status.
    if (cancelar) {
      if (!podeCancelarOS(session.role)) {
        return NextResponse.json({ error: 'Só o escritório pode cancelar uma OS.' }, { status: 403 });
      }
      const texto = typeof motivo === 'string' ? motivo.trim() : '';
      if (texto.length < 3) return NextResponse.json({ error: 'Informe o motivo do cancelamento.' }, { status: 400 });
      const os = await Database.cancelarOS(id, texto.slice(0, 500), session.name);
      if (!os) return NextResponse.json({ error: 'Esta OS já foi finalizada ou cancelada.' }, { status: 409 });
      notifyN8n('os_status_changed', os, { de: original.status });
      return NextResponse.json({ success: true, os });
    }
    if (rest.status === 'cancelada') {
      return NextResponse.json({ error: 'Use "Cancelar OS" para cancelar.' }, { status: 400 });
    }
    // Permissão por campo: se o corpo mistura campo e agenda, cada um é
    // checado — qualquer campo não permitido recusa o pedido inteiro.
    const camposDeCampo = ['status', 'entrada_em', 'saida_em'].filter((f) => rest[f] !== undefined);
    const mandouNomeZelador = assinatura_zelador_nome !== undefined || assinatura_zelador_documento !== undefined;
    if (finalizar || mandouNomeZelador || typeof assinatura_zelador === 'string' || typeof assinatura_tecnico === 'string') {
      camposDeCampo.push('finalizar/assinatura');
    }
    if (camposDeCampo.length > 0 && !podeOperarCampo(session.role)) {
      return NextResponse.json(
        { error: 'O trabalho de campo (chegada, andamento, assinaturas e finalizar) é do técnico ou do gestor.' },
        { status: 403 }
      );
    }
    // Técnico só trabalha em campo na OS que assumiu: corretiva sem técnico
    // ainda é só "visível" pra ele — sem assumir, a OS ficaria sem responsável
    // e sumiria do acesso dele ao finalizar.
    if (camposDeCampo.length > 0 && session.role === 'tecnico' && original.tecnico_id !== session.id) {
      return NextResponse.json({ error: 'Assuma a OS antes de registrar a chegada ou mexer nela.' }, { status: 403 });
    }
    // Técnico só atribui a si mesmo (assumir); passar a OS adiante é do escritório.
    if (session.role === 'tecnico' && rest.tecnico_id !== undefined && rest.tecnico_id !== session.id) {
      return NextResponse.json({ error: 'Só o escritório pode trocar o técnico da OS.' }, { status: 403 });
    }
    // Mudar o dia da visita é do escritório; o técnico só assume a OS (tecnico_id = ele).
    if (session.role === 'tecnico' && rest.data_programada !== undefined) {
      return NextResponse.json({ error: 'Só o escritório reagenda a visita.' }, { status: 403 });
    }
    const camposDeAgenda = [
      'tecnico_id', 'data_programada', 'prioridade', 'observacao', 'solicitante_nome', 'solicitante_telefone', 'descricao_problema',
    ].filter((f) => rest[f] !== undefined);
    if (camposDeAgenda.length > 0 && !podeAgendarOS(session.role)) {
      return NextResponse.json({ error: 'Você não pode alterar a agenda ou os dados desta OS.' }, { status: 403 });
    }
    const updates: Record<string, unknown> = {};
    for (const f of [
      'status', 'prioridade', 'tecnico_id', 'entrada_em', 'saida_em', 'observacao',
      'solicitante_nome', 'solicitante_telefone', 'descricao_problema',
    ] as const) {
      if (rest[f] !== undefined) updates[f] = rest[f];
    }
    // tecnico_id vazio = desatribuir (o <select> manda ''; a coluna é UUID).
    if (updates.tecnico_id === '') updates.tecnico_id = null;
    // A chegada já registrada não muda: a hora que o cliente manda só vale
    // na primeira vez (e só vem do aparelho sem sinal, via fila offline — o
    // envio normal deixa o servidor gravar a hora). Hora no futuro vira agora.
    if (updates.entrada_em !== undefined) {
      const t = typeof updates.entrada_em === 'string' ? Date.parse(updates.entrada_em) : NaN;
      if (original.entrada_em || Number.isNaN(t)) delete updates.entrada_em;
      else if (t > Date.now()) updates.entrada_em = new Date().toISOString();
    }
    // Chegada no condomínio = "Cheguei no local" (OSModal e Rota do dia). Se só o
    // status mudou, o servidor grava a hora: o prazo de 3h da corretiva
    // (src/lib/os-sla.ts) conta dela.
    if (updates.status === 'em_andamento' && !original.entrada_em && updates.entrada_em === undefined) {
      updates.entrada_em = new Date().toISOString();
    }
    // Chegada numa PREVENTIVA agendada pra OUTRO dia (adiantar a próxima
    // visita, ou fazer uma atrasada): a data dela passa a ser o dia da
    // chegada, pra "feitas hoje" da rota e o painel do mês contarem no dia
    // certo. O dia sai da hora da chegada (updates.entrada_em), não do relógio
    // do servidor: chegada sem sinal só sobe depois. Corretiva não muda de
    // data (o atraso dela continua visível). Só quando o PATCH não manda data
    // (o escritório reagendando manda).
    let reagendadaNaChegada: { de: string; para: string } | null = null;
    if (
      updates.status === 'em_andamento' && !original.entrada_em && rest.data_programada === undefined &&
      original.tipo === 'preventiva' && original.data_programada
    ) {
      const diaChegada = hojeISO(new Date(updates.entrada_em as string));
      if (original.data_programada !== diaChegada) {
        reagendadaNaChegada = { de: original.data_programada, para: diaChegada };
        updates.data_programada = diaChegada;
      }
    }
    if (rest.data_programada !== undefined) {
      const data = normalizarDataProgramada(rest.data_programada);
      if (data === undefined) return NextResponse.json({ error: 'Data da visita inválida.' }, { status: 400 });
      updates.data_programada = data;
    }

    // Nome (obrigatório para finalizar) e documento (opcional) de quem assinou
    // pelo condomínio. Podem vir junto com a assinatura ou depois, num PATCH só
    // com o nome (assinatura que subiu sem nome). OS encerrada não muda mais.
    if (mandouNomeZelador) {
      if (original.status === 'finalizada' || original.status === 'cancelada') {
        return NextResponse.json({ error: 'Esta OS já foi encerrada.' }, { status: 409 });
      }
      if (assinatura_zelador_nome !== undefined) {
        const nome = typeof assinatura_zelador_nome === 'string' ? assinatura_zelador_nome.trim().slice(0, 120) : '';
        if (nome.length < 2) return NextResponse.json({ error: 'Informe o nome de quem assinou.' }, { status: 400 });
        updates.assinatura_zelador_nome = nome;
      }
      if (assinatura_zelador_documento !== undefined) {
        updates.assinatura_zelador_documento =
          typeof assinatura_zelador_documento === 'string' ? assinatura_zelador_documento.trim().slice(0, 40) : '';
      }
    }
    if (typeof assinatura_zelador === 'string') {
      const url = saveAssinaturaDataUrl(assinatura_zelador, id, 'zelador');
      if (!url) return NextResponse.json({ error: 'Assinatura do zelador em formato inválido.' }, { status: 400 });
      updates.assinatura_zelador_url = url;
    }
    if (typeof assinatura_tecnico === 'string') {
      const url = saveAssinaturaDataUrl(assinatura_tecnico, id, 'tecnico');
      if (!url) return NextResponse.json({ error: 'Assinatura do técnico em formato inválido.' }, { status: 400 });
      updates.assinatura_tecnico_url = url;
    }

    if (finalizar) {
      let os;
      try {
        os = await Database.finalizarOS(id, updates);
      } catch (e) {
        // finalizarOS só lança de propósito FinalizacaoBloqueadaError (trava
        // de qualidade — ver src/lib/os-finalizacao.ts), cujas pendências são
        // seguras pra mostrar ao usuário verbatim. Qualquer outra coisa (erro
        // de driver do Postgres, violação de constraint) não pode vazar pro
        // cliente: registra e troca por uma mensagem genérica.
        if (e instanceof FinalizacaoBloqueadaError) {
          // Aba aberta antes do campo "nome" existir não tem onde digitá-lo: avisa o que fazer.
          const dicaNome = e.pendencias.some((p) => p.startsWith('Falta o nome'))
            ? ' Se a tela não mostra o campo do nome, atualize a página e preencha na aba Assinaturas.'
            : '';
          return NextResponse.json(
            { error: `${e.message} ${e.pendencias.join('; ')}.${dicaNome}`, pendencias: e.pendencias },
            { status: 422 }
          );
        }
        console.error('Erro ao finalizar OS:', e);
        return NextResponse.json({ error: 'Não foi possível finalizar a OS.' }, { status: 422 });
      }
      if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });

      // Geração automática do PDF ao finalizar (PRD — Must). A OS já está
      // finalizada nesta altura: uma falha aqui (ex.: foto corrompida) não
      // pode desfazer a finalização, só fica sem o PDF pra tentar de novo.
      let pdfError: string | undefined;
      try {
        const [checklist, fotos, condominio, tecnico, vinculos] = await Promise.all([
          Database.getChecklistByOS(id),
          Database.getFotosByOS(id),
          Database.getCondominioById(os.condominio_id),
          os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
          vinculosDaOS(os),
        ]);
        if (condominio) {
          const buffer = await generateOsPdf({
            os, condominio, checklist, fotos, tecnico,
            origem: vinculos.origem, corretivas: vinculos.corretivas, equipamento: vinculos.equipamento,
          });
          const pdf_url = saveOsPdfBuffer(buffer, id);
          os = (await Database.updateOS(id, { pdf_url })) ?? os;
        }
      } catch (e) {
        console.error('Erro ao gerar PDF da OS:', e);
        pdfError = 'OS finalizada, mas houve erro ao gerar o PDF.';
      }

      notifyN8n('os_finalizada', os);
      return NextResponse.json({ success: true, os, ...(pdfError ? { pdfError } : {}) });
    }

    const os = await Database.updateOS(id, updates);
    if (updates.status && updates.status !== original.status) {
      await Database.createAuditLog({
        entidade: 'os', entidade_id: id, acao: 'STATUS_ALTERADO', ator: session.name,
        detalhe: { de: original.status, para: updates.status, ip: getClientIp(request) },
      });
      if (os) notifyN8n('os_status_changed', os, { de: original.status });
    }
    if (os && reagendadaNaChegada) {
      await Database.createAuditLog({
        entidade: 'os', entidade_id: id, acao: 'REAGENDADA_NA_CHEGADA', ator: session.name, detalhe: reagendadaNaChegada,
      });
    }
    let aviso;
    if (os && updates.tecnico_id !== undefined && (updates.tecnico_id ?? null) !== (original.tecnico_id ?? null)) {
      await Database.createAuditLog({
        entidade: 'os', entidade_id: id, acao: 'TECNICO_ATRIBUIDO', ator: session.name,
        detalhe: { de: original.tecnico_id ?? null, para: updates.tecnico_id ?? null },
      });
      // Corretiva ativa ganhou técnico. Se o próprio técnico assumiu, avisa o
      // grupo da abertura pra ninguém ir em dobro; se o escritório atribuiu ou
      // trocou, avisa só o técnico escolhido (+ gestores e secretária).
      if (os.tipo === 'corretiva' && os.status !== 'finalizada' && os.status !== 'cancelada') {
        if (os.tecnico_id) {
          aviso = await avisarCorretiva(session.role === 'tecnico' ? 'os_corretiva_assumida' : 'os_corretiva_atribuida', os);
        } else {
          // Escritório tirou o técnico: a OS voltou a ficar sem responsável e
          // o prazo de 3h continua — chama de novo pela regra de horário.
          aviso = await avisarCorretiva('os_corretiva_aberta', os);
        }
      }
    }
    return NextResponse.json({ success: true, os, ...(aviso ? { aviso } : {}) });
  } catch (e) {
    console.error('Erro ao atualizar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/os/[id] — apaga a OS de vez (checklist, fotos, assinaturas, PDF).
// Só gestor. Para tirar da fila sem perder o histórico, use "Cancelar OS".
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeApagarOS(session.role)) {
    return NextResponse.json({ error: 'Só gestores podem apagar uma OS.' }, { status: 403 });
  }
  try {
    const ok = await Database.apagarOS(id, session.name);
    if (!ok) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao apagar OS:', e);
    return NextResponse.json({ error: 'Não foi possível apagar a OS.' }, { status: 500 });
  }
}
