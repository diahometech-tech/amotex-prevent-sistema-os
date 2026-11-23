'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Form';

// Só o gestor (a rota devolve 403 para os outros): define, por tipo de OS, se
// "Inspecionar <equipamento>" nasce obrigatório no checklist. Vale para as OS
// criadas daqui em diante; as que já existem não mudam.
export function InspecaoEquipamentoConfig() {
  const [valores, setValores] = useState<{ preventiva: boolean; corretiva: boolean } | null>(null);
  const [salvos, setSalvos] = useState<{ preventiva: boolean; corretiva: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/os/inspecao-equipamento', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d) {
          setValores({ preventiva: !!d.preventiva, corretiva: !!d.corretiva });
          setSalvos({ preventiva: !!d.preventiva, corretiva: !!d.corretiva });
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (!valores || !salvos) return null;
  const mudou = valores.preventiva !== salvos.preventiva || valores.corretiva !== salvos.corretiva;

  const salvar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/os/inspecao-equipamento', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valores),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSalvos({ preventiva: !!data.preventiva, corretiva: !!data.corretiva });
        setMsg({ ok: true, texto: 'Salvo. Vale para as OS criadas daqui em diante.' });
      } else {
        setMsg({ ok: false, texto: data.error || 'Não foi possível salvar.' });
      }
    } catch {
      setMsg({ ok: false, texto: 'Erro de conexão.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 pt-4 border-t border-amx-line">
      <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted mb-1">INSPEÇÃO DOS EQUIPAMENTOS OBRIGATÓRIA</p>
      <p className="text-xs text-amx-muted mb-3">
        Ligado: cada equipamento do condomínio vira um item obrigatório do checklist. Só vale para as OS criadas daqui em diante.
      </p>
      <div className="flex flex-col gap-2 max-w-md">
        <Toggle
          label="Preventiva"
          checked={valores.preventiva}
          onChange={(v) => {
            setValores({ ...valores, preventiva: v });
            setMsg(null);
          }}
          disabled={busy}
        />
        <Toggle
          label="Corretiva"
          checked={valores.corretiva}
          onChange={(v) => {
            setValores({ ...valores, corretiva: v });
            setMsg(null);
          }}
          disabled={busy}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-3">
        <Button size="sm" variant="secondary" onClick={salvar} disabled={busy || !mudou}>
          {busy ? 'Salvando...' : 'Salvar'}
        </Button>
        {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-amx-green' : 'text-amx-red-hover'}`}>{msg.texto}</p>}
      </div>
    </div>
  );
}
