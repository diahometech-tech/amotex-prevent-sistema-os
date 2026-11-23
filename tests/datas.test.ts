import { describe, expect, it } from 'vitest';
import type { OS } from '../src/lib/db';
import {
  diaUtilApartirDe, ehDiaUtil, formatarDataCurta, hojeISO, inicioDoDiaProgramado, montarRotaDoDia,
  normalizarDataProgramada, proximoDiaUtil, somarDias,
} from '../src/lib/os-agenda';

describe('hoje em São Paulo (virada de dia)', () => {
  it('depois das 21h em SP o servidor (UTC) já está no dia seguinte, mas hoje ainda é o mesmo', () => {
    expect(hojeISO(new Date('2026-11-20T23:30:00Z'))).toBe('2026-11-20'); // 20h30 em SP
    expect(hojeISO(new Date('2026-11-21T02:59:00Z'))).toBe('2026-11-20'); // 23h59 em SP
    expect(hojeISO(new Date('2026-11-21T03:00:00Z'))).toBe('2026-11-21'); // meia-noite em SP
  });
  it('virada de mês e de ano', () => {
    expect(hojeISO(new Date('2026-12-01T02:59:00Z'))).toBe('2026-11-30');
    expect(hojeISO(new Date('2027-01-01T02:59:00Z'))).toBe('2026-12-31');
    expect(hojeISO(new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });
  it('início do dia agendado é meia-noite de Brasília', () => {
    expect(new Date(inicioDoDiaProgramado('2026-11-20')).toISOString()).toBe('2026-11-20T03:00:00.000Z');
  });
});

describe('data de calendário', () => {
  it('normaliza: vazio limpa, data real passa, o resto é inválido', () => {
    expect(normalizarDataProgramada(null)).toBeNull();
    expect(normalizarDataProgramada('')).toBeNull();
    expect(normalizarDataProgramada('2026-11-20')).toBe('2026-11-20');
    expect(normalizarDataProgramada('2024-02-29')).toBe('2024-02-29');
    for (const v of ['2026-02-30', '2026-13-01', '20/11/2026', '2026-1-1', 20261120, undefined, {}]) {
      expect(normalizarDataProgramada(v), String(v)).toBeUndefined();
    }
  });
  it('somar dias atravessa mês, ano e bissexto', () => {
    expect(somarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(somarDias('2024-03-01', -1)).toBe('2024-02-29');
  });
  it('rótulo curto', () => {
    expect(formatarDataCurta('2026-11-20')).toBe('sex 20/11');
    expect(formatarDataCurta('2026-11-22')).toBe('dom 22/11');
  });
});

describe('dias úteis da preventiva', () => {
  it('segunda a sexta', () => {
    expect(ehDiaUtil('2026-11-20')).toBe(true); // sexta
    expect(ehDiaUtil('2026-11-21')).toBe(false); // sábado
    expect(ehDiaUtil('2026-11-22')).toBe(false); // domingo
  });
  it('próximo dia útil pula o fim de semana', () => {
    expect(proximoDiaUtil('2026-11-20')).toBe('2026-11-23');
    expect(diaUtilApartirDe('2026-11-21')).toBe('2026-11-23');
    expect(diaUtilApartirDe('2026-11-23')).toBe('2026-11-23');
    expect(diaUtilApartirDe('2026-11-21', [])).toBe('2026-11-21');
  });
});

describe('rota do dia', () => {
  const os = (p: Partial<OS>) => ({ id: 'x', status: 'aberta', ...p }) as OS;
  const lista = [
    os({ id: 'hoje', data_programada: '2026-11-20' }),
    os({ id: 'atrasada', data_programada: '2026-11-18' }),
    os({ id: 'futura', data_programada: '2026-11-25' }),
    os({ id: 'semdata' }),
    os({ id: 'fechada', data_programada: '2026-11-20', status: 'finalizada' }),
  ];
  it('hoje: do dia, atrasadas e sem data; encerrada fica de fora', () => {
    const r = montarRotaDoDia(lista, '2026-11-20', '2026-11-20');
    expect(r.doDia.map((o) => o.id)).toEqual(['hoje']);
    expect(r.atrasadas.map((o) => o.id)).toEqual(['atrasada']);
    expect(r.semData.map((o) => o.id)).toEqual(['semdata']);
  });
  it('olhando outro dia, o atraso de hoje não aparece', () => {
    const r = montarRotaDoDia(lista, '2026-11-25', '2026-11-20');
    expect(r.doDia.map((o) => o.id)).toEqual(['futura']);
    expect(r.atrasadas).toEqual([]);
  });
});
