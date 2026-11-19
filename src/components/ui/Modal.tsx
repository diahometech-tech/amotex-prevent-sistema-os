'use client';

import React, { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';

// Pilha de modais abertos (o último é o de cima) e um único ouvinte de Esc.
const pilhaModais: Array<() => void> = [];
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || pilhaModais.length === 0) return;
    pilhaModais[pilhaModais.length - 1]();
  });
}

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
  // O Esc fecha só a janela de cima: cada modal aberto entra na pilha global
  // e só o último ouve a tecla (ConfirmDialog também usa este Modal).
  const fecharRef = useRef(onClose);
  useEffect(() => {
    fecharRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const entrada = () => fecharRef.current();
    pilhaModais.push(entrada);
    return () => {
      const i = pilhaModais.indexOf(entrada);
      if (i >= 0) pilhaModais.splice(i, 1);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className={`bg-amx-bg border border-amx-line rounded-[var(--radius-amx)] w-full ${maxWidth} max-h-[90vh] overflow-y-auto shadow-2xl`}
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
    <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-amx-line sticky top-0 bg-amx-panel-2 z-10">
      <div>
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {subtitle && <p className="text-xs text-amx-muted mt-0.5">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="text-amx-muted hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center -m-3"
      >
        <Icon name="fechar" size={18} />
      </button>
    </div>
  );
}
