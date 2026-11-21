// Sessão por cookie ASSINADO (HMAC-SHA256) + helpers de senha (bcrypt).
// O segredo vem de JWT_SECRET (obrigatório em produção). Em dev usa um
// segredo fixo apenas para conveniência local.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { NextRequest } from 'next/server';
import type { Condominio, OS, UserRole } from './db';
import { isAdmin, isEscritorio, isScopedToOwnCondominio as isSindico, tecnicoVeOS, osEncerrada } from './roles';

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
// Regra vem de src/lib/roles.ts — a interface precisa da MESMA regra e não
// pode importar este arquivo (bcrypt/crypto não vão pro bundle do cliente).
export function canManageUsers(role?: UserRole): boolean {
  return isAdmin(role);
}

// Síndico só enxerga/edita dados do próprio condomínio (Painel Condominial) —
// bloquear com este helper em qualquer endpoint que liste dados de todos os
// condomínios, em vez de checar `role === 'sindico'` inline.
export function isScopedToOwnCondominio(role?: UserRole): boolean {
  return isSindico(role);
}

// Confere se a sessão pode acessar dados do condomínio informado — admin e
// técnico acessam qualquer um; síndico só o próprio (busca no banco, nunca
// confia num condominio_id vindo do client). Usar em toda rota aninhada sob
// /api/condominios/[id]/* e /api/os que filtre por condomínio.
//
// Por papel: admin e secretária acessam qualquer um; síndico só o próprio;
// técnico só os condomínios onde há alguma OS que ele vê (as dele ou uma
// corretiva sem técnico) — ver tecnicoVeOS em src/lib/roles.ts. Qualquer
// outro valor de papel (cookie antigo, papel desconhecido) é recusado.
export async function canAccessCondominio(session: SessionUser, condominioId: string): Promise<boolean> {
  if (isEscritorio(session.role)) return true;
  const { Database } = await import('./db');
  if (session.role === 'sindico') {
    const user = await Database.getUserById(session.id);
    return !!condominioId && user?.condominio_id === condominioId;
  }
  if (session.role === 'tecnico') {
    const oss = await Database.getOSsByCondominio(condominioId);
    return oss.some((os) => tecnicoVeOS(session.id, os));
  }
  return false;
}

// Confere se a sessão pode ver/abrir uma OS específica (GET /api/os/[id] e
// rotas aninhadas, fotos em /uploads/os/...). Mesma regra da lista.
export async function podeVerOS(
  session: SessionUser,
  os: Pick<OS, 'condominio_id' | 'tecnico_id' | 'tipo' | 'status'>
): Promise<boolean> {
  if (isEscritorio(session.role)) return true;
  if (session.role === 'tecnico') return tecnicoVeOS(session.id, os);
  if (session.role === 'sindico') return canAccessCondominio(session, os.condominio_id);
  return false;
}

// Leitura de OS: o que podeVerOS permite + histórico do condomínio — o
// técnico lê (só lê) as OS ENCERRADAS (finalizadas/canceladas) dos condomínios
// onde tem OS visível. Usar só em rotas GET (OS, fotos/PDF em /uploads);
// qualquer escrita continua em podeVerOS.
export async function podeLerOS(
  session: SessionUser,
  os: Pick<OS, 'condominio_id' | 'tecnico_id' | 'tipo' | 'status'>
): Promise<boolean> {
  if (await podeVerOS(session, os)) return true;
  if (session.role === 'tecnico' && osEncerrada(os)) return canAccessCondominio(session, os.condominio_id);
  return false;
}

// Filtra uma lista de OS para o que a sessão pode ver (GET /api/os).
export async function filtrarOSVisiveis<T extends Pick<OS, 'condominio_id' | 'tecnico_id' | 'tipo' | 'status'>>(
  session: SessionUser,
  oss: T[]
): Promise<T[]> {
  if (isEscritorio(session.role)) return oss;
  if (session.role === 'tecnico') return oss.filter((os) => tecnicoVeOS(session.id, os));
  if (session.role === 'sindico') {
    const { Database } = await import('./db');
    const user = await Database.getUserById(session.id);
    if (!user?.condominio_id) return [];
    return oss.filter((os) => os.condominio_id === user.condominio_id);
  }
  return [];
}

// Campos do condomínio que são de contrato/financeiro — só o escritório
// (gestor e secretária) recebe. Técnico e síndico recebem o cadastro sem eles
// (antes, GET /api/condominios[/id] e /api/os/[id] entregavam valor, CNPJ e
// e-mails de cobrança a qualquer sessão autorizada no condomínio).
const CAMPOS_CONTRATO: (keyof Condominio)[] = [
  'cnpj', 'razao_social', 'emails_cobranca', 'valor_mensal_centavos', 'dia_vencimento',
  'contrato_inicio', 'reajuste_indice', 'reajuste_percentual_fixo', 'responsavel_email',
  'observacoes', 'desativado_em',
];
export function condominioParaPapel<T extends Partial<Condominio>>(role: UserRole, c: T): T {
  if (isEscritorio(role)) return c;
  const copia: Partial<Condominio> = { ...c };
  for (const k of CAMPOS_CONTRATO) delete copia[k];
  return copia as T;
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
