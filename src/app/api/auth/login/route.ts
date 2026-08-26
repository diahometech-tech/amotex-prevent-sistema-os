import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { SESSION_COOKIE, encodeSession, verifyPassword, hashPassword, getClientIp } from '@/lib/auth';
import { checkRateLimit, recordFailure, clearRateLimit } from '@/lib/rate-limit';

// Rate limiting de login (item pendente da auditoria de segurança, corrigido
// 24/07/2026): 8 tentativas malsucedidas por IP em 10 minutos bloqueiam esse
// IP por mais 10 minutos. Chave é só o IP (não usuário+IP) — não faz sentido
// permitir ataque de força bruta rotativo por usuário na mesma origem, e
// evita complexidade extra sem ganho real pra um app interno com poucos
// usuários fixos.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

// POST /api/auth/login  body: { username, password }
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rateLimitKey = `login:${ip}`;
    const rl = checkRateLimit(rateLimitKey, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
        { status: 429, headers: rl.retryAfterSeconds ? { 'Retry-After': String(rl.retryAfterSeconds) } : undefined }
      );
    }

    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Informe usuário e senha.' }, { status: 400 });
    }

    const user = await Database.getUserByUsername(username);
    if (!user || !user.active) {
      recordFailure(rateLimitKey, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS);
      return NextResponse.json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
    }
    const check = verifyPassword(user.password, password);
    if (!check.ok) {
      recordFailure(rateLimitKey, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS);
      return NextResponse.json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
    }
    clearRateLimit(rateLimitKey);
    // Migra senha legada (texto puro) para bcrypt no primeiro login bem-sucedido.
    if (check.needsUpgrade) {
      await Database.updateUser(user.id, { password: hashPassword(password) });
    }

    const res = NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, role: user.role },
    });
    res.cookies.set(SESSION_COOKIE, encodeSession(user), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12h
    });
    await Database.createSessionLog({
      user_name: user.name,
      role: user.role,
      action: 'login',
      ip_address: getClientIp(request),
    });
    return res;
  } catch (e) {
    console.error('Erro no login:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
