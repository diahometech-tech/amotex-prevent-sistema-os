// CNPJ: limpeza, validação (dígitos verificadores) e formatação. Puro.

export function limparCnpj(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

export function cnpjValido(v: unknown): boolean {
  const c = limparCnpj(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

export function formatarCnpj(v: unknown): string {
  const c = limparCnpj(v);
  if (c.length !== 14) return typeof v === 'string' ? v : '';
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export interface DadosCnpj {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  endereco?: string; // "Avenida Macuco, 372 - Bloco A"
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  email?: string;
  situacao?: string;
}

function titulo(s?: string | null): string | undefined {
  if (!s) return undefined;
  const minusculas = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

// Normaliza a resposta da BrasilAPI (/api/cnpj/v1/{cnpj}, dados públicos da
// Receita). Campos vêm em CAIXA ALTA; logradouro às vezes já traz o tipo
// ("AVENIDA MACUCO") e às vezes não (tipo em descricao_tipo_de_logradouro).
export function normalizarRespostaCnpj(r: Record<string, unknown>): DadosCnpj {
  const s = (k: string) => (typeof r[k] === 'string' && (r[k] as string).trim() ? (r[k] as string).trim() : undefined);
  const tipo = s('descricao_tipo_de_logradouro');
  let logradouro = s('logradouro');
  if (logradouro && tipo && !logradouro.toUpperCase().startsWith(tipo.toUpperCase())) logradouro = `${tipo} ${logradouro}`;
  const numero = s('numero');
  const complemento = s('complemento');
  const endereco = logradouro
    ? `${titulo(logradouro)}${numero ? `, ${numero}` : ''}${complemento ? ` - ${titulo(complemento)}` : ''}`
    : undefined;
  const tel = s('ddd_telefone_1')?.replace(/\D/g, '');
  const cep = s('cep')?.replace(/\D/g, '');
  return {
    cnpj: limparCnpj(String(r.cnpj ?? '')),
    razao_social: titulo(s('razao_social')),
    nome_fantasia: titulo(s('nome_fantasia')),
    endereco,
    bairro: titulo(s('bairro')),
    cidade: titulo(s('municipio')),
    uf: s('uf')?.toUpperCase(),
    cep: cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : undefined,
    telefone: tel && tel.length >= 10 ? tel : undefined,
    email: s('email')?.toLowerCase(),
    situacao: titulo(s('descricao_situacao_cadastral')),
  };
}
