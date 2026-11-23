import { describe, expect, it } from 'vitest';
import type { AjusteValor, Cobranca, Condominio, Reajuste } from '../src/lib/db';
import { aplicarPercentual, formatarReais, parseReais } from '../src/lib/financeiro/dinheiro';
import {
  ajustesDaCompetencia, cobrancaAjustavel, gerarCobrancasMes, nomeComprovante, resumoMes, somarMeses,
  statusEfetivo, vencimentoDaCompetencia, vencimentoSugerido,
} from '../src/lib/financeiro/cobranca';
import {
  acumular, calcularValorNovo, percentualSugerido, proximoAniversario, reajustesPendentes, ultimoAniversario,
  vigenciaPadrao,
} from '../src/lib/financeiro/reajuste';

const cond = (id: string, p: Partial<Condominio> = {}): Condominio => ({
  id, nome: `Cond ${id}`, monitoramento_ativo: false, criado_em: '2026-01-01T00:00:00Z',
  valor_mensal_centavos: 100_000, dia_vencimento: 10, ...p,
});
const cobranca = (p: Partial<Cobranca> = {}): Cobranca => ({
  id: 'x', condominio_id: 'c1', competencia: '2026-11', valor_previsto_centavos: 100_000, vencimento: '2026-11-10',
  status: 'pendente', criado_em: '2026-11-01T00:00:00Z', ...p,
});
const ajuste = (p: Partial<AjusteValor> = {}): AjusteValor => ({
  id: 'a1', condominio_id: 'c1', descricao: 'Quadros elétricos', valor_centavos: 20_000, inicio: '2026-09', fim: '2026-11',
  criado_em: '2026-09-01T00:00:00Z', ...p,
});

describe('dinheiro em centavos', () => {
  it('parseReais aceita os formatos do dia a dia', () => {
    expect(parseReais('1.116,66')).toBe(111_666);
    expect(parseReais('1116,66')).toBe(111_666);
    expect(parseReais('1116.66')).toBe(111_666);
    expect(parseReais('1,300.00')).toBe(130_000); // Excel em inglês
    expect(parseReais('R$ 500')).toBe(50_000);
    expect(parseReais('1.300')).toBe(130_000); // milhar
    expect(parseReais('1,300')).toBe(130_000);
    expect(parseReais('0,5')).toBe(50);
    expect(parseReais(285.9)).toBe(28_590);
    expect(parseReais('0')).toBe(0);
  });
  it('parseReais recusa o que não é valor', () => {
    for (const v of ['', 'abc', '-5', '1,234,56', '1,5,0', null, undefined, {}, NaN, -1, '1.2.3']) {
      expect(parseReais(v), String(v)).toBeNull();
    }
  });
  it('não soma float: 0,10 + 0,20 em centavos dá 30', () => {
    expect(parseReais('0,10')! + parseReais('0,20')!).toBe(30);
  });
  it('formatarReais usa espaço comum', () => {
    const t = formatarReais(111_666);
    expect(t).toBe('R$ 1.116,66');
    expect(t.includes(String.fromCharCode(160))).toBe(false);
    expect(formatarReais(undefined)).toBe('R$ 0,00');
  });
  it('percentual arredonda pro centavo', () => {
    expect(aplicarPercentual(100_000, 3.34)).toBe(103_340);
    expect(aplicarPercentual(41_000, 0)).toBe(41_000);
    expect(calcularValorNovo(41_000, 4.5)).toBe(42_845);
  });
});

describe('status efetivo (atrasada é derivado, não gravado)', () => {
  it('pendente ou enviada com vencimento passado: atrasada', () => {
    expect(statusEfetivo({ status: 'pendente', vencimento: '2026-11-10' }, '2026-11-11')).toBe('atrasada');
    expect(statusEfetivo({ status: 'enviada', vencimento: '2026-11-10' }, '2026-11-19')).toBe('atrasada');
  });
  it('no dia do vencimento ainda não está atrasada', () => {
    expect(statusEfetivo({ status: 'pendente', vencimento: '2026-11-10' }, '2026-11-10')).toBe('pendente');
  });
  it('paga e isenta nunca atrasam', () => {
    expect(statusEfetivo({ status: 'paga', vencimento: '2026-01-10' }, '2026-11-19')).toBe('paga');
    expect(statusEfetivo({ status: 'isenta', vencimento: '2026-01-10' }, '2026-11-19')).toBe('isenta');
  });
});

describe('datas de cobrança', () => {
  it('vencimento: dia do contrato limitado a 1..28, padrão 10', () => {
    expect(vencimentoDaCompetencia('2026-11', 5)).toBe('2026-11-05');
    expect(vencimentoDaCompetencia('2026-02', 31)).toBe('2026-02-28');
    expect(vencimentoDaCompetencia('2026-11')).toBe('2026-11-10');
    expect(vencimentoDaCompetencia('2026-11', 0)).toBe('2026-11-10');
  });
  it('somar meses vira o ano', () => {
    expect(somarMeses('2026-11', 2)).toBe('2027-01');
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
  });
  it('vencimento sugerido: hoje + 5 dias (vira o mês)', () => {
    expect(vencimentoSugerido('2026-11-19')).toBe('2026-11-24');
    expect(vencimentoSugerido('2026-11-28')).toBe('2026-12-03');
    expect(vencimentoSugerido('2026-12-29')).toBe('2027-01-03');
  });
  it('comprovante: nome padrão da planilha', () => {
    expect(nomeComprovante('Condomínio Edifício Gaivotas', '2026-11')).toBe('Gaivotas - 11-2026');
  });
});

describe('geração mensal de cobranças', () => {
  const comp = '2026-11';
  it('uma por condomínio ativo, com valor e vencimento do contrato', () => {
    const r = gerarCobrancasMes({ competencia: comp, condominios: [cond('c1'), cond('c2', { dia_vencimento: 5, valor_mensal_centavos: 50_000 })], ajustes: [], existentes: [] });
    expect(r.novas.map((n) => [n.condominio_id, n.valor_previsto_centavos, n.vencimento])).toEqual([
      ['c1', 100_000, '2026-11-10'], ['c2', 50_000, '2026-11-05'],
    ]);
    expect(r.vencidas).toBe(0);
  });
  it('idempotente: rodar de novo não duplica, só acrescenta o novo', () => {
    const conds = [cond('c1'), cond('c2')];
    const primeira = gerarCobrancasMes({ competencia: comp, condominios: conds, ajustes: [], existentes: [] });
    const existentes = primeira.novas.map((n) => ({ condominio_id: n.condominio_id, competencia: n.competencia }));
    const segunda = gerarCobrancasMes({ competencia: comp, condominios: conds, ajustes: [], existentes });
    expect(segunda.novas).toEqual([]);
    expect(segunda.jaExistiam).toBe(2);
    const terceira = gerarCobrancasMes({ competencia: comp, condominios: [...conds, cond('c3')], ajustes: [], existentes });
    expect(terceira.novas.map((n) => n.condominio_id)).toEqual(['c3']);
  });
  it('cobrança de outra competência não conta como existente', () => {
    const r = gerarCobrancasMes({ competencia: comp, condominios: [cond('c1')], ajustes: [], existentes: [{ condominio_id: 'c1', competencia: '2026-10' }] });
    expect(r.novas).toHaveLength(1);
  });
  it('pula inativo e contrato que começa depois; lista quem está sem valor', () => {
    const r = gerarCobrancasMes({
      competencia: comp,
      condominios: [cond('c1', { ativo: false }), cond('c2', { contrato_inicio: '2026-12-01' }), cond('c3', { valor_mensal_centavos: undefined }), cond('c4', { contrato_inicio: '2026-11-15' })],
      ajustes: [], existentes: [],
    });
    expect(r.novas.map((n) => n.condominio_id)).toEqual(['c4']);
    expect(r.semValor).toEqual([{ id: 'c3', nome: 'Cond c3' }]);
  });
  it('ajustes temporários: dentro da janela soma, fora não; desconto não passa de zero', () => {
    expect(ajustesDaCompetencia([ajuste()], 'c1', '2026-09')).toHaveLength(1);
    expect(ajustesDaCompetencia([ajuste()], 'c1', '2026-11')).toHaveLength(1);
    expect(ajustesDaCompetencia([ajuste()], 'c1', '2026-12')).toHaveLength(0);
    expect(ajustesDaCompetencia([ajuste()], 'c2', '2026-10')).toHaveLength(0);
    const r = gerarCobrancasMes({ competencia: comp, condominios: [cond('c1')], ajustes: [ajuste()], existentes: [] });
    expect(r.novas[0].valor_previsto_centavos).toBe(120_000);
    expect(r.novas[0].observacao).toBe('Quadros elétricos');
    const desc = gerarCobrancasMes({ competencia: comp, condominios: [cond('c1')], ajustes: [ajuste({ valor_centavos: -500_000 })], existentes: [] });
    expect(desc.novas[0].valor_previsto_centavos).toBe(0);
    const fora = gerarCobrancasMes({ competencia: '2026-12', condominios: [cond('c1')], ajustes: [ajuste()], existentes: [] });
    expect(fora.novas[0].valor_previsto_centavos).toBe(100_000);
    expect(fora.novas[0].observacao).toBeUndefined();
  });

  describe('gerar depois do vencimento (dia 19 com vencimento dia 10)', () => {
    const hoje = '2026-11-19';
    const conds = [cond('c1'), cond('c2', { dia_vencimento: 5 }), cond('c3', { dia_vencimento: 25 })];
    it('sem escolha: conta as vencidas e mantém o dia do contrato', () => {
      const r = gerarCobrancasMes({ competencia: '2026-11', condominios: conds, ajustes: [], existentes: [], hoje });
      expect(r.vencidas).toBe(2);
      expect(r.diasVencidas).toEqual([5, 10]);
      expect(r.novas.map((n) => n.vencimento)).toEqual(['2026-11-10', '2026-11-05', '2026-11-25']);
    });
    it('manter o dia do contrato = igual a sem escolha', () => {
      const a = gerarCobrancasMes({ competencia: '2026-11', condominios: conds, ajustes: [], existentes: [], hoje });
      const b = gerarCobrancasMes({ competencia: '2026-11', condominios: conds, ajustes: [], existentes: [], hoje, vencimentoVencidas: { modo: 'manter' } });
      expect(b.novas).toEqual(a.novas);
    });
    it('nova data: só as que já nasceriam vencidas mudam', () => {
      const r = gerarCobrancasMes({ competencia: '2026-11', condominios: conds, ajustes: [], existentes: [], hoje, vencimentoVencidas: { modo: 'data', data: '2026-11-24' } });
      expect(r.novas.map((n) => n.vencimento)).toEqual(['2026-11-24', '2026-11-24', '2026-11-25']);
      expect(r.vencidas).toBe(2);
    });
    it('não mexe em cobrança já existente (idempotente)', () => {
      const r = gerarCobrancasMes({
        competencia: '2026-11', condominios: conds, ajustes: [], hoje,
        existentes: [{ condominio_id: 'c1', competencia: '2026-11' }],
        vencimentoVencidas: { modo: 'data', data: '2026-11-24' },
      });
      expect(r.novas.map((n) => n.condominio_id)).toEqual(['c2', 'c3']);
      expect(r.vencidas).toBe(1);
      expect(r.diasVencidas).toEqual([5]);
    });
    it('vencimento no próprio dia de hoje não é vencido', () => {
      const r = gerarCobrancasMes({ competencia: '2026-11', condominios: [cond('c1', { dia_vencimento: 19 })], ajustes: [], existentes: [], hoje });
      expect(r.vencidas).toBe(0);
    });
    it('mês futuro nunca nasce vencido', () => {
      const r = gerarCobrancasMes({ competencia: '2026-12', condominios: conds, ajustes: [], existentes: [], hoje, vencimentoVencidas: { modo: 'data', data: '2026-11-24' } });
      expect(r.vencidas).toBe(0);
      expect(r.novas.map((n) => n.vencimento)).toEqual(['2026-12-10', '2026-12-05', '2026-12-25']);
    });
    it('sem `hoje` (chamada antiga) nada muda', () => {
      const r = gerarCobrancasMes({ competencia: '2026-11', condominios: conds, ajustes: [], existentes: [], vencimentoVencidas: { modo: 'data', data: '2026-11-24' } });
      expect(r.vencidas).toBe(0);
      expect(r.novas.map((n) => n.vencimento)).toEqual(['2026-11-10', '2026-11-05', '2026-11-25']);
    });
  });
});

describe('ajuste de vencimento em lote', () => {
  it('só cobrança em aberto (pendente ou enviada) é ajustável', () => {
    expect(cobrancaAjustavel({ status: 'pendente' })).toBe(true);
    expect(cobrancaAjustavel({ status: 'enviada' })).toBe(true);
    expect(cobrancaAjustavel({ status: 'paga' })).toBe(false);
    expect(cobrancaAjustavel({ status: 'isenta' })).toBe(false);
  });
});

describe('resumo do mês', () => {
  it('isenta sai do previsto; atrasada soma o que falta', () => {
    const hoje = '2026-11-19';
    const r = resumoMes([
      cobranca({ id: '1', status: 'paga', valor_recebido_centavos: 100_000 }),
      cobranca({ id: '2', status: 'pendente', vencimento: '2026-11-25' }),
      cobranca({ id: '3', status: 'enviada', vencimento: '2026-11-10' }),
      cobranca({ id: '4', status: 'isenta' }),
    ], hoje);
    expect(r).toMatchObject({ previsto: 300_000, recebido: 100_000, emAberto: 200_000, atrasadoValor: 100_000, pagas: 1, pendentes: 1, atrasadas: 1, isentas: 1, total: 4 });
    expect(r.percentualRecebido).toBeCloseTo(1 / 3);
  });
  it('mês vazio não divide por zero', () => {
    expect(resumoMes([], '2026-11-19').percentualRecebido).toBe(0);
  });
});

describe('reajuste anual', () => {
  it('aniversário: último e próximo', () => {
    expect(ultimoAniversario('2025-06-15', '2026-11-19')).toBe('2026-06-15');
    expect(ultimoAniversario('2026-03-01', '2026-11-19')).toBeNull(); // ainda no 1º ano
    expect(proximoAniversario('2025-06-15', '2026-11-19')).toBe('2027-06-15');
    expect(proximoAniversario('2026-03-01', '2026-11-19')).toBe('2027-03-01');
  });
  it('29/02 em ano não bissexto vira 28/02', () => {
    expect(proximoAniversario('2024-02-29', '2026-11-19')).toBe('2027-02-28');
  });
  it('vigência nunca é retroativa', () => {
    expect(vigenciaPadrao('2026-12-05', '2026-11-19')).toBe('2026-12'); // aniversário futuro: o mês dele
    expect(vigenciaPadrao('2026-11-25', '2026-11-19')).toBe('2026-11');
    expect(vigenciaPadrao('2026-06-15', '2026-11-19')).toBe('2026-12'); // esquecido: mês seguinte a hoje
    expect(vigenciaPadrao('2026-12-15', '2026-12-20')).toBe('2026-12'); // mesmo mês: ainda vale este
    expect(vigenciaPadrao('2026-12-15', '2027-01-03')).toBe('2027-02');
  });
  it('pendentes: janela de 30 dias, ciclo perdido, registrados saem', () => {
    const hoje = '2026-11-19';
    const conds = [
      cond('a', { contrato_inicio: '2025-12-01' }), // próximo em 12 dias: entra
      cond('b', { contrato_inicio: '2025-06-15' }), // último em 06/2026 passou sem reajuste: entra, negativo
      cond('c', { contrato_inicio: '2025-03-01' }), // ciclo passou, mas já registrado: sai
      cond('d', { contrato_inicio: '2025-09-01', ativo: false }), // inativo: sai
      cond('e', { contrato_inicio: '2026-10-01' }), // 1º ano: nada
      cond('f', { contrato_inicio: undefined }),
      cond('g', { contrato_inicio: '2025-12-30' }), // 41 dias: fora da janela e sem ciclo perdido
    ];
    const registrados: Pick<Reajuste, 'condominio_id' | 'aniversario'>[] = [{ condominio_id: 'c', aniversario: '2026-03-01' }];
    const r = reajustesPendentes(conds, registrados, hoje);
    expect(r.map((x) => [x.condominio_id, x.aniversario, x.dias])).toEqual([
      ['b', '2026-06-15', -157],
      ['a', '2026-12-01', 12],
    ]);
  });
  it('percentual sugerido: fixo do contrato ou índice acumulado', () => {
    expect(percentualSugerido({ reajuste_indice: 'fixo', reajuste_percentual_fixo: 5 }, {})).toBe(5);
    expect(percentualSugerido({ reajuste_indice: 'igpm' }, { igpm: 3.2 })).toBe(3.2);
    expect(percentualSugerido({ reajuste_indice: 'ipca' }, { igpm: 3.2 })).toBeNull();
    expect(percentualSugerido({}, { igpm: 3.2 })).toBeNull();
  });
  it('acumulado de série mensal', () => {
    expect(acumular([1, 1])).toBe(2.01);
    expect(acumular([])).toBe(0);
  });
});
