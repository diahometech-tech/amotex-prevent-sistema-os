import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { PRECISAO_MAXIMA_M, coordenadaValida, podeEnviarPosicao, rastreioAtivo } from '@/lib/rastreio';

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/os/[id]/posicao — o técnico informa onde está no trecho "a caminho".
//
// ENDPOINT GENÉRICO: hoje quem chama é o navegador do técnico (PWA, com
// `navigator.geolocation.watchPosition`, no máximo a cada 15 s). Mais adiante o
// app Android vai mandar a posição em segundo plano para ESTE MESMO endpoint,
// com o mesmo cookie de sessão e o mesmo corpo — não crie outro endpoint.
//
// Corpo: { lat: number, lng: number, precisao_m?: number }
//   400  lat/lng ausentes, não numéricos ou fora dos limites do mundo
//   403  quem chama não é o técnico da OS (gestor, secretária e síndico também não)
//   409  { ativo: false } — fora da janela: sem "Estou a caminho", já chegou, OS
//        encerrada ou mais de 2 h desde o "a caminho". O cliente DEVE parar de enviar.
//   200  { success: true, gravada: true }
//        { success: true, gravada: false }  última posição tem menos de 5 s (não gravou)
//        { success: true, ignorada: true }  precisão pior que 1000 m (não gravou)
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (session.role !== 'tecnico') {
    return NextResponse.json({ error: 'Só o técnico da OS envia a posição.' }, { status: 403 });
  }
  const os = await Database.getOSById(id);
  if (!os) return NextResponse.json({ error: 'OS não encontrada.' }, { status: 404 });
  if (!podeEnviarPosicao(session, os)) {
    return NextResponse.json({ error: 'Só o técnico da OS envia a posição.' }, { status: 403 });
  }
  if (!rastreioAtivo(os)) {
    return NextResponse.json({ ativo: false, error: 'O acompanhamento desta OS não está ativo.' }, { status: 409 });
  }

  let corpo: Record<string, unknown>;
  try {
    const lido = await request.json();
    corpo = lido && typeof lido === 'object' ? (lido as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }
  const lat = corpo.lat;
  const lng = corpo.lng;
  if (!coordenadaValida(lat, lng)) {
    return NextResponse.json({ error: 'Coordenadas inválidas.' }, { status: 400 });
  }
  let precisao: number | undefined;
  if (typeof corpo.precisao_m === 'number' && Number.isFinite(corpo.precisao_m) && corpo.precisao_m >= 0) {
    precisao = Math.round(corpo.precisao_m);
    if (precisao > PRECISAO_MAXIMA_M) return NextResponse.json({ success: true, ignorada: true });
  }

  try {
    const gravada = await Database.registrarPosicao({
      os_id: id, tecnico_id: session.id, lat, lng: lng as number, ...(precisao !== undefined ? { precisao_m: precisao } : {}),
    });
    return NextResponse.json({ success: true, gravada });
  } catch (e) {
    console.error('Erro ao gravar a posição do técnico:', e);
    return NextResponse.json({ error: 'Não foi possível gravar a posição.' }, { status: 500 });
  }
}
