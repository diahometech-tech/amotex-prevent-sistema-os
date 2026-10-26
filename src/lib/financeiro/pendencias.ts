// Pendências de cadastro — o que falta em cada condomínio pra cobrança e
// reajuste funcionarem sozinhos. Também gera a mensagem pra equipe levantar
// os dados (pedido do cliente em 26/10: "preciso que gere uma msg com os
// dados que vou precisar"). Puro.
import type { Condominio } from '../db';
import { condominioAtivo } from './cobranca';
import { formatarCnpj } from './cnpj';

export const CAMPOS_NECESSARIOS = [
  ['contrato_inicio', 'Data de início do contrato', 'pra avisar o reajuste no aniversário'],
  ['reajuste_indice', 'Índice de reajuste (IGP-M, IPCA, INPC ou % fixo)', 'pra sugerir o % do reajuste'],
  ['dia_vencimento', 'Dia de vencimento da cobrança', 'hoje está no padrão dia 10'],
  ['responsavel_nome', 'Nome do responsável (síndico ou administradora)', 'quem recebe os avisos'],
  ['responsavel_telefone', 'Telefone/WhatsApp do responsável', 'pros avisos por WhatsApp'],
  ['emails_cobranca', 'E-mail(s) de cobrança', 'pra onde vão boleto, nota e reajuste'],
  ['valor_mensal_centavos', 'Valor mensal do contrato', 'sem valor não gera cobrança'],
  ['cnpj', 'CNPJ', 'identifica o condomínio sem confusão de nome'],
] as const;

export type CampoNecessario = (typeof CAMPOS_NECESSARIOS)[number][0];

export interface PendenciaCondominio {
  condominio_id: string;
  nome: string;
  cnpj?: string;
  faltando: CampoNecessario[];
}

function vazio(c: Condominio, k: CampoNecessario): boolean {
  const v = c[k];
  if (v === undefined || v === null || v === '') return true;
  // "% fixo" sem o percentual não serve pra sugerir reajuste.
  return k === 'reajuste_indice' && v === 'fixo' && c.reajuste_percentual_fixo == null;
}

export function pendenciasCadastro(condominios: Condominio[]): PendenciaCondominio[] {
  return condominios
    .filter(condominioAtivo)
    .map((c) => ({
      condominio_id: c.id,
      nome: c.nome,
      cnpj: c.cnpj,
      faltando: CAMPOS_NECESSARIOS.map(([k]) => k).filter((k) => vazio(c, k)),
    }))
    .filter((p) => p.faltando.length > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

const LABEL = Object.fromEntries(CAMPOS_NECESSARIOS.map(([k, l]) => [k, l])) as Record<CampoNecessario, string>;

// Mensagem pra mandar no WhatsApp/e-mail da equipe: o que levantar, de quem.
export function mensagemLevantamento(pendencias: PendenciaCondominio[]): string {
  if (pendencias.length === 0) return 'Cadastro completo: nenhum condomínio com dado faltando.';
  const linhas = [
    `*Levantamento de dados dos contratos — ${pendencias.length} condomínio${pendencias.length > 1 ? 's' : ''}*`,
    '',
    'Para o sistema avisar o reajuste no aniversário de cada contrato e controlar as cobranças, precisamos completar os dados abaixo. ' +
      'O mais urgente é a *data de início* e o *índice de reajuste* de cada contrato (estão no contrato assinado).',
    '',
  ];
  for (const p of pendencias) {
    linhas.push(`• *${p.nome}*${p.cnpj ? ` (${formatarCnpj(p.cnpj)})` : ''}`);
    linhas.push(`  Falta: ${p.faltando.map((k) => LABEL[k]).join('; ')}`);
  }
  linhas.push('', 'Pode responder por aqui ou preencher a planilha de levantamento e devolver.');
  return linhas.join('\n');
}
