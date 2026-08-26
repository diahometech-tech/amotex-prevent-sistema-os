// Sessão por cookie ASSINADO (HMAC-SHA256) + helpers de senha (bcrypt).
// O segredo vem de JWT_SECRET (obrigatório em produção). Em dev usa um
// segredo fixo apenas para conveniência local.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { NextRequest } from 'next/server';
import type { UserRole } from './db';

export const SESSION_COOKIE = 'amotex_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h (igual ao maxAge do cookie)

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') {
    // Em produção NÃO caímos para a chave de dev (que está no código-fonte):
    // sessões assinadas com ela seriam forjáveis por qualquer um. Aborta.
    throw new Error('[auth] JWT_SECRET ausente ou muito curto (<16) em produção. Defina JWT_SECRET no ambiente.');
  }
  return 'nexusflow-dev-secret-nao-usar-em-producao';
}

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function encodeSession(user: SessionUser): string {
  const json = JSON.stringify({
    id: user.id,
    name: user.name,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  });
  const payload = Buffer.from(json, 'utf-8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined | null): SessionUser | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return null; // formato antigo (não assinado) → inválido
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!obj || !obj.id || !obj.role) return null;
    if (obj.exp && Date.now() > obj.exp) return null; // expirada
    return { id: obj.id, name: obj.name, role: obj.role } as SessionUser;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): SessionUser | null {
  return decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
}

// IP de origem real do usuário. A VPS fica atrás de Cloudflare Tunnel, então
// o IP de conexão direta é sempre o do túnel — o IP real vem no header
// x-forwarded-for (primeiro da lista; os demais são proxies intermediários).
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'desconhecido';
}

// Papéis com poder de administração de usuários.
export function canManageUsers(role?: UserRole): boolean {
  return role === 'admin';
}

// Síndico só enxerga/edita dados do próprio condomínio (Painel Condominial) —
// bloquear com este helper em qualquer endpoint que liste dados de todos os
// condomínios, em vez de checar `role === 'sindico'` inline.
export function isScopedToOwnCondominio(role?: UserRole): boolean {
  return role === 'sindico';
}

// Confere se a sessão pode acessar dados do condomínio informado — admin e
// técnico acessam qualquer um; síndico só o próprio (busca no banco, nunca
// confia num condominio_id vindo do client). Usar em toda rota aninhada sob
// /api/condominios/[id]/* e /api/os que filtre por condomínio.
export async function canAccessCondominio(session: SessionUser, condominioId: string): Promise<boolean> {
  if (session.role !== 'sindico') return true;
  const { Database } = await import('./db');
  const user = await Database.getUserById(session.id);
  return user?.condominio_id === condominioId;
}

// ===== Senhas (bcrypt) =====

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function isHashed(stored: string): boolean {
  return /^\$2[aby]\$/.test(stored);
}

// Verifica a senha. `needsUpgrade` = senha legada em texto puro que conferiu
// (o chamador deve regravar com hashPassword).
export function verifyPassword(
  stored: string,
  plain: string
): { ok: boolean; needsUpgrade: boolean } {
  if (isHashed(stored)) {
    return { ok: bcrypt.compareSync(plain, stored), needsUpgrade: false };
  }
  const ok = stored === plain;
  return { ok, needsUpgrade: ok };
}
