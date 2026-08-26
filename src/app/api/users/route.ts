import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

const VALID_ROLES = ['admin', 'tecnico', 'sindico'];

function safe(u: any) {
  const { senha_hash, ...rest } = u;
  return rest;
}

// GET /api/users — lista usuários (sem senha). Só admin.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const users = await Database.getUsers();
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
