import { describe, expect, it } from 'vitest';
import type { User } from '../src/lib/db';
import { emHorarioComercial, periodoAtendimento } from '../src/lib/horario-comercial';
import { atendeCorretiva, escolherDestinatarios, plantonistasEm } from '../src/lib/plantao';

const plantonistas = (users: User[]) => plantonistasEm(new Date('2026-11-23T12:00:00Z'), [], users).usuarios;

// Horários em Brasília (UTC-3, sem horário de verão desde 2019).
describe('horário comercial', () => {
  const casos: [string, string, 'comercial' | 'plantao'][] = [
    ['seg 07:59', '2026-11-16T10:59:00Z', 'plantao'],
    ['seg 08:00', '2026-11-16T11:00:00Z', 'comercial'],
    ['sex 17:59', '2026-11-20T20:59:00Z', 'comercial'],
    ['sex 18:00', '2026-11-20T21:00:00Z', 'plantao'],
    ['sáb 08:00', '2026-11-21T11:00:00Z', 'comercial'],
    ['sáb 15:59', '2026-11-21T18:59:00Z', 'comercial'],
    ['sáb 16:00', '2026-11-21T19:00:00Z', 'plantao'],
    ['dom 12:00', '2026-11-22T15:00:00Z', 'plantao'],
    ['seg 01:00 (UTC ainda é domingo)', '2026-11-16T04:00:00Z', 'plantao'],
    ['dom 23:30 (UTC já é segunda)', '2026-11-16T02:30:00Z', 'plantao'],
  ];
  for (const [nome, iso, esperado] of casos) {
    it(`${nome} = ${esperado}`, () => {
      expect(periodoAtendimento(new Date(iso))).toBe(esperado);
      expect(emHorarioComercial(new Date(iso))).toBe(esperado === 'comercial');
    });
  }
});

describe('plantão e aviso de corretiva', () => {
  const user = (id: string, p: Partial<User> = {}): User => ({
    id, nome: `Nome ${id}`, login: id, papel: 'tecnico', senha_hash: 'x', ativo: true, criado_em: '2026-01-01T00:00:00Z',
    telegram_chat_id: `chat-${id}`, ...p,
  });
  const equipe: User[] = [
    user('adm', { papel: 'admin' }),
    user('sec', { papel: 'secretaria' }),
    user('t1', { de_plantao: true }),
    user('t2'),
    user('t3', { especialidade: 'preventiva' }),
    user('t4', { ativo: false }),
  ];
  const comercial = new Date('2026-11-17T15:00:00Z'); // terça 12h
  const noturno = new Date('2026-11-17T23:00:00Z'); // terça 20h
  const ids = (l: User[]) => l.map((u) => u.id).sort();

  it('quem atende corretiva: técnico ativo que não é só de preventiva', () => {
    expect(equipe.filter(atendeCorretiva).map((u) => u.id)).toEqual(['t1', 't2']);
    expect(atendeCorretiva(user('s', { papel: 'sindico' }))).toBe(false);
  });
  it('plantonistas: de plantão e que atendem corretiva', () => {
    expect(plantonistas(equipe).map((u) => u.id)).toEqual(['t1']);
    expect(plantonistas([user('t9', { de_plantao: true, ativo: false })])).toEqual([]);
  });
  it('OS com técnico: só ele (mais gestor e secretária)', () => {
    const r = escolherDestinatarios(equipe, { agora: noturno, tecnicoId: 't2' });
    expect(ids(r.destinatarios)).toEqual(['adm', 'sec', 't2']);
    expect(r.motivo).toBe('atribuida');
    expect(r.atribuido).toEqual({ id: 't2', nome: 'Nome t2', semTelegram: false });
  });
  it('técnico indicado inativo ou inexistente cai na regra geral', () => {
    expect(escolherDestinatarios(equipe, { agora: comercial, tecnicoId: 't4' }).motivo).toBe('comercial');
    expect(escolherDestinatarios(equipe, { agora: comercial, tecnicoId: 'zzz' }).motivo).toBe('comercial');
  });
  it('sem técnico em horário comercial: todos os técnicos de corretiva', () => {
    const r = escolherDestinatarios(equipe, { agora: comercial });
    expect(ids(r.destinatarios)).toEqual(['adm', 'sec', 't1', 't2']);
    expect(r.motivo).toBe('comercial');
    expect(r.periodo).toBe('comercial');
    expect(r.tecnicosAvisados).toBe(2);
  });
  it('sem técnico à noite: só quem está de plantão', () => {
    const r = escolherDestinatarios(equipe, { agora: noturno });
    expect(ids(r.destinatarios)).toEqual(['adm', 'sec', 't1']);
    expect(r.motivo).toBe('plantao');
    expect(r.plantao).toEqual(['Nome t1']);
  });
  it('plantão vazio: avisa todos os técnicos de corretiva', () => {
    const semPlantao = equipe.map((u) => ({ ...u, de_plantao: false }));
    const r = escolherDestinatarios(semPlantao, { agora: noturno });
    expect(ids(r.destinatarios)).toEqual(['adm', 'sec', 't1', 't2']);
    expect(r.motivo).toBe('plantao_vazio');
    expect(r.plantao).toEqual([]);
  });
  it('só recebe quem tem Telegram; plantonista sem Telegram é sinalizado', () => {
    const e = equipe.map((u) => (u.id === 't1' ? { ...u, telegram_chat_id: undefined } : u));
    const r = escolherDestinatarios(e, { agora: noturno });
    expect(ids(r.destinatarios)).toEqual(['adm', 'sec']);
    expect(r.plantaoSemTelegram).toEqual(['Nome t1']);
    expect(r.tecnicosAvisados).toBe(0);
  });
  it('gestor inativo não é avisado', () => {
    const e = equipe.map((u) => (u.id === 'adm' ? { ...u, ativo: false } : u));
    expect(ids(escolherDestinatarios(e, { agora: comercial }).destinatarios)).not.toContain('adm');
  });
});
