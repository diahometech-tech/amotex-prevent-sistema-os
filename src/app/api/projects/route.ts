import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSessionFromRequest } from '@/lib/auth';
import { getGestorScope } from '@/lib/gestor-scope';
import { UPLOADS_DIR } from '@/lib/storage';
import { Database } from '@/lib/db';

// Lista de projetos persiste em um JSON ao lado da pasta de uploads.
const PROJECTS_FILE = path.join(path.dirname(UPLOADS_DIR), 'projects.json');

export interface Project {
  nome: string;
  capacidade: number; // 0 = ilimitado
  // Contador Contex padrão do projeto — ao atribuir uma OS a este projeto, o
  // contador_abertura já é preenchido automaticamente, evitando o erro de
  // atribuição manual (mais de uma pessoa mexendo no mesmo lote por engano).
  contador_abertura?: string;
}

const DEFAULT_PROJECTS: Project[] = [
  { nome: 'Projeto 01', capacidade: 0 },
  { nome: 'Projeto 02', capacidade: 0 },
];

function readProjects(): Project[] {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
      // Retrocompatibilidade: array de strings vira objetos com capacidade 0
      if (Array.isArray(raw)) {
        return raw.map((p) =>
          typeof p === 'string' ? { nome: p, capacidade: 0 } : p
        );
      }
    }
  } catch {}
  return [...DEFAULT_PROJECTS];
}

function writeProjects(projects: Project[]) {
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  } catch (e) {
    console.error('[projects] Falha ao salvar projects.json:', e);
  }
}

async function withUsados(projects: Project[]) {
  const dossiers = await Database.getDossiers();
  return projects.map((p) => ({
    ...p,
    usados: dossiers.filter((d) => d.projeto === p.nome).length,
  }));
}

// Criação/gerenciamento de projeto agora é só na tela dedicada "Projetos" (gestor/admin) —
// terceiro passou a só SELECIONAR um projeto já existente (não cria mais na hora).
const ALLOWED_ROLES = ['gestor', 'admin'];

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  let projects = await withUsados(readProjects());
  // Isolamento entre gestores de projetos diferentes (ver src/lib/gestor-scope.ts)
  // — sem isso, uma conta gestor escopada continuaria vendo nome/uso de
  // projetos de outros gestores na tela "Projetos", mesmo sem acesso às OS's.
  if (session.role === 'gestor') {
    const escopo = await getGestorScope(session);
    if (escopo.length > 0) {
      projects = projects.filter((p) => escopo.includes(p.nome));
    }
  }
  // Explícito aqui (não só via headers() do next.config.ts) — contagem de
  // "vagas usadas" reportada como divergente entre 2 contas vendo a mesma
  // hora (11/08/2026); header CDN-Cache-Control cobre o caso de um proxy/CDN
  // na frente (Cloudflare Tunnel) decidir cachear apesar do Cache-Control
  // padrão já enviado pelo Next.
  return NextResponse.json(
    { projects },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' } }
  );
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }
  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Nome inválido' }, { status: 400 });
  // Isolamento entre gestores de projetos diferentes: uma conta gestor
  // escopada não cria projetos novos fora do próprio escopo (evita "poluir"
  // a lista global com um projeto que nem ela mesma voltaria a ver depois).
  if (session.role === 'gestor') {
    const escopo = await getGestorScope(session);
    if (escopo.length > 0 && !escopo.includes(name)) {
      return NextResponse.json({ error: 'Você só pode criar/editar projetos do seu próprio escopo.' }, { status: 403 });
    }
  }
  const capacidade = typeof body?.capacidade === 'number' ? Math.max(0, Math.floor(body.capacidade)) : 0;
  const contadorAbertura = typeof body?.contador_abertura === 'string' ? body.contador_abertura.trim() : '';

  const projects = readProjects();
  const existing = projects.find((p) => p.nome === name);
  if (existing) {
    // Update capacidade se já existir
    existing.capacidade = capacidade;
    if (contadorAbertura) existing.contador_abertura = contadorAbertura;
  } else {
    projects.push({ nome: name, capacidade, ...(contadorAbertura ? { contador_abertura: contadorAbertura } : {}) });
  }
  writeProjects(projects);
  return NextResponse.json({ projects: await withUsados(projects) });
}

export async function PATCH(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }
  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'Nome inválido' }, { status: 400 });
  if (session.role === 'gestor') {
    const escopo = await getGestorScope(session);
    if (escopo.length > 0 && !escopo.includes(name)) {
      return NextResponse.json({ error: 'Você só pode editar projetos do seu próprio escopo.' }, { status: 403 });
    }
  }
  const capacidade = typeof body?.capacidade === 'number' ? Math.max(0, Math.floor(body.capacidade)) : 0;

  const projects = readProjects();
  const p = projects.find((proj) => proj.nome === name);
  if (!p) return NextResponse.json({ error: 'Projeto não encontrado' }, { status: 404 });
  p.capacidade = capacidade;
  if (typeof body?.contador_abertura === 'string') {
    p.contador_abertura = body.contador_abertura.trim() || undefined;
  }
  writeProjects(projects);
  return NextResponse.json({ projects: await withUsados(projects) });
}

export async function DELETE(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
  }
  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Nome inválido' }, { status: 400 });
  }
  if (session.role === 'gestor') {
    const escopo = await getGestorScope(session);
    if (escopo.length > 0 && !escopo.includes(name)) {
      return NextResponse.json({ error: 'Você só pode excluir projetos do seu próprio escopo.' }, { status: 403 });
    }
  }
  const projects = readProjects().filter((p) => p.nome !== name);
  writeProjects(projects);
  return NextResponse.json({ projects: await withUsados(projects) });
}
