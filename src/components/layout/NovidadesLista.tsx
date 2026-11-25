'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import type { NovidadeApi } from './NovidadesCard';

// Seção "Novidades" da Ajuda: todas as novidades do perfil, as ainda não lidas
// com a marca "Nova". Sem novidades (ou falha na busca), não aparece.
export function NovidadesLista() {
  const [lista, setLista] = useState<NovidadeApi[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch('/api/novidades', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { novidades?: NovidadeApi[] } | null) => {
        if (vivo && d?.novidades) setLista(d.novidades);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (lista.length === 0) return null;

  return (
    <section aria-label="Novidades" className="mb-8 print:hidden">
      <h2 className="text-[17px] font-semibold text-white normal-case tracking-normal mb-3">Novidades</h2>
      <div className="flex flex-col gap-3">
        {lista.map((n) => {
          const [a, m, d] = n.data.split('-');
          return (
            <Card key={n.id} className="p-4 sm:p-5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-amx-muted">{`${d}/${m}/${a}`}</span>
                {!n.lida && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-white bg-amx-red rounded-full px-2 py-0.5">
                    Nova
                  </span>
                )}
              </div>
              <h3 className="text-[15px] font-semibold text-white normal-case tracking-normal mt-1 break-words">
                {n.titulo}
              </h3>
              <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5 text-[13.5px] leading-relaxed text-white/90">
                {n.itens.map((item, i) => (
                  <li key={i} className="break-words">
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
