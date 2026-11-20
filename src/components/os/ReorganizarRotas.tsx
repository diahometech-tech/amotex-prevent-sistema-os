'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ModalHeader } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/EmptyState';
import { formatarDataCurta } from '@/lib/os-agenda';

interface Movimento {
  os_id: string;
  de: string;
  para: string;
  condominio_nome: string;
  tecnico_nome: string;
  acimaDaMeta?: boolean;
}

// "Reorganizar agora": mostra a prévia do que muda (nada gravado) e só aplica
// na confirmação. A regra está em src/lib/reorganizar-fila.ts; o servidor
// recalcula ao confirmar. A mesma rotina roda sozinha às 5h (n8n).
export function ReorganizarRotas({ onClose, onAplicado }: { onClose: () => void; onAplicado: () => void }) {
  const [previa, setPrevia] = useState<{ meta: number; movimentos: Movimento[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feito, setFeito] = useState<string | null>(null);

  const chamar = async (confirmar: boolean) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/os/preventivas/reorganizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmar }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Falha ao reorganizar.');
      } else if (confirmar) {
        setFeito(data.remarcadas ? `${data.remarcadas} visita${data.remarcadas !== 1 ? 's' : ''} remarcada${data.remarcadas !== 1 ? 's' : ''}.` : 'Nada a mudar.');
        onAplicado();
      } else {
        setPrevia(data);
      }
    } catch {
      setError('Erro de conexão.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // A prévia abre sozinha: só lê, não grava. O setState acontece depois do await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    chamar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <ModalHeader
        title="Reorganizar rotas agora"
        subtitle="As preventivas que ficaram pra trás entram primeiro no próximo dia útil e a fila de cada técnico anda"
        onClose={onClose}
      />
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
            {!previa && !error && (
              <div className="flex justify-center py-6">
                <Spinner className="h-5 w-5" />
              </div>
            )}
            {previa && (
              <>
                <p className="text-sm text-white">
                  {previa.movimentos.length === 0 ? (
                    'Nada a mudar agora. As visitas abertas de hoje só passam para o próximo dia útil na reorganização das 5h.'
                  ) : (
                    <>
                      <b>{previa.movimentos.length}</b> visita{previa.movimentos.length !== 1 ? 's' : ''} muda
                      {previa.movimentos.length !== 1 ? 'm' : ''} de dia · meta de {previa.meta} por técnico por dia
                    </>
                  )}
                </p>
                {previa.movimentos.some((m) => m.acimaDaMeta) && (
                  <p className="text-xs text-amx-muted">
                    {previa.movimentos.filter((m) => m.acimaDaMeta).length} visita(s) não cabem na meta até o fim do mês e ficam no último dia
                    útil, acima da meta (marcadas com *). Considere aumentar a meta ou incluir outro técnico.
                  </p>
                )}
                {previa.movimentos.length > 0 && (
                  <div className="overflow-x-auto border border-amx-line rounded-lg max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-amx-panel-2 text-amx-muted sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5">Condomínio</th>
                          <th className="text-left px-2 py-1.5">Técnico</th>
                          <th className="text-left px-2 py-1.5">De</th>
                          <th className="text-left px-2 py-1.5">Para</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previa.movimentos.map((m) => (
                          <tr key={m.os_id} className="border-t border-amx-line text-white">
                            <td className="px-2 py-1.5 font-semibold">{m.condominio_nome}</td>
                            <td className="px-2 py-1.5">{m.tecnico_nome}</td>
                            <td className="px-2 py-1.5 text-amx-muted whitespace-nowrap">{formatarDataCurta(m.de)}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{formatarDataCurta(m.para)}{m.acimaDaMeta ? ' *' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-xs font-semibold text-amx-red-hover">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => chamar(true)} disabled={busy || !previa || previa.movimentos.length === 0}>
                {busy && previa ? 'Aplicando...' : 'Aplicar'}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
