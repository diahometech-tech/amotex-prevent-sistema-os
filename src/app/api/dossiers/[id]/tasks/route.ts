import { NextRequest, NextResponse } from 'next/server';
import { Database, shortId } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const tasks = await Database.getTasksByDossier(id);
  return NextResponse.json({ tasks });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const body = await request.json();
  const { to_user, text } = body as { to_user: string; text: string };
  if (!to_user || !text?.trim()) {
    return NextResponse.json({ error: 'Destinatário e texto são obrigatórios.' }, { status: 400 });
  }

  const task = {
    id: shortId(),
    dossier_id: id,
    from_user: session.name,
    to_user,
    text: text.trim(),
    done: false,
    created_at: new Date().toISOString(),
  };
  await Database.insertTask(task);
  await sendPushToUser(to_user, {
    title: `📋 Nova tarefa de ${session.name}`,
    body: text.trim(),
  });

  // Quando uma tarefa é aberta para um captador, notifica o(s) gestor(es)
  const recipient = (await Database.getUsers()).find((u) => u.name === to_user);
  if (recipient?.role === 'captador') {
    const dossier = await Database.getDossierById(id);
    const gestores = await Database.getUsersByRole('gestor');
    for (const g of gestores) {
      await Database.insertTask({
        id: shortId(),
        dossier_id: id,
        from_user: 'Sistema NexusFlow',
        to_user: g.name,
        text: `🔔 Tarefa aberta para o captador ${to_user} na OS #${id}${dossier ? ` (${dossier.client_name})` : ''}: ${text.trim()}`,
        done: false,
        created_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ task }, { status: 201 });
}
