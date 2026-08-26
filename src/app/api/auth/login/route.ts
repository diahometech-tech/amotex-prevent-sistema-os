import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { SESSION_COOKIE, encodeSession, verifyPassword, hashPassword, getClientIp } from '@/lib/auth';
import { checkRateLimit, recordFailure, clearRateLimit } from '@/lib/rate-limit';

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

// POST /api/auth/login  body: { login, password }
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

    const { login, password } = await request.json();
    if (!login || !password) {
      return NextResponse.json({ error: 'Informe usuário e senha.' }, { status: 400 });
    }

    const user = await Database.getUserByLogin(login);
    if (!user || !user.ativo) {
      recordFailure(rateLimitKey, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS);
      return NextResponse.json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
    }
    const check = verifyPassword(user.senha_hash, password);
    if (!check.ok) {
      recordFailure(rateLimitKey, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS);
      return NextResponse.json({ error: 'Usuário ou senha inválidos.' }, { status: 401 });
    }
    clearRateLimit(rateLimitKey);
    if (check.needsUpgrade) {
      await Database.updateUser(user.id, { senha_hash: hashPassword(password) });
    }

    const res = NextResponse.json({
      success: true,
      user: { id: user.id, name: user.nome, role: user.papel, condominio_id: user.condominio_id },
    });
    res.cookies.set(SESSION_COOKIE, encodeSession({ id: user.id, name: user.nome, role: user.papel }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12h
    });
    await Database.createSessionLog({
      user_name: user.nome,
      role: user.papel,
      action: 'login',
      ip_address: ip,
    });
    return res;
  } catch (e) {
    console.error('Erro no login:', e);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
