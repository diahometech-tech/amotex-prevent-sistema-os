'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Form';
import { formatarReais } from '@/lib/financeiro/dinheiro';
import { rotuloCompetencia, type ResumoMes } from '@/lib/financeiro/cobranca';
import type { MesFinanceiro, PontoCarteira, Projecao } from '@/lib/financeiro/painel';

interface Dados {
  hoje: string;
  competencia: string;
  kpis: {
    ativos: number; receitaMensal: number; receitaAnual: number; ticketMedio: number; novosNoMes: number; saidasNoMes: number;
    inadimplenciaValor: number; inadimplenciaCondominios: number; reajustesPendentes: number; reajustesAguardando: number;
    cadastrosIncompletos: number;
    semDataInicio: number;
  };
  mesAtual: ResumoMes;
  serie: MesFinanceiro[];
  carteira: PontoCarteira[];
  projecao: Projecao;
}

// Valores curtos pro eixo: "R$ 70 mil", "R$ 1,2 mi".
function reaisCurto(centavos: number): string {
  const r = centavos / 100;
  if (r >= 1_000_000) return `R$ ${(r / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (r >= 1_000) return `R$ ${Math.round(r / 1000)} mil`;
  return `R$ ${Math.round(r)}`;
}

function escalaBonita(max: number): number[] {
  if (max <= 0) return [0, 1];
  const passoBruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= passoBruto)!;
  const topo = Math.ceil(max / passo) * passo;
  return Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
}

// Painel do gestor: só receita (decisão da reunião de 26/10). Cores dos
// gráficos: tokens --color-amx-serie-1/2 (globals.css), validados no fundo
// do app. Cada gráfico tem tabela equivalente (acessibilidade).
export function PainelTab({ onIr }: { onIr: (aba: 'cobrancas' | 'reajustes' | 'pendencias') => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [editandoMeta, setEditandoMeta] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/financeiro/painel', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setDados(d);
      else setErro(d.error || 'Não foi possível carregar o painel.');
    } catch {
      setErro('Erro de conexão.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar só faz setState depois do fetch
    carregar();
  }, [carregar]);

  if (!dados) {
    return erro ? <p className="text-xs font-semibold text-amx-red-hover">{erro}</p> : <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>;
  }
  const k = dados.kpis;
  const m = dados.mesAtual;
  const p = dados.projecao;
  // Projeção só é confiável com a data de início da maioria dos contratos.
  const historicoIncerto = k.ativos > 0 && k.semDataInicio / k.ativos > 0.2;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile titulo="Receita mensal (contratos)" valor={formatarReais(k.receitaMensal)} detalhe={`${formatarReais(k.receitaAnual)} por ano · ticket médio ${formatarReais(k.ticketMedio)}`} />
        <Tile
          titulo="Condomínios ativos"
          valor={String(k.ativos)}
          detalhe={historicoIncerto ? `${k.semDataInicio} sem data de início do contrato` : `+${k.novosNoMes} novos · −${k.saidasNoMes} saídas no mês`}
        />
        <Tile
          titulo={`Recebido em ${rotuloCompetencia(dados.competencia)}`}
          valor={formatarReais(m.recebido)}
          detalhe={m.previsto ? `${Math.round(m.percentualRecebido * 100)}% de ${formatarReais(m.previsto)}` : 'cobranças do mês ainda não geradas'}
          onClick={() => onIr('cobrancas')}
        />
        <Tile
          titulo="Inadimplência"
          valor={formatarReais(k.inadimplenciaValor)}
          detalhe={`${k.inadimplenciaCondominios} condomínio${k.inadimplenciaCondominios !== 1 ? 's' : ''} com cobrança atrasada`}
          alerta={k.inadimplenciaValor > 0}
          onClick={() => onIr('cobrancas')}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Tile
          titulo="Reajustes"
          valor={`${k.reajustesPendentes} a fazer`}
          detalhe={`${k.reajustesAguardando} aguardando envio ou resposta`}
          alerta={k.reajustesPendentes > 0}
          onClick={() => onIr('reajustes')}
        />
        <Tile
          titulo="Cadastros incompletos"
          valor={String(k.cadastrosIncompletos)}
          detalhe="sem data de contrato, índice, responsável ou e-mail"
          alerta={k.cadastrosIncompletos > 0}
          onClick={() => onIr('pendencias')}
        />
      </div>

      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Receita mês a mês</p>
          <Legenda itens={[['var(--color-amx-serie-1)', 'Previsto'], ['var(--color-amx-serie-2)', 'Recebido']]} />
        </div>
        <GraficoReceita serie={dados.serie} atual={dados.competencia} />
        <details>
          <summary className="text-xs text-amx-muted cursor-pointer">Ver tabela</summary>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-amx-muted"><tr><th className="text-left py-1">Mês</th><th className="text-right">Previsto</th><th className="text-right">Recebido</th><th className="text-right">Em aberto</th><th className="text-right">Atrasadas</th></tr></thead>
              <tbody className="text-white">
                {dados.serie.map((s) => (
                  <tr key={s.competencia} className="border-t border-amx-line">
                    <td className="py-1">{rotuloCompetencia(s.competencia)}</td>
                    <td className="text-right">{formatarReais(s.previsto)}</td>
                    <td className="text-right">{formatarReais(s.recebido)}</td>
                    <td className="text-right">{formatarReais(s.emAberto)}</td>
                    <td className="text-right">{s.atrasadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Carteira de condomínios × meta</p>
          <Button size="sm" variant="ghost" onClick={() => setEditandoMeta((v) => !v)}>{editandoMeta ? 'Fechar' : 'Alterar meta'}</Button>
        </div>
        {editandoMeta && <EditarMeta projecao={p} onSalvo={async () => { setEditandoMeta(false); await carregar(); }} />}
        <GraficoCarteira carteira={dados.carteira} meta={p.meta} />
        {historicoIncerto ? (
          <p className="text-sm text-amx-amber">
            Projeção ainda não confiável: {k.semDataInicio} de {k.ativos} contratos estão sem data de início e contam como
            entrada no mês em que foram cadastrados. Preencha as datas (aba Pendências de cadastro) para ver o ritmo real de crescimento.
          </p>
        ) : (
        <p className="text-sm text-white">
          {p.ativosHoje >= p.meta
            ? `Meta de ${p.meta} condomínios atingida.`
            : p.mesesAteMeta !== null
              ? `No ritmo dos últimos meses (${p.ritmoMensal > 0 ? '+' : ''}${p.ritmoMensal.toLocaleString('pt-BR')} por mês), a meta de ${p.meta} chega em ${rotuloCompetencia(p.competenciaMeta!, true)}.`
              : `Faltam ${p.meta - p.ativosHoje} condomínios para a meta de ${p.meta}; a carteira não cresceu nos últimos meses.`}
          {p.ativosHoje < p.meta && p.ritmoNecessario !== null && (
            <span className="text-amx-muted"> Para chegar lá até {rotuloCompetencia(p.prazo, true)}, são {p.ritmoNecessario.toLocaleString('pt-BR')} novos por mês.</span>
          )}
        </p>
        )}
        {historicoIncerto && p.ativosHoje < p.meta && p.ritmoNecessario !== null && (
          <p className="text-sm text-white">
            Faltam {p.meta - p.ativosHoje} condomínios para a meta de {p.meta}: {p.ritmoNecessario.toLocaleString('pt-BR')} novos por mês até {rotuloCompetencia(p.prazo, true)}.
          </p>
        )}
        <p className="text-[11px] text-amx-muted">
          A entrada de cada condomínio usa a data de início do contrato (ou a do cadastro, enquanto ela não for preenchida). A receita usa o valor atual de cada contrato.
        </p>
      </Card>
    </div>
  );
}

function Tile({ titulo, valor, detalhe, alerta, onClick }: { titulo: string; valor: string; detalhe?: string; alerta?: boolean; onClick?: () => void }) {
  const corpo = (
    <>
      <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider">{titulo}</p>
      <p className={`text-2xl font-bold tabular-nums ${alerta ? 'text-amx-amber' : 'text-white'}`}>{valor}</p>
      {detalhe && <p className="text-[11px] text-amx-muted">{detalhe}</p>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="text-left bg-amx-panel border border-amx-line rounded-[10px] p-4 flex flex-col gap-1 hover:border-amx-muted transition-colors">
      {corpo}
    </button>
  ) : (
    <Card className="p-4 flex flex-col gap-1">{corpo}</Card>
  );
}

function Legenda({ itens }: { itens: [string, string][] }) {
  return (
    <div className="flex items-center gap-4">
      {itens.map(([cor, nome]) => (
        <span key={nome} className="inline-flex items-center gap-1.5 text-xs text-amx-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: cor }} aria-hidden />
          {nome}
        </span>
      ))}
    </div>
  );
}

const W = 720, H = 240, M = { top: 12, right: 12, bottom: 28, left: 64 };

function GraficoReceita({ serie, atual }: { serie: MesFinanceiro[]; atual: string }) {
  const max = Math.max(...serie.map((s) => Math.max(s.previsto, s.recebido)), 0);
  if (max === 0) {
    return <p className="text-xs text-amx-muted py-10 text-center">Nenhuma cobrança gerada neste período. Gere as cobranças do mês na aba Cobranças.</p>;
  }
  const ticks = escalaBonita(max);
  const topo = ticks.at(-1)!;
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const banda = iw / serie.length;
  const larg = Math.min(18, (banda - 10) / 2);
  const y = (v: number) => M.top + ih - (v / topo) * ih;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Receita prevista e recebida por mês, últimos 12 meses">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-amx-line)" strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-amx-muted)">{reaisCurto(t)}</text>
          </g>
        ))}
        {serie.map((s, i) => {
          const cx = M.left + banda * i + banda / 2;
          return (
            <g key={s.competencia}>
              <title>{`${rotuloCompetencia(s.competencia, true)}: previsto ${formatarReais(s.previsto)}, recebido ${formatarReais(s.recebido)}`}</title>
              <rect x={M.left + banda * i} y={M.top} width={banda} height={ih} fill="transparent" />
              {s.previsto > 0 && <rect x={cx - larg - 1} y={y(s.previsto)} width={larg} height={Math.max(1, y(0) - y(s.previsto))} rx={3} fill="var(--color-amx-serie-1)" />}
              {s.recebido > 0 && <rect x={cx + 1} y={y(s.recebido)} width={larg} height={Math.max(1, y(0) - y(s.recebido))} rx={3} fill="var(--color-amx-serie-2)" />}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={s.competencia === atual ? 700 : 400} fill={s.competencia === atual ? 'var(--color-amx-white)' : 'var(--color-amx-muted)'}>
                {rotuloCompetencia(s.competencia)}
              </text>
            </g>
          );
        })}
        <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--color-amx-muted)" strokeWidth={1} />
      </svg>
    </div>
  );
}

function GraficoCarteira({ carteira, meta }: { carteira: PontoCarteira[]; meta: number }) {
  const max = Math.max(meta, ...carteira.map((c) => c.ativos));
  const ticks = escalaBonita(max);
  const topo = ticks.at(-1)!;
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const x = (i: number) => M.left + (iw / Math.max(1, carteira.length - 1)) * i;
  const y = (v: number) => M.top + ih - (v / topo) * ih;
  const pontos = carteira.map((c, i) => `${x(i)},${y(c.ativos)}`).join(' ');
  const ultimo = carteira.at(-1);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label={`Condomínios ativos por mês e meta de ${meta}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-amx-line)" strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-amx-muted)">{t}</text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={y(meta)} y2={y(meta)} stroke="var(--color-amx-white)" strokeWidth={1.5} strokeDasharray="6 4" />
        {/* Rótulo abaixo da linha quando a meta é o topo da escala (senão corta). */}
        <text x={W - M.right} y={y(meta) < M.top + 16 ? y(meta) + 16 : y(meta) - 6} textAnchor="end" fontSize={11} fill="var(--color-amx-white)">Meta {meta}</text>
        <polyline points={pontos} fill="none" stroke="var(--color-amx-serie-1)" strokeWidth={2} strokeLinejoin="round" />
        {carteira.map((c, i) => (
          <g key={c.competencia}>
            <title>{`${rotuloCompetencia(c.competencia, true)}: ${c.ativos} ativos (+${c.novos} / −${c.saidas})`}</title>
            <circle cx={x(i)} cy={y(c.ativos)} r={4} fill="var(--color-amx-serie-1)" stroke="var(--color-amx-panel)" strokeWidth={2} />
            <circle cx={x(i)} cy={y(c.ativos)} r={12} fill="transparent" />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-amx-muted)">{rotuloCompetencia(c.competencia)}</text>
          </g>
        ))}
        {ultimo && (
          <text x={x(carteira.length - 1) - 8} y={y(ultimo.ativos) - 10} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--color-amx-white)">{ultimo.ativos} ativos</text>
        )}
      </svg>
    </div>
  );
}

function EditarMeta({ projecao, onSalvo }: { projecao: Projecao; onSalvo: () => void }) {
  const [meta, setMeta] = useState(String(projecao.meta));
  const [prazo, setPrazo] = useState(projecao.prazo);
  const [erro, setErro] = useState('');
  const salvar = async () => {
    const res = await fetch('/api/financeiro/meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meta: Number(meta), prazo }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) onSalvo();
    else setErro(d.error || 'Falha ao salvar a meta.');
  };
  return (
    <div className="flex items-end gap-2 flex-wrap bg-amx-panel-2 border border-amx-line rounded-lg p-3">
      <Field label="Meta (condomínios)"><Input id="meta-n" inputMode="numeric" value={meta} onChange={(e) => setMeta(e.target.value)} className="w-28" /></Field>
      <Field label="Até"><Input id="meta-prazo" type="month" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></Field>
      <Button size="sm" onClick={salvar}>Salvar meta</Button>
      {erro && <p className="text-xs font-semibold text-amx-red-hover w-full">{erro}</p>}
    </div>
  );
}
