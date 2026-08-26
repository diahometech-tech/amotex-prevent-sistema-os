'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
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

  const titulo = momento === 'antes' ? 'Fotos — Antes do serviço' : 'Fotos — Depois do serviço';
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
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-amx-ink">{titulo}</p>
        <Badge tone="neutral">{totalFotos} foto(s)</Badge>
      </div>

      <div className="flex flex-col gap-3">
        {/* Foto Grid */}
        {totalFotos > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {fotos.map((foto) => (
              <img
                key={foto.id}
                src={foto.url}
                alt={`Foto ${foto.momento}`}
                className="w-full aspect-square object-cover rounded-lg border border-amx-border"
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-amx-muted">Nenhuma foto enviada ainda.</p>
        )}

        {/* Hidden file input + Upload button */}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleInputChange}
            className="hidden"
            disabled={disabled || isUploading || busy}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClick}
            disabled={disabled || isUploading || busy}
          >
            {isUploading || busy ? (
              <>
                <Spinner className="w-3 h-3" />
                Enviando...
              </>
            ) : (
              '📷 Tirar foto'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
