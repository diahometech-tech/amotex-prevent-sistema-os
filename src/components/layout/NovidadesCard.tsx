'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface NovidadeApi {
  id: string;
  data: string;
  titulo: string;
  itens: string[];
  lida: boolean;
}

// Aviso de novidades no topo da tela inicial: mostra a mais recente que a
// pessoa ainda não leu. "Entendi" grava no servidor e esconde o cartão. Sem
// novidade nova (ou se a busca falhar) não renderiza nada.
export function NovidadesCard({ semMargem = false }: { semMargem?: boolean }) {
  const [naoLidas, setNaoLidas] = useState<NovidadeApi[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

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
    <div className={semMargem ? 'mb-5' : 'px-4 sm:px-8 pt-4'}>
      <section
        aria-label="Novidades"
        className="rounded-lg border border-amx-red/40 border-l-4 border-l-amx-red bg-amx-red/5 px-4 py-3 min-w-0"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amx-red-hover">
          Novidade · {d}/{m}/{a}
        </p>
        <h2 className="text-[15px] font-semibold text-white normal-case tracking-normal mt-0.5 break-words">
          {atual.titulo}
        </h2>
        <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5 text-[13.5px] leading-relaxed text-white/90">
          {atual.itens.map((item, i) => (
            <li key={i} className="break-words">
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={entendi}
            disabled={salvando}
            className="px-4 py-1.5 rounded-lg bg-amx-red hover:bg-amx-red-hover text-white text-[13px] font-semibold disabled:opacity-60"
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
