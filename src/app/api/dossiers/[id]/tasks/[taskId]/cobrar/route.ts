import { NextRequest, NextResponse } from 'next/server';
import { Database, shortId } from '@/lib/db';
import { getSessionFromRequest, getClientIp } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';

type RouteContext = { params: Promise<{ id: string; taskId: string }> };

// POST /api/dossiers/[id]/tasks/[taskId]/cobrar
// Cobrança direcionada à pessoa que recebeu a tarefa (distinta de "Cobrar
// Setor", que é sobre SLA da OS como um todo) — gera um lembrete pro mesmo
// destinatário, referenciando a tarefa original, pra reduzir atraso quando
// ninguém sinaliza que uma tarefa está parada.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id, taskId } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  }

  const tasks = await Database.getTasksByDossier(id);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
  }
  if (task.done) {
    return NextResponse.json({ error: 'Esta tarefa já foi concluída.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const mensagem = typeof body?.mensagem === 'string' ? body.mensagem.trim() : '';

  const reminder = {
    id: shortId(),
    dossier_id: id,
    from_user: session.name,
    to_user: task.to_user,
    text: `🔔 Cobrança de ${session.name} sobre a tarefa "${task.text}"${mensagem ? `: ${mensagem}` : ''}`,
    done: false,
    created_at: new Date().toISOString(),
  };
  await Database.insertTask(reminder);
  await sendPushToUser(task.to_user, {
    title: `🔔 Cobrança de ${session.name}`,
    body: `Tarefa: "${task.text}"${mensagem ? ` — ${mensagem}` : ''}`,
  });

  await Database.createLog({
    dossier_id: id,
    user_name: session.name,
    action_type: 'TASK_COBRADA',
    details: `Cobrou ${task.to_user} sobre a tarefa "${task.text}".`,
    ip_address: getClientIp(request),
  });

  return NextResponse.json({ ok: true, task: reminder });
}
