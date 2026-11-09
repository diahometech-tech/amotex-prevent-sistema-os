'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Form';
import type { AjusteValor, Cobranca, Condominio } from '@/lib/db';
import { formatarCnpj } from '@/lib/financeiro/cnpj';
import { formatarReais } from '@/lib/financeiro/dinheiro';
import { rotuloCompetencia, statusEfetivo, STATUS_LABEL, type StatusEfetivo } from '@/lib/financeiro/cobranca';
import { INDICE_LABEL, proximoAniversario } from '@/lib/financeiro/reajuste';
import { hojeISO } from '@/lib/os-agenda';

export const STATUS_TONE: Record<StatusEfetivo, BadgeTone> = {
  pendente: 'neutral',
  enviada: 'info',
  paga: 'success',
  isenta: 'navy',
  atrasada: 'red',
};

function data(iso?: string) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// Bloco "Contrato e cobrança" na página do condomínio (só gestor): dados do
// contrato, ajustes temporários de valor e últimas cobranças. A edição dos
// dados é o formulário do condomínio (botão Editar no topo da página).
export function ContratoCondominio({ condominio }: { condominio: Condominio }) {
  const [ajustes, setAjustes] = useState<AjusteValor[]>([]);
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState<{ descricao: string; valor: string; inicio: string; fim: string } | null>(null);
  const hoje = hojeISO();

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch(`/api/financeiro/ajustes?condominio_id=${condominio.id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/financeiro/cobrancas?condominio_id=${condominio.id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([a, c]) => {
      if (cancel) return;
      setAjustes(a?.ajustes ?? []);
      setCobrancas(c?.cobrancas ?? []);
    });
    return () => {
      cancel = true;
    };
  }, [condominio.id]);

  const salvarAjuste = async () => {
    if (!novo) return;
    setErro('');
    const res = await fetch('/api/financeiro/ajustes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condominio_id: condominio.id, ...novo }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ajuste) {
      setAjustes((p) => [...p, d.ajuste]);
      setNovo(null);
    } else setErro(d.error || 'Falha ao salvar o ajuste.');
  };

  const removerAjuste = async (id: string) => {
    const res = await fetch(`/api/financeiro/ajustes/${id}`, { method: 'DELETE' });
    if (res.ok) setAjustes((p) => p.filter((a) => a.id !== id));
  };

  const c = condominio;
  const linhas: [string, React.ReactNode][] = [
    ['CNPJ', c.cnpj ? formatarCnpj(c.cnpj) : '—'],
    ['Valor mensal', c.valor_mensal_centavos ? formatarReais(c.valor_mensal_centavos) : '—'],
    ['Vencimento', `dia ${c.dia_vencimento ?? '10 (padrão)'}`],
    ['Início do contrato', data(c.contrato_inicio)],
    ['Reajuste', c.reajuste_indice ? (c.reajuste_indice === 'fixo' ? `${c.reajuste_percentual_fixo ?? '?'}% ao ano` : INDICE_LABEL[c.reajuste_indice]) : '—'],
    ['Próximo reajuste', c.contrato_inicio ? data(proximoAniversario(c.contrato_inicio, hoje)) : '—'],
    ['Responsável', [c.responsavel_nome, c.responsavel_telefone].filter(Boolean).join(' · ') || '—'],
    ['E-mails de cobrança', c.emails_cobranca || '—'],
    ['Preventivas', `${c.preventivas_por_mes ?? 1}× por mês`],
  ];

  return (
    <Card className="p-5 mb-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Contrato e cobrança</p>
        <div className="flex items-center gap-2">
          {c.ativo === false && <Badge tone="neutral">Contrato encerrado</Badge>}
          <Link href="/financeiro" className="text-xs font-semibold text-amx-blue-light hover:text-white">Abrir financeiro →</Link>
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2">
        {linhas.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-amx-muted">{k}</dt>
            <dd className="text-[13px] text-white break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {c.observacoes && <p className="text-xs text-amx-amber">{c.observacoes}</p>}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white">Ajustes temporários de valor</p>
          {!novo && (
            <Button size="sm" variant="secondary" onClick={() => setNovo({ descricao: '', valor: '', inicio: hoje.slice(0, 7), fim: hoje.slice(0, 7) })}>
              + Ajuste
            </Button>
          )}
        </div>
        {ajustes.length === 0 && !novo && (
          <p className="text-xs text-amx-muted">Nenhum. Use para acréscimo por período (ex.: adequação de quadros elétricos de set a nov) ou desconto (valor negativo).</p>
        )}
        {ajustes.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-xs bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2">
            <span className="flex-1 min-w-0 text-white">{a.descricao}</span>
            <span className="text-amx-muted whitespace-nowrap">{rotuloCompetencia(a.inicio)} a {rotuloCompetencia(a.fim)}</span>
            <span className={`whitespace-nowrap font-semibold ${a.valor_centavos < 0 ? 'text-amx-green' : 'text-white'}`}>
              {a.valor_centavos < 0 ? '−' : '+'}{formatarReais(Math.abs(a.valor_centavos))}
            </span>
            <button type="button" onClick={() => removerAjuste(a.id)} className="text-amx-muted hover:text-amx-red-hover" aria-label="Remover ajuste">×</button>
          </div>
        ))}
        {novo && (
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-end bg-amx-panel-2 border border-amx-line rounded-lg p-3">
            <Field label="Descrição"><Input id="ajuste-descricao" value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} /></Field>
            <Field label="Valor (R$)"><Input id="ajuste-valor" inputMode="decimal" placeholder="666,66" value={novo.valor} onChange={(e) => setNovo({ ...novo, valor: e.target.value })} /></Field>
            <Field label="De"><Input id="ajuste-inicio" type="month" value={novo.inicio} onChange={(e) => setNovo({ ...novo, inicio: e.target.value })} /></Field>
            <Field label="Até"><Input id="ajuste-fim" type="month" value={novo.fim} onChange={(e) => setNovo({ ...novo, fim: e.target.value })} /></Field>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setNovo(null)}>Cancelar</Button>
              <Button size="sm" onClick={salvarAjuste}>Salvar</Button>
            </div>
          </div>
        )}
        {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
      </div>

      {cobrancas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-white">Últimas cobranças</p>
          {cobrancas.slice(0, 6).map((cb) => {
            const st = statusEfetivo(cb, hoje);
            return (
              <div key={cb.id} className="flex items-center gap-3 text-xs">
                <span className="w-16 text-amx-muted">{rotuloCompetencia(cb.competencia)}</span>
                <span className="flex-1 text-white tabular-nums">{formatarReais(cb.valor_previsto_centavos)}</span>
                <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
