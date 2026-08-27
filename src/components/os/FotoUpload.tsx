'use client';

import React, { useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/EmptyState';
import type { Foto } from '@/lib/db';

interface FotoUploadProps {
  momento: 'antes' | 'depois';
  fotos: Foto[];
  onUpload: (file: File) => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
}

export function FotoUpload({ momento, fotos, onUpload, disabled, busy }: FotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const titulo = momento === 'antes' ? 'ANTES' : 'DEPOIS';
  const totalFotos = fotos.length;

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
        {totalFotos > 0 && <Badge tone="neutral">{totalFotos} foto(s)</Badge>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {fotos.map((foto) => (
          <img
            key={foto.id}
            src={foto.url}
            alt={`Foto ${foto.momento}`}
            className="w-full aspect-square object-cover rounded-[10px] border border-amx-line"
          />
        ))}

        {/* Slot tracejado — sempre visível pra convidar a próxima foto,
            igual ao protótipo (caixa tracejada com ícone de câmera). */}
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
      </div>
    </div>
  );
}
