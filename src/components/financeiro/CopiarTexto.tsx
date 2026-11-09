'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

// Botão "Copiar" com confirmação. Clipboard pode falhar (http, permissão):
// aí seleciona o texto do <textarea> irmão pra o usuário copiar na mão.
export function CopiarTexto({ texto, rotulo = 'Copiar', alvoId }: { texto: string; rotulo?: string; alvoId?: string }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      const el = alvoId ? (document.getElementById(alvoId) as HTMLTextAreaElement | null) : null;
      el?.select();
    }
  };
  return (
    <Button type="button" size="sm" variant="secondary" onClick={copiar}>
      {copiado ? 'Copiado ✓' : rotulo}
    </Button>
  );
}

/** Link "Abrir no WhatsApp" com o texto pronto (número brasileiro com DDD). */
export function linkWhatsApp(telefone: string | undefined, texto: string): string | null {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const numero = d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
