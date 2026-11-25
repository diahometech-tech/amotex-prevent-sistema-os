import { describe, expect, it, vi } from 'vitest';
import type { OS, UserRole } from '../src/lib/db';
import {
  PAPEIS, abasFinanceiro, isEscritorio, moduloDaRota, podeAcaoCobranca, podeAbrirOS, podeApagarOS,
  podeCancelarOS, podeEditarCondominio, podeEditarContato, podeEditarEquipamento, podeGerirPlantao,
  podeOperarCampo, podePlanejarPreventivas, podeVerContrato, podeVerModulo, podeVerRotaDeTodos,
  telaInicial, tecnicoOperaOS, avaliarAssumirOS, isPapelValido,
} from '../src/lib/roles';
import { ROLE_LABELS, canManageUsers } from '../src/lib/permissions';

// As leituras de banco só rodam para síndico e para a leitura de OS encerrada
// do técnico; o teste troca o banco por dados em memória.
const usuarios: Record<string, { condominio_id?: string }> = { s1: { condominio_id: 'c1' }, s2: { condominio_id: 'c2' }, s3: {} };
const osDoCondominio: Record<string, Pick<OS, 'tecnico_id' | 'tipo' | 'status'>[]> = {
  c1: [{ tecnico_id: 't1', tipo: 'preventiva', status: 'aberta' }],
  c2: [{ tecnico_id: undefined, tipo: 'corretiva', status: 'aberta' }],
};
vi.mock('../src/lib/db', () => ({
  Database: {
    getUserById: async (id: string) => usuarios[id] ?? null,
    getOSsByCondominio: async (id: string) => osDoCondominio[id] ?? [],
  },
}));

const { podeVerOS, podeLerOS, podeOperarOS, canAccessCondominio, filtrarOSVisiveis, condominioParaPapel, encodeSession, decodeSession } =
  await import('../src/lib/auth');

const sessao = (role: UserRole, id = 'u1') => ({ id, name: 'Fulano', role });
const os = (p: Partial<OS> = {}) => ({
  condominio_id: 'c1',
  tecnico_id: undefined as string | undefined,
  tipo: 'corretiva' as OS['tipo'],
  status: 'aberta' as OS['status'],
  ...p,
});

describe('módulos por papel (matriz do roles.ts)', () => {
  const matriz: Record<string, UserRole[]> = {
    dashboard: ['admin', 'secretaria'],
    os: ['admin', 'secretaria', 'tecnico'],
    rotas: ['admin', 'secretaria', 'tecnico'],
    condominios: ['admin', 'secretaria', 'tecnico'],
    painel: ['admin', 'secretaria', 'sindico'],
    financeiro: ['admin', 'secretaria'],
    usuarios: ['admin'],
    ajuda: ['admin', 'secretaria', 'tecnico', 'sindico'],
  };
  for (const [modulo, papeis] of Object.entries(matriz)) {
    for (const papel of PAPEIS) {
      it(`${modulo}: ${papel} ${papeis.includes(papel) ? 'vê' : 'não vê'}`, () => {
        expect(podeVerModulo(papel, modulo as Parameters<typeof podeVerModulo>[1])).toBe(papeis.includes(papel));
      });
    }
  }
  it('sem papel não vê nada', () => {
    expect(podeVerModulo(undefined, 'ajuda')).toBe(false);
  });
  it('tela inicial: síndico vai pro painel, os outros pra raiz', () => {
    expect(telaInicial('sindico')).toBe('/painel');
    expect(telaInicial('admin')).toBe('/');
    expect(telaInicial('tecnico')).toBe('/');
  });
  it('rota para módulo', () => {
    expect(moduloDaRota('/')).toBe('os');
    expect(moduloDaRota('/financeiro')).toBe('financeiro');
    expect(moduloDaRota('/financeiro/algo')).toBe('financeiro');
    expect(moduloDaRota('/admin/usuarios')).toBe('usuarios');
    expect(moduloDaRota('/condominios/abc')).toBe('condominios');
    expect(moduloDaRota('/financeiroX')).toBeNull();
  });
  it('papel válido', () => {
    expect(isPapelValido('admin')).toBe(true);
    expect(isPapelValido('root')).toBe(false);
    expect(isPapelValido(undefined)).toBe(false);
  });
});

describe('ações por papel', () => {
  const quem = (fn: (r?: UserRole) => boolean) => PAPEIS.filter((p) => fn(p));
  it('abrir OS: gestor, secretária e técnico', () => expect(quem(podeAbrirOS)).toEqual(['admin', 'secretaria', 'tecnico']));
  it('operar campo: gestor e técnico (secretária não vai a campo)', () => expect(quem(podeOperarCampo)).toEqual(['admin', 'tecnico']));
  it('cancelar OS: escritório; apagar: só gestor', () => {
    expect(quem(podeCancelarOS)).toEqual(['admin', 'secretaria']);
    expect(quem(podeApagarOS)).toEqual(['admin']);
  });
  it('planejar preventivas, plantão, rotas de todos, contrato e contato: escritório', () => {
    for (const fn of [podePlanejarPreventivas, podeGerirPlantao, podeVerRotaDeTodos, podeVerContrato, podeEditarContato]) {
      expect(quem(fn)).toEqual(['admin', 'secretaria']);
    }
  });
  it('condomínio: cadastro só do gestor; equipamento gestor e técnico', () => {
    expect(quem(podeEditarCondominio)).toEqual(['admin']);
    expect(quem(podeEditarEquipamento)).toEqual(['admin', 'tecnico']);
  });
  it('gestão de usuários só do gestor', () => {
    expect(PAPEIS.filter((p) => canManageUsers(p))).toEqual(['admin']);
    expect(ROLE_LABELS.admin).toBe('Gestor');
  });
  it('escritório = admin + secretária', () => {
    expect(PAPEIS.filter(isEscritorio)).toEqual(['admin', 'secretaria']);
    expect(isEscritorio(undefined)).toBe(false);
  });
});

describe('cobranças: ações por papel', () => {
  it('gestor faz tudo', () => {
    for (const a of ['marcar_enviada', 'registrar_pagamento', 'anexar_comprovante', 'ajustar_vencimento', 'isentar', 'reabrir', 'editar']) {
      expect(podeAcaoCobranca('admin', a)).toBe(true);
    }
  });
  it('secretária só a rotina (mais o ajuste de vencimento em lote)', () => {
    for (const a of ['marcar_enviada', 'registrar_pagamento', 'anexar_comprovante', 'ajustar_vencimento']) {
      expect(podeAcaoCobranca('secretaria', a)).toBe(true);
    }
    for (const a of ['isentar', 'reabrir', 'editar', 'qualquer']) expect(podeAcaoCobranca('secretaria', a)).toBe(false);
  });
  it('técnico, síndico e sem papel: nada', () => {
    for (const p of ['tecnico', 'sindico', undefined] as (UserRole | undefined)[]) {
      expect(podeAcaoCobranca(p, 'marcar_enviada')).toBe(false);
      expect(podeAcaoCobranca(p, 'ajustar_vencimento')).toBe(false);
    }
  });
  it('abas do financeiro por papel', () => {
    expect(abasFinanceiro('admin')).toEqual(['painel', 'cobrancas', 'reajustes', 'pendencias']);
    expect(abasFinanceiro('secretaria')).toEqual(['cobrancas']);
    expect(abasFinanceiro('tecnico')).toEqual([]);
    expect(abasFinanceiro('sindico')).toEqual([]);
  });
});

describe('escopo de OS do técnico (25/11: vê todas — ver podeVerOS —, mexe só na dele)', () => {
  it('tecnicoOperaOS: só a dele', () => {
    expect(tecnicoOperaOS('t1', os({ tecnico_id: 't1' }))).toBe(true);
    expect(tecnicoOperaOS('t1', os({ tecnico_id: 't2' }))).toBe(false);
    expect(tecnicoOperaOS('t1', os())).toBe(false);
    expect(tecnicoOperaOS('', os())).toBe(false);
  });
});

describe('avaliarAssumirOS (regra de assumir)', () => {
  const base = { tecnico_id: undefined as string | undefined, status: 'aberta' as OS['status'], a_caminho_em: undefined, entrada_em: undefined };
  it('sem técnico, qualquer tipo: direto', () => expect(avaliarAssumirOS('t1', base)).toBe('direto'));
  it('já é dele: nada a fazer', () => expect(avaliarAssumirOS('t1', { ...base, tecnico_id: 't1' })).toBe('ja_e_dele'));
  it('de outro técnico, aberta e não iniciada: tomar (com confirmação)', () => {
    expect(avaliarAssumirOS('t1', { ...base, tecnico_id: 't2' })).toBe('tomar');
  });
  it('de outro técnico a caminho, com chegada ou em andamento: recusa', () => {
    expect(avaliarAssumirOS('t1', { ...base, tecnico_id: 't2', a_caminho_em: '2026-11-25T10:00:00Z' })).toBe('iniciada');
    expect(avaliarAssumirOS('t1', { ...base, tecnico_id: 't2', entrada_em: '2026-11-25T10:00:00Z' })).toBe('iniciada');
    expect(avaliarAssumirOS('t1', { ...base, tecnico_id: 't2', status: 'em_andamento' })).toBe('iniciada');
  });
  it('encerrada: recusa, com ou sem técnico', () => {
    expect(avaliarAssumirOS('t1', { ...base, status: 'finalizada' })).toBe('encerrada');
    expect(avaliarAssumirOS('t1', { ...base, tecnico_id: 't2', status: 'cancelada' })).toBe('encerrada');
  });
});

describe('podeVerOS, podeOperarOS e canAccessCondominio', () => {
  it('escritório vê qualquer OS', async () => {
    expect(await podeVerOS(sessao('admin'), os({ tecnico_id: 't9', tipo: 'preventiva' }))).toBe(true);
    expect(await podeVerOS(sessao('secretaria'), os({ tecnico_id: 't9', tipo: 'preventiva' }))).toBe(true);
  });
  it('técnico vê qualquer OS, ativa ou encerrada', async () => {
    expect(await podeVerOS(sessao('tecnico', 't1'), os({ tecnico_id: 't1' }))).toBe(true);
    expect(await podeVerOS(sessao('tecnico', 't1'), os({ tecnico_id: 't2' }))).toBe(true);
    expect(await podeVerOS(sessao('tecnico', 't1'), os())).toBe(true);
    const encerrada = os({ condominio_id: 'c3', tecnico_id: 'outro', status: 'finalizada', tipo: 'preventiva' });
    expect(await podeVerOS(sessao('tecnico', 't1'), encerrada)).toBe(true);
    expect(await podeLerOS(sessao('tecnico', 't1'), encerrada)).toBe(true);
  });
  it('podeOperarOS: técnico só na dele; gestor em qualquer; secretária e síndico nunca', () => {
    expect(podeOperarOS(sessao('tecnico', 't1'), os({ tecnico_id: 't1' }))).toBe(true);
    expect(podeOperarOS(sessao('tecnico', 't1'), os({ tecnico_id: 't2' }))).toBe(false);
    expect(podeOperarOS(sessao('tecnico', 't1'), os())).toBe(false);
    expect(podeOperarOS(sessao('admin'), os({ tecnico_id: 't2' }))).toBe(true);
    expect(podeOperarOS(sessao('secretaria'), os({ tecnico_id: 't1' }))).toBe(false);
    expect(podeOperarOS(sessao('sindico', 's1'), os({ tecnico_id: 's1' }))).toBe(false);
  });
  it('síndico só do próprio condomínio', async () => {
    expect(await podeVerOS(sessao('sindico', 's1'), os({ condominio_id: 'c1' }))).toBe(true);
    expect(await podeVerOS(sessao('sindico', 's1'), os({ condominio_id: 'c2' }))).toBe(false);
  });
  it('síndico sem condomínio e usuário inexistente: nada', async () => {
    expect(await canAccessCondominio(sessao('sindico', 's3'), 'c1')).toBe(false);
    expect(await canAccessCondominio(sessao('sindico', 'nao-existe'), 'c1')).toBe(false);
  });
  it('técnico acessa qualquer condomínio', async () => {
    expect(await canAccessCondominio(sessao('tecnico', 't1'), 'c1')).toBe(true);
    expect(await canAccessCondominio(sessao('tecnico', 't1'), 'c3')).toBe(true);
  });
  it('papel desconhecido é recusado', async () => {
    expect(await podeVerOS(sessao('root' as UserRole), os())).toBe(false);
    expect(await canAccessCondominio(sessao('root' as UserRole), 'c1')).toBe(false);
  });
  it('síndico não lê OS de outro condomínio', async () => {
    expect(await podeLerOS(sessao('sindico', 's1'), os({ condominio_id: 'c2', status: 'finalizada' }))).toBe(false);
  });
  it('filtrarOSVisiveis por papel', async () => {
    const lista = [
      os({ condominio_id: 'c1', tecnico_id: 't1', tipo: 'preventiva' }),
      os({ condominio_id: 'c2', tecnico_id: 't2', tipo: 'preventiva' }),
      os({ condominio_id: 'c2' }), // corretiva sem técnico
    ];
    expect(await filtrarOSVisiveis(sessao('admin'), lista)).toHaveLength(3);
    expect(await filtrarOSVisiveis(sessao('tecnico', 't1'), lista)).toHaveLength(3);
    expect(await filtrarOSVisiveis(sessao('sindico', 's2'), lista)).toHaveLength(2);
    expect(await filtrarOSVisiveis(sessao('sindico', 's3'), lista)).toHaveLength(0);
  });
});

describe('dados de contrato escondidos de técnico e síndico', () => {
  const cond = { id: 'c1', nome: 'Gaivotas', cnpj: '123', valor_mensal_centavos: 100000, emails_cobranca: 'a@b.c', dia_vencimento: 10 };
  it('escritório recebe tudo', () => {
    expect(condominioParaPapel('admin', cond)).toEqual(cond);
    expect(condominioParaPapel('secretaria', cond)).toEqual(cond);
  });
  it('técnico e síndico recebem sem campos de contrato', () => {
    for (const papel of ['tecnico', 'sindico'] as const) {
      expect(condominioParaPapel(papel, cond)).toEqual({ id: 'c1', nome: 'Gaivotas' });
    }
  });
});

describe('sessão assinada', () => {
  it('ida e volta', () => {
    expect(decodeSession(encodeSession(sessao('admin', 'a1')))).toEqual({ id: 'a1', name: 'Fulano', role: 'admin' });
  });
  it('adulterar o papel invalida', () => {
    const [payload, sig] = encodeSession(sessao('tecnico', 't1')).split('.');
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString());
    json.role = 'admin';
    const forjado = `${Buffer.from(JSON.stringify(json)).toString('base64url')}.${sig}`;
    expect(decodeSession(forjado)).toBeNull();
  });
  it('vazio e sem assinatura', () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession('')).toBeNull();
    expect(decodeSession('semponto')).toBeNull();
  });
  it('expirada', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
      const token = encodeSession(sessao('admin'));
      vi.setSystemTime(new Date('2026-11-21T01:00:00Z')); // 13h depois (validade = 12h)
      expect(decodeSession(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
