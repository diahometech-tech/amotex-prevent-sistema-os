'use client';

// Bloco "técnico a caminho" do Painel do Condomínio (síndico) e da OS aberta
// pelo escritório: mapa com técnico e condomínio, mais o texto da estimativa.
// Consulta GET /api/os/[id]/rastreio a cada 15 s, só com a aba visível. Some
// sozinho quando o rastreio deixa de estar ativo (chegada, cancelamento, 2 h).
import React from 'react';
import { MapaRastreioCarregado, type PontoMapa } from '@/components/mapa/MapaRastreioCarregado';
import { useConsultaPeriodica } from '@/lib/useRastreio';
import { useTick } from '@/lib/useTick';
import { textoDuracao, textoMinutos } from '@/lib/rastreio';
import type { RastreioOS } from '@/lib/rastreio-servidor';

export function AcompanharTecnico({ osId, paraEscritorio = false }: { osId: string; paraEscritorio?: boolean }) {
  const { dados, carregou } = useConsultaPeriodica<RastreioOS>(`/api/os/${osId}/rastreio`);
  const agora = useTick(15_000);

  if (!carregou || !dados || !dados.ativo) return null;

  const nome = dados.tecnico_nome ?? 'O técnico';
  const pontos: PontoMapa[] = [];
  if (dados.destino) pontos.push({ id: 'condominio', lat: dados.destino.lat, lng: dados.destino.lng, tipo: 'condominio', rotulo: 'Condomínio' });
  if (dados.posicao) {
    pontos.push({ id: 'tecnico', lat: dados.posicao.lat, lng: dados.posicao.lng, tipo: 'tecnico', rotulo: nome, precisao_m: dados.posicao.precisao_m });
  }

  let linha: React.ReactNode;
  if (!dados.posicao) {
    linha = 'Aguardando a localização do técnico.';
  } else if (dados.estimativa) {
    linha = (
      <>
        Técnico {nome} a caminho · chega em <strong className="text-white">{textoMinutos(dados.estimativa.minutos)}</strong> (estimativa)
      </>
    );
  } else {
    linha = <>Técnico {nome} a caminho.</>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="acompanhar-tecnico">
      <p className="text-[13px] text-amx-muted" aria-live="polite">{linha}</p>
      {dados.posicao && dados.posicao_velha && (
        <p className="text-xs font-semibold text-amx-amber">
          Sem atualização da localização há {textoDuracao(new Date(dados.posicao.registrado_em).getTime(), agora)}.
        </p>
      )}
      {pontos.length > 0 && <MapaRastreioCarregado pontos={pontos} />}
      {dados.posicao && !dados.destino && paraEscritorio && (
        <p className="text-[11px] text-amx-muted">Sem estimativa: este condomínio ainda não tem localização no mapa. Cadastre em Condomínios.</p>
      )}
    </div>
  );
}
