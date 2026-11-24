import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio, condominioParaPapel, filtrarOSVisiveis, osParaPapel } from '@/lib/auth';
import { podeEditarCondominio, podeVerReservatorios } from '@/lib/roles';
import { validarCadastro } from '@/lib/financeiro/cadastro';
import { hojeISO } from '@/lib/os-agenda';
import { coordenadaValida } from '@/lib/rastreio';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const condominio = await Database.getCondominioById(id);
  if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });

  // Reservatórios (sensor) só pro escritório; OS filtradas por papel (o
  // técnico vê só as dele + corretivas sem técnico); contrato só pro escritório.
  const [reservatorios, contatos, equipamentos, todasOss] = await Promise.all([
    podeVerReservatorios(session.role) ? Database.getReservatoriosByCondominio(id) : Promise.resolve([]),
    Database.getContatosByCondominio(id),
    Database.getEquipamentosByCondominio(id),
    Database.getOSsByCondominio(id),
  ]);
  // Localização da chegada/finalização só pro escritório (osParaPapel).
  const oss = (await filtrarOSVisiveis(session, todasOss)).map((o) => osParaPapel(session.role, o));
  return NextResponse.json({ condominio: condominioParaPapel(session.role, condominio), reservatorios, contatos, equipamentos, oss });
}

// PATCH /api/condominios/[id] — só admin.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarCondominio(session.role)) {
    return NextResponse.json({ error: 'Apenas administradores podem editar condomínios.' }, { status: 403 });
  }
  try {
    const atual = await Database.getCondominioById(id);
    if (!atual) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
    const body = await request.json();
    const { dados, erro } = validarCadastro(body);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });
    if (dados.cnpj && dados.cnpj !== atual.cnpj) {
      const outro = (await Database.getCondominios()).find((c) => c.cnpj === dados.cnpj && c.id !== id);
      if (outro) return NextResponse.json({ error: `CNPJ já cadastrado em "${outro.nome}".` }, { status: 409 });
    }
    // Saída da carteira registra a data (painel de crescimento conta as saídas).
    const updates: Record<string, unknown> = { ...dados };
    if (dados.ativo === false && atual.ativo !== false) updates.desativado_em = hojeISO();
    if (dados.ativo === true && atual.ativo === false) updates.desativado_em = null;
    // Localização no mapa (24/11): quem salva aqui grava origem 'manual'. Vazio
    // nos dois campos limpa; um só, ou valor fora do mundo, é erro. A origem
    // 'chegada' só nasce em PATCH /api/os/[id] (primeira chegada com boa precisão).
    let mudouLocalizacao = false;
    if (body.lat !== undefined || body.lng !== undefined) {
      const vazio = (v: unknown) => v === null || v === '' || v === undefined;
      if (vazio(body.lat) && vazio(body.lng)) {
        Object.assign(updates, { lat: null, lng: null, localizacao_origem: null, localizacao_em: null });
      } else {
        const lat = typeof body.lat === 'string' ? Number(body.lat.replace(',', '.')) : body.lat;
        const lng = typeof body.lng === 'string' ? Number(body.lng.replace(',', '.')) : body.lng;
        if (!coordenadaValida(lat, lng)) {
          return NextResponse.json({ error: 'Localização inválida. Use latitude e longitude, como -23.5505, -46.6333.' }, { status: 400 });
        }
        Object.assign(updates, { lat, lng, localizacao_origem: 'manual', localizacao_em: new Date().toISOString() });
      }
      mudouLocalizacao = true;
    }
    const condominio = await Database.updateCondominio(id, updates);
    const mudou = Object.keys(dados).filter((k) => (dados as Record<string, unknown>)[k] !== (atual as unknown as Record<string, unknown>)[k]);
    if (mudouLocalizacao) mudou.push('localizacao');
    if (mudou.length) {
      await Database.createAuditLog({ entidade: 'condominio', entidade_id: id, acao: 'CADASTRO_ALTERADO', ator: session.name, detalhe: { campos: mudou } });
    }
    return NextResponse.json({ success: true, condominio });
  } catch (e) {
    console.error('Erro ao atualizar condomínio:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// DELETE /api/condominios/[id]  body: { confirmar_nome } — apaga o condomínio
// e tudo dele (OS, equipamentos, cobranças, acesso do síndico, arquivos). Só
// admin. Pede o nome digitado de novo como trava contra clique errado.
// Cliente que saiu NÃO se apaga: desmarca "Contrato ativo" (mantém histórico).
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarCondominio(session.role)) {
    return NextResponse.json({ error: 'Só gestores podem apagar um condomínio.' }, { status: 403 });
  }
  const condominio = await Database.getCondominioById(id);
  if (!condominio) return NextResponse.json({ error: 'Condomínio não encontrado.' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const digitado = typeof body?.confirmar_nome === 'string' ? body.confirmar_nome.trim().toLowerCase() : '';
  if (digitado !== condominio.nome.trim().toLowerCase()) {
    return NextResponse.json({ error: 'Digite o nome do condomínio exatamente como está cadastrado.' }, { status: 400 });
  }
  try {
    await Database.apagarCondominio(id, session.name);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao apagar condomínio:', e);
    return NextResponse.json({ error: 'Não foi possível apagar o condomínio.' }, { status: 500 });
  }
}
