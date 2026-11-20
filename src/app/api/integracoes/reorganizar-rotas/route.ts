import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { aplicarReorganizacao } from '@/lib/reorganizar-rotas';

// POST /api/integracoes/reorganizar-rotas — chamado pelo n8n (workflow
// agendado, todo dia às 5h), não por gente. Mesmo segredo do webhook (header
// X-Amotex-Secret = N8N_WEBHOOK_SECRET). As preventivas abertas que ficaram
// pra trás entram primeiro no próximo dia útil e a fila de cada técnico anda
// (regra em src/lib/reorganizar-fila.ts). Idempotente: rodar de novo no mesmo
// dia não muda nada. Cada OS remarcada ganha um audit log REAGENDADA_AUTOMATICA.
export async function POST(request: NextRequest) {
  const segredo = process.env.N8N_WEBHOOK_SECRET;
  if (!segredo) return NextResponse.json({ error: 'Integração não configurada.' }, { status: 503 });
  const enviado = request.headers.get('x-amotex-secret') ?? '';
  const a = Buffer.from(enviado);
  const b = Buffer.from(segredo);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  try {
    const { meta, movimentos } = await aplicarReorganizacao('n8n');
    return NextResponse.json({ success: true, meta, remarcadas: movimentos.length, movimentos });
  } catch (e) {
    console.error('Erro na rotina de reorganizar rotas:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
