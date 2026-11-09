'use client';

import { useEffect, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/EmptyState';
import { CobrancasTab } from '@/components/financeiro/CobrancasTab';
import { ReajustesTab } from '@/components/financeiro/ReajustesTab';
import { PainelTab } from '@/components/financeiro/PainelTab';
import { PendenciasTab } from '@/components/financeiro/PendenciasTab';
import { canSeeFinanceiro } from '@/lib/permissions';
import { hojeISO } from '@/lib/os-agenda';

type Aba = 'painel' | 'cobrancas' | 'reajustes' | 'pendencias';
const ABAS: [Aba, string][] = [
  ['painel', 'Painel'],
  ['cobrancas', 'Cobranças'],
  ['reajustes', 'Reajustes'],
  ['pendencias', 'Pendências de cadastro'],
];

function FinanceiroContent() {
  const user = useAmxUser();
  const [aba, setAba] = useState<Aba>('painel');

  // ?aba= abre direto numa aba (link do resumo diário, dashboard).
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get('aba') as Aba | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única da URL na montagem
    if (a && ABAS.some(([v]) => v === a)) setAba(a);
  }, []);

  const ir = (a: Aba) => {
    setAba(a);
    window.history.replaceState(null, '', `/financeiro?aba=${a}`);
  };

  if (!user) return null;
  if (!canSeeFinanceiro(user.role)) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <EmptyState title="Acesso negado" description="O financeiro é restrito aos gestores." />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 sm:px-8 pt-6 pb-0 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Financeiro</h1>
        <p className="text-[13px] text-amx-muted mt-1">Cobranças, reajustes de contrato e crescimento da carteira</p>
        <nav className="flex gap-1 mt-4 overflow-x-auto" role="tablist">
          {ABAS.map(([v, l]) => (
            <button
              key={v}
              role="tab"
              aria-selected={aba === v}
              type="button"
              onClick={() => ir(v)}
              className={`text-sm font-semibold px-3 py-2.5 border-b-2 whitespace-nowrap transition-colors ${
                aba === v ? 'border-amx-red text-white' : 'border-transparent text-amx-muted hover:text-white'
              }`}
            >
              {l}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        {aba === 'painel' && <PainelTab onIr={ir} />}
        {aba === 'cobrancas' && <CobrancasTab competenciaInicial={hojeISO().slice(0, 7)} />}
        {aba === 'reajustes' && <ReajustesTab onIrPendencias={() => ir('pendencias')} />}
        {aba === 'pendencias' && <PendenciasTab />}
      </div>
    </div>
  );
}

export default function FinanceiroPage() {
  return (
    <AppShell>
      <FinanceiroContent />
    </AppShell>
  );
}
