'use client';

import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { MapaAoVivo } from '@/components/mapa/MapaAoVivo';
import { podeVerModulo } from '@/lib/roles';

function MapaContent() {
  const user = useAmxUser();
  if (!user || !podeVerModulo(user.role, 'mapa')) return null;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Mapa ao vivo</h1>
        <p className="text-[13px] text-amx-muted mt-1">Os técnicos que estão a caminho do condomínio. Atualiza sozinho.</p>
      </div>
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        <MapaAoVivo />
      </div>
    </div>
  );
}

export default function MapaPage() {
  return (
    <AppShell>
      <MapaContent />
    </AppShell>
  );
}
