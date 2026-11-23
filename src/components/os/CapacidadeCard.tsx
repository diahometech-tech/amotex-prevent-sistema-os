'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/EmptyState';
import type { ResultadoCapacidade } from '@/lib/capacidade';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const num = (n: number, casas = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function escalaBonita(max: number): number[] {
  if (max <= 0) return [0, 1];
  const passoBruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(passoBruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= passoBruto)!;
  const topo = Math.ceil(max / passo) * passo;
  return Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo);
}

// Gestor, no Dashboard: quantos condomínios cabem com a equipe de hoje e de
// quantos técnicos a carteira da meta precisaria. Cálculo em
// src/lib/capacidade.ts. Os gráficos são SVG próprios, com os tokens
// --color-amx-serie-* e tabela equivalente (mesmo padrão do Financeiro).
export function CapacidadeCard() {
  const [d, setD] = useState<ResultadoCapacidade | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    fetch('/api/capacidade', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (r.ok) setD(body);
        else setErro(body.error || 'Não foi possível carregar a capacidade.');
      })
      .catch(() => vivo && setErro('Erro de conexão.'));
    return () => {
      vivo = false;
    };
  }, []);

  if (!d) {
    return (
      <Card className="p-4 mb-6">
        <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-3">Capacidade da equipe</p>
        {erro ? <p className="text-xs font-semibold text-amx-red-hover">{erro}</p> : <div className="flex justify-center py-6"><Spinner className="h-5 w-5" /></div>}
      </Card>
    );
  }

  const nomeMes = `${MESES[Number(d.mes.slice(5)) - 1]} de ${d.mes.slice(0, 4)}`;
  const baseTexto = d.baseTipo === 'real' ? `média real de ${num(d.baseDia)} visitas` : `meta de ${num(d.baseDia)} visitas (ainda sem histórico)`;

  return (
    <Card className="p-4 mb-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Capacidade da equipe de preventiva</p>
        <p className="text-xs text-amx-muted">{nomeMes}</p>
      </div>

      {d.poucosDados && (
        <p className="text-xs font-semibold text-amx-amber bg-amx-amber/10 rounded-lg px-3 py-2">
          Poucos dados ainda: {d.diasDeHistorico === 0 ? 'nenhuma visita concluída' : `só ${d.diasDeHistorico} dia${d.diasDeHistorico !== 1 ? 's' : ''} de histórico`}.
          A média real só fica confiável com 2 semanas ou mais; até lá a conta usa {d.baseTipo === 'real' ? 'o que existe' : 'a meta por técnico/dia'}.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile titulo="Média real por técnico/dia" valor={d.media4 === null ? '—' : num(d.media4)} detalhe={`últimas 4 semanas · 8 semanas: ${d.media8 === null ? '—' : num(d.media8)}`} />
        <Tile titulo="Visitas necessárias no mês" valor={String(d.visitasNecessarias)} detalhe={`${d.condominiosAtivos} condomínios ativos`} />
        <Tile
          titulo="Capacidade do mês"
          valor={String(Math.floor(d.capacidadeMes))}
          detalhe={`${d.tecnicos} técnico${d.tecnicos !== 1 ? 's' : ''} × ${baseTexto} × ${d.diasUteisMes} dias úteis`}
          alerta={d.faltaCapacidade}
        />
        <Tile titulo="Cabem na equipe atual" valor={`${d.cabem}`} detalhe="condomínios, na frequência de hoje" alerta={d.cabem < d.condominiosAtivos} />
      </div>

      <p className="text-sm text-white">
        Com a equipe atual cabem <b>{d.cabem}</b> condomínios.{' '}
        {d.tecnicosParaMeta === null ? (
          'Sem técnico de preventiva cadastrado para calcular a meta.'
        ) : (
          <>
            Para <b>{d.metaCarteira}</b> condomínios seriam <b>{d.tecnicosParaMeta}</b> técnico{d.tecnicosParaMeta !== 1 ? 's' : ''}.
          </>
        )}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-amx-muted">Visitas concluídas por técnico por dia útil, semana a semana</p>
          <GraficoSemanas d={d} />
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-amx-muted">Visitas necessárias × capacidade do mês</p>
          <GraficoMes d={d} />
        </div>
      </div>

      <details>
        <summary className="text-xs text-amx-muted cursor-pointer">Ver tabela</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-amx-muted">
              <tr>
                <th className="text-left py-1">Semana (início)</th>
                <th className="text-right">Concluídas</th>
                <th className="text-right">Dias úteis</th>
                <th className="text-right">Por técnico/dia</th>
              </tr>
            </thead>
            <tbody className="text-white">
              {d.semanas.map((s) => (
                <tr key={s.inicio} className="border-t border-amx-line">
                  <td className="py-1">{diaMes(s.inicio)}</td>
                  <td className="text-right">{s.concluidas}</td>
                  <td className="text-right">{s.diasUteis}</td>
                  <td className="text-right">{s.media === null ? '—' : num(s.media)}</td>
                </tr>
              ))}
              <tr className="border-t border-amx-line bg-amx-panel-2 font-semibold">
                <td className="py-1">Visitas necessárias no mês</td>
                <td className="text-right" colSpan={3}>{d.visitasNecessarias}</td>
              </tr>
              <tr className="border-t border-amx-line bg-amx-panel-2 font-semibold">
                <td className="py-1">Capacidade do mês</td>
                <td className="text-right" colSpan={3}>{num(d.capacidadeMes, 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function Tile({ titulo, valor, detalhe, alerta }: { titulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className="bg-amx-panel-2 border border-amx-line rounded-[10px] p-3 flex flex-col gap-1">
      <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider">{titulo}</p>
      <p className={`text-2xl font-bold tabular-nums ${alerta ? 'text-amx-amber' : 'text-white'}`}>{valor}</p>
      {detalhe && <p className="text-[11px] text-amx-muted">{detalhe}</p>}
    </div>
  );
}

const W = 360, H = 200, M = { top: 14, right: 10, bottom: 26, left: 34 };

function GraficoSemanas({ d }: { d: ResultadoCapacidade }) {
  const max = Math.max(d.meta, ...d.semanas.map((s) => s.media ?? 0));
  const ticks = escalaBonita(max);
  const topo = ticks.at(-1)!;
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const banda = iw / d.semanas.length;
  const larg = Math.min(26, banda - 8);
  const y = (v: number) => M.top + ih - (v / topo) * ih;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Visitas concluídas por técnico por dia útil nas últimas ${d.semanas.length} semanas; meta de ${d.meta}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-amx-line)" strokeWidth={1} />
          <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-amx-muted)">{num(t)}</text>
        </g>
      ))}
      {d.semanas.map((s, i) => {
        const cx = M.left + banda * i + banda / 2;
        const v = s.media ?? 0;
        return (
          <g key={s.inicio}>
            <title>{`Semana de ${diaMes(s.inicio)}: ${s.concluidas} concluídas, ${s.media === null ? 'sem média' : `${num(s.media)} por técnico por dia útil`}`}</title>
            {v > 0 && <rect x={cx - larg / 2} y={y(v)} width={larg} height={Math.max(1, y(0) - y(v))} rx={3} fill="var(--color-amx-serie-1)" />}
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--color-amx-muted)">{diaMes(s.inicio)}</text>
          </g>
        );
      })}
      <line x1={M.left} x2={W - M.right} y1={y(d.meta)} y2={y(d.meta)} stroke="var(--color-amx-white)" strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={W - M.right} y={y(d.meta) < M.top + 12 ? y(d.meta) + 12 : y(d.meta) - 4} textAnchor="end" fontSize={10} fill="var(--color-amx-white)">Meta {d.meta}</text>
      <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--color-amx-muted)" strokeWidth={1} />
    </svg>
  );
}

function GraficoMes({ d }: { d: ResultadoCapacidade }) {
  const max = Math.max(d.visitasNecessarias, d.capacidadeMes, 1);
  const ticks = escalaBonita(max);
  const topo = ticks.at(-1)!;
  const iw = W - M.left - M.right, ih = H - M.top - M.bottom;
  const y = (v: number) => M.top + ih - (v / topo) * ih;
  const barras = [
    { nome: 'Necessárias', valor: d.visitasNecessarias, cor: 'var(--color-amx-serie-1)' },
    { nome: 'Capacidade', valor: d.capacidadeMes, cor: 'var(--color-amx-serie-2)' },
  ];
  const banda = iw / barras.length;
  const larg = Math.min(64, banda - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${d.visitasNecessarias} visitas necessárias no mês e capacidade de ${Math.floor(d.capacidadeMes)}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-amx-line)" strokeWidth={1} />
          <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--color-amx-muted)">{num(t, 0)}</text>
        </g>
      ))}
      {barras.map((b, i) => {
        const cx = M.left + banda * i + banda / 2;
        return (
          <g key={b.nome}>
            <title>{`${b.nome}: ${num(b.valor, 0)} visitas no mês`}</title>
            <rect x={cx - larg / 2} y={y(b.valor)} width={larg} height={Math.max(1, y(0) - y(b.valor))} rx={3} fill={b.cor} />
            <text x={cx} y={y(b.valor) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-amx-white)">{num(b.valor, 0)}</text>
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--color-amx-muted)">{b.nome}</text>
          </g>
        );
      })}
      <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--color-amx-muted)" strokeWidth={1} />
    </svg>
  );
}
