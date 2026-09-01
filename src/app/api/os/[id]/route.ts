import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, getClientIp, canAccessCondominio } from '@/lib/auth';
import { saveAssinaturaDataUrl, saveOsPdfBuffer } from '@/lib/uploads';
import { generateOsPdf } from '@/lib/os-pdf';
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
      let os;
      try {
        os = await Database.finalizarOS(id, updates);
      } catch (e) {
        // finalizarOS só lança de propósito a mensagem de checklist pendente
        // (ver src/lib/db.ts) — essa é segura pra mostrar ao usuário verbatim.
        // Qualquer outra coisa (erro de driver do Postgres, violação de
        // constraint) não pode vazar pro cliente: registra e troca por uma
        // mensagem genérica, igual ao resto das rotas.
        const CHECKLIST_PENDENTE = 'Existem itens obrigatórios do checklist não concluídos.';
        if (e instanceof Error && e.message === CHECKLIST_PENDENTE) {
          return NextResponse.json({ error: e.message }, { status: 422 });
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
        const [checklist, fotos, condominio, tecnico] = await Promise.all([
          Database.getChecklistByOS(id),
          Database.getFotosByOS(id),
          Database.getCondominioById(os.condominio_id),
          os.tecnico_id ? Database.getUserById(os.tecnico_id) : Promise.resolve(null),
        ]);
        if (condominio) {
          const buffer = await generateOsPdf({ os, condominio, checklist, fotos, tecnico });
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
    return NextResponse.json({ success: true, os });
  } catch (e) {
    console.error('Erro ao atualizar OS:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
