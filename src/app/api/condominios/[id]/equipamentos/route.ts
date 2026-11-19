import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio, podeVerOS } from '@/lib/auth';
import { podeEditarEquipamento, podeOperarCampo, osEncerrada } from '@/lib/roles';
import { itemDeEquipamento } from '@/lib/os-checklist-inicial';
import { validarEquipamento } from '@/lib/equipamento-campos';
import { saveFotoEquipamentoDataUrl } from '@/lib/uploads';

// Janela em que um cadastro idêntico na mesma OS conta como reenvio, não como outro equipamento.
const REENVIO_MS = 2 * 60 * 1000;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const equipamentos = await Database.getEquipamentosByCondominio(id);
  return NextResponse.json({ equipamentos });
}

// POST — cadastra equipamento do parque de máquinas (feito na visita técnica,
// com foto opcional em `foto` como data URL). Admin ou técnico.
// Com `os_id` (1ª vistoria, dentro da OS) também cria o item "Inspecionar …"
// no checklist dessa OS; resposta `{equipamento, checklistItem}`.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarEquipamento(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  try {
    if (!(await Database.getCondominioById(id))) {
      return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    }
    const body = await request.json();
    // Valida a OS ANTES de criar qualquer coisa: equipamento sem item no
    // checklist seria um cadastro pela metade.
    let os = null;
    if (body?.os_id) {
      os = await Database.getOSById(String(body.os_id));
      if (!os || os.condominio_id !== id) {
        return NextResponse.json({ error: 'OS não encontrada neste condomínio.' }, { status: 404 });
      }
      if (osEncerrada(os)) return NextResponse.json({ error: 'OS encerrada.' }, { status: 409 });
      if (!podeOperarCampo(session.role) || !(await podeVerOS(session, os))) {
        return NextResponse.json({ error: 'Sem acesso a esta OS.' }, { status: 403 });
      }
      // Técnico só mexe na OS que já é dele (corretiva sem dono: antes assume).
      if (session.role === 'tecnico' && os.tecnico_id !== session.id) {
        return NextResponse.json({ error: 'Assuma a OS antes de cadastrar equipamentos.' }, { status: 403 });
      }
    }
    const { dados, erro } = validarEquipamento(body ?? {});
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (typeof body.foto === 'string' && body.foto) {
      const foto = saveFotoEquipamentoDataUrl(body.foto, id);
      if ('erro' in foto) return NextResponse.json({ error: foto.erro }, { status: 400 });
      dados.foto_url = foto.url;
    }
    // Reenvio por sinal ruim: o POST anterior gravou mas a resposta se perdeu.
    // Sem o checklist ainda não dá pra desfazer cadastro (equipamento em uso não
    // é apagado), então um cadastro idêntico feito há instantes nesta OS devolve
    // o que já existe em vez de criar o fantasma obrigatório.
    if (os) {
      const [checklist, existentes] = await Promise.all([Database.getChecklistByOS(os.id), Database.getEquipamentosByCondominio(id)]);
      const naOS = new Set(checklist.map((i) => i.equipamento_id).filter(Boolean));
      const repetido = existentes.find(
        (e) =>
          naOS.has(e.id) &&
          Date.now() - new Date(e.cadastrado_em).getTime() < REENVIO_MS &&
          e.tipo === dados.tipo &&
          (e.identificacao ?? '') === (dados.identificacao ?? '') &&
          (e.modelo ?? '') === (dados.modelo ?? '')
      );
      if (repetido) {
        const checklistItem = checklist.find((i) => i.equipamento_id === repetido.id);
        return NextResponse.json({ success: true, equipamento: repetido, checklistItem, repetido: true });
      }
    }
    const equipamento = await Database.createEquipamento({ ...dados, condominio_id: id });
    await Database.createAuditLog({
      entidade: 'equipamento', entidade_id: equipamento.id, acao: 'CRIADO', ator: session.name,
      detalhe: { condominio_id: id, tipo: equipamento.tipo },
    });
    let checklistItem;
    if (os) {
      checklistItem = await Database.createChecklistItem(itemDeEquipamento(os, equipamento));
      // O planejamento mensal cria todas as preventivas do mês com o parque
      // vazio: as outras OS abertas do condomínio também precisam do item novo,
      // senão a regra de foto por equipamento só valeria na OS do cadastro.
      for (const outra of await Database.getOSsByCondominio(id)) {
        if (outra.id === os.id || osEncerrada(outra)) continue;
        await Database.createChecklistItem(itemDeEquipamento(outra, equipamento));
      }
    }
    return NextResponse.json({ success: true, equipamento, checklistItem });
  } catch (e) {
    console.error('Erro ao criar equipamento:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
