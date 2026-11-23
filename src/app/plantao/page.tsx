'use client';

import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { EscalaPlantao } from '@/components/equipe/EscalaPlantao';
import { podeGerirPlantao } from '@/lib/roles';

function PlantaoContent() {
  const user = useAmxUser();
  if (!user) return null;
  const editar = podeGerirPlantao(user.role);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Escala de plantão</h1>
        <p className="text-[13px] text-amx-muted mt-1">
          {editar ? 'Quem fica de plantão e quando. A escala manda; sem ela, vale a marcação manual.' : 'Quem está de plantão agora e a sua escala.'}
        </p>
      </div>
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        <EscalaPlantao papel={user.role} />
      </div>
    </div>
  );
}

export default function PlantaoPage() {
  return (
    <AppShell>
      <PlantaoContent />
    </AppShell>
  );
}
