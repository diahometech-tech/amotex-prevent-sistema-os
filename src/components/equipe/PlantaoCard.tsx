'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { User } from '@/lib/db';
import { atendeCorretiva } from '@/lib/plantao';

type Tecnico = Pick<User, 'id' | 'nome' | 'papel' | 'especialidade' | 'ativo' | 'de_plantao' | 'telegram_chat_id'>;

// Quem está de plantão agora — o supervisor marca aqui (regra em
// src/lib/plantao.ts). Só admin: lê a lista completa de GET /api/users e grava
// com PATCH /api/users/[id]. Usado no Dashboard e em Usuários.
export function PlantaoCard({ onChange }: { onChange?: () => void }) {
  const [tecnicos, setTecnicos] = useState<Tecnico[] | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/users', { cache: 'no-store' }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (!data?.users) {
      setErro('Não foi possível carregar a equipe.');
      setTecnicos([]);
      return;
    }
    setTecnicos((data.users as Tecnico[]).filter(atendeCorretiva));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() só faz setState depois do primeiro await
    load();
  }, [load]);

  const alternar = async (t: Tecnico) => {
    setSalvando(t.id);
    setErro('');
    const res = await fetch(`/api/users/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ de_plantao: !t.de_plantao }),
    }).catch(() => null);
    setSalvando(null);
    if (!res?.ok) {
      setErro('Não foi possível salvar o plantão.');
      return;
    }
    await load();
    onChange?.();
  };

  if (!tecnicos) return null;
  const dePlantao = tecnicos.filter((t) => t.de_plantao);

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Plantão agora</p>
        <p className="text-xs text-amx-muted">
          {dePlantao.length > 0
            ? 'Aviso de corretiva vai para quem está de plantão e para os gestores.'
            : 'Ninguém marcado: aviso de corretiva vai para todos os técnicos.'}
        </p>
      </div>
      {tecnicos.length === 0 ? (
        <p className="text-sm text-amx-muted">Nenhum técnico de corretiva cadastrado em Usuários.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tecnicos.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={!!t.de_plantao}
              disabled={salvando === t.id}
              onClick={() => alternar(t)}
              className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm transition-colors disabled:opacity-50 ${
                t.de_plantao
                  ? 'border-amx-green bg-amx-green/15 text-white'
                  : 'border-amx-line bg-amx-panel-2 text-amx-muted hover:border-amx-muted'
              }`}
            >
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${t.de_plantao ? 'bg-amx-green' : 'bg-amx-line'}`} />
              <span className="font-semibold">{t.nome}</span>
              {t.de_plantao && <span className="text-[11px]">de plantão</span>}
              {t.de_plantao && !t.telegram_chat_id && <Badge tone="warning">sem Telegram</Badge>}
            </button>
          ))}
        </div>
      )}
      {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
    </Card>
  );
}
