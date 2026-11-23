'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Form';
import type { User } from '@/lib/db';
import { atendeCorretiva, mensagemSemCanalDeAviso } from '@/lib/plantao';
import { formatarInstante } from '@/lib/plantao-escala';
import { periodoAtendimento } from '@/lib/horario-comercial';

type Tecnico = Pick<User, 'id' | 'nome' | 'papel' | 'especialidade' | 'ativo' | 'de_plantao' | 'telegram_chat_id'> & {
  app_ativo?: boolean;
};

interface Agora {
  origem: 'escala' | 'manual';
  plantonistas: { id: string; nome: string; ate: string | null; sem_canal?: boolean }[];
}

// Quem está de plantão agora. A escala (tela "Escala de plantão") manda; sem
// período cobrindo o instante, vale a marca manual feita aqui (regra em
// src/lib/plantao.ts). Gestor e secretária: lê a lista completa de GET
// /api/users, o plantão atual de GET /api/plantao e grava com PATCH
// /api/users/[id] (marca manual) e POST /api/plantao/trocar. Usado no
// Dashboard e em Usuários.
export function PlantaoCard({ onChange }: { onChange?: () => void }) {
  const [tecnicos, setTecnicos] = useState<Tecnico[] | null>(null);
  const [agora, setAgora] = useState<Agora | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [trocarPara, setTrocarPara] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [erro, setErro] = useState('');

  const load = useCallback(async () => {
    const [resUsers, resPlantao] = await Promise.all([
      fetch('/api/users', { cache: 'no-store' }).catch(() => null),
      fetch('/api/plantao', { cache: 'no-store' }).catch(() => null),
    ]);
    const data = resUsers?.ok ? await resUsers.json().catch(() => null) : null;
    if (!data?.users) {
      setErro('Não foi possível carregar a equipe.');
      setTecnicos([]);
      return;
    }
    const plantao = resPlantao?.ok ? await resPlantao.json().catch(() => null) : null;
    setAgora(plantao?.agora ?? null);
    setTecnicos((data.users as Tecnico[]).filter(atendeCorretiva));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() só faz setState depois do primeiro await
    load();
  }, [load]);

  const alternar = async (t: Tecnico) => {
    // Recusa antes de ir ao servidor (o servidor confere de novo).
    if (!t.de_plantao && !t.telegram_chat_id && !t.app_ativo) {
      setErro(mensagemSemCanalDeAviso(t.nome));
      return;
    }
    setSalvando(t.id);
    setErro('');
    const res = await fetch(`/api/users/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ de_plantao: !t.de_plantao }),
    }).catch(() => null);
    setSalvando(null);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setErro(d?.error || 'Não foi possível salvar o plantão.');
      return;
    }
    await load();
    onChange?.();
  };

  const trocar = async () => {
    const alvo = tecnicos?.find((t) => t.id === trocarPara);
    if (!alvo) return;
    if (!alvo.telegram_chat_id && !alvo.app_ativo) {
      setErro(mensagemSemCanalDeAviso(alvo.nome));
      return;
    }
    setTrocando(true);
    setErro('');
    const res = await fetch('/api/plantao/trocar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: trocarPara }),
    }).catch(() => null);
    setTrocando(false);
    if (!res?.ok) {
      const d = await res?.json().catch(() => null);
      setErro(d?.error || 'Não foi possível trocar o plantonista.');
      return;
    }
    setTrocarPara('');
    await load();
    onChange?.();
  };

  if (!tecnicos) return null;
  const comercial = periodoAtendimento() === 'comercial';
  const atuais = agora?.plantonistas ?? [];
  const pelaEscala = agora?.origem === 'escala';

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Plantão agora</p>
        <Link href="/plantao" className="text-xs font-semibold text-amx-blue-light hover:text-white">
          Escala de plantão
        </Link>
      </div>

      {atuais.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {atuais.map((p) => (
            <li key={p.id} className="flex items-center gap-2 flex-wrap text-sm text-white">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amx-green" />
              <span className="font-semibold">{p.nome}</span>
              <span className="text-xs text-amx-muted">
                {pelaEscala && p.ate ? `pela escala, até ${formatarInstante(p.ate)}` : 'marcado à mão'}
              </span>
              {p.sem_canal && <Badge tone="warning">sem Telegram nem app</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-white">Ninguém marcado.</p>
      )}

      <p className="text-xs text-amx-muted">
        {comercial
          ? 'Agora é horário comercial (seg–sex 8h–18h, sáb 8h–16h): o aviso vai para todos os técnicos de corretiva. O plantonista vale fora desse horário.'
          : atuais.length > 0
          ? 'Aviso de corretiva vai para quem está de plantão, os gestores e a secretária.'
          : 'Ninguém marcado: aviso de corretiva vai para todos os técnicos.'}
      </p>

      {tecnicos.length === 0 ? (
        <p className="text-sm text-amx-muted">Nenhum técnico de corretiva cadastrado em Usuários.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-amx-muted">
              {pelaEscala
                ? 'Marcar à mão: vale só quando não há ninguém na escala. Agora a escala manda.'
                : 'Marcar à mão: toque para marcar ou desmarcar.'}
            </p>
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
                  {!t.telegram_chat_id && !t.app_ativo && <Badge tone="warning">sem Telegram nem app</Badge>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select
              id="plantao-trocar"
              aria-label="Trocar plantonista agora"
              value={trocarPara}
              onChange={(e) => setTrocarPara(e.target.value)}
              disabled={trocando}
              className="flex-1 min-w-[10rem]"
            >
              <option value="">Trocar plantonista agora…</option>
              {tecnicos.filter((t) => !(atuais.length === 1 && atuais[0].id === t.id)).map((t) => (
                <option key={t.id} value={t.id}>{t.nome}{!t.telegram_chat_id && !t.app_ativo ? ' (sem Telegram nem app)' : ''}</option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={trocar} disabled={trocando || !trocarPara}>
              {trocando ? 'Trocando...' : 'Trocar'}
            </Button>
          </div>
        </>
      )}
      {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
    </Card>
  );
}
