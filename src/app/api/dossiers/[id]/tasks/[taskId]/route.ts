import { NextRequest, NextResponse } from 'next/server';
import { Database, shortId } from '@/lib/db';
import { getSessionFromRequest, getClientIp } from '@/lib/auth';
import { notifyN8n } from '@/lib/notify';
import { sendPushToUser } from '@/lib/push';

type RouteContext = { params: Promise<{ id: string; taskId: string }> };

// DELETE /api/dossiers/[id]/tasks/[taskId] — só gestor/admin, pra corrigir
// uma tarefa criada por engano (pedido do gestor). Diferente de "concluir":
// apaga de vez, não deixa rastro na lista de tarefas da OS (só na auditoria).
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id, taskId } = await context.params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.role !== 'gestor' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas gestor ou admin podem apagar uma tarefa.' }, { status: 403 });
  }

  const task = (await Database.getTasksByDossier(id)).find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
  }

  await Database.deleteTask(taskId);
  await Database.createLog({
    ip_address: getClientIp(request),
    dossier_id: id,
    user_name: session.name,
    action_type: 'TAREFA_APAGADA',
    details: `Apagou a tarefa de "${task.from_user}" para "${task.to_user}": ${task.text.slice(0, 100)}${task.text.length > 100 ? '…' : ''}`,
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id, taskId } = await context.params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  // Identifica quem ATRIBUIU a tarefa antes de concluir — se foi um
  // certificador, ele deve ser notificado da conclusão (evento dedicado p/ n8n;
  // o sino in-app já mostra via task_done).
  const task = (await Database.getTasksByDossier(id)).find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
  }
  // Só quem RECEBEU a tarefa (to_user) pode concluí-la, ou gestor/admin
  // (override) — evita que qualquer usuário autenticado marque como concluída
  // uma tarefa endereçada a outra pessoa.
  const isManager = session.role === 'gestor' || session.role === 'admin';
  if (task.to_user !== session.name && !isManager) {
    return NextResponse.json({ error: 'Você não pode concluir uma tarefa endereçada a outra pessoa.' }, { status: 403 });
  }

  await Database.completeTask(taskId, session.name, new Date().toISOString());

  if (task && task.from_user) {
    // from_user guarda o NOME do autor (não o username) — casa por nome.
    const isCertAuthor = (await Database.getUsers())
      .some((u) => u.name === task.from_user && u.role === 'operador_certificacao');
    if (isCertAuthor) {
      const dossier = await Database.getDossierById(id);
      if (dossier) notifyN8n('cert_task_done', dossier, { task_text: task.text, done_by: session.name });
    }
    // Avisa quem atribuiu a tarefa que ela foi cumprida — parte envolvida no
    // processo, não só quem recebe o trabalho. Pula o pseudo-usuário "Sistema
    // NexusFlow" e o caso de a pessoa concluir a própria tarefa.
    if (task.from_user !== 'Sistema NexusFlow' && task.from_user !== session.name) {
      await sendPushToUser(task.from_user, {
        title: `✅ Tarefa concluída por ${session.name}`,
        body: task.text.slice(0, 120),
      });
    }
  }

  // Se quem concluiu é captador, notifica todos os gestores
  if (session.role === 'captador' && task) {
    const dossier = await Database.getDossierById(id);
    const gestores = await Database.getUsersByRole('gestor');
    for (const g of gestores) {
      await Database.insertTask({
        id: shortId(),
        dossier_id: id,
        from_user: 'Sistema NexusFlow',
        to_user: g.name,
        text: `✅ Tarefa concluída por ${session.name} na OS #${id}${dossier ? ` (${dossier.client_name})` : ''}: ${task.text.slice(0, 100)}${task.text.length > 100 ? '…' : ''}`,
        done: false,
        created_at: new Date().toISOString(),
      });
      await sendPushToUser(g.name, {
        title: `✅ Tarefa concluída por ${session.name}`,
        body: `OS #${id}${dossier ? ` (${dossier.client_name})` : ''}: ${task.text.slice(0, 100)}`,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
