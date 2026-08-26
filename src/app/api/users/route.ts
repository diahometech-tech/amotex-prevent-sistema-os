import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';

const VALID_ROLES = [
  'captador', 'operador_certificacao', 'operador_abertura', 'gestor', 'admin', 'terceiro', 'certificador',
];

// Remove a senha antes de devolver ao cliente.
function safe(u: any) {
  const { password, ...rest } = u;
  return rest;
}

// GET /api/users — lista usuários (sem senha). Só gestor/admin.
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const users = await Database.getUsers();
  return NextResponse.json({ users: users.map(safe) });
}

// POST /api/users — cria usuário. Só gestor/admin.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session || !canManageUsers(session.role)) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  try {
    const { name, username, password, role, terceiro_projeto, gestor_projetos } = await request.json();
    if (!name || !username || !password || !role) {
      return NextResponse.json({ error: 'Preencha nome, usuário, senha e papel.' }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Papel inválido.' }, { status: 400 });
    }
    const exists = await Database.getUserByUsername(username);
    if (exists) {
      return NextResponse.json({ error: 'Este nome de usuário já existe.' }, { status: 409 });
    }
    // Escopo de projeto só faz sentido pro papel 'terceiro' — isolamento entre
    // parceiros de e-commerce de projetos diferentes (ver comentário no tipo User).
    const projetoScope = role === 'terceiro' && typeof terceiro_projeto === 'string' ? terceiro_projeto.trim() : undefined;
    // Escopo de projeto(s) pro papel 'gestor' (ver src/lib/gestor-scope.ts).
    const gestorProjetosScope = role === 'gestor' && typeof gestor_projetos === 'string' ? gestor_projetos.trim() : undefined;
    const user = await Database.createUser({
      name, username, password, role,
      ...(projetoScope ? { terceiro_projeto: projetoScope } : {}),
      ...(gestorProjetosScope ? { gestor_projetos: gestorProjetosScope } : {}),
    });
    return NextResponse.json({ success: true, user: safe(user) });
  } catch (e) {
    console.error('Erro ao criar usuário:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
