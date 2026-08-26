import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import type { AuditLog } from '@/lib/db';

interface HistoricoPanelProps {
  logs: AuditLog[];
  loading?: boolean;
}

function formatarAcao(acao: string): string {
  // Replace underscores with spaces and lowercase
  return acao.replace(/_/g, ' ').toLowerCase();
}

function formatarData(dataIso: string): string {
  try {
    return format(new Date(dataIso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return dataIso;
  }
}

function renderDetalhe(detalhe: unknown): React.ReactNode {
  if (!detalhe) return null;
  if (typeof detalhe !== 'object' || detalhe === null) return null;

  // Try to render as key-value pairs or JSON
  try {
    const jsonStr = JSON.stringify(detalhe);
    return <code className="text-[11px] text-amx-muted font-mono">{jsonStr}</code>;
  } catch {
    return null;
  }
}

export function HistoricoPanel({ logs, loading }: HistoricoPanelProps) {
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
            {/* Left column: dot + line */}
            <div className="flex flex-col items-center pt-1">
              <div className="w-1 h-1 rounded-full bg-amx-blue" style={{ width: 4, height: 4 }} />
              {!isLast && (
                <div className="w-px bg-amx-line flex-1" style={{ minHeight: 24, marginTop: 4 }} />
              )}
            </div>

            {/* Right column: content */}
            <div className="pb-4 flex-1">
              <p className="text-xs font-bold text-white">{formatarAcao(log.acao)}</p>
              <p className="text-[11px] text-amx-muted mt-1">
                por {log.ator} · {formatarData(log.criado_em)}
              </p>
              {Boolean(log.detalhe) && (
                <div className="mt-2 text-[11px]">{renderDetalhe(log.detalhe)}</div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
