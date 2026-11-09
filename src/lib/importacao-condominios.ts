// Importação de condomínios por planilha (CSV) — funções puras, sem I/O.
// A tela usa pra mostrar a prévia; a API (POST /api/condominios/importar)
// usa as MESMAS funções pra revalidar antes de gravar — a prévia nunca
// promete algo que o servidor recusaria.
//
// Formato aceito: CSV com cabeçalho, separado por ";" (padrão do Excel em
// português), "," ou tab — detectado pela primeira linha. Colunas pelo nome
// do cabeçalho, sem depender da ordem nem de acento/maiúscula.
//
// Desde 26/10 também ATUALIZA: linha com CNPJ já cadastrado preenche/troca
// só as colunas que vieram com valor (é como a planilha de levantamento de
// contratos volta pro sistema). Os campos de cadastro passam pelo mesmo
// validador da tela (src/lib/financeiro/cadastro.ts).
import { normalizeSearch } from './text';
import { validarCadastro, type CadastroCondominio } from './financeiro/cadastro';
import { limparCnpj } from './financeiro/cnpj';

export interface LinhaCondominio {
  /** Linha na planilha (1 = cabeçalho), pra mensagem de erro apontar o lugar. */
  linha: number;
  /** Campos de cadastro já validados/normalizados (só os que vieram preenchidos). */
  cadastro: CadastroCondominio;
  /** A linha como veio da planilha — é isto que a tela manda pro servidor revalidar. */
  bruto: Record<string, string | number>;
  zelador_nome?: string;
  zelador_telefone?: string;
  sindico_nome?: string;
  sindico_telefone?: string;
}

// Colunas de cadastro aceitas, como chegam do CSV (strings), antes do validador.
type CampoCadastro =
  | 'nome' | 'cnpj' | 'endereco' | 'bairro' | 'cidade' | 'uf' | 'cep' | 'administradora'
  | 'valor_mensal' | 'dia_vencimento' | 'emails_cobranca'
  | 'responsavel_nome' | 'responsavel_telefone' | 'responsavel_email'
  | 'contrato_inicio' | 'reajuste_indice' | 'reajuste_percentual_fixo' | 'preventivas_por_mes' | 'observacoes';
type CampoContato = 'zelador_nome' | 'zelador_telefone' | 'sindico_nome' | 'sindico_telefone';
type Campo = CampoCadastro | CampoContato;

// Cabeçalho normalizado (sem acento, minúsculo, só letras) → campo. Inclui os
// cabeçalhos da planilha "Controle de Cobranças" da Amotex.
const ALIASES: Record<string, Campo> = {
  nome: 'nome', condominio: 'nome', nomedocondominio: 'nome',
  cnpj: 'cnpj',
  endereco: 'endereco', enderecocompleto: 'endereco',
  bairro: 'bairro', cidade: 'cidade', municipio: 'cidade', uf: 'uf', estado: 'uf', cep: 'cep',
  administradora: 'administradora',
  valormensal: 'valor_mensal', valormensalr: 'valor_mensal', valor: 'valor_mensal', valordocontrato: 'valor_mensal',
  diavencimento: 'dia_vencimento', diadevencimento: 'dia_vencimento', vencimento: 'dia_vencimento',
  emailsparacobranca: 'emails_cobranca', emailsdecobranca: 'emails_cobranca', emailscobranca: 'emails_cobranca', emailcobranca: 'emails_cobranca', emails: 'emails_cobranca',
  responsavel: 'responsavel_nome', responsavelnome: 'responsavel_nome', nomedoresponsavel: 'responsavel_nome',
  responsaveltelefone: 'responsavel_telefone', telefonedoresponsavel: 'responsavel_telefone', whatsappdoresponsavel: 'responsavel_telefone', telefone: 'responsavel_telefone',
  responsavelemail: 'responsavel_email', emaildoresponsavel: 'responsavel_email',
  contratoinicio: 'contrato_inicio', iniciodocontrato: 'contrato_inicio', datadeiniciodocontrato: 'contrato_inicio', datainicio: 'contrato_inicio',
  reajusteindice: 'reajuste_indice', indicedereajuste: 'reajuste_indice', indice: 'reajuste_indice', reajuste: 'reajuste_indice',
  reajustepercentualfixo: 'reajuste_percentual_fixo', percentualfixo: 'reajuste_percentual_fixo',
  preventivaspormes: 'preventivas_por_mes', frequenciadapreventiva: 'preventivas_por_mes',
  observacoes: 'observacoes', observacao: 'observacoes', obs: 'observacoes',
  zelador: 'zelador_nome', zeladornome: 'zelador_nome', nomedozelador: 'zelador_nome',
  zeladortelefone: 'zelador_telefone', telefonezelador: 'zelador_telefone', telefonedozelador: 'zelador_telefone', zeladorwhatsapp: 'zelador_telefone',
  sindico: 'sindico_nome', sindiconome: 'sindico_nome', nomedosindico: 'sindico_nome',
  sindicotelefone: 'sindico_telefone', telefonesindico: 'sindico_telefone', telefonedosindico: 'sindico_telefone', sindicowhatsapp: 'sindico_telefone',
};

export const CABECALHO_MODELO = [
  'nome', 'cnpj', 'endereco', 'administradora', 'valor_mensal', 'dia_vencimento', 'emails_cobranca',
  'responsavel_nome', 'responsavel_telefone', 'responsavel_email', 'contrato_inicio', 'reajuste_indice',
  'reajuste_percentual_fixo', 'preventivas_por_mes', 'zelador_nome', 'zelador_telefone', 'sindico_nome', 'sindico_telefone', 'observacoes',
];

export const MAX_LINHAS_IMPORTACAO = 500;

function chaveCabecalho(h: string): string {
  return normalizeSearch(h).replace(/[^a-z]/g, '');
}

/** Chave de comparação de nome de condomínio (detecção de duplicado). */
export function chaveNome(nome: string): string {
  return normalizeSearch(nome).replace(/\s+/g, ' ').trim();
}

/** Parser CSV com aspas ("a;b" e "" escapado). Separador detectado pela 1ª linha. */
export function parseCsv(texto: string): string[][] {
  const limpo = texto.replace(/^﻿/, '');
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].reduce((melhor, s) =>
    primeira.split(s).length > primeira.split(melhor).length ? s : melhor
  );

  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpo[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length > 0) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((v) => v.trim() !== ''));
}

export interface ResultadoLeitura {
  linhas: LinhaCondominio[];
  /** Erros que impedem a linha de entrar (ex.: sem nome, CNPJ inválido). */
  erros: { linha: number; motivo: string }[];
  /** Problema no arquivo inteiro (sem coluna de nome/CNPJ, vazio, grande demais). */
  erroArquivo?: string;
}

/**
 * Lê o CSV já parseado. O cabeçalho é a primeira linha (entre as 10
 * primeiras) que tem coluna de nome ou CNPJ — a aba "Cadastro" da planilha
 * da Amotex tem título e nota antes do cabeçalho e uma linha TOTAL no fim.
 */
export function lerPlanilhaCondominios(tabela: string[][]): ResultadoLeitura {
  const mapear = (linha: string[]) => linha.map((h) => ALIASES[chaveCabecalho(h)]);
  const iCab = tabela.slice(0, 10).findIndex((l) => {
    const m = mapear(l);
    return m.includes('nome') || m.includes('cnpj');
  });
  if (iCab === -1) {
    return { linhas: [], erros: [], erroArquivo: 'Não achei a coluna "nome" (ou "condomínio") nem "CNPJ" no cabeçalho.' };
  }
  const campos = mapear(tabela[iCab]);
  const corpo = tabela.slice(iCab + 1).filter((l) => !l.some((v) => /^total\b/i.test(v.trim())));
  if (corpo.length === 0) return { linhas: [], erros: [], erroArquivo: 'A planilha está vazia ou só tem o cabeçalho.' };
  if (corpo.length > MAX_LINHAS_IMPORTACAO) {
    return { linhas: [], erros: [], erroArquivo: `Máximo de ${MAX_LINHAS_IMPORTACAO} condomínios por importação.` };
  }

  const linhas: LinhaCondominio[] = [];
  const erros: ResultadoLeitura['erros'] = [];
  corpo.forEach((valores, idx) => {
    const bruto: Partial<Record<Campo, string>> = {};
    campos.forEach((campo, col) => {
      const v = (valores[col] ?? '').trim();
      if (campo && v) bruto[campo] = v;
    });
    const resultado = validarLinha({ linha: iCab + idx + 2, ...bruto });
    if ('motivo' in resultado) erros.push(resultado);
    else linhas.push(resultado);
  });
  return { linhas, erros };
}

function telefone(v?: string): string | undefined {
  if (!v) return undefined;
  const digitos = v.replace(/\D/g, '');
  return digitos || undefined;
}

/** "15/03/2024" ou "2024-03-15" → "2024-03-15" (o validador confere a data). */
function dataIso(v: string): string {
  const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return br ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}` : v;
}

/** "IGP-M", "igpm", "IPCA", "INPC", "2%", "fixo 2,5%" → índice (+ % fixo). */
function indice(v: string): { indice?: string; fixo?: string } {
  const n = normalizeSearch(v).replace(/[^a-z0-9,.%]/g, '');
  if (n.startsWith('igpm') || n === 'igp') return { indice: 'igpm' };
  if (n.startsWith('ipca')) return { indice: 'ipca' };
  if (n.startsWith('inpc')) return { indice: 'inpc' };
  const pct = n.match(/(\d+(?:[.,]\d+)?)%?/);
  if (n.replace(/%/g, '').startsWith('fixo') || pct) return { indice: 'fixo', fixo: pct?.[1] };
  return { indice: v }; // inválido — o validador recusa com mensagem
}

/** "mensal", "quinzenal", "semanal", "1", "2", "4" → preventivas por mês. */
function frequencia(v: string): string {
  const n = normalizeSearch(v);
  if (n.startsWith('mensal')) return '1';
  if (n.startsWith('quinzenal')) return '2';
  if (n.startsWith('semanal')) return '4';
  return v.replace(/\D/g, '') || v;
}

/** Valida/normaliza uma linha (também usado pela API sobre o JSON recebido). */
export function validarLinha(
  entrada: Partial<Record<Campo, unknown>> & { linha?: unknown }
): LinhaCondominio | { linha: number; motivo: string } {
  const linha = typeof entrada.linha === 'number' ? entrada.linha : 0;
  const s = (k: Campo) => (typeof entrada[k] === 'string' ? (entrada[k] as string).trim() || undefined : undefined);
  if (!s('nome') && !s('cnpj')) return { linha, motivo: 'sem nome do condomínio' };

  const corpo: Record<string, unknown> = {};
  for (const k of ['nome', 'cnpj', 'endereco', 'bairro', 'cidade', 'uf', 'cep', 'administradora', 'valor_mensal', 'dia_vencimento',
    'emails_cobranca', 'responsavel_nome', 'responsavel_telefone', 'responsavel_email', 'observacoes'] as const) {
    if (s(k)) corpo[k] = s(k);
  }
  if (s('contrato_inicio')) corpo.contrato_inicio = dataIso(s('contrato_inicio')!);
  if (s('reajuste_indice')) {
    const r = indice(s('reajuste_indice')!);
    corpo.reajuste_indice = r.indice;
    if (r.fixo && !s('reajuste_percentual_fixo')) corpo.reajuste_percentual_fixo = r.fixo;
  }
  if (s('reajuste_percentual_fixo')) corpo.reajuste_percentual_fixo = s('reajuste_percentual_fixo');
  if (s('preventivas_por_mes')) corpo.preventivas_por_mes = frequencia(s('preventivas_por_mes')!);

  const { dados, erro } = validarCadastro(corpo);
  if (erro) return { linha, motivo: erro.replace(/\.$/, '') };

  const bruto: LinhaCondominio['bruto'] = { linha };
  for (const [k, v] of Object.entries(entrada)) if (typeof v === 'string' && v.trim()) bruto[k] = v.trim();
  const out: LinhaCondominio = {
    linha,
    cadastro: dados,
    bruto,
    zelador_nome: s('zelador_nome'),
    zelador_telefone: telefone(s('zelador_telefone')),
    sindico_nome: s('sindico_nome'),
    sindico_telefone: telefone(s('sindico_telefone')),
  };
  for (const papel of ['zelador', 'sindico'] as const) {
    const tel = out[`${papel}_telefone`];
    if (tel && (tel.length < 10 || tel.length > 13)) {
      return { linha, motivo: `telefone do ${papel === 'zelador' ? 'zelador' : 'síndico'} inválido (use DDD + número)` };
    }
  }
  return out;
}

/** CNPJ (só dígitos) de uma linha, se veio. */
export function cnpjDaLinha(l: LinhaCondominio): string | undefined {
  return l.cadastro.cnpj ? limparCnpj(l.cadastro.cnpj) : undefined;
}
