'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import {
  manutencoesDoMes,
  tempoMedioRespostaMinutos,
  formatarMinutos,
  historicoPorMes,
  proximaVisita,
  diaDoAtendimento,
} from '@/lib/condominio-stats';
import { formatarDataCurta } from '@/lib/os-agenda';
import { OSModal } from '@/components/os/OSModal';
import { AbrirChamado, ChamadosDoCondominio } from '@/components/os/ChamadosDoCondominio';
import { podeAbrirChamado, podeCancelarChamado } from '@/lib/roles';
import type { Condominio, OS, Equipamento } from '@/lib/db';
import { Icon } from '@/components/ui/Icon';

interface CondominioDetalheResponse {
  condominio?: Condominio;
  equipamentos?: Equipamento[];
  oss?: OS[];
  error?: string;
}

export default function PainelDetailPage() {
  return (
    <AppShell>
      <PainelDetailContent />
    </AppShell>
  );
}

function PainelDetailContent() {
  const user = useAmxUser();
  const params = useParams();
  const id = params?.id as string;

  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [oss, setOss] = useState<OS[]>([]);

  const [loadingCondominio, setLoadingCondominio] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carrega condomínio, equipamentos e OS em paralelo
  const carregar = useCallback(
    // inicial = primeira carga da tela (mostra erro e some o carregando);
    // as seguintes (a cada 30 s, depois de cancelar) são silenciosas.
    async (inicial = false) => {
      if (!id) return;
      try {

        // GET /api/condominios/:id já devolve condominio + reservatorios +
        // contatos + equipamentos + oss (as OS já escopadas a este
        // condomínio) num payload só — ver src/app/api/condominios/[id]/route.ts.
        // Buscar equipamentos à parte, ou puxar /api/os inteiro pra filtrar no
        // cliente, era trabalho duplicado (e trazia OS de outros condomínios
        // pro navegador à toa).
        const condRes = await fetch(`/api/condominios/${id}`, { cache: 'no-store' });
        const data: CondominioDetalheResponse = await condRes.json().catch(() => ({}));

        if (!condRes.ok || !data.condominio) {
          if (inicial) setError(data.error || 'Condomínio não encontrado');
          return;
        }

        setCondominio(data.condominio);
        setEquipamentos(data.equipamentos ?? []);
        setOss(data.oss ?? []);
      } catch {
        if (inicial) setError('Erro ao carregar o painel');
      } finally {
        if (inicial) setLoadingCondominio(false);
      }
    },
    [id]
  );

  useEffect(() => {
    const t = window.setTimeout(() => carregar(true), 0);
    return () => window.clearTimeout(t);
  }, [carregar]);

  // Acompanhamento ao vivo: o técnico avisa que está a caminho e chega com a
  // tela aberta. Atualiza a cada 30 s e quando o app volta pra frente.
  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState === 'visible') carregar();
    };
    const timer = window.setInterval(atualizar, 30_000);
    document.addEventListener('visibilitychange', atualizar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', atualizar);
    };
  }, [carregar]);

  const manutencoes = useMemo(() => manutencoesDoMes(oss), [oss]);
  const tempoMedio = useMemo(() => tempoMedioRespostaMinutos(oss), [oss]);
  const meses = useMemo(() => historicoPorMes(oss), [oss]);
  const proxima = useMemo(() => proximaVisita(oss), [oss]);
  // Mês aberto na "pasta"; começa no mais recente.
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  const [osAberta, setOsAberta] = useState<string | null>(null);

  // Mês/ano atual pro badge
  const agora = new Date();
  const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const relatorioMes = `Relatório — ${nomesMeses[agora.getMonth()]}`;
  const mesSelecionado = mesAberto ?? meses[0]?.chave ?? null;

  if (loadingCondominio) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!condominio || error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <EmptyState
          title="Condomínio não encontrado"
          description={error || 'O condomínio que você tentou acessar não existe ou foi removido.'}
          action={
            <Link href="/painel">
              <Button variant="secondary">Voltar</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b border-amx-line flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-1">{user?.role === 'sindico' ? 'Painel do Condomínio' : 'Painel do Síndico'}</p>
          <h1 className="text-white">{condominio.nome}</h1>
        </div>
        {podeAbrirChamado(user?.role) ? (
          <AbrirChamado
            nomePadrao={user?.name ?? ''}
            onAberto={(nova) => setOss((prev) => [nova, ...prev])}
          />
        ) : (
          <Badge tone="info">{relatorioMes}</Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        {/* Atendimentos em andamento (linha do tempo) e chamados recentes */}
        <ChamadosDoCondominio
          oss={oss}
          podeCancelar={podeCancelarChamado(user?.role)}
          onAlterada={(atualizada) => setOss((prev) => prev.map((o) => (o.id === atualizada.id ? atualizada : o)))}
          onRecarregar={() => carregar()}
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {/* EQUIPAMENTOS */}
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Equipamentos</p>
            <p className="text-3xl font-bold text-white">{equipamentos.length}</p>
            <p className="text-xs text-amx-muted mt-1">total cadastrado</p>
          </Card>

          {/* MANUTENÇÕES NO MÊS */}
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Manutenções no Mês</p>
            <p className="text-3xl font-bold text-white">{manutencoes.total}</p>
            <p className="text-xs text-amx-muted mt-1">
              {manutencoes.preventivas} preventivas · {manutencoes.corretivas} corretivas
            </p>
          </Card>

          {/* TEMPO MÉDIO DE RESPOSTA */}
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Tempo Médio de Resposta</p>
            <p className="text-3xl font-bold text-white">{tempoMedio !== null ? formatarMinutos(tempoMedio) : '—'}</p>
            <p className="text-xs text-amx-muted mt-1">até chegada em campo</p>
          </Card>

          {/* PRÓXIMA VISITA — dia agendado (os.data_programada) */}
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Próxima Visita</p>
            {proxima ? (
              <>
                <p className="text-3xl font-bold text-white">{formatarDataCurta(proxima.data_programada!)}</p>
                <p className="text-xs text-amx-muted mt-1">{proxima.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'} agendada</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-bold text-amx-muted">—</p>
                <p className="text-xs text-amx-muted mt-1">Sem visita agendada</p>
              </>
            )}
          </Card>
        </div>

        {/* Histórico de atendimentos, na largura toda */}
        <div>
          {/* HISTÓRICO DE MANUTENÇÕES */}
          <Card>
            <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-4">Histórico de Atendimentos</p>
            {meses.length === 0 ? (
              <p className="text-xs text-amx-muted">Nenhuma OS finalizada ainda.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {meses.map((m) => {
                  const aberto = m.chave === mesSelecionado;
                  const partes = [
                    m.preventivas && `${m.preventivas} preventiva${m.preventivas > 1 ? 's' : ''}`,
                    m.corretivas && `${m.corretivas} corretiva${m.corretivas > 1 ? 's' : ''}`,
                  ].filter(Boolean);
                  return (
                    <div key={m.chave} className="rounded-lg border border-amx-line overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setMesAberto(aberto ? '' : m.chave)}
                        aria-expanded={aberto}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-amx-panel-2 hover:bg-amx-panel transition-colors text-left"
                      >
                        <span className="text-xs font-semibold text-white">
                          <span className="inline-flex items-center gap-1"><Icon name="pasta" size={14} />{m.rotulo}</span>
                        </span>
                        <span className="text-[11px] text-amx-muted">
                          {m.oss.length} visita{m.oss.length > 1 ? 's' : ''} · {partes.join(' · ')}{' '}
                          <Icon name={aberto ? 'chevronBaixo' : 'chevronDireita'} size={14} className="inline align-text-bottom" />
                        </span>
                      </button>
                      {aberto && (
                        <div className="flex flex-col divide-y divide-amx-line">
                          {m.oss.map((os) => {
                            const tipo_bg = os.tipo === 'preventiva' ? 'bg-amx-blue' : 'bg-amx-red';
                            return (
                              <div key={os.id} className="flex items-start gap-2.5 px-3 py-2.5">
                                <span className={`${tipo_bg} w-2 h-2 rounded-full shrink-0 mt-1.5`} aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-white">
                                    {formatarDataCurta(diaDoAtendimento(os))} · {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}
                                  </p>
                                  {(os.descricao_problema || os.observacao) && (
                                    <p className="text-[11px] text-amx-muted truncate">{os.descricao_problema || os.observacao}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setOsAberta(os.id)}
                                  className="text-[11px] font-semibold text-amx-blue-light hover:text-white transition-colors shrink-0 whitespace-nowrap min-h-[44px] px-2 inline-flex items-center"
                                >
                                  <span className="inline-flex items-center gap-1"><Icon name="camera" size={14} />Fotos</span>
                                </button>
                                {os.pdf_url && (
                                  <a
                                    href={os.pdf_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] font-semibold text-amx-muted hover:text-white transition-colors shrink-0 whitespace-nowrap min-h-[44px] px-2 inline-flex items-center"
                                  >
                                    <span className="inline-flex items-center gap-1"><Icon name="documento" size={14} />PDF</span>
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
      {osAberta && (
        <OSModal
          osId={osAberta}
          condominioNome={condominio.nome}
          onClose={() => setOsAberta(null)}
          onChanged={(atualizada) => setOss((prev) => prev.map((o) => (o.id === atualizada.id ? atualizada : o)))}
          onDeleted={(id) => setOss((prev) => prev.filter((o) => o.id !== id))}
        />
      )}
    </div>
  );
}
