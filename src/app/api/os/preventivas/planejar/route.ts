import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { hojeISO } from '@/lib/os-agenda';
import { criarChecklistInicial } from '@/lib/os-checklist-inicial';
import { mesValido, planejarPreventivasMes } from '@/lib/planejamento-preventiva';

// POST /api/os/preventivas/planejar — rota mensal das preventivas. Só admin.
// Corpo: { mes: 'YYYY-MM', confirmar?: boolean }. Sem `confirmar` devolve só a
// prévia (nada é gravado); com `confirmar: true` cria uma OS preventiva por
// item do plano. Recalcula o plano na confirmação (não confia na prévia do
// cliente) — e é idempotente: condomínio que já tem preventiva no mês fica
// de fora, então rodar duas vezes não duplica. Regra em
// src/lib/planejamento-preventiva.ts.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores planejam a rota de preventivas.' }, { status: 403 });
  }
  try {
    const { mes, confirmar } = await request.json();
    if (!mesValido(mes)) return NextResponse.json({ error: 'Informe o mês (AAAA-MM).' }, { status: 400 });
    const hoje = hojeISO();
    if (mes < hoje.slice(0, 7)) return NextResponse.json({ error: 'Esse mês já passou.' }, { status: 400 });

    const [condominios, users, oss] = await Promise.all([Database.getCondominios(), Database.getUsers(), Database.getOSs()]);
    const tecnicos = users.filter((u) => u.papel === 'tecnico' && u.ativo && u.especialidade === 'preventiva');
    if (tecnicos.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum técnico com especialidade "Preventiva". Defina em Usuários › Editar.' },
        { status: 400 }
      );
    }

    const plano = planejarPreventivasMes({
      mes, hoje, oss,
      condominios: condominios.map((c) => ({ id: c.id, nome: c.nome })),
      tecnicos: tecnicos.map((t) => t.id),
    });
    const nomeCondominio = new Map(condominios.map((c) => [c.id, c.nome]));
    const nomeTecnico = new Map(tecnicos.map((t) => [t.id, t.nome]));
    const itens = plano.itens.map((i) => ({
      ...i,
      condominio_nome: nomeCondominio.get(i.condominio_id) ?? '',
      tecnico_nome: nomeTecnico.get(i.tecnico_id) ?? '',
    }));

    if (!confirmar) {
      return NextResponse.json({ ...plano, itens, totalCondominios: condominios.length });
    }

    for (const item of plano.itens) {
      const os = await Database.createOS({
        condominio_id: item.condominio_id, tipo: 'preventiva', origem: 'manual',
        tecnico_id: item.tecnico_id, data_programada: item.data,
      });
      await criarChecklistInicial(os);
    }
    await Database.createAuditLog({
      entidade: 'os', acao: 'PLANEJAMENTO_PREVENTIVAS', ator: session.name,
      detalhe: { mes, criadas: plano.itens.length, ja_agendados: plano.jaAgendados },
    });
    return NextResponse.json({ success: true, criadas: plano.itens.length, jaAgendados: plano.jaAgendados });
  } catch (e) {
    console.error('Erro ao planejar preventivas:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
