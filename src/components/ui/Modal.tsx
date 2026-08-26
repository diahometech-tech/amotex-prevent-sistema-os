'use client';

import React, { useEffect } from 'react';

// Wrapper padrão pra todo modal do sistema: fundo escurecido, fecha ao
// clicar fora ou apertar Esc, nunca encosta na borda em tela estreita
// (p-4 + items-center, nunca top-1/2 + translate).
export function Modal({
  open,
  onClose,
  children,
  maxWidth = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-amx-ink/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={`bg-amx-surface rounded-[var(--radius-amx)] w-full ${maxWidth} max-h-[90vh] overflow-y-auto shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-amx-border sticky top-0 bg-amx-surface z-10">
      <div>
        <h2 className="text-sm font-bold text-amx-ink">{title}</h2>
        {subtitle && <p className="text-xs text-amx-muted mt-0.5">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="text-amx-muted hover:text-amx-ink text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}
