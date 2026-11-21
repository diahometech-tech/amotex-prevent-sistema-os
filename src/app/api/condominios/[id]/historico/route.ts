import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canAccessCondominio } from '@/lib/auth';
import { hojeISO } from '@/lib/os-agenda';
import { isEscritorio, isTecnico, osEncerrada } from '@/lib/roles';

type RouteContext = { params: Promise<{ id: string }> };

// Quantas OS anteriores a tela mostra (as mais recentes).
const LIMITE = 30;

// GET /api/condominios/[id]/historico — OS anteriores (finalizadas e
// canceladas) do condomínio, só leitura, pro técnico consultar o que já foi
// feito no local. Cada linha abre a OS por GET /api/os/[id] (podeLerOS).
// Só devolve o resumo — sem contrato, assinaturas nem logs. Síndico não usa
// (ele tem o histórico no Painel).
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });
  if (!isTecnico(session.role) && !isEscritorio(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  if (!(await canAccessCondominio(session, id))) {
    return NextResponse.json({ error: 'Você não tem acesso a este condomínio.' }, { status: 403 });
  }
  const [todas, users] = await Promise.all([Database.getOSsByCondominio(id), Database.getUsers()]);
  const nomes = new Map(users.map((u) => [u.id, u.nome]));
  const historico = todas
    .filter(osEncerrada)
    // Data do encerramento (cancelada/finalizada = saída), na falta dela a da
    // visita ou da abertura; mais recente primeiro.
    .map((os) => ({ os, data: hojeISO(new Date(os.saida_em || os.criado_em)) }))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
    .slice(0, LIMITE)
    .map(({ os, data }) => ({
      id: os.id,
      tipo: os.tipo,
      status: os.status,
      data,
      tecnico_nome: os.tecnico_id ? nomes.get(os.tecnico_id) ?? null : null,
      descricao_problema: os.descricao_problema ?? null,
      observacao: os.observacao ?? null,
    }));
  return NextResponse.json({ historico });
}
