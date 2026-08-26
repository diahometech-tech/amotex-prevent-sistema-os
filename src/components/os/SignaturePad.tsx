'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';

interface SignaturePadProps {
  label: string;
  value?: string;
  onSave: (dataUrl: string) => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
}

export function SignaturePad({ label, value, onSave, disabled, busy }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || value) return;

    // Set internal resolution
    canvas.width = 400;
    canvas.height = 150;

    // Fill with white background
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [value]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || value || disabled || busy) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    setIsDrawing(true);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current || value) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#10182b';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasDrawn(true);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.closePath();
      }
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    setIsSaving(true);
    try {
      await onSave(dataUrl);
    } finally {
      setIsSaving(false);
    }
  };

  // Read-only mode: signature already captured
  if (value) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-sm font-semibold text-white">{label}</p>
          <Badge tone="success">Assinado</Badge>
        </div>
        <div className="border border-amx-line rounded-lg bg-white p-2 overflow-hidden" style={{ height: 120 }}>
          <img src={value} alt="Assinatura" className="w-full h-full object-contain" />
        </div>
      </div>
    );
  }

  // Disabled mode: no canvas, show placeholder
  if (disabled) {
    return (
      <div>
        <p className="text-sm font-semibold text-white mb-3">{label}</p>
        <EmptyState
          title="Assinatura indisponível"
          description="Você não tem permissão para coletar esta assinatura."
        />
      </div>
    );
  }

  // Active drawing mode
  return (
    <div>
      <p className="text-sm font-semibold text-white mb-3">{label}</p>
      <canvas
        ref={canvasRef}
        className="w-full border border-amx-line rounded-lg bg-white touch-none"
        style={{ height: 150 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="flex gap-2 mt-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleClear}
          disabled={!hasDrawn || busy}
        >
          Limpar
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!hasDrawn || busy}
        >
          {isSaving || busy ? (
            <>
              <Spinner className="w-3 h-3" />
              Salvando...
            </>
          ) : (
            'Confirmar assinatura'
          )}
        </Button>
      </div>
    </div>
  );
}
