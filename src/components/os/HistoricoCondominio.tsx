'use client';

// "Histórico do condomínio" (só leitura): as OS anteriores do local, pro
// técnico ver o que já foi feito antes de começar. Cada linha abre a OS em
// modo leitura (o OSModal já trava edição em OS que não é do usuário).
import React, { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { OS_STATUS_LABELS, OS_TIPO_LABELS } from '@/lib/os-priority';
import { Paginacao } from '@/components/ui/Paginacao';
import { usePaginacao } from '@/lib/usePaginacao';
import type { OS } from '@/lib/db';

// "2026-11-20" -> "20/11/26" (com o ano: o histórico passa de um ano).
function dataComAno(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

interface ItemHistorico {
  id: string;
  tipo: OS['tipo'];
  status: OS['status'];
  data: string;
  tecnico_nome: string | null;
  descricao_problema: string | null;
  observacao: string | null;
}

export function HistoricoCondominio({
  condominioId,
  osAtualId,
  onAbrir,
}: {
  condominioId: string;
  osAtualId: string;
  onAbrir: (osId: string) => void;
}) {
  const [itens, setItens] = useState<ItemHistorico[] | null>(null);
  const [erro, setErro] = useState('');
  const listaRef = useRef<HTMLUListElement>(null);
  const lista = (itens ?? []).filter((i) => i.id !== osAtualId);
  const paginacao = usePaginacao(lista, { chave: 'historico-condominio', redefinirQuando: condominioId });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/condominios/${condominioId}/historico`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) setItens((await res.json()).historico || []);
        else setErro((await res.json().catch(() => ({}))).error || 'Não foi possível carregar o histórico.');
      })
      .catch(() => {
        if (!cancelled) setErro('Erro de conexão ao carregar o histórico.');
      });
    return () => {
      cancelled = true;
    };
  }, [condominioId]);

  if (erro) return <p className="text-xs text-amx-amber">{erro}</p>;
  if (!itens) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (lista.length === 0) {
    return <EmptyState title="Sem OS anteriores" description="Este condomínio ainda não tem OS finalizada ou cancelada." />;
  }
  return (
    <>
    <ul ref={listaRef} className="flex flex-col gap-2">
      {paginacao.itensDaPagina.map((i) => {
        const texto = i.descricao_problema || i.observacao;
        return (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => onAbrir(i.id)}
              className="w-full text-left rounded-lg border border-amx-line bg-amx-panel-2/40 px-3.5 py-3 hover:border-amx-muted transition-colors flex flex-col gap-1"
            >
              <span className="flex flex-wrap items-center gap-2 text-xs text-amx-muted">
                <span className="text-white font-semibold">{dataComAno(i.data)}</span>
                <span>{OS_TIPO_LABELS[i.tipo]}</span>
                <Badge tone={i.status === 'finalizada' ? 'success' : 'neutral'}>{OS_STATUS_LABELS[i.status]}</Badge>
                <span>{i.tecnico_nome ? `Técnico: ${i.tecnico_nome}` : 'Sem técnico'}</span>
              </span>
              {texto && <span className="text-[13px] text-white line-clamp-2">{texto}</span>}
            </button>
          </li>
        );
      })}
    </ul>
    <Paginacao p={paginacao} rotuloItens="OS" alvoRolagem={listaRef} />
    </>
  );
}
