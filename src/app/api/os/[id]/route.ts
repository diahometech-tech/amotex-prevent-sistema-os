import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, getClientIp, canAccessCondominio } from '@/lib/auth';
import { saveAssinaturaDataUrl } from '@/lib/uploads';
import { notifyN8n } from '@/lib/notify';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await canAccessCondominio(session, os.condominio_id))) {
    return NextResponse.json({ error: 'Você não tem acesso a esta OS.' }, { status: 403 });
  }

  const [checklist, fotos, condominio, logs] = await Promise.all([
    Database.getChecklistByOS(id),
    Database.getFotosByOS(id),
    Database.getCondominioById(os.condominio_id),
    Database.getAuditLogsByEntidade('os', id),
  ]);
  return NextResponse.json({ os, checklist, fotos, condominio, logs });
}

// PATCH /api/os/[id] — atualiza campos, registra assinatura, e finaliza
// (aplicando a trava de qualidade: não finaliza com checklist obrigatório
// pendente — ver Database.finalizarOS). Admin ou técnico.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || (session.role !== 'admin' && session.role !== 'tecnico')) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const original = await Database.getOSById(id);
  if (!original) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });

  try {
    const body = await request.json();
    const { finalizar, assinatura_zelador, assinatura_tecnico, ...rest } = body;
    const updates: Record<string, unknown> = {};
    for (const f of ['status', 'prioridade', 'tecnico_id', 'entrada_em', 'saida_em', 'observacao'] as const) {
      if (rest[f] !== undefined) updates[f] = rest[f];
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
      try {
        const os = await Database.finalizarOS(id, updates);
        if (os) notifyN8n('os_finalizada', os);
        return NextResponse.json({ success: true, os });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Não foi possível finalizar a OS.';
        return NextResponse.json({ error: message }, { status: 422 });
      }
    }

    const os = await Database.updateOS(id, updates);
    if (updates.status && updates.status !== original.status) {
      await Database.createAuditLog({
        entidade: 'os', entidade_id: id, acao: 'STATUS_ALTERADO', ator: session.name,
        detalhe: { de: original.status, para: updates.status, ip: getClientIp(request) },
      });
      if (os) notifyN8n('os_status_changed', os, { de: original.status });
    }
    return NextResponse.json({ success: true, os });
  } catch (e) {
    console.error('Erro ao atualizar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
