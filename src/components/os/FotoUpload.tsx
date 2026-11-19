'use client';

import React, { useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/EmptyState';
import type { Foto } from '@/lib/db';
import { Icon } from '@/components/ui/Icon';

interface FotoUploadProps {
  momento: 'antes' | 'depois';
  fotos: Foto[];
  onUpload: (file: File) => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  /** Fotos guardadas no aparelho, ainda não enviadas (fila offline). */
  pendentes?: { id: string; data: string; recusado?: boolean; erro?: string }[];
  /** Com a OS em aberto, mostra o botão de remover pra tirar uma foto errada. */
  onRemover?: (foto: Foto) => void;
}

export function FotoUpload({ momento, fotos, onUpload, disabled, busy, pendentes = [], onRemover }: FotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const titulo = momento === 'antes' ? 'ANTES' : 'DEPOIS';
  const totalFotos = fotos.length + pendentes.length;

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      await onUpload(file);
    } finally {
      setIsUploading(false);
      // Reset input so selecting the same file twice still fires onChange
      e.target.value = '';
    }
  };

  const handleClick = () => {
    if (!inputRef.current || disabled || isUploading || busy) return;
    inputRef.current.click();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <p className="font-heading text-[10px] font-semibold text-amx-muted uppercase tracking-wider">{titulo}</p>
        <div className="flex items-center gap-1.5">
          {pendentes.length > 0 && <Badge tone="warning"><span className="inline-flex items-center gap-1"><Icon name="nuvemEnvio" size={12} />{pendentes.length} aguardando envio</span></Badge>}
          {totalFotos > 0 && <Badge tone="neutral">{totalFotos} foto(s)</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {fotos.map((foto) => (
          <div key={foto.id} className="relative">
            <img
              src={foto.url}
              alt={`Foto ${foto.momento}`}
              className="w-full aspect-square object-cover rounded-[10px] border border-amx-line"
            />
            {onRemover && (
              <button
                type="button"
                onClick={() => onRemover(foto)}
                className="absolute top-1 right-1 rounded-md bg-amx-bg/85 border border-amx-line px-1.5 py-0.5 text-[10px] font-semibold text-amx-muted hover:text-white hover:border-amx-red"
              >
                Remover
              </button>
            )}
          </div>
        ))}
        {pendentes.map((p) => (
          <div key={p.id} className="relative" title={p.erro}>
            <img
              src={p.data}
              alt={`Foto ${momento} aguardando envio`}
              className={`w-full aspect-square object-cover rounded-[10px] border-2 border-dashed opacity-80 ${
                p.recusado ? 'border-amx-red' : 'border-amx-amber'
              }`}
            />
            <span
              className={`absolute bottom-1 left-1 right-1 text-center rounded-md text-[9px] font-semibold px-1 py-0.5 bg-amx-bg/85 ${
                p.recusado ? 'text-amx-red-hover' : 'text-amx-amber'
              }`}
            >
              {p.recusado ? 'Não aceita' : 'Aguardando'}
            </span>
          </div>
        ))}

        {/* Slot tracejado — sempre visível pra convidar a próxima foto,
            igual ao protótipo (caixa tracejada com ícone de câmera). */}
        {/* Sem permissão (ou OS encerrada) o slot some: esconder, não desabilitar. */}
        {disabled ? (
          totalFotos === 0 && <p className="col-span-3 text-xs text-amx-muted">Nenhuma foto</p>
        ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled || isUploading || busy}
          className="aspect-square rounded-[10px] border-[1.5px] border-dashed border-amx-line bg-amx-panel-2 flex flex-col items-center justify-center gap-1.5 text-amx-muted hover:border-amx-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleInputChange}
            className="hidden"
            disabled={disabled || isUploading || busy}
          />
          {isUploading || busy ? (
            <Spinner className="w-5 h-5" />
          ) : (
            <>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="text-[10px]">{totalFotos > 0 ? 'Adicionar' : 'Tirar foto'}</span>
            </>
          )}
        </button>
        )}
      </div>
    </div>
  );
}
