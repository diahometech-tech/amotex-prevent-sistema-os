import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podeVerMapaGeral, rastreioAtivo } from '@/lib/rastreio';
import { destinoDoCondominio, montarRastreio } from '@/lib/rastreio-servidor';

// GET /api/rastreio — todos os técnicos a caminho agora (Mapa ao vivo).
// Só gestor e secretária; técnico e síndico recebem 403.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!podeVerMapaGeral(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const agora = Date.now();
  const ativas = (await Database.getOSs()).filter((o) => rastreioAtivo(o, agora));
  const [condominios, usuarios, posicoes] = await Promise.all([
    Database.getCondominios(),
    Database.getUsers(),
    Database.getUltimasPosicoes(ativas.map((o) => o.id)),
  ]);
  const condPorId = new Map(condominios.map((c) => [c.id, c]));
  const userPorId = new Map(usuarios.map((u) => [u.id, u]));
  const posPorOs = new Map(posicoes.map((p) => [p.os_id, p]));

  const itens = ativas
    .map((os) => {
      const cond = condPorId.get(os.condominio_id) ?? null;
      const r = montarRastreio(os, cond, os.tecnico_id ? userPorId.get(os.tecnico_id) ?? null : null, posPorOs.get(os.id) ?? null, agora);
      return {
        os: { id: os.id, codigo: os.id.slice(0, 6).toUpperCase(), tipo: os.tipo },
        tecnico: { id: os.tecnico_id ?? null, nome: r.tecnico_nome },
        condominio: { id: os.condominio_id, nome: cond?.nome ?? 'Condomínio', destino: destinoDoCondominio(cond) },
        a_caminho_em: r.a_caminho_em,
        posicao: r.posicao,
        estimativa: r.estimativa,
        posicao_velha: r.posicao_velha,
      };
    })
    .sort((a, b) => (a.a_caminho_em ?? '').localeCompare(b.a_caminho_em ?? ''));

  return NextResponse.json({ itens }, { headers: { 'Cache-Control': 'no-store' } });
}
