// Rótulo e estado de de-para dos alertas de sensor no dashboard — funções
// puras. GET /api/alertas devolve reservatorio/condominio já resolvidos no
// servidor, e os dois podem vir nulos de forma independente (ex.: reservatório
// achado, mas sem condomínio vinculado).
export interface AlertaDePara {
  reservatorio: { nome_interno: string } | null;
  condominio: { nome: string } | null;
}

/** De-para completo = reservatório E condomínio identificados. */
export function deParaResolvido(a: AlertaDePara): boolean {
  return !!a.reservatorio && !!a.condominio;
}

export function rotuloAlerta(a: AlertaDePara): string {
  if (a.reservatorio && a.condominio) return `${a.condominio.nome} · ${a.reservatorio.nome_interno}`;
  if (a.reservatorio) return `${a.reservatorio.nome_interno} · condomínio não identificado`;
  return 'Reservatório não identificado';
}
