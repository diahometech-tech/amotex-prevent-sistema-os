import React from 'react';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import type { AuditLog } from '@/lib/db';
import { descreverEvento, quandoCompleto, type PessoaHistorico } from '@/lib/os-historico';

interface HistoricoPanelProps {
  logs: AuditLog[];
  pessoas?: PessoaHistorico[];
  loading?: boolean;
}

export function HistoricoPanel({ logs, pessoas = [], loading }: HistoricoPanelProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (logs.length === 0) {
    return <EmptyState title="Sem histórico" description="Nenhum evento registrado para esta OS ainda." />;
  }

  return (
    <ul className="space-y-0">
      {logs.map((log, index) => {
        const isLast = index === logs.length - 1;
        return (
          <li key={log.id} className="flex gap-3">
            <div className="flex flex-col items-center pt-1.5">
              <div className="rounded-full bg-amx-blue" style={{ width: 6, height: 6 }} />
              {!isLast && <div className="w-px bg-amx-line flex-1" style={{ minHeight: 24, marginTop: 4 }} />}
            </div>
            <div className="pb-4 flex-1 min-w-0">
              <p className="text-xs font-semibold text-white break-words">{descreverEvento(log, pessoas)}</p>
              <p className="text-[11px] text-amx-muted mt-0.5">{quandoCompleto(log.criado_em)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
