'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export interface NovidadeApi {
  id: string;
  data: string;
  titulo: string;
  itens: string[];
  lida: boolean;
}

// Aviso de novidades em pop-up (janela centralizada) nas telas iniciais:
// mostra a mais antiga que a pessoa ainda não leu; "Entendi" e o X gravam
// como lida no servidor e passam para a próxima. Sem novidade nova (ou se a
// busca falhar) não renderiza nada.
export function NovidadesCard() {
  const [naoLidas, setNaoLidas] = useState<NovidadeApi[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const botaoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/novidades', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { novidades?: NovidadeApi[] } | null) => {
        if (vivo && d?.novidades) setNaoLidas(d.novidades.filter((n) => !n.lida));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const atual = naoLidas[0];
  const atualId = atual?.id;

  // Foco no botão ao abrir cada novidade.
  useEffect(() => {
    if (atualId) botaoRef.current?.focus();
  }, [atualId]);

  // Esc fecha como o X (marca como lida).
  const fecharRef = useRef<() => void>(() => {});
  useEffect(() => {
    fecharRef.current = () => {
      if (!salvando) void entendi();
    };
  });
  useEffect(() => {
    if (!atualId) return;
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharRef.current();
    };
    window.addEventListener('keydown', aoTecla);
    return () => window.removeEventListener('keydown', aoTecla);
  }, [atualId]);

  if (!atual) return null;

  async function entendi() {
    if (!atual) return;
    setSalvando(true);
    setErro('');
    try {
      const r = await fetch(`/api/novidades/${encodeURIComponent(atual.id)}/lida`, { method: 'POST' });
      if (!r.ok) throw new Error();
      setNaoLidas((l) => l.filter((n) => n.id !== atual.id));
    } catch {
      setErro('Não deu certo. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const [a, m, d] = atual.data.split('-');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4" onClick={() => fecharRef.current()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="novidade-titulo"
        className="relative flex w-full max-w-md max-h-[90vh] min-w-0 flex-col rounded-[var(--radius-amx)] border border-amx-line border-l-4 border-l-amx-red bg-amx-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amx-red-hover pt-1">
            Novidade · {d}/{m}/{a}
          </p>
          <button
            type="button"
            onClick={() => fecharRef.current()}
            aria-label="Fechar"
            className="text-amx-muted hover:text-white min-w-[44px] min-h-[44px] inline-flex items-center justify-center -mt-2 -mr-2"
          >
            <Icon name="fechar" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <h2 id="novidade-titulo" className="text-[16px] font-semibold text-white normal-case tracking-normal break-words">
            {atual.titulo}
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5 text-[13.5px] leading-relaxed text-white/90">
            {atual.itens.map((item, i) => (
              <li key={i} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-amx-line px-4 py-3">
          <button
            ref={botaoRef}
            type="button"
            onClick={entendi}
            disabled={salvando}
            className="min-h-[44px] px-5 rounded-lg bg-amx-red hover:bg-amx-red-hover text-white text-[14px] font-semibold disabled:opacity-60"
          >
            Entendi
          </button>
          {naoLidas.length > 1 && (
            <Link href="/ajuda" className="text-[13px] font-semibold text-amx-muted hover:text-white underline">
              Ver todas na Ajuda
            </Link>
          )}
          {erro && <span className="text-[12px] font-semibold text-amx-red-hover">{erro}</span>}
        </div>
      </section>
    </div>
  );
}
