import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podeGerirPlantao } from '@/lib/roles';
import { atendeCorretiva, erroParaPlantao, plantonistasEm } from '@/lib/plantao';
import { fimDaTrocaManual } from '@/lib/plantao-escala';

// POST /api/plantao/trocar { usuario_id } — "Trocar plantonista agora".
// Escritório. O escolhido passa a ser o plantonista DESTE instante até o fim do
// período atual:
//  - com a escala em andamento: os períodos de quem está de plantão são
//    encerrados agora e o novo período vai de agora até o fim do período
//    substituído (a escala de depois continua como estava);
//  - plantão marcado à mão (sem escala cobrindo): cria o período até o fim do
//    plantão corrente (a próxima abertura do horário comercial) e tira a marca
//    manual de quem estava marcado, para ele não voltar quando o período acabar.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeGerirPlantao(session.role)) {
    return NextResponse.json({ error: 'Apenas o escritório troca o plantonista.' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const novo = typeof body?.usuario_id === 'string' ? await Database.getUserById(body.usuario_id) : null;
    if (!novo || !atendeCorretiva(novo)) return NextResponse.json({ error: 'Escolha um técnico de corretiva ativo.' }, { status: 400 });
    const semCanal = erroParaPlantao(novo);
    if (semCanal) return NextResponse.json({ error: semCanal }, { status: 400 });

    const agora = new Date();
    const [escala, users] = await Promise.all([Database.getPlantaoEscala(), Database.getUsers()]);
    const atual = plantonistasEm(agora, escala, users);
    const idsAtuais = new Set(atual.usuarios.map((u) => u.id));
    if (idsAtuais.size === 1 && idsAtuais.has(novo.id)) {
      return NextResponse.json({ error: `${novo.nome} já é o plantonista agora.` }, { status: 409 });
    }

    let fim: Date;
    const encerrados: string[] = [];
    if (atual.origem === 'escala') {
      // Períodos em andamento (de quem está de plantão): o fim mais tarde é o do período atual.
      const vigentes = escala.filter(
        (p) => idsAtuais.has(p.usuario_id) && new Date(p.inicio).getTime() <= agora.getTime() && agora.getTime() < new Date(p.fim).getTime()
      );
      fim = new Date(Math.max(...vigentes.map((p) => new Date(p.fim).getTime())));
      for (const p of vigentes) {
        if (p.usuario_id === novo.id) continue; // já cobre: fica como está
        if (new Date(p.inicio).getTime() >= agora.getTime()) await Database.deletePlantaoEscala(p.id);
        else await Database.updatePlantaoEscala(p.id, { fim: agora.toISOString() });
        encerrados.push(p.usuario_id);
      }
    } else {
      fim = fimDaTrocaManual(agora);
      for (const u of atual.usuarios) {
        if (u.id !== novo.id) await Database.updateUser(u.id, { de_plantao: false });
      }
    }

    const jaCobre = atual.origem === 'escala' && idsAtuais.has(novo.id);
    const periodo = jaCobre
      ? null
      : await Database.createPlantaoEscala({ usuario_id: novo.id, inicio: agora.toISOString(), fim: fim.toISOString(), criado_por: session.name });
    await Database.createAuditLog({
      entidade: 'plantao_escala', entidade_id: periodo?.id, acao: 'PLANTAO_TROCADO', ator: session.name,
      detalhe: {
        para: novo.nome,
        de: atual.usuarios.filter((u) => u.id !== novo.id).map((u) => u.nome),
        origem: atual.origem, ate: fim.toISOString(),
      },
    });
    return NextResponse.json({ success: true, periodo });
  } catch (e) {
    console.error('Erro ao trocar o plantonista:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
