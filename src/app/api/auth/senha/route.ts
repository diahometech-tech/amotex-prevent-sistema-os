import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { getSessionFromRequest, verifyPassword, hashPassword } from '@/lib/auth';
import { checkRateLimit, recordFailure, clearRateLimit } from '@/lib/rate-limit';

const JANELA_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 8;
const SENHA_MIN = 8;

// POST /api/auth/senha — a própria pessoa troca a senha (piloto de 09/11: o
// gestor cria o acesso com senha provisória e cada um troca no 1º acesso).
// Exige a senha atual; errar conta no mesmo limite de tentativas do login.
export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Sessão expirada.' }, { status: 401 });

  const chave = `senha:${session.id}`;
  const rl = checkRateLimit(chave, JANELA_MS, MAX_TENTATIVAS);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente de novo em alguns minutos.' }, { status: 429 });
  }
  try {
    const { atual, nova } = await request.json();
    if (typeof atual !== 'string' || typeof nova !== 'string') {
      return NextResponse.json({ error: 'Informe a senha atual e a nova.' }, { status: 400 });
    }
    if (nova.length < SENHA_MIN) {
      return NextResponse.json({ error: `A nova senha precisa ter pelo menos ${SENHA_MIN} caracteres.` }, { status: 400 });
    }
    if (nova === atual) {
      return NextResponse.json({ error: 'A nova senha precisa ser diferente da atual.' }, { status: 400 });
    }
    const user = await Database.getUserById(session.id);
    if (!user || !user.ativo) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    if (!verifyPassword(user.senha_hash, atual).ok) {
      recordFailure(chave, JANELA_MS, MAX_TENTATIVAS);
      return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 400 });
    }
    clearRateLimit(chave);
    await Database.updateUser(user.id, { senha_hash: hashPassword(nova) });
    await Database.createAuditLog({ entidade: 'usuario', entidade_id: user.id, acao: 'SENHA_TROCADA', ator: user.nome });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Erro ao trocar senha:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
