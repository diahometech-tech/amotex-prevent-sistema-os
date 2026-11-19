import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { podeEditarEquipamento } from '@/lib/roles';

// GET /api/equipamentos/catalogo — combinações únicas de tipo/modelo/potência
// já cadastradas em QUALQUER condomínio, pra reaproveitar no cadastro em vez
// de digitar de novo (bombas e boias costumam se repetir entre condomínios).
// Cadastrar continua livre — uma combinação nova entra no catálogo sozinha,
// na próxima vez que alguém buscar. Mesmo acesso de quem cadastra equipamento
// (admin ou técnico); não expõe condominio_id, só o formato do equipamento.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !podeEditarEquipamento(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const equipamentos = await Database.getEquipamentos();
  const vistos = new Set<string>();
  const catalogo: { tipo: string; modelo?: string; potencia_hp?: number }[] = [];
  for (const e of equipamentos) {
    const chave = `${e.tipo}|${e.modelo ?? ''}|${e.potencia_hp ?? ''}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    catalogo.push({ tipo: e.tipo, modelo: e.modelo, potencia_hp: e.potencia_hp });
  }
  catalogo.sort((a, b) => a.tipo.localeCompare(b.tipo) || (a.modelo ?? '').localeCompare(b.modelo ?? ''));
  return NextResponse.json({ catalogo });
}
