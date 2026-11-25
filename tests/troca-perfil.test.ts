import { describe, expect, it } from 'vitest';
import { avaliarTrocaPapel } from '../src/lib/usuario-campos';

const gestor = 'u-gestor';
const tec = { id: 'u-tec', papel: 'tecnico' as const };
const sind = { id: 'u-sind', papel: 'sindico' as const };

describe('avaliarTrocaPapel', () => {
  it('técnico vira secretária: sai do plantão e perde a especialidade', () => {
    expect(avaliarTrocaPapel({ alvo: tec, novoPapel: 'secretaria', sessaoId: gestor, condominioExiste: false })).toEqual({
      campos: { papel: 'secretaria', especialidade: null, de_plantao: false },
    });
  });

  it('virar síndico exige condomínio existente', () => {
    expect(avaliarTrocaPapel({ alvo: tec, novoPapel: 'sindico', sessaoId: gestor, condominioExiste: false })).toEqual({
      erro: 'Selecione o condomínio do síndico.',
    });
    expect(
      avaliarTrocaPapel({ alvo: tec, novoPapel: 'sindico', condominioId: 'c1', sessaoId: gestor, condominioExiste: false })
    ).toEqual({ erro: 'Condomínio não encontrado.' });
    expect(
      avaliarTrocaPapel({ alvo: tec, novoPapel: 'sindico', condominioId: 'c1', sessaoId: gestor, condominioExiste: true })
    ).toEqual({ campos: { papel: 'sindico', condominio_id: 'c1', especialidade: null, de_plantao: false } });
  });

  it('síndico vira técnico: perde o vínculo com o condomínio', () => {
    expect(avaliarTrocaPapel({ alvo: sind, novoPapel: 'tecnico', sessaoId: gestor, condominioExiste: false })).toEqual({
      campos: { papel: 'tecnico', condominio_id: null },
    });
  });

  it('síndico pode só mudar de condomínio', () => {
    expect(
      avaliarTrocaPapel({ alvo: sind, novoPapel: 'sindico', condominioId: 'c2', sessaoId: gestor, condominioExiste: true })
    ).toEqual({ campos: { papel: 'sindico', condominio_id: 'c2' } });
  });

  it('ninguém troca o próprio perfil', () => {
    expect(
      avaliarTrocaPapel({ alvo: { id: gestor, papel: 'admin' }, novoPapel: 'tecnico', sessaoId: gestor, condominioExiste: false })
    ).toEqual({ erro: 'Você não pode trocar o próprio perfil.' });
    // Salvar o próprio cadastro sem mudar o perfil continua funcionando.
    expect(
      avaliarTrocaPapel({ alvo: { id: gestor, papel: 'admin' }, novoPapel: 'admin', sessaoId: gestor, condominioExiste: false })
    ).toEqual({ campos: { papel: 'admin' } });
  });

  it('perfil desconhecido é recusado', () => {
    expect(avaliarTrocaPapel({ alvo: tec, novoPapel: 'root', sessaoId: gestor, condominioExiste: false })).toEqual({
      erro: 'Perfil inválido.',
    });
  });
});
