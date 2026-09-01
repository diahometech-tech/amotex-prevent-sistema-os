export interface TecnicoLite {
  id: string;
  nome: string;
}

// GET /api/users devolve dois formatos: admin recebe a lista completa (com
// `papel`), técnico recebe um payload reduzido `{id, nome}` que já vem só
// com técnicos ativos. Filtrar por `papel === 'tecnico'` zerava a lista
// inteira pro técnico (o campo nem existe no payload dele) — daí aceitar
// também quem chega sem `papel` (ver o comentário do GET em
// src/app/api/users/route.ts).
//
// Extraído pra um lugar só depois que essa lógica — comentário incluso —
// foi copiada de src/app/page.tsx pra src/app/rotas/page.tsx (issue #13):
// se o contrato da rota mudar, corrigir num lugar só evita reintroduzir o
// próprio bug que o comentário descreve.
export function parseTecnicosResponse(data: { users?: { id: string; nome: string; papel?: string }[] }): TecnicoLite[] {
  const users = data.users || [];
  return users.filter((u) => u.papel === undefined || u.papel === 'tecnico');
}
