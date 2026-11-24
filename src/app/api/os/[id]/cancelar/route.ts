import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { canAccessCondominio, getSessionFromRequest, osParaPapel } from '@/lib/auth';
import { podeCancelarChamado } from '@/lib/roles';
import { permissaoCancelarChamado } from '@/lib/os-cancelamento';
import { avisarCancelamentoCorretiva } from '@/lib/notificacao-corretiva';
import { notifyN8n } from '@/lib/notify';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/os/[id]/cancelar — o condomínio cancela o próprio chamado.
// Só síndico (o acesso também usado por zelador/gerente), só corretiva do
// PRÓPRIO condomínio e só dentro da regra de src/lib/os-cancelamento.ts: antes
// do "a caminho" a qualquer hora; depois, só nos primeiros 5 minutos; nunca
// depois da chegada. O servidor é quem decide — a tela só espelha a regra.
// Gestor e secretária cancelam pelo PATCH /api/os/[id] ({ cancelar: true }).
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!podeCancelarChamado(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!(await canAccessCondominio(session, os.condominio_id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este chamado.' }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : '';
    if (motivo.length < 3) return NextResponse.json({ error: 'Informe o motivo do cancelamento.' }, { status: 400 });

    const regra = permissaoCancelarChamado(os);
    if (!regra.pode) return NextResponse.json({ error: regra.mensagem, motivo: regra.motivo }, { status: 409 });

    const cancelada = await Database.cancelarOS(id, motivo.slice(0, 500), `${session.name} (condomínio)`, {
      canal: 'condominio',
      ...(os.a_caminho_em ? { a_caminho_em: new Date(os.a_caminho_em).toISOString() } : {}),
    });
    if (!cancelada) return NextResponse.json({ error: 'Este chamado já foi encerrado.' }, { status: 409 });
    notifyN8n('os_status_changed', cancelada, { de: os.status });
    // Avisa quem recebeu o chamado (o técnico a caminho, se houver). O resultado
    // é interno: o condomínio não precisa saber quem foi avisado.
    await avisarCancelamentoCorretiva(cancelada, motivo.slice(0, 500));
    return NextResponse.json({ success: true, os: osParaPapel(session.role, cancelada) });
  } catch (e) {
    console.error('Erro ao cancelar chamado:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
