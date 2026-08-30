import { NextRequest, NextResponse } from 'next/server';
import { Database, type User } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';
import { isAdminOrTecnico } from '@/lib/roles';

const VALID_ROLES = ['admin', 'tecnico', 'sindico'];

function safe(u: User) {
  const { senha_hash: _senha_hash, ...rest } = u;
  return rest;
}

// GET /api/users — lista usuários (sem senha).
//
// Admin recebe a lista completa (é a tela de gestão de usuários).
// Técnico recebe só id/nome dos OUTROS técnicos ativos: ele também abre OS
// (POST /api/os aceita admin e técnico) e precisa preencher o seletor de
// "técnico responsável" — sem isso o seletor ficava sempre vazio pra ele,
// porque a rota respondia 403 e o erro era engolido no client.
// Deliberadamente NÃO expõe síndicos, logins, papéis nem condominio_id: pra
// preencher o seletor basta id e nome. Síndico continua bloqueado.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !isAdminOrTecnico(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const users = await Database.getUsers();
  if (!canManageUsers(session.role)) {
    const tecnicos = users
      .filter((u) => u.papel === 'tecnico' && u.ativo)
      .map((u) => ({ id: u.id, nome: u.nome }));
    return NextResponse.json({ users: tecnicos });
  }
  return NextResponse.json({ users: users.map(safe) });
}

// POST /api/users — cria usuário. Só admin.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const { nome, login, senha, papel, condominio_id } = await request.json();
    if (!nome || !login || !senha || !papel) {
      return NextResponse.json({ error: 'Preencha nome, login, senha e papel.' }, { status: 400 });
    }
    if (!VALID_ROLES.includes(papel)) {
      return NextResponse.json({ error: 'Papel inválido.' }, { status: 400 });
    }
    if (papel === 'sindico' && !condominio_id) {
      return NextResponse.json({ error: 'Informe o condomínio do síndico.' }, { status: 400 });
    }
    const exists = await Database.getUserByLogin(login);
    if (exists) {
      return NextResponse.json({ error: 'Este login já existe.' }, { status: 409 });
    }
    const user = await Database.createUser({ nome, login, senha, papel, condominio_id });
    return NextResponse.json({ success: true, user: safe(user) });
  } catch (e) {
    console.error('Erro ao criar usuário:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
