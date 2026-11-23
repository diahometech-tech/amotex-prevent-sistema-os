'use client';

// Linha do tempo da OS (Painel do Condomínio): Chamado aberto → Técnico a
// caminho → Técnico chegou → Finalizado. Só mostra o que o condomínio pode
// ver (hora e nome do técnico, PDF) — sem localização nem auditoria.
import React from 'react';
import type { OS } from '@/lib/db';
import { passosDaOS, type EstadoPasso } from '@/lib/os-linha-do-tempo';
import { Icon } from '@/components/ui/Icon';

const PONTO: Record<EstadoPasso, string> = {
  feito: 'bg-amx-green border-amx-green text-amx-bg',
  atual: 'bg-amx-blue border-amx-blue-light text-white',
  pendente: 'bg-transparent border-amx-line text-transparent',
  pulado: 'bg-transparent border-amx-line text-transparent',
  cancelado: 'bg-amx-red border-amx-red text-white',
};

export function LinhaDoTempoOS({ os }: { os: OS }) {
  const passos = passosDaOS(os);
  return (
    <ol className="flex flex-col" aria-label="Andamento do atendimento">
      {passos.map((p, i) => {
        const ultimo = i === passos.length - 1;
        const apagado = p.estado === 'pendente' || p.estado === 'pulado';
        return (
          <li key={p.chave} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${PONTO[p.estado]}`} aria-hidden>
                {(p.estado === 'feito' || p.estado === 'atual') && <Icon name="check" size={12} />}
                {p.estado === 'cancelado' && <Icon name="fechar" size={12} />}
              </span>
              {!ultimo && <span className={`w-px flex-1 min-h-[18px] ${apagado ? 'bg-amx-line' : 'bg-amx-green/50'}`} aria-hidden />}
            </div>
            <div className="pb-3 min-w-0">
              <p className={`text-[13px] font-semibold ${apagado ? 'text-amx-muted' : 'text-white'}`}>{p.rotulo}</p>
              {(p.quando || p.detalhe) && (
                <p className="text-xs text-amx-muted">{[p.detalhe, p.quando].filter(Boolean).join(' · ')}</p>
              )}
              {p.chave === 'finalizado' && p.estado === 'feito' && os.pdf_url && (
                <a
                  href={os.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amx-blue-light hover:text-white transition-colors min-h-[44px]"
                >
                  <Icon name="documento" size={14} />
                  Baixar relatório (PDF)
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
