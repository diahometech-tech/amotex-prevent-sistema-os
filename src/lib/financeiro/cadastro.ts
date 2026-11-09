// Validação dos campos de cadastro/contrato do condomínio — uma função só pra
// POST /api/condominios, PATCH /api/condominios/[id] e a importação por
// planilha, pra nenhum caminho gravar dado que os outros recusariam. Puro.
import type { Condominio, IndiceReajuste } from '../db';
import { cnpjValido, limparCnpj } from './cnpj';
import { parseReais } from './dinheiro';
import { normalizarDataProgramada } from '../os-agenda';

const INDICES: IndiceReajuste[] = ['igpm', 'ipca', 'inpc', 'fixo'];
const EMAIL = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;

export type CadastroCondominio = Partial<
  Pick<
    Condominio,
    | 'nome' | 'endereco' | 'administradora' | 'monitoramento_ativo'
    | 'cnpj' | 'razao_social' | 'bairro' | 'cidade' | 'uf' | 'cep'
    | 'responsavel_nome' | 'responsavel_telefone' | 'responsavel_email' | 'emails_cobranca'
    | 'valor_mensal_centavos' | 'dia_vencimento' | 'contrato_inicio' | 'reajuste_indice' | 'reajuste_percentual_fixo'
    | 'preventivas_por_mes' | 'ativo' | 'observacoes'
  >
>;

/** "a@b.com; c@d.com.br, e@f.com" → "a@b.com; c@d.com.br; e@f.com" (ou erro). */
export function normalizarEmails(v: string): { ok: true; valor: string } | { ok: false; invalido: string } {
  const lista = v.split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const invalido = lista.find((e) => !EMAIL.test(e));
  if (invalido) return { ok: false, invalido };
  return { ok: true, valor: [...new Set(lista)].join('; ') };
}

function telefone(v: string): string | null {
  const d = v.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 13 ? d : null;
}

// Converte o corpo da requisição (strings de formulário/planilha) nos campos
// gravados. `null`/'' limpa o campo (no PATCH). Campo ausente = não mexe.
// Retorna o primeiro erro em texto pro usuário.
export function validarCadastro(body: Record<string, unknown>): { dados: CadastroCondominio; erro?: string } {
  const d: Record<string, unknown> = {};
  const limpar = (k: string) => body[k] === null || body[k] === '';
  const texto = (k: string) => {
    if (body[k] === undefined) return;
    if (limpar(k)) { d[k] = null; return; }
    if (typeof body[k] === 'string') d[k] = (body[k] as string).trim();
  };
  for (const k of ['nome', 'endereco', 'administradora', 'razao_social', 'bairro', 'cidade', 'responsavel_nome', 'observacoes']) texto(k);
  if (d.nome === null) return { dados: {}, erro: 'O nome do condomínio não pode ficar vazio.' };

  if (body.cnpj !== undefined) {
    if (limpar('cnpj')) d.cnpj = null;
    else if (!cnpjValido(body.cnpj)) return { dados: {}, erro: 'CNPJ inválido (confira os números).' };
    else d.cnpj = limparCnpj(body.cnpj);
  }
  if (body.uf !== undefined) {
    if (limpar('uf')) d.uf = null;
    else if (typeof body.uf !== 'string' || !/^[A-Za-z]{2}$/.test(body.uf.trim())) return { dados: {}, erro: 'UF inválida.' };
    else d.uf = body.uf.trim().toUpperCase();
  }
  if (body.cep !== undefined) {
    if (limpar('cep')) d.cep = null;
    else {
      const c = String(body.cep).replace(/\D/g, '');
      if (c.length !== 8) return { dados: {}, erro: 'CEP inválido.' };
      d.cep = `${c.slice(0, 5)}-${c.slice(5)}`;
    }
  }
  if (body.responsavel_telefone !== undefined) {
    if (limpar('responsavel_telefone')) d.responsavel_telefone = null;
    else {
      const t = telefone(String(body.responsavel_telefone));
      if (!t) return { dados: {}, erro: 'Telefone do responsável inválido (use DDD + número).' };
      d.responsavel_telefone = t;
    }
  }
  if (body.responsavel_email !== undefined) {
    if (limpar('responsavel_email')) d.responsavel_email = null;
    else {
      const e = String(body.responsavel_email).trim().toLowerCase();
      if (!EMAIL.test(e)) return { dados: {}, erro: 'E-mail do responsável inválido.' };
      d.responsavel_email = e;
    }
  }
  if (body.emails_cobranca !== undefined) {
    if (limpar('emails_cobranca')) d.emails_cobranca = null;
    else {
      const r = normalizarEmails(String(body.emails_cobranca));
      if (!r.ok) return { dados: {}, erro: `E-mail de cobrança inválido: ${r.invalido}` };
      d.emails_cobranca = r.valor;
    }
  }
  // Valor chega em reais ("1.116,66") como `valor_mensal`; centavos direto também vale.
  const valorBruto = body.valor_mensal !== undefined ? body.valor_mensal : body.valor_mensal_centavos;
  if (valorBruto !== undefined) {
    if (valorBruto === null || valorBruto === '') d.valor_mensal_centavos = null;
    else {
      const c = body.valor_mensal !== undefined ? parseReais(valorBruto) : (Number.isInteger(valorBruto) ? (valorBruto as number) : null);
      if (c === null) return { dados: {}, erro: 'Valor mensal inválido.' };
      d.valor_mensal_centavos = c;
    }
  }
  if (body.dia_vencimento !== undefined) {
    if (limpar('dia_vencimento')) d.dia_vencimento = null;
    else {
      const n = Number(body.dia_vencimento);
      if (!Number.isInteger(n) || n < 1 || n > 28) return { dados: {}, erro: 'Dia de vencimento deve ser de 1 a 28.' };
      d.dia_vencimento = n;
    }
  }
  if (body.contrato_inicio !== undefined) {
    const data = normalizarDataProgramada(body.contrato_inicio);
    if (data === undefined) return { dados: {}, erro: 'Data de início do contrato inválida.' };
    d.contrato_inicio = data;
  }
  if (body.reajuste_indice !== undefined) {
    if (limpar('reajuste_indice')) d.reajuste_indice = null;
    else if (!INDICES.includes(body.reajuste_indice as IndiceReajuste)) return { dados: {}, erro: 'Índice de reajuste inválido.' };
    else d.reajuste_indice = body.reajuste_indice;
  }
  if (body.reajuste_percentual_fixo !== undefined) {
    if (limpar('reajuste_percentual_fixo')) d.reajuste_percentual_fixo = null;
    else {
      const p = Number(String(body.reajuste_percentual_fixo).replace(',', '.').replace('%', ''));
      if (!Number.isFinite(p) || p < 0 || p > 100) return { dados: {}, erro: 'Percentual de reajuste inválido.' };
      d.reajuste_percentual_fixo = p;
    }
  }
  if (body.preventivas_por_mes !== undefined) {
    const n = Number(body.preventivas_por_mes);
    if (![1, 2, 4].includes(n)) return { dados: {}, erro: 'Preventivas por mês: 1, 2 ou 4.' };
    d.preventivas_por_mes = n;
  }
  for (const k of ['ativo', 'monitoramento_ativo']) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== 'boolean') return { dados: {}, erro: `Campo ${k} inválido.` };
      d[k] = body[k];
    }
  }
  return { dados: d as CadastroCondominio };
}
