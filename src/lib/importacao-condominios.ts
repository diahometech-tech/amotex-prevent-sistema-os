// Importação de condomínios por planilha (CSV) — funções puras, sem I/O.
// A tela usa pra mostrar a prévia; a API (POST /api/condominios/importar)
// usa as MESMAS funções pra revalidar antes de gravar — a prévia nunca
// promete algo que o servidor recusaria.
//
// Formato aceito: CSV com cabeçalho, separado por ";" (padrão do Excel em
// português), "," ou tab — detectado pela primeira linha. Colunas pelo nome
// do cabeçalho, sem depender da ordem nem de acento/maiúscula.
import { normalizeSearch } from './text';

export interface LinhaCondominio {
  /** Linha na planilha (1 = cabeçalho), pra mensagem de erro apontar o lugar. */
  linha: number;
  nome: string;
  endereco?: string;
  administradora?: string;
  zelador_nome?: string;
  zelador_telefone?: string;
  sindico_nome?: string;
  sindico_telefone?: string;
}

type Campo = Exclude<keyof LinhaCondominio, 'linha'>;

// Cabeçalho normalizado (sem acento, minúsculo, só letras) → campo.
const ALIASES: Record<string, Campo> = {
  nome: 'nome',
  condominio: 'nome',
  nomedocondominio: 'nome',
  endereco: 'endereco',
  enderecocompleto: 'endereco',
  administradora: 'administradora',
  zelador: 'zelador_nome',
  zeladornome: 'zelador_nome',
  nomedozelador: 'zelador_nome',
  zeladortelefone: 'zelador_telefone',
  telefonezelador: 'zelador_telefone',
  telefonedozelador: 'zelador_telefone',
  zeladorwhatsapp: 'zelador_telefone',
  sindico: 'sindico_nome',
  sindiconome: 'sindico_nome',
  nomedosindico: 'sindico_nome',
  sindicotelefone: 'sindico_telefone',
  telefonesindico: 'sindico_telefone',
  telefonedosindico: 'sindico_telefone',
  sindicowhatsapp: 'sindico_telefone',
};

export const CABECALHO_MODELO = [
  'nome', 'endereco', 'administradora', 'zelador_nome', 'zelador_telefone', 'sindico_nome', 'sindico_telefone',
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
  /** Erros que impedem a linha de entrar (ex.: sem nome). */
  erros: { linha: number; motivo: string }[];
  /** Problema no arquivo inteiro (sem coluna de nome, vazio, grande demais). */
  erroArquivo?: string;
}

/** Lê o CSV já parseado (primeira linha = cabeçalho). */
export function lerPlanilhaCondominios(tabela: string[][]): ResultadoLeitura {
  if (tabela.length < 2) return { linhas: [], erros: [], erroArquivo: 'A planilha está vazia ou só tem o cabeçalho.' };
  const campos = tabela[0].map((h) => ALIASES[chaveCabecalho(h)]);
  if (!campos.includes('nome')) {
    return { linhas: [], erros: [], erroArquivo: 'Não achei a coluna "nome" (ou "condomínio") no cabeçalho.' };
  }
  if (tabela.length - 1 > MAX_LINHAS_IMPORTACAO) {
    return { linhas: [], erros: [], erroArquivo: `Máximo de ${MAX_LINHAS_IMPORTACAO} condomínios por importação.` };
  }

  const linhas: LinhaCondominio[] = [];
  const erros: ResultadoLeitura['erros'] = [];
  tabela.slice(1).forEach((valores, idx) => {
    const bruto: Partial<Record<Campo, string>> = {};
    campos.forEach((campo, col) => {
      const v = (valores[col] ?? '').trim();
      if (campo && v) bruto[campo] = v;
    });
    const resultado = validarLinha({ linha: idx + 2, ...bruto });
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

/** Valida/normaliza uma linha (também usado pela API sobre o JSON recebido). */
export function validarLinha(
  entrada: Partial<Record<Campo, unknown>> & { linha?: unknown }
): LinhaCondominio | { linha: number; motivo: string } {
  const linha = typeof entrada.linha === 'number' ? entrada.linha : 0;
  const texto = (k: Campo) => (typeof entrada[k] === 'string' ? (entrada[k] as string).trim() || undefined : undefined);
  const nome = texto('nome');
  if (!nome) return { linha, motivo: 'sem nome do condomínio' };

  const out: LinhaCondominio = {
    linha,
    nome,
    endereco: texto('endereco'),
    administradora: texto('administradora'),
    zelador_nome: texto('zelador_nome'),
    zelador_telefone: telefone(texto('zelador_telefone')),
    sindico_nome: texto('sindico_nome'),
    sindico_telefone: telefone(texto('sindico_telefone')),
  };
  for (const papel of ['zelador', 'sindico'] as const) {
    const tel = out[`${papel}_telefone`];
    if (tel && (tel.length < 10 || tel.length > 13)) {
      return { linha, motivo: `telefone do ${papel === 'zelador' ? 'zelador' : 'síndico'} inválido (use DDD + número)` };
    }
  }
  return out;
}
