'use client';

// "Mapa ao vivo" (gestor e secretária): todos os técnicos a caminho, no mapa e
// em lista. Consulta GET /api/rastreio a cada 15 s, só com a aba visível.
import React from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { MapaRastreioCarregado, type PontoMapa } from '@/components/mapa/MapaRastreioCarregado';
import { useConsultaPeriodica } from '@/lib/useRastreio';
import { useTick } from '@/lib/useTick';
import { textoHa, textoMinutos } from '@/lib/rastreio';
import { OS_TIPO_LABELS } from '@/lib/os-priority';
import type { OS } from '@/lib/db';
import type { PosicaoPublica } from '@/lib/rastreio-servidor';
import type { Estimativa } from '@/lib/rastreio';

interface ItemMapa {
  os: { id: string; codigo: string; tipo: OS['tipo'] };
  tecnico: { id: string | null; nome: string | null };
  condominio: { id: string; nome: string; destino: { lat: number; lng: number } | null };
  a_caminho_em: string | null;
  posicao: PosicaoPublica | null;
  estimativa: Estimativa | null;
  posicao_velha: boolean;
}

export function MapaAoVivo() {
  const { dados, carregou, erro } = useConsultaPeriodica<{ itens: ItemMapa[] }>('/api/rastreio');
  const agora = useTick(15_000);

  if (!carregou) {
    return (
      <div className="flex items-center gap-2 text-xs text-amx-muted py-6">
        <Spinner /> Carregando o mapa...
      </div>
    );
  }
  if (!dados) {
    return <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">Não foi possível carregar o mapa. Tente de novo em instantes.</p>;
  }
  const itens = dados.itens;
  if (itens.length === 0) {
    return (
      <Card>
        <EmptyState title="Nenhum técnico a caminho agora." description="Quando um técnico tocar em Estou a caminho, ele aparece aqui." />
      </Card>
    );
  }

  const pontos: PontoMapa[] = [];
  for (const it of itens) {
    if (it.condominio.destino) {
      pontos.push({ id: `c-${it.os.id}`, lat: it.condominio.destino.lat, lng: it.condominio.destino.lng, tipo: 'condominio' });
    }
    if (it.posicao) {
      pontos.push({
        id: `t-${it.os.id}`, lat: it.posicao.lat, lng: it.posicao.lng, tipo: 'tecnico',
        rotulo: it.tecnico.nome ?? 'Técnico', precisao_m: it.posicao.precisao_m,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {erro && <p className="text-xs text-amx-amber">Sem conexão agora. Mostrando a última atualização.</p>}
      {pontos.length > 0 ? (
        <MapaRastreioCarregado pontos={pontos} className="sm:!h-[420px]" rotuloAcessivel="Mapa com todos os técnicos a caminho" />
      ) : (
        <p className="text-[13px] text-amx-muted">Aguardando a localização dos técnicos.</p>
      )}
      <ul className="flex flex-col gap-3" aria-label="Técnicos a caminho">
        {itens.map((it) => (
          <li key={it.os.id}>
            <Card className="p-3 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-white">{it.tecnico.nome ?? 'Técnico'}</span>
                <Badge tone={it.os.tipo === 'corretiva' ? 'red' : 'info'}>{OS_TIPO_LABELS[it.os.tipo]}</Badge>
                <a href={`/?os=${it.os.id}`} className="text-xs font-semibold text-amx-blue-light hover:text-white transition-colors min-h-[44px] inline-flex items-center">
                  OS #{it.os.codigo}
                </a>
              </div>
              <p className="text-[13px] text-white">{it.condominio.nome}</p>
              <p className="text-xs text-amx-muted">
                {it.estimativa
                  ? `Chega em ${textoMinutos(it.estimativa.minutos)} (estimativa)`
                  : it.condominio.destino
                    ? 'Sem estimativa ainda.'
                    : 'Sem estimativa: o condomínio não tem localização no mapa.'}
                {' · '}
                {it.posicao ? (
                  <span className={it.posicao_velha ? 'text-amx-amber font-semibold' : ''}>
                    atualizado {textoHa(new Date(it.posicao.registrado_em).getTime(), agora)}
                  </span>
                ) : (
                  'aguardando a localização'
                )}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
