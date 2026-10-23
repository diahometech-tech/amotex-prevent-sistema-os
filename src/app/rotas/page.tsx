'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Form';
import { OSModal } from '@/components/os/OSModal';
import { PlanejarPreventivas } from '@/components/os/PlanejarPreventivas';
import { Modal } from '@/components/ui/Modal';
import { canManageOS } from '@/lib/permissions';
import { computeOsPrioridade, resumoRotasPorCondominio, OS_STATUS_LABELS, type RotaCondominio } from '@/lib/os-priority';
import { formatarDataCurta, hojeISO, montarRotaDoDia, somarDias } from '@/lib/os-agenda';
import { slaChegada } from '@/lib/os-sla';
import { useTick } from '@/lib/useTick';
import type { Condominio, OS } from '@/lib/db';

interface TecnicoLite {
  id: string;
  nome: string;
}

// Filtro de técnico: '' = todos; SEM_TECNICO = só as não atribuídas; senão o id.
const SEM_TECNICO = 'sem_tecnico';

type GrupoNomeado = RotaCondominio & { nome: string };

function RotasContent() {
  const user = useAmxUser();
  useTick(); // prazo de chegada das corretivas anda sozinho na rota

  const [oss, setOss] = useState<OS[]>([]);
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visitando, setVisitando] = useState<string | null>(null);
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);
  const [showPlanejar, setShowPlanejar] = useState(false);

  const hoje = hojeISO();
  const [dia, setDia] = useState(hoje);
  // Técnico abre direto na própria rota; admin vê a equipe toda. (O AppShell
  // só monta esta tela depois de carregar o usuário, então `user` já existe.)
  const [filtroTecnico, setFiltroTecnico] = useState(user?.role === 'tecnico' ? user.id : '');

  const condominioNome = useMemo(() => {
    const map = new Map(condominios.map((c) => [c.id, c.nome]));
    return (id: string) => map.get(id) || 'Condomínio desconhecido';
  }, [condominios]);

  const tecnicoNome = useMemo(() => {
    const map = new Map(tecnicos.map((t) => [t.id, t.nome]));
    return (id?: string) => (id ? map.get(id) : undefined);
  }, [tecnicos]);

  const load = async () => {
    try {
      const [osRes, condRes, userRes] = await Promise.all([
        fetch('/api/os', { cache: 'no-store' }),
        fetch('/api/condominios', { cache: 'no-store' }),
        fetch('/api/users', { cache: 'no-store' }).catch(() => null),
      ]);
      if (osRes.ok) {
        const data = await osRes.json();
        setOss(data.oss ?? []);
      } else {
        const data = await osRes.json().catch(() => ({}));
        setError(data.error || 'Não foi possível carregar as rotas.');
      }
      if (condRes.ok) setCondominios((await condRes.json()).condominios ?? []);
      if (userRes?.ok) {
        const data = await userRes.json();
        const users: { id: string; nome: string; papel?: string }[] = data.users || [];
        // GET /api/users devolve dois formatos: admin recebe a lista completa
        // (com `papel`), técnico recebe um payload reduzido `{id, nome}` que
        // JÁ vem só com técnicos ativos. Filtrar por `papel === 'tecnico'`
        // zerava a lista inteira pro técnico (o campo nem existe no payload
        // dele) — daí aceitar também quem chega sem `papel`.
        setTecnicos(users.filter((u) => u.papel === undefined || u.papel === 'tecnico'));
      }
    } catch {
      setError('Erro de conexão ao carregar as rotas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Mesmo padrão de src/app/page.tsx: load() só faz setState depois do
    // primeiro await, mas o lint não segue a função até lá.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const doTecnico = useMemo(() => {
    if (!filtroTecnico) return oss;
    if (filtroTecnico === SEM_TECNICO) return oss.filter((o) => !o.tecnico_id);
    return oss.filter((o) => o.tecnico_id === filtroTecnico);
  }, [oss, filtroTecnico]);

  const rota = useMemo(() => montarRotaDoDia(doTecnico, dia, hoje), [doTecnico, dia, hoje]);

  // Atrasadas entram junto na rota do dia (é trabalho pra hoje), marcadas
  // na linha. Contagem e ordem saem de resumoRotasPorCondominio — a mesma
  // função dos badges (ver o aviso em src/lib/os-priority.ts).
  const gruposDoDia = useMemo(
    () => nomear(resumoRotasPorCondominio([...rota.doDia, ...rota.atrasadas]), condominioNome),
    [rota, condominioNome]
  );
  const gruposSemData = useMemo(() => nomear(resumoRotasPorCondominio(rota.semData), condominioNome), [rota, condominioNome]);

  const totalDoDia = rota.doDia.length + rota.atrasadas.length;
  const totalUrgentes = gruposDoDia.reduce((acc, g) => acc + g.urgentes, 0);

  const marcarVisitado = async (os: OS) => {
    setVisitando(os.id);
    // Limpa o erro da tentativa anterior: sem isso o banner de "Falha ao
    // marcar visita" continuava na tela mesmo depois de um retry que deu certo.
    setError('');
    try {
      const res = await fetch(`/api/os/${os.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entrada_em: new Date().toISOString(), status: 'em_andamento' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOss((prev) => prev.map((o) => (o.id === data.os.id ? data.os : o)));
      } else {
        setError(data.error || 'Falha ao marcar visita.');
      }
    } catch {
      setError('Erro de conexão ao marcar visita.');
    } finally {
      setVisitando(null);
    }
  };

  if (!user) return null;

  // Gestão de Rotas é tela de operação (admin ou técnico), igual ao gate do
  // menu no AppShell. Sem isto o síndico não via o ícone mas abria a tela
  // digitando a URL. Não é vazamento — o GET /api/os já escopa o síndico ao
  // próprio condomínio no servidor — mas é uma tela que não é dele.
  if (!canManageOS(user.role)) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <EmptyState
          title="Acesso negado"
          description="A gestão de rotas é restrita à equipe de operação (administrador ou técnico)."
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const minhaRota = user.role === 'tecnico' && filtroTecnico === user.id;
  const tituloDia = dia === hoje ? 'hoje' : formatarDataCurta(dia);

  const renderGrupo = (g: GrupoNomeado) => (
    <Card key={g.condominio_id}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-sm font-semibold text-white">{g.nome}</p>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone="neutral">{g.total} OS</Badge>
          {g.urgentes > 0 && <Badge tone="red">{g.urgentes} urgente{g.urgentes > 1 ? 's' : ''}</Badge>}
          {g.altas > 0 && <Badge tone="warning">{g.altas} alta{g.altas > 1 ? 's' : ''}</Badge>}
        </div>
      </div>
      <div className="space-y-2">
        {g.oss.map((os) => {
          const prioridade = computeOsPrioridade(os);
          const atrasada = os.tipo === 'preventiva' && !!os.data_programada && os.data_programada < dia;
          const sla = slaChegada(os);
          return (
            <div
              key={os.id}
              className="flex items-center gap-3 bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2.5 flex-wrap"
            >
              <button
                type="button"
                onClick={() => setSelectedOsId(os.id)}
                className="flex items-center gap-3 flex-1 basis-60 min-w-0 text-left"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${prioridade.nivel === 'urgente' || prioridade.nivel === 'alta' ? 'bg-amx-red' : 'bg-amx-blue'}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">
                    {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}
                    {(os.descricao_problema || os.observacao) && ` · ${os.descricao_problema || os.observacao}`}
                  </p>
                  <p className="text-[11px] text-amx-muted truncate">
                    {OS_STATUS_LABELS[os.status]} · aberta há {prioridade.elapsedLabel}
                    {/* Sem cair pro id: o fallback anterior passava o
                        UUID do técnico pela função de iniciais e
                        exibia uma letra sem sentido na tela. */}
                    {os.tecnico_id ? ` · ${tecnicoNome(os.tecnico_id) ?? 'técnico atribuído'}` : ' · não atribuído'}
                  </p>
                  {sla && sla.situacao !== 'cumprido' && (
                    <p className={`text-[11px] font-semibold ${sla.tone === 'red' ? 'text-amx-red-hover' : 'text-amx-amber'}`}>
                      ⏱ {sla.label}
                    </p>
                  )}
                  {atrasada && (
                    <p className="text-[11px] font-semibold text-amx-amber">
                      Atrasada · era para {formatarDataCurta(os.data_programada!)}
                    </p>
                  )}
                </div>
                <Badge tone={prioridade.nivel === 'urgente' ? 'red' : prioridade.nivel === 'alta' ? 'warning' : 'info'}>
                  {prioridade.label}
                </Badge>
              </button>
              {os.entrada_em ? (
                <Badge tone="success">Visitado</Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={visitando === os.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    marcarVisitado(os);
                  }}
                >
                  {visitando === os.id ? 'Marcando...' : 'Marcar Visitado'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">
          {minhaRota ? `Minha rota de ${tituloDia}` : `Rota de ${tituloDia}`}
        </h1>
        <p className="text-[13px] text-amx-muted mt-1">
          {totalDoDia} OS em {gruposDoDia.length} condomínio{gruposDoDia.length !== 1 ? 's' : ''}
          {rota.atrasadas.length > 0 ? ` · ${rota.atrasadas.length} atrasada${rota.atrasadas.length > 1 ? 's' : ''}` : ''}
          {totalUrgentes > 0 ? ` · ${totalUrgentes} urgente${totalUrgentes > 1 ? 's' : ''}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior">
            ‹
          </Button>
          <Input
            id="rota-dia"
            type="date"
            value={dia}
            onChange={(e) => e.target.value && setDia(e.target.value)}
            className="w-auto py-1.5 text-xs"
          />
          <Button variant="secondary" size="sm" onClick={() => setDia(somarDias(dia, 1))} aria-label="Próximo dia">
            ›
          </Button>
          {dia !== hoje && (
            <Button variant="secondary" size="sm" onClick={() => setDia(hoje)}>
              Hoje
            </Button>
          )}
          <Select
            id="rota-tecnico"
            value={filtroTecnico}
            onChange={(e) => setFiltroTecnico(e.target.value)}
            className="w-auto py-1.5 text-xs"
          >
            <option value="">Todos os técnicos</option>
            {user.role === 'tecnico' && <option value={user.id}>Só as minhas</option>}
            {tecnicos
              .filter((t) => !(user.role === 'tecnico' && t.id === user.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            <option value={SEM_TECNICO}>Não atribuídas</option>
          </Select>
          {user.role === 'admin' && (
            <Button size="sm" onClick={() => setShowPlanejar(true)} className="sm:ml-auto">
              Planejar preventivas do mês
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 sm:px-8 py-6">
        {error && (
          <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {gruposDoDia.length === 0 ? (
          <EmptyState
            title={`Nenhuma visita para ${tituloDia}`}
            description="Agende OS para este dia pelo campo 'Data da visita', na criação ou no detalhe da OS."
          />
        ) : (
          <div className="space-y-5">{gruposDoDia.map(renderGrupo)}</div>
        )}

        {gruposSemData.length > 0 && (
          <div className="mt-8">
            <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted mb-3">
              SEM DATA DE VISITA · {rota.semData.length} OS · abra a OS e defina o dia
            </p>
            <div className="space-y-5">{gruposSemData.map(renderGrupo)}</div>
          </div>
        )}
      </div>

      <Modal open={showPlanejar} onClose={() => setShowPlanejar(false)} maxWidth="max-w-2xl">
        {showPlanejar && <PlanejarPreventivas onClose={() => setShowPlanejar(false)} onCriado={load} />}
      </Modal>

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

function nomear(grupos: RotaCondominio[], condominioNome: (id: string) => string): GrupoNomeado[] {
  return grupos.map((g) => ({ ...g, nome: condominioNome(g.condominio_id) }));
}

export default function RotasPage() {
  return (
    <AppShell>
      <RotasContent />
    </AppShell>
  );
}
