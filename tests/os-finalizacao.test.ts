import { describe, expect, it } from 'vitest';
import { equipamentosObrigatorios, nomeEquipamentoDoItem, pendenciasFinalizacao } from '../src/lib/os-finalizacao';

type Args = Parameters<typeof pendenciasFinalizacao>[0];

const assinada = { assinatura_tecnico_url: '/t.png', assinatura_zelador_url: '/z.png', assinatura_zelador_nome: 'Seu Zé' };
const base = (o: Partial<Args['os']> = {}): Args['os'] => ({ tipo: 'preventiva', ...assinada, ...o });
const item = (p: Partial<Args['checklist'][number]> = {}) => ({ obrigatorio: true, concluido: true, descricao: 'Verificar luz', ...p });

describe('trava de finalização', () => {
  it('preventiva completa sem foto: nada pendente (foto só na corretiva)', () => {
    expect(pendenciasFinalizacao({ os: base(), checklist: [item()], fotos: [] })).toEqual([]);
  });

  it('checklist obrigatório pendente trava', () => {
    const p = pendenciasFinalizacao({ os: base(), checklist: [item({ concluido: false }), item({ concluido: false }), item()], fotos: [] });
    expect(p).toEqual(['2 item(ns) obrigatório(s) do checklist pendente(s)']);
  });

  it('item opcional pendente não trava', () => {
    expect(pendenciasFinalizacao({ os: base(), checklist: [item({ obrigatorio: false, concluido: false })], fotos: [] })).toEqual([]);
  });

  it('corretiva sem equipamento exige uma foto antes e uma depois', () => {
    const os = base({ tipo: 'corretiva' });
    expect(pendenciasFinalizacao({ os, checklist: [], fotos: [] })).toEqual(['Falta foto ANTES do serviço', 'Falta foto DEPOIS do serviço']);
    expect(pendenciasFinalizacao({ os, checklist: [], fotos: [{ momento: 'antes' }] })).toEqual(['Falta foto DEPOIS do serviço']);
    expect(pendenciasFinalizacao({ os, checklist: [], fotos: [{ momento: 'antes' }, { momento: 'depois' }] })).toEqual([]);
  });

  it('corretiva de equipamento: foto antes/depois precisa ser DAQUELE equipamento', () => {
    const os = { ...base({ tipo: 'corretiva' }), equipamento_id: 'e1' };
    const checklist = [
      item({ equipamento_id: 'e1', descricao: 'Inspecionar Bomba 1 (5 HP)' }),
      item({ equipamento_id: 'e2', descricao: 'Inspecionar Bomba 2' }),
    ];
    // foto geral não vale e a de outro equipamento também não
    expect(pendenciasFinalizacao({ os, checklist, fotos: [{ momento: 'antes' }, { momento: 'depois', equipamento_id: 'e2' }] }))
      .toEqual(['Falta foto ANTES de: Bomba 1 (5 HP)', 'Falta foto DEPOIS de: Bomba 1 (5 HP)']);
    expect(pendenciasFinalizacao({ os, checklist, fotos: [{ momento: 'antes', equipamento_id: 'e1' }, { momento: 'depois', equipamento_id: 'e1' }] })).toEqual([]);
  });

  it('preventiva com equipamento no checklist não exige foto', () => {
    const os = { ...base(), equipamento_id: 'e1' };
    expect(pendenciasFinalizacao({ os, checklist: [item({ equipamento_id: 'e1' })], fotos: [] })).toEqual([]);
  });

  it('equipamentosObrigatorios: só o da OS, sem repetir', () => {
    const lista = [item({ equipamento_id: 'e1' }), item({ equipamento_id: 'e1' }), item({ equipamento_id: 'e2' }), item()];
    expect(equipamentosObrigatorios({ tipo: 'corretiva', equipamento_id: 'e1' }, lista)).toHaveLength(1);
    expect(equipamentosObrigatorios({ tipo: 'preventiva', equipamento_id: 'e1' }, lista)).toEqual([]);
    expect(equipamentosObrigatorios({ tipo: 'corretiva' }, lista)).toEqual([]);
  });

  it('assinaturas: técnico e zelador, e o nome de quem assinou', () => {
    const sem = (o: Partial<Args['os']>) => pendenciasFinalizacao({ os: base(o), checklist: [], fotos: [] });
    expect(sem({ assinatura_tecnico_url: undefined })).toEqual(['Falta assinatura do técnico']);
    expect(sem({ assinatura_zelador_url: undefined })).toEqual(['Falta assinatura do zelador']);
    expect(sem({ assinatura_zelador_nome: '   ' })).toEqual(['Falta o nome de quem assinou pelo condomínio']);
    expect(sem({ assinatura_zelador_url: undefined, assinatura_zelador_nome: undefined })).toEqual(['Falta assinatura do zelador']);
  });

  it('acumula tudo que falta (corretiva sem nada)', () => {
    const p = pendenciasFinalizacao({ os: { tipo: 'corretiva' }, checklist: [item({ concluido: false })], fotos: [] });
    expect(p).toHaveLength(5);
  });

  it('nome do equipamento sem o prefixo "Inspecionar"', () => {
    expect(nomeEquipamentoDoItem('Inspecionar Bomba 1 (5 HP)')).toBe('Bomba 1 (5 HP)');
    expect(nomeEquipamentoDoItem('inspecionar Portão')).toBe('Portão');
    expect(nomeEquipamentoDoItem('Trocar filtro')).toBe('Trocar filtro');
  });
});
