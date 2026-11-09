'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import type { Condominio } from '@/lib/db';
import { CAMPOS_NECESSARIOS, type PendenciaCondominio } from '@/lib/financeiro/pendencias';
import { formatarCnpj } from '@/lib/financeiro/cnpj';
import { INDICE_LABEL } from '@/lib/financeiro/reajuste';
import { CopiarTexto } from './CopiarTexto';

const ROTULO_CURTO: Record<string, string> = {
  contrato_inicio: 'início do contrato',
  reajuste_indice: 'índice de reajuste',
  dia_vencimento: 'dia de vencimento',
  responsavel_nome: 'responsável',
  responsavel_telefone: 'telefone',
  emails_cobranca: 'e-mail de cobrança',
  valor_mensal_centavos: 'valor mensal',
  cnpj: 'CNPJ',
};

// Planilha de levantamento: todos os condomínios ativos com o que já se sabe
// preenchido; a equipe completa as colunas vazias e importa de volta em
// Condomínios > Importar planilha (o CNPJ casa a linha e atualiza).
function baixarLevantamento(condominios: Condominio[]) {
  const cab = ['nome', 'cnpj', 'contrato_inicio', 'reajuste_indice', 'reajuste_percentual_fixo', 'dia_vencimento', 'valor_mensal',
    'responsavel_nome', 'responsavel_telefone', 'responsavel_email', 'emails_cobranca', 'preventivas_por_mes', 'observacoes'];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const data = (iso?: string) => (iso ? iso.split('-').reverse().join('/') : '');
  const linhas = condominios
    .filter((c) => c.ativo !== false)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((c) => [
      c.nome, c.cnpj ? formatarCnpj(c.cnpj) : '', data(c.contrato_inicio), c.reajuste_indice ? INDICE_LABEL[c.reajuste_indice] : '',
      c.reajuste_percentual_fixo ?? '', c.dia_vencimento ?? '', c.valor_mensal_centavos ? (c.valor_mensal_centavos / 100).toFixed(2).replace('.', ',') : '',
      c.responsavel_nome, c.responsavel_telefone, c.responsavel_email, c.emails_cobranca, c.preventivas_por_mes ?? 1, c.observacoes,
    ].map(esc).join(';'));
  const csv = `﻿${cab.join(';')}\r\n${linhas.join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'levantamento-contratos-amotex.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function PendenciasTab() {
  const [pendencias, setPendencias] = useState<PendenciaCondominio[] | null>(null);
  const [mensagem, setMensagem] = useState('');
  const [condominios, setCondominios] = useState<Condominio[]>([]);

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch('/api/financeiro/pendencias', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/condominios', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([p, c]) => {
      if (cancel) return;
      setPendencias(p.pendencias ?? []);
      setMensagem(p.mensagem ?? '');
      setCondominios(c.condominios ?? []);
    }).catch(() => !cancel && setPendencias([]));
    return () => {
      cancel = true;
    };
  }, []);

  if (!pendencias) return <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>;
  if (pendencias.length === 0) return <EmptyState title="Cadastro completo" description="Todos os condomínios ativos têm os dados de contrato e cobrança." />;

  const contagem = CAMPOS_NECESSARIOS.map(([k, label]) => [label, pendencias.filter((p) => p.faltando.includes(k)).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 flex flex-col gap-3">
        <p className="text-sm text-white">
          <b>{pendencias.length}</b> condomínio{pendencias.length > 1 ? 's' : ''} com dado faltando. Sem a <b>data de início</b> o sistema não avisa o reajuste; sem <b>e-mail</b> não dá pra mandar cobrança e aviso.
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-amx-muted">
          {contagem.map(([label, n]) => <li key={label}><b className="text-white tabular-nums">{n}</b> sem {label.toLowerCase()}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => baixarLevantamento(condominios)}>Baixar planilha de levantamento</Button>
          <CopiarTexto texto={mensagem} rotulo="Copiar mensagem para a equipe" alvoId="pend-msg" />
        </div>
        <p className="text-[11px] text-amx-muted">
          A planilha vem com o que já está cadastrado. Preencha as colunas vazias e importe em Condomínios › Importar planilha: o CNPJ identifica cada linha e só as colunas preenchidas são atualizadas.
        </p>
        <details>
          <summary className="text-xs text-amx-muted cursor-pointer">Ver mensagem</summary>
          <textarea id="pend-msg" readOnly value={mensagem} rows={10} className="mt-2 w-full text-xs bg-amx-panel-2 border border-amx-line rounded-lg p-3 text-white" />
        </details>
      </Card>

      <div className="flex flex-col gap-2">
        {pendencias.map((p) => (
          <Link key={p.condominio_id} href={`/condominios/${p.condominio_id}`} className="flex items-center gap-x-4 gap-y-1 flex-wrap bg-amx-panel border border-amx-line rounded-[10px] px-4 py-3 hover:border-amx-muted transition-colors">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-semibold text-white truncate">{p.nome}</p>
              <p className="text-[11px] text-amx-muted">{p.cnpj ? formatarCnpj(p.cnpj) : 'sem CNPJ'}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {p.faltando.map((k) => (
                <span key={k} className="text-[11px] px-2 py-0.5 rounded-full border border-amx-amber/50 text-amx-amber">{ROTULO_CURTO[k]}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
