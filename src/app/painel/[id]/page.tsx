'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { manutencoesDoMes, tempoMedioRespostaMinutos, formatarMinutos, ordenarHistoricoRecente } from '@/lib/condominio-stats';
import type { Condominio, OS, Equipamento } from '@/lib/db';

interface CondominiosResponse {
  condominio?: Condominio;
  error?: string;
}

interface EquipamentosResponse {
  equipamentos?: Equipamento[];
  error?: string;
}

interface OSResponse {
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
  const params = useParams();
  const id = params?.id as string;

  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [oss, setOss] = useState<OS[]>([]);

  const [loadingCondominio, setLoadingCondominio] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Carrega condomínio, equipamentos e OS em paralelo
  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        setLoadingCondominio(true);
        setError(null);

        const [condRes, equipRes, osRes] = await Promise.all([
          fetch(`/api/condominios/${id}`, { cache: 'no-store' }),
          fetch(`/api/condominios/${id}/equipamentos`, { cache: 'no-store' }).catch(() => null),
          fetch('/api/os', { cache: 'no-store' }).catch(() => null),
        ]);

        if (condRes.ok) {
          const data: CondominiosResponse = await condRes.json();
          if (data.condominio) {
            setCondominio(data.condominio);
          } else {
            setError(data.error || 'Condomínio não encontrado');
          }
        } else {
          const data: CondominiosResponse = await condRes.json().catch(() => ({}));
          setError(data.error || 'Condomínio não encontrado');
        }

        if (equipRes?.ok) {
          const data: EquipamentosResponse = await equipRes.json();
          setEquipamentos(data.equipamentos ?? []);
        }

        if (osRes?.ok) {
          const data: OSResponse = await osRes.json();
          const todasAss = data.oss ?? [];
          // Filtra client-side para este condomínio
          setOss(todasAss.filter((o) => o.condominio_id === id));
        }
      } catch {
        setError('Erro ao carregar o painel');
      } finally {
        setLoadingCondominio(false);
      }
    };

    load();
  }, [id]);

  const manutencoes = useMemo(() => manutencoesDoMes(oss), [oss]);
  const tempoMedio = useMemo(() => tempoMedioRespostaMinutos(oss), [oss]);
  const historicoRecente = useMemo(
    () => ordenarHistoricoRecente(oss.filter((o) => o.status === 'finalizada')),
    [oss]
  );

  // Mês/ano atual pro badge
  const agora = new Date();
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const relatorioMes = `Relatório — ${meses[agora.getMonth()]}`;

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
      <div className="px-8 pt-6 pb-4 border-b border-amx-line flex items-center justify-between">
        <div>
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-1">Painel do Síndico</p>
          <h1 className="text-white">{condominio.nome}</h1>
        </div>
        <Badge tone="info">{relatorioMes}</Badge>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
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

          {/* PRÓXIMA VISITA — placeholder com gap explicado */}
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Próxima Visita</p>
            <p className="text-3xl font-bold text-amx-muted">—</p>
            <p className="text-xs text-amx-muted mt-1">Agendamento de visitas ainda não existe no sistema</p>
          </Card>
        </div>

        {/* 2-column grid: Histórico + Nível de Reservatório */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
          {/* HISTÓRICO DE MANUTENÇÕES */}
          <Card>
            <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-4">Histórico de Manutenções</p>
            {historicoRecente.length === 0 ? (
              <p className="text-xs text-amx-muted">Nenhuma OS finalizada ainda.</p>
            ) : (
              <div className="space-y-2">
                {historicoRecente.slice(0, 10).map((os) => {
                  const tipo_bg = os.tipo === 'preventiva' ? 'bg-amx-blue' : 'bg-amx-red';
                  const data = new Date(os.saida_em || os.criado_em).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  return (
                    <div key={os.id} className="flex items-start gap-2.5">
                      <span className={`${tipo_bg} w-2 h-2 rounded-full shrink-0 mt-1.5`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white">
                          {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}
                          {os.observacao && ` · ${os.observacao}`}
                        </p>
                        <p className="text-[11px] text-amx-muted">{data}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* NÍVEL — Placeholder com gap de backend */}
          <Card>
            <EmptyState
              title="Histórico de nível indisponível"
              description="Depende de um endpoint novo que exponha as leituras de nível por dia do reservatório (hoje só existem eventos de alerta pontuais, não uma série histórica)."
            />
            {/* TODO(merge): Implementar gráfico de nível de reservatório aqui quando
                houver endpoint de série histórica de leituras de sensores. */}
          </Card>
        </div>
      </div>
    </div>
  );
}
