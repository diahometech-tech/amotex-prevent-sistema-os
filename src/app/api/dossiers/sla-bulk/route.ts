import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, getClientIp } from '@/lib/auth';
import { getGestorScope, dossierInGestorScope } from '@/lib/gestor-scope';

// POST /api/dossiers/sla-bulk
// Ajuste de prazo (SLA) em lote — só gestor/admin. Body:
//   { ids: string[], add_hours?: number, sla_deadline?: string }
// add_hours soma horas ao prazo atual de cada OS (ou a partir de agora, se
// a OS não tiver prazo definido); sla_deadline (ISO) sobrescreve com um
// valor absoluto igual pra todas. Um dos dois é obrigatório.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'gestor' && session.role !== 'admin')) {
    return NextResponse.json({ error: 'Acesso restrito a gestor/admin.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  const addHours = typeof body?.add_hours === 'number' ? body.add_hours : null;
  const absoluteDeadline = typeof body?.sla_deadline === 'string' ? body.sla_deadline : null;

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Selecione ao menos uma OS.' }, { status: 400 });
  }
  if (addHours === null && !absoluteDeadline) {
    return NextResponse.json({ error: 'Informe add_hours ou sla_deadline.' }, { status: 400 });
  }

  const escopo = session.role === 'gestor' ? await getGestorScope(session) : [];

  let updated = 0;
  for (const id of ids) {
    const dossier = await Database.getDossierById(id);
    if (!dossier) continue;
    if (session.role === 'gestor' && !dossierInGestorScope(dossier, escopo)) continue;

    const newDeadline = absoluteDeadline
      ? absoluteDeadline
      : new Date((dossier.sla_deadline ? new Date(dossier.sla_deadline).getTime() : Date.now()) + (addHours as number) * 60 * 60 * 1000).toISOString();

    await Database.updateDossier(id, { sla_deadline: newDeadline });
    await Database.createLog({
      dossier_id: id,
      user_name: session.name,
      action_type: 'SLA_AJUSTADO_LOTE',
      details: `Ajustou o prazo (SLA) em lote${addHours !== null ? ` (+${addHours}h)` : ''} para ${new Date(newDeadline).toLocaleString('pt-BR')}.`,
      ip_address: getClientIp(request),
    });
    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
