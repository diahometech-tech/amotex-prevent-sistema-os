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
import { pedirLocalizacao, type ResultadoPedido } from '@/lib/localizacao-cliente';

export const INTERVALO_ENVIO_MS = 15_000;

type Estado = 'iniciando' | 'enviando' | 'sem_permissao' | 'sem_gps' | 'parado';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export function CompartilharLocalizacao({
  osId,
  aCaminhoEm,
  ativo,
  pedidoInicial = null,
}: {
  osId: string;
  aCaminhoEm: string;
  ativo: boolean;
  /** Resultado do pedido de permissão feito no toque de "Estou a caminho". */
  pedidoInicial?: ResultadoPedido | null;
}) {
  const [estado, setEstado] = useState<Estado>('iniciando');
  // Reinicia o envio depois de "Tentar de novo" ou de a permissão ser liberada.
  const [tentativa, setTentativa] = useState(0);
  const [falhaPedido, setFalhaPedido] = useState<ResultadoPedido | null>(pedidoInicial);
  const [tentando, setTentando] = useState(false);
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
        setFalhaPedido(null);
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
  }, [ativo, osId, aCaminhoEm, tentativa]);

  // Se a pessoa liberar a localização nos ajustes do celular, retoma sozinho.
  useEffect(() => {
    if (!ativo || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let vivo = true;
    const aoMudar = () => {
      if (status?.state === 'granted') {
        setFalhaPedido(null);
        setTentativa((t) => t + 1);
      }
    };
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((st) => {
        if (!vivo) return;
        status = st;
        st.addEventListener('change', aoMudar);
      })
      .catch(() => {});
    return () => {
      vivo = false;
      status?.removeEventListener('change', aoMudar);
    };
  }, [ativo]);

  async function tentarDeNovo() {
    setTentando(true);
    // Direto do toque: é o que faz o navegador mostrar a janela de permissão.
    const r = await pedirLocalizacao();
    setTentando(false);
    setFalhaPedido(r === 'ok' ? null : r);
    if (r === 'ok') setTentativa((t) => t + 1);
  }

  if (!ativo || estado === 'parado') return null;

  const exibido: Estado =
    estado === 'enviando' ? estado : falhaPedido === 'negada' ? 'sem_permissao' : falhaPedido ? 'sem_gps' : estado;
  const problema = exibido === 'sem_permissao' || exibido === 'sem_gps';

  return (
    <Card className="p-3 flex flex-col gap-2" data-testid="compartilhando-localizacao">
      <div className="flex items-start gap-2">
        <Icon name="mapa" size={16} className="text-amx-blue-light mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-white">
            {exibido === 'sem_permissao' ? 'Localização bloqueada neste celular' : 'Compartilhando sua localização com o condomínio'}
          </p>
          {exibido === 'sem_gps' ? (
            <p className="text-xs text-amx-muted">Ligue a localização (GPS) do celular. O chamado segue normal.</p>
          ) : exibido === 'sem_permissao' ? (
            <>
              <p className="text-xs text-amx-muted">O condomínio não verá o mapa, mas o chamado segue normal. Para liberar:</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-white/90 flex flex-col gap-1">
                <li>
                  <span className="font-semibold">Android (Chrome):</span> toque no cadeado ao lado do endereço do site, depois em Permissões, Localização e Permitir.
                </li>
                <li>
                  <span className="font-semibold">App instalado no Android:</span> Configurações, Apps, Chrome (ou Amotex), Permissões, Localização e Permitir.
                </li>
                <li>
                  <span className="font-semibold">iPhone:</span> Ajustes, Privacidade, Serviços de Localização, Safari (Sites) e &quot;Ao Usar o App&quot;.
                </li>
              </ul>
            </>
          ) : (
            <p className="text-xs text-amx-muted">
              {ultimoEnvio ? `Último envio às ${fmtHora(ultimoEnvio)}.` : 'Pegando sua localização...'}
            </p>
          )}
        </div>
      </div>
      {problema && (
        <button
          type="button"
          onClick={tentarDeNovo}
          disabled={tentando}
          className="self-start px-4 py-2 min-h-[44px] rounded-lg bg-amx-red hover:bg-amx-red-hover text-white text-[13px] font-semibold disabled:opacity-60"
        >
          {tentando ? 'Tentando...' : 'Tentar de novo'}
        </button>
      )}
      <p className="text-xs text-amx-amber">Deixe esta tela aberta no trajeto. Se abrir outro app, o condomínio para de ver você no mapa.</p>
      <p className="text-[11px] text-amx-muted">Sua localização só é compartilhada no caminho até o condomínio.</p>
    </Card>
  );
}
