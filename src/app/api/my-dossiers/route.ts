import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

// GET /api/my-dossiers — lista de OS captadas pelo captador logado (projeção segura).
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const all = await Database.getDossiers();
  const mine = all
    .filter((d) => (d.captured_by || '') === session.name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((d) => ({
      id: d.id,
      client_name: d.client_name,
      cpf: d.cpf,
      phone: d.phone,
      email: d.email,
      address: d.address,
      gov_level: d.gov_level,
      gov_login: d.gov_login,
      status: d.status,
      current_step: d.current_step,
      created_at: d.created_at,
      protocolo: d.protocolo,
      // Pro captador acompanhar o próprio agendamento de certificação (dia/
      // horário e pra quem foi agendado) sem precisar perguntar pra
      // ninguém — resp_certificacao pode ainda estar vazio (atribuído
      // depois pelo gestor), a tela trata isso como "aguardando atribuição".
      agendamento_cert: d.agendamento_cert,
      resp_certificacao: d.resp_certificacao,
      // Status da aprovação do certificador — o captador precisa saber se o
      // horário que ele marcou já foi aceito, ainda está pendente ou foi
      // recusado (e por quê). Agendamento antigo, anterior a esse fluxo, vem
      // sem status: a tela trata ausência como "aprovado".
      agendamento_status: d.agendamento_status,
      agendamento_recusa_motivo: d.agendamento_recusa_motivo,
    }));

  return NextResponse.json({ dossiers: mine });
}
