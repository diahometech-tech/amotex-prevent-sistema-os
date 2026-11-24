'use client';

// Técnico, na OS aberta, entre "Estou a caminho" e "Cheguei no local": envia a
// posição do celular para POST /api/os/[id]/posicao (no máximo a cada 15 s).
// Mantém a tela acesa (Wake Lock) e para sozinho na chegada, no cancelamento,
// na resposta 409 ou 2 horas depois do "a caminho". Sem botão de pausar.
// Sem permissão ou sem GPS: mensagem neutra, o chamado segue normal.
//
// O futuro app Android mandará a posição em segundo plano para o MESMO
// endpoint; esta tela é só a versão do navegador.
import React, { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { fmtHora } from '@/lib/os-sla';
import { LIMITE_RASTREIO_MS } from '@/lib/rastreio';

export const INTERVALO_ENVIO_MS = 15_000;

type Estado = 'iniciando' | 'enviando' | 'sem_permissao' | 'sem_gps' | 'parado';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function CompartilharLocalizacao({ osId, aCaminhoEm, ativo }: { osId: string; aCaminhoEm: string; ativo: boolean }) {
  const [estado, setEstado] = useState<Estado>('iniciando');
  const [ultimoEnvio, setUltimoEnvio] = useState<number | null>(null);
  const ultimaPosicao = useRef<{ lat: number; lng: number; precisao_m?: number } | null>(null);
  const ultimoEnvioRef = useRef(0);

  useEffect(() => {
    if (!ativo) return;
    let parado = false;
    let enviando = false;
    let watchId: number | null = null;
    let wakeLock: WakeLockSentinelLike | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstado('iniciando');

    const parar = () => {
      if (parado) return;
      parado = true;
      setEstado('parado');
    };

    const enviar = async () => {
      const pos = ultimaPosicao.current;
      if (parado || enviando || !pos) return;
      if (Date.now() - ultimoEnvioRef.current < INTERVALO_ENVIO_MS - 500) return;
      enviando = true;
      try {
        const res = await fetch(`/api/os/${osId}/posicao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pos),
        });
        if (res.ok) {
          ultimoEnvioRef.current = Date.now();
          setUltimoEnvio(Date.now());
        } else if (res.status === 409 || res.status === 401 || res.status === 403 || res.status === 404) {
          parar();
        }
        // 400/500: tenta de novo no próximo ciclo.
      } catch {
        // Sem rede: tenta de novo no próximo ciclo.
      } finally {
        enviando = false;
      }
    };

    // Janela de 2 h contada do "a caminho" (o servidor também recusa com 409).
    const restante = new Date(aCaminhoEm).getTime() + LIMITE_RASTREIO_MS - Date.now();
    const fimDaJanela = setTimeout(parar, Math.max(0, restante));

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setEstado('sem_gps');
    } else {
      const aoPosicionar = (p: GeolocationPosition) => {
        const { latitude, longitude, accuracy } = p.coords;
        ultimaPosicao.current = { lat: latitude, lng: longitude, ...(Number.isFinite(accuracy) ? { precisao_m: Math.round(accuracy) } : {}) };
        setEstado('enviando');
        void enviar();
      };
      const aoFalhar = (e: GeolocationPositionError) => {
        // 1 = permissão negada; 2/3 = sem sinal ou tempo esgotado (segue tentando).
        if (e.code === 1) setEstado('sem_permissao');
        else if (!ultimaPosicao.current) setEstado('sem_gps');
      };
      const opcoes: PositionOptions = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 };
      watchId = navigator.geolocation.watchPosition(aoPosicionar, aoFalhar, opcoes);
      // Alguns aparelhos demoram a entregar a primeira posição do watch: pede uma leitura avulsa também.
      navigator.geolocation.getCurrentPosition(aoPosicionar, () => {}, opcoes);
    }
    // Reenvia a última posição conhecida a cada ciclo: parado no semáforo o
    // GPS quase não dispara, e a tela do condomínio marcaria "sem atualização".
    const ciclo = setInterval(() => void enviar(), INTERVALO_ENVIO_MS);

    const pedirTelaAcesa = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
        if (!wl || parado || document.visibilityState !== 'visible') return;
        wakeLock?.release().catch(() => {});
        wakeLock = await wl.request('screen');
      } catch {
        // Sem suporte ou negado: a tela pode apagar; o aviso na tela já orienta.
      }
    };
    void pedirTelaAcesa();
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible') {
        void pedirTelaAcesa();
        void enviar();
      }
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    return () => {
      parado = true;
      clearTimeout(fimDaJanela);
      clearInterval(ciclo);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      wakeLock?.release().catch(() => {});
    };
  }, [ativo, osId, aCaminhoEm]);

  if (!ativo || estado === 'parado') return null;

  return (
    <Card className="p-3 flex flex-col gap-2" data-testid="compartilhando-localizacao">
      <div className="flex items-start gap-2">
        <Icon name="mapa" size={16} className="text-amx-blue-light mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white">Compartilhando sua localização com o condomínio</p>
          {estado === 'sem_permissao' || estado === 'sem_gps' ? (
            <p className="text-xs text-amx-muted">
              {estado === 'sem_permissao'
                ? 'Não foi possível usar sua localização neste aparelho. O condomínio não verá o mapa, mas o chamado segue normal.'
                : 'Ainda sem sinal de GPS. O chamado segue normal.'}
            </p>
          ) : (
            <p className="text-xs text-amx-muted">
              {ultimoEnvio ? `Último envio às ${fmtHora(ultimoEnvio)}.` : 'Pegando sua localização...'}
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-amx-amber">Deixe esta tela aberta no trajeto. Se abrir outro app, o condomínio para de ver você no mapa.</p>
      <p className="text-[11px] text-amx-muted">Sua localização só é compartilhada no caminho até o condomínio.</p>
    </Card>
  );
}
