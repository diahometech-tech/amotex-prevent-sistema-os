'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ModalHeader } from '@/components/ui/Modal';
import { Field, Input } from '@/components/ui/Form';
import { formatarDataCurta, hojeISO } from '@/lib/os-agenda';

interface ItemPrevia {
  condominio_id: string;
  condominio_nome: string;
  tecnico_id: string;
  tecnico_nome: string;
  data: string;
}

interface Previa {
  itens: ItemPrevia[];
  jaAgendados: number;
  dias: string[];
  capacidadeDia: number;
  totalCondominios: number;
}

// Rota mensal das preventivas: prévia primeiro (nada gravado), depois
// confirmação. A regra de distribuição está em
// src/lib/planejamento-preventiva.ts; o servidor recalcula ao confirmar.
export function PlanejarPreventivas({ onClose, onCriado }: { onClose: () => void; onCriado: () => void }) {
  const [mes, setMes] = useState(hojeISO().slice(0, 7));
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feito, setFeito] = useState<string | null>(null);

  const chamar = async (confirmar: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/os/preventivas/planejar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes, confirmar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Falha ao planejar.');
      } else if (confirmar) {
        setFeito(`${data.criadas} OS preventivas criadas${data.jaAgendados ? ` (${data.jaAgendados} condomínios já tinham preventiva no mês)` : ''}.`);
        onCriado();
      } else {
        setPrevia(data);
      }
    } catch {
      setError('Erro de conexão.');
    } finally {
      setBusy(false);
    }
  };

  const porDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of previa?.itens ?? []) m.set(i.data, (m.get(i.data) ?? 0) + 1);
    return m;
  }, [previa]);

  return (
    <>
      <ModalHeader title="Planejar preventivas do mês" subtitle="Uma preventiva por condomínio, de segunda a domingo" onClose={onClose} />
      <div className="p-5 flex flex-col gap-4">
        {feito ? (
          <>
            <p className="text-sm font-semibold text-amx-green">{feito}</p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Fechar</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-end gap-2 flex-wrap">
              <Field label="Mês">
                <Input
                  id="planejar-mes"
                  type="month"
                  value={mes}
                  min={hojeISO().slice(0, 7)}
                  onChange={(e) => {
                    setMes(e.target.value);
                    setPrevia(null);
                  }}
                />
              </Field>
              <Button type="button" variant="secondary" onClick={() => chamar(false)} disabled={busy || !mes}>
                {busy && !previa ? 'Calculando...' : 'Ver prévia'}
              </Button>
            </div>
            <p className="text-xs text-amx-muted">
              Condomínio que já fez preventiva antes volta no mesmo dia do mês, com o mesmo técnico. Os novos preenchem os
              dias mais vazios. Quem já tem preventiva no mês fica de fora, então rodar de novo não duplica.
            </p>

            {previa && (
              <>
                <p className="text-sm text-white">
                  <b>{previa.itens.length}</b> condomínio{previa.itens.length !== 1 ? 's' : ''} a agendar em{' '}
                  {previa.dias.length} dias · até {previa.capacidadeDia} visita{previa.capacidadeDia > 1 ? 's' : ''} por
                  técnico por dia
                  {previa.jaAgendados > 0 ? ` · ${previa.jaAgendados} já agendados no mês` : ''}
                </p>

                {previa.itens.length > 0 && (
                  <>
                    <div className="grid grid-cols-7 gap-1" aria-label="Visitas por dia">
                      {previa.dias.map((d) => {
                        const n = porDia.get(d) ?? 0;
                        return (
                          <div
                            key={d}
                            title={`${formatarDataCurta(d)}: ${n} visita(s)`}
                            className={`rounded-md border border-amx-line px-1 py-1 text-center ${n ? 'bg-amx-blue/25' : 'bg-amx-panel-2'}`}
                          >
                            <p className="text-[10px] text-amx-muted">{formatarDataCurta(d).split(' ')[0]} {Number(d.slice(8))}</p>
                            <p className="text-xs font-semibold text-white tabular-nums">{n || '·'}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="overflow-x-auto border border-amx-line rounded-lg max-h-56">
                      <table className="w-full text-xs">
                        <thead className="bg-amx-panel-2 text-amx-muted sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-1.5">Dia</th>
                            <th className="text-left px-2 py-1.5">Condomínio</th>
                            <th className="text-left px-2 py-1.5">Técnico</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previa.itens.map((i) => (
                            <tr key={i.condominio_id} className="border-t border-amx-line text-white">
                              <td className="px-2 py-1.5 text-amx-muted whitespace-nowrap">{formatarDataCurta(i.data)}</td>
                              <td className="px-2 py-1.5 font-semibold">{i.condominio_nome}</td>
                              <td className="px-2 py-1.5">{i.tecnico_nome}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}

            {error && <p className="text-xs font-semibold text-amx-red-hover">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => chamar(true)} disabled={busy || !previa || previa.itens.length === 0}>
                {busy && previa ? 'Criando...' : `Criar ${previa?.itens.length ?? 0} OS preventivas`}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
