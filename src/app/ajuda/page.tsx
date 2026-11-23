'use client';

import { useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/Card';
import { InstalarAppCard } from '@/components/layout/InstalarAppCard';
import { MANUAL_ATUALIZADO, manuaisVisiveis, type ManualPapel } from '@/lib/manual';

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function Manual({ manual }: { manual: ManualPapel }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-amx-muted leading-relaxed max-w-3xl">{manual.resumo}</p>

      {manual.secoes.map((secao, i) => (
        <Card key={secao.titulo} className="p-4 sm:p-5 break-inside-avoid">
          <h2 className="text-[15px] font-semibold text-white normal-case tracking-normal mb-4">
            <span className="text-amx-red mr-2">{i + 1}.</span>
            {secao.titulo}
          </h2>
          <ol className="flex flex-col gap-3">
            {secao.passos.map((passo, j) => (
              <li key={j} className="flex gap-3 text-[13.5px] leading-relaxed text-white/90">
                <span className="shrink-0 w-6 h-6 rounded-full border border-amx-line text-amx-muted text-[11px] font-semibold flex items-center justify-center mt-px">
                  {j + 1}
                </span>
                <span>{passo}</span>
              </li>
            ))}
          </ol>
        </Card>
      ))}

      {manual.situacoes.length > 0 && (
        <Card className="p-5 break-inside-avoid">
          <h2 className="text-[15px] font-semibold text-white normal-case tracking-normal mb-4">E se acontecer…</h2>
          <dl className="flex flex-col gap-4">
            {manual.situacoes.map((s) => (
              <div key={s.pergunta} className="border-l-2 border-amx-red/60 pl-3">
                <dt className="text-[13.5px] font-semibold text-white">{s.pergunta}</dt>
                <dd className="text-[13.5px] text-amx-muted leading-relaxed mt-1">{s.resposta}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}

function AjudaContent() {
  const user = useAmxUser();
  const manuais = user ? manuaisVisiveis(user.role) : [];
  // Gestor abre no próprio manual; os demais só têm o deles.
  const [ativo, setAtivo] = useState(manuais[0]?.papel);
  if (!user || manuais.length === 0) return null;
  const atual = manuais.find((m) => m.papel === ativo) ?? manuais[0];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b border-amx-line flex items-start justify-between gap-4 flex-wrap print:border-0">
        <div>
          <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Manual de uso</h1>
          <p className="text-[13px] text-amx-muted mt-1">
            {manuais.length > 1 ? 'Como cada perfil usa o sistema' : `Perfil ${atual.titulo}`} · atualizado em{' '}
            {formatarData(MANUAL_ATUALIZADO)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="text-[13px] font-semibold text-amx-muted hover:text-white border border-amx-line rounded-lg px-3 py-1.5 print:hidden"
        >
          Imprimir / salvar PDF
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        <InstalarAppCard />
        {manuais.length > 1 && (
          <div className="flex gap-2 mb-6 flex-wrap print:hidden" role="tablist">
            {manuais.map((m) => (
              <button
                key={m.papel}
                type="button"
                role="tab"
                aria-selected={m.papel === atual.papel}
                onClick={() => setAtivo(m.papel)}
                className={`px-4 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  m.papel === atual.papel
                    ? 'bg-amx-red border-amx-red text-white'
                    : 'border-amx-line text-amx-muted hover:text-white'
                }`}
              >
                {m.titulo}
              </button>
            ))}
          </div>
        )}
        <Manual manual={atual} />
      </div>
    </div>
  );
}

export default function AjudaPage() {
  return (
    <AppShell>
      <AjudaContent />
    </AppShell>
  );
}
