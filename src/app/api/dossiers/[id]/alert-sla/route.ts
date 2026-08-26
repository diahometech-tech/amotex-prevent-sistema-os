import { NextRequest, NextResponse } from 'next/server';
import { Database, shortId } from '@/lib/db';
import { getSessionFromRequest, getClientIp, isFieldRole } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';
import { NotificationService } from '@/lib/notifications';
import { notifyN8n } from '@/lib/notify';
import { sendPushToUser } from '@/lib/push';

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  // Disparo de cobrança de SLA exige sessão; só papéis internos (não captador/terceiro).
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }
  if (isFieldRole(session.role)) {
    return NextResponse.json({ error: 'Acesso restrito.' }, { status: 403 });
  }
  try {
    const dossier = await Database.getDossierById(id);
    if (!dossier) {
      return NextResponse.json({ error: 'Ordem de Serviço não encontrada.' }, { status: 404 });
    }

    if (session.role === 'gestor') {
      const escopo = await getGestorScope(session);
      if (!dossierInGestorScope(dossier, escopo)) {
        return NextResponse.json({ error: 'Esta OS não pertence a um projeto do seu acesso.' }, { status: 403 });
      }
    }

    const body = await request.json().catch(() => ({}));
    const mensagem = typeof body?.mensagem === 'string' ? body.mensagem.trim() : '';

    // Dispara a simulação de notificação de SLA
    await NotificationService.sendSLAWarningEmail(
      dossier.client_name,
      dossier.id,
      dossier.current_step,
      dossier.sla_deadline || new Date().toISOString()
    );

    // Notifica o n8n (cobrança de SLA → WhatsApp do responsável).
    notifyN8n('sla_due', dossier, mensagem ? { mensagem } : undefined);

    // Cobrança direcionada: sem isso o alerta ia só pro e-mail geral da
    // gerência, sem dizer PRA QUEM nem O QUE falta — cria uma tarefa interna
    // pro responsável atual da OS, com a mensagem de quem cobrou.
    const responsavel = dossier.current_step === 't3'
      ? (dossier.resp_abertura || dossier.resp_certificacao)
      : dossier.assigned_to;
    if (responsavel && responsavel !== session.name) {
      await Database.insertTask({
        id: shortId(),
        dossier_id: id,
        from_user: session.name,
        to_user: responsavel,
        text: `🔔 Cobrança de SLA — OS de ${dossier.client_name}${mensagem ? `: ${mensagem}` : ''}`,
        done: false,
        created_at: new Date().toISOString(),
      });
      await sendPushToUser(responsavel, {
        title: `🔔 Cobrança de SLA — ${session.name}`,
        body: `OS de ${dossier.client_name}${mensagem ? `: ${mensagem}` : ''}`,
      });
    }

    await Database.createLog({
      ip_address: getClientIp(request),
      dossier_id: id,
      user_name: session.name,
      action_type: 'SLA_COBRADO',
      details: `Cobrou o setor responsável pela OS${mensagem ? ` — Mensagem: ${mensagem}` : ''}.`,
    });

    return NextResponse.json({
      success: true,
      message: 'Simulação de e-mail de alerta de SLA disparada com sucesso!'
    });
  } catch (e) {
    console.error('Erro ao disparar alerta SLA:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
