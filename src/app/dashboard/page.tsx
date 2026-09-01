'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { OSModal } from '@/components/os/OSModal';
import { computeOsPrioridade, compararPorPrioridade, resumoRotasPorCondominio } from '@/lib/os-priority';
import { useCondominioNome } from '@/lib/useCondominioNome';
import type { Alerta, Condominio, EventoAlerta, OS } from '@/lib/db';

// Shape devolvido por GET /api/alertas: reservatorio/condominio já
// resolvidos no servidor (ver src/app/api/alertas/route.ts) — ambos `null`
// quando o de-para SensorLog não bate com nenhum reservatório cadastrado,
// de propósito (o PRD pede pra sinalizar isso, nunca esconder).
interface AlertaResolvido extends Alerta {
  reservatorio: { id: string; nome_interno: string; tipo: string } | null;
  condominio: { id: string; nome: string } | null;
}

const EVENTO_LABELS: Record<EventoAlerta, string> = {
  NIVEL_BAIXO: 'Nível baixo',
  NIVEL_CRITICO: 'Nível crítico',
  NIVEL_MUITO_BAIXO: 'Nível muito baixo',
  TENDENCIA_QUEDA_MADRUGADA: 'Queda na madrugada',
  RECUPEROU: 'Recuperou',
  SEM_REPORTE: 'Sem reporte',
};

const EVENTO_TONE: Record<EventoAlerta, BadgeTone> = {
  NIVEL_BAIXO: 'warning',
  NIVEL_CRITICO: 'red',
  NIVEL_MUITO_BAIXO: 'red',
  TENDENCIA_QUEDA_MADRUGADA: 'warning',
  RECUPEROU: 'success',
  SEM_REPORTE: 'neutral',
};

// A busca traz até 100 alertas (para o KPI de 24h ser um número real); o
// painel lateral mostra só os mais recentes.
const ALERTAS_VISIVEIS = 15;

function formatRecebidoEm(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function DashboardContent() {
  const user = useAmxUser();

  const [oss, setOss] = useState<OS[]>([]);
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [alertas, setAlertas] = useState<AlertaResolvido[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  /** Instante em que os dados chegaram — âncora da janela de 24h dos alertas. */
  const [carregadoEm, setCarregadoEm] = useState<number | null>(null);
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);

  const condominioNome = useCondominioNome(condominios);

  const load = async () => {
    try {
      const [osRes, condRes, alertaRes] = await Promise.all([
        fetch('/api/os', { cache: 'no-store' }),
        fetch('/api/condominios', { cache: 'no-store' }),
        // limit=100 (o padrão da rota; o teto é 500) em vez de 15: o KPI
        // conta os alertas das últimas 24h, e com 15 ele saturava — "15"
        // aparecia como número real ao lado de totais verdadeiros. A LISTA
        // continua curta, cortada na renderização (ALERTAS_VISIVEIS).
        fetch('/api/alertas?limit=100', { cache: 'no-store' }),
      ]);
      // /api/alertas é admin-only — o 403 real do servidor é quem decide
      // "negado", não uma checagem de papel no cliente (ver permissions.ts).
      if (alertaRes.status === 403) {
        setDenied(true);
        return;
      }
      // Cada falha precisa aparecer: com os KPIs zerados e nenhum aviso, uma
      // falha do /api/os se parece exatamente com "não há nada pendente" —
      // que é a leitura mais perigosa possível neste dashboard.
      const falhas: string[] = [];
      if (osRes.ok) setOss((await osRes.json()).oss ?? []);
      else falhas.push('ordens de serviço');
      if (condRes.ok) setCondominios((await condRes.json()).condominios ?? []);
      else falhas.push('condomínios');
      if (alertaRes.ok) {
        setAlertas((await alertaRes.json()).alertas ?? []);
        setCarregadoEm(Date.now());
      } else falhas.push('alertas');
      if (falhas.length > 0) {
        setError(`Não foi possível carregar: ${falhas.join(', ')}. Os números abaixo estão incompletos.`);
      }
    } catch {
      setError('Erro ao carregar o dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // load() só faz setState depois do primeiro await — mesmo padrão de
    // src/app/page.tsx (ver comentário lá sobre o lint não seguir a função).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const ossAbertas = useMemo(
    () => oss.filter((o) => o.status !== 'finalizada' && o.status !== 'cancelada'),
    [oss]
  );

  const pendenciasCriticas = useMemo(
    () =>
      ossAbertas
        .filter((o) => {
          const nivel = computeOsPrioridade(o).nivel;
          return nivel === 'urgente' || nivel === 'alta';
        })
        .sort(compararPorPrioridade),
    [ossAbertas]
  );

  // Janela fixa de 24h: um número com significado próprio, diferente de
  // "quantos couberam no fetch". O "agora" é o instante da carga (gravado em
  // `carregadoEm`), não Date.now() no corpo do hook — a regra
  // react-hooks/purity proíbe função impura aqui, e ancorar no fetch também
  // evita a contagem mudar sozinha entre re-renders.
  const alertas24h = useMemo(() => {
    if (carregadoEm === null) return 0;
    const corte = carregadoEm - 24 * 60 * 60 * 1000;
    return alertas.filter((a) => new Date(a.recebido_em).getTime() >= corte).length;
  }, [alertas, carregadoEm]);
  // De-para não resolvido cobre DOIS casos: reservatorio_id do alerta sem
  // reservatório cadastrado (a.reservatorio null), OU reservatório existe
  // mas o condominio_id dele não bate com nenhum condomínio (a.condominio
  // null mesmo com a.reservatorio presente — condomínio apagado, por
  // exemplo). Contar só !a.reservatorio subestimava esse segundo caso e o
  // texto do card correspondente errava o diagnóstico (issue #13).
  const alertasSemDePara = useMemo(
    () => alertas.filter((a) => !a.reservatorio || !a.condominio).length,
    [alertas]
  );
  const condominiosMonitorados = useMemo(
    () => condominios.filter((c) => c.monitoramento_ativo).length,
    [condominios]
  );

  const resumoRotas = useMemo(
    () =>
      resumoRotasPorCondominio(oss).map((r) => ({ ...r, nome: condominioNome(r.condominio_id) })),
    [oss, condominioNome]
  );

  if (!user) return null;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (denied) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <EmptyState title="Acesso negado" description="O dashboard consolidado é restrito a administradores." />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Dashboard</h1>
        <p className="text-[13px] text-amx-muted mt-1">Visão consolidada de OS, alertas e rotas</p>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {error && (
          <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">OS Abertas</p>
            <p className="text-3xl font-bold text-white">{ossAbertas.length}</p>
            <p className="text-xs text-amx-muted mt-1">em andamento ou aguardando</p>
          </Card>
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Pendências Críticas</p>
            <p className="text-3xl font-bold text-white">{pendenciasCriticas.length}</p>
            <p className="text-xs text-amx-muted mt-1">prioridade alta ou urgente</p>
          </Card>
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Alertas (24h)</p>
            <p className="text-3xl font-bold text-white">{alertas24h}</p>
            <p className="text-xs text-amx-muted mt-1">
              {alertasSemDePara > 0 ? `${alertasSemDePara} sem de-para resolvido` : 'recebidos nas últimas 24h'}
            </p>
          </Card>
          <Card>
            <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider mb-2">Condomínios Monitorados</p>
            <p className="text-3xl font-bold text-white">
              {condominiosMonitorados}
              <span className="text-base text-amx-muted">/{condominios.length}</span>
            </p>
            <p className="text-xs text-amx-muted mt-1">com monitoramento ativo</p>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5 mb-5">
          {/* PENDÊNCIAS CRÍTICAS */}
          <Card>
            <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-4">OS que Precisam de Atenção</p>
            {pendenciasCriticas.length === 0 ? (
              <p className="text-xs text-amx-muted">Nenhuma pendência crítica no momento.</p>
            ) : (
              <div className="space-y-2">
                {pendenciasCriticas.slice(0, 8).map((os) => {
                  const prioridade = computeOsPrioridade(os);
                  return (
                    <button
                      key={os.id}
                      type="button"
                      onClick={() => setSelectedOsId(os.id)}
                      className="w-full flex items-center gap-3 text-left bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2.5 hover:border-amx-muted transition-colors"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${prioridade.nivel === 'urgente' ? 'bg-amx-red' : 'bg-amx-amber'}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">{condominioNome(os.condominio_id)}</p>
                        <p className="text-[11px] text-amx-muted truncate">
                          {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'} · aberta há {prioridade.elapsedLabel}
                        </p>
                      </div>
                      <Badge tone={prioridade.nivel === 'urgente' ? 'red' : 'warning'}>{prioridade.label}</Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ALERTAS RECENTES */}
          <Card>
            <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-4">Alertas Recentes</p>
            {alertas.length === 0 ? (
              <p className="text-xs text-amx-muted">Nenhum alerta recebido.</p>
            ) : (
              <div className="space-y-3">
                {alertas.slice(0, ALERTAS_VISIVEIS).map((a) => (
                  <div key={a.id} className="flex items-start gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 bg-amx-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge tone={EVENTO_TONE[a.evento]}>{EVENTO_LABELS[a.evento]}</Badge>
                        {(!a.reservatorio || !a.condominio) && <Badge tone="neutral">De-para não resolvido</Badge>}
                      </div>
                      <p className="text-xs text-white mt-1 truncate">
                        {a.condominio && a.reservatorio
                          ? `${a.condominio.nome} · ${a.reservatorio.nome_interno}`
                          : a.reservatorio
                            ? `Condomínio não identificado · ${a.reservatorio.nome_interno}`
                            : 'Reservatório não identificado'}
                      </p>
                      <p className="text-[11px] text-amx-muted">{formatRecebidoEm(a.recebido_em)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ROTA DO DIA */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Rota do Dia</p>
            <Link href="/rotas">
              <Button variant="secondary" size="sm">Ver gestão de rotas</Button>
            </Link>
          </div>
          {resumoRotas.length === 0 ? (
            <p className="text-xs text-amx-muted">Nenhuma OS em aberto no momento.</p>
          ) : (
            <div className="space-y-2">
              {resumoRotas.slice(0, 6).map((r) => (
                <div
                  key={r.condominio_id}
                  className="flex items-center justify-between gap-3 bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2.5"
                >
                  <p className="text-xs font-semibold text-white truncate">{r.nome}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone="neutral">{r.total} em aberto</Badge>
                    {r.urgentes > 0 && <Badge tone="red">{r.urgentes} urgente{r.urgentes > 1 ? 's' : ''}</Badge>}
                    {r.altas > 0 && <Badge tone="warning">{r.altas} alta{r.altas > 1 ? 's' : ''}</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {selectedOsId && (
        <OSModal
          key={selectedOsId}
          osId={selectedOsId}
          condominioNome={oss.find((o) => o.id === selectedOsId) ? condominioNome(oss.find((o) => o.id === selectedOsId)!.condominio_id) : ''}
          onClose={() => setSelectedOsId(null)}
          onChanged={(updated) => {
            setOss((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
          }}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}
