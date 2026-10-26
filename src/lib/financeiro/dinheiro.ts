// Dinheiro em CENTAVOS inteiros em todo o sistema (ver comentário em
// Condominio, src/lib/db.ts). Aqui só conversão e exibição.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Intl separa "R$" do número com espaço não separável (U+00A0) — troca por
// espaço comum: o texto vai pra e-mail/WhatsApp copiado e colado.
export function formatarReais(centavos: number | null | undefined): string {
  return BRL.format((centavos ?? 0) / 100).replace(/ /g, ' ');
}

/**
 * "1.116,66", "1116,66", "1116.66", "1,116.66" (Excel em inglês), "R$ 500"
 * ou número → centavos. Retorna null se não for um valor válido (>= 0).
 */
export function parseReais(entrada: unknown): number | null {
  if (typeof entrada === 'number') return Number.isFinite(entrada) && entrada >= 0 ? Math.round(entrada * 100) : null;
  if (typeof entrada !== 'string') return null;
  let s = entrada.replace(/R\$|\s/g, '');
  if (!s) return null;
  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');
  if (temPonto && temVirgula) {
    // O separador que vem por último é o decimal; o outro é milhar.
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(decimal === ',' ? '.' : ',').join('').replace(',', '.');
  } else if (temVirgula) {
    // Só vírgula: decimal (BR), a não ser que sejam grupos de milhar ("1,300").
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (temPonto && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.300" = mil e trezentos
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Aplica percentual (ex.: 3,34) e arredonda pro centavo. */
export function aplicarPercentual(centavos: number, percentual: number): number {
  return Math.round(centavos * (1 + percentual / 100));
}
