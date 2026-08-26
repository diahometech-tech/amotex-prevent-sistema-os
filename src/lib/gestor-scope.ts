// Isolamento por projeto entre contas dos papéis 'gestor' e 'terceiro'
// (10/08/2026, caso real: conta "Gestor empresas" via OS de outro
// gestor/projeto que não eram dela — mesmo mecanismo depois estendido pra
// 'terceiro' poder ter mais de um projeto também, mesmo pedido real).
// `parseGestorProjetos`/`dossierInGestorScope` são genéricos de propósito
// (não fazem nada específico de 'gestor' na implementação) — reaproveitados
// também por `terceiro_projeto` (ver src/app/api/terceiro/dossiers/route.ts
// e as demais rotas do parceiro) em vez de duplicar a mesma lógica de
// parsing/comparação. O nome ficou "Gestor" porque foi o primeiro caso de
// uso; não renomeado pra não gerar diff enorme nos ~15 importadores já
// existentes.
//
// Ambos os campos guardam uma lista separada por vírgula em
// User.gestor_projetos/User.terceiro_projeto. "vazio = sem restrição" é
// deliberado nos dois — não tira acesso de conta existente que ainda não
// foi configurada; só quem for explicitamente escopado fica restrito.
//
// 'admin' NUNCA passa por este filtro (acesso irrestrito sempre) — só
// 'gestor'/'terceiro' são afetados, e é responsabilidade de quem chama
// getGestorScope/lê terceiro_projeto, não deste módulo.
import { Database, type Dossier } from './db';
import type { SessionUser } from './auth';

export function parseGestorProjetos(raw?: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Busca o escopo de projetos da conta gestor da sessão. Retorna [] (sem
// restrição) pra qualquer papel que não seja 'gestor', ou pra uma conta
// gestor sem gestor_projetos definido.
export async function getGestorScope(session: SessionUser): Promise<string[]> {
  if (session.role !== 'gestor') return [];
  const user = await Database.getUserById(session.id);
  return parseGestorProjetos(user?.gestor_projetos);
}

// true = a OS está dentro do escopo (ou não há restrição). OS sem `projeto`
// atribuído fica de fora de qualquer escopo restrito (não é fila livre
// compartilhada entre projetos) — vale tanto pra gestor quanto terceiro.
export function dossierInGestorScope(d: Pick<Dossier, 'projeto'>, escopo: string[]): boolean {
  if (escopo.length === 0) return true;
  return !!d.projeto && escopo.includes(d.projeto);
}
