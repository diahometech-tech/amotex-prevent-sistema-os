import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { Database } from '@/lib/db';
import { resumoDiarioGestor } from '@/lib/financeiro/resumo-diario';
import { hojeISO } from '@/lib/os-agenda';

// GET /api/integracoes/resumo-diario — chamado pelo n8n (workflow agendado,
// todo dia de manhã), não por gente. Autenticado pelo mesmo segredo do
// webhook (header X-Amotex-Secret = N8N_WEBHOOK_SECRET). Devolve o texto e os
// gestores (admin ativos com Telegram) — o n8n só entrega.
export async function GET(request: NextRequest) {
  const segredo = process.env.N8N_WEBHOOK_SECRET;
  if (!segredo) return NextResponse.json({ error: 'Integração não configurada.' }, { status: 503 });
  const enviado = request.headers.get('x-amotex-secret') ?? '';
  const a = Buffer.from(enviado);
  const b = Buffer.from(segredo);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

  const [condominios, cobrancas, reajustes, oss, users] = await Promise.all([
    Database.getCondominios(), Database.getCobrancas(), Database.getReajustes(), Database.getOSs(), Database.getUsers(),
  ]);
  const { mensagem, temAlgo } = resumoDiarioGestor({ hoje: hojeISO(), agora: Date.now(), condominios, cobrancas, reajustes, oss });
  const destinatarios = users
    .filter((u) => u.ativo && u.papel === 'admin' && u.telegram_chat_id)
    .map((u) => ({ nome: u.nome, telegram_chat_id: u.telegram_chat_id }));
  return NextResponse.json({ mensagem, temAlgo, destinatarios });
}
