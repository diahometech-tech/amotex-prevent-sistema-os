'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Toggle } from '@/components/ui/Form';
import { InspecaoEquipamentoConfig } from '@/components/os/InspecaoEquipamentoConfig';
import { diasUteisPreventiva } from '@/lib/os-agenda';
import { painelPreventivasMes } from '@/lib/painel-preventivas-mes';
import type { OS } from '@/lib/db';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Escritório, na tela de Rotas: meta de visitas por técnico/dia (campo
// simples, salvo em configuração) e o painel do mês das preventivas — por
// técnico e total: feitas, faltam, dias úteis restantes e ritmo por dia.
export function PainelPreventivasMes({
  oss,
  tecnicoNome,
  hoje,
  ehGestor = false,
}: {
  ehGestor?: boolean;
  oss: OS[];
  tecnicoNome: (id?: string) => string | undefined;
  hoje: string;
}) {
  const [meta, setMeta] = useState('');
  const [metaSalva, setMetaSalva] = useState<number | null>(null);
  const [sabado, setSabado] = useState(false);
  const [salvandoSabado, setSalvandoSabado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/os/preventivas/meta', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.meta) {
          setMeta(String(d.meta));
          setMetaSalva(d.meta);
          setSabado(!!d.planejar_sabado);
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const salvar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/os/preventivas/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: Number(meta) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMetaSalva(data.meta);
        const mudam: number = data.mudariam ?? 0;
        setMsg({
          ok: true,
          texto: mudam
            ? `Meta salva. Na reorganização das 5h, ${mudam} visita${mudam !== 1 ? 's' : ''} mudam de dia (veja em Reorganizar agora).${data.acimaDaMeta ? ` ${data.acimaDaMeta} não cabem na meta até o fim do mês.` : ''}`
            : 'Meta salva.',
        });
      } else {
        setMsg({ ok: false, texto: data.error || 'Não foi possível salvar a meta.' });
      }
    } catch {
      setMsg({ ok: false, texto: 'Erro de conexão.' });
    } finally {
      setBusy(false);
    }
  };

  // "Planejar preventivas aos sábados" salva na hora, sem botão (vale pro
  // planejamento, a reorganização e o próximo dia útil).
  const mudarSabado = async (valor: boolean) => {
    setSalvandoSabado(true);
    setMsg(null);
    try {
      const res = await fetch('/api/os/preventivas/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planejar_sabado: valor }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSabado(!!data.planejar_sabado);
        setMsg({ ok: true, texto: valor ? 'Sábado entra no planejamento das preventivas.' : 'Sábado fora do planejamento. Domingo nunca entra.' });
      } else {
        setMsg({ ok: false, texto: data.error || 'Não foi possível salvar.' });
      }
    } catch {
      setMsg({ ok: false, texto: 'Erro de conexão.' });
    } finally {
      setSalvandoSabado(false);
    }
  };

  const mes = hoje.slice(0, 7);
  const painel = useMemo(() => painelPreventivasMes(oss, mes, hoje, diasUteisPreventiva(sabado)), [oss, mes, hoje, sabado]);
  const nomeMes = `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`;
  const ritmo = (r: number | null) => (r === null ? '—' : String(r).replace('.', ','));

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-end gap-2 flex-wrap">
        <Field label="Meta por técnico/dia" hint="Visitas de preventiva por técnico por dia (1 a 20)">
          <Input
            id="meta-visitas"
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            value={meta}
            onChange={(e) => {
              setMeta(e.target.value);
              setMsg(null);
            }}
            className="w-24"
          />
        </Field>
        <Button size="sm" variant="secondary" onClick={salvar} disabled={busy || meta === '' || Number(meta) === metaSalva}>
          {busy ? 'Salvando...' : 'Salvar meta'}
        </Button>
        {msg && <p className={`text-xs font-semibold ${msg.ok ? 'text-amx-green' : 'text-amx-red-hover'}`}>{msg.texto}</p>}
      </div>
      <div className="mt-3">
        <Toggle
          checked={sabado}
          onChange={mudarSabado}
          disabled={salvandoSabado}
          label="Planejar preventivas aos sábados"
          hint="Desligado: só segunda a sexta. Domingo nunca. Vale para o planejamento do mês, as sobras e o próximo dia útil."
        />
      </div>

      {ehGestor && <InspecaoEquipamentoConfig />}

      <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted mt-5 mb-2">
        PREVENTIVAS DE {nomeMes.toUpperCase()} · {painel.diasUteisRestantes} dia{painel.diasUteisRestantes !== 1 ? 's' : ''} útei
        {painel.diasUteisRestantes !== 1 ? 's' : ''} restante{painel.diasUteisRestantes !== 1 ? 's' : ''}
      </p>
      {painel.total.total === 0 ? (
        <p className="text-xs text-amx-muted">Nenhuma preventiva agendada neste mês. Use Planejar preventivas do mês.</p>
      ) : (
        <div className="overflow-x-auto border border-amx-line rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-amx-panel-2 text-amx-muted">
              <tr>
                <th className="text-left px-2 py-1.5">Técnico</th>
                <th className="text-right px-2 py-1.5">Feitas</th>
                <th className="text-right px-2 py-1.5">Faltam</th>
                <th className="text-right px-2 py-1.5">Ritmo por dia</th>
              </tr>
            </thead>
            <tbody>
              {painel.porTecnico.map((l) => (
                <tr key={l.tecnico_id || 'sem'} className="border-t border-amx-line text-white">
                  <td className="px-2 py-1.5 font-semibold">{l.tecnico_id ? (tecnicoNome(l.tecnico_id) ?? 'Técnico') : 'Sem técnico'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.feitas}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.faltam}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{ritmo(l.ritmo)}</td>
                </tr>
              ))}
              <tr className="border-t border-amx-line text-white bg-amx-panel-2 font-semibold">
                <td className="px-2 py-1.5">Total</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{painel.total.feitas}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{painel.total.faltam}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{ritmo(painel.total.ritmo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
