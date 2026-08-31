'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { OSModal } from '@/components/os/OSModal';
import { canManageOS } from '@/lib/permissions';
import { computeOsPrioridade, resumoRotasPorCondominio, OS_STATUS_LABELS } from '@/lib/os-priority';
import type { Condominio, OS } from '@/lib/db';

interface TecnicoLite {
  id: string;
  nome: string;
}

function RotasContent() {
  const user = useAmxUser();

  const [oss, setOss] = useState<OS[]>([]);
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visitando, setVisitando] = useState<string | null>(null);
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);

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

  const grupos = useMemo(
    () =>
      resumoRotasPorCondominio(oss).map((r) => ({ ...r, nome: condominioNome(r.condominio_id) })),
    [oss, condominioNome]
  );

  const totalUrgentes = useMemo(() => grupos.reduce((acc, g) => acc + g.urgentes, 0), [grupos]);

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

  const canMarcar = canManageOS(user.role);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Gestão de Rotas</h1>
        <p className="text-[13px] text-amx-muted mt-1">
          {grupos.length} condomínio{grupos.length !== 1 ? 's' : ''} com OS em aberto
          {totalUrgentes > 0 ? ` · ${totalUrgentes} urgente${totalUrgentes > 1 ? 's' : ''}` : ''}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {error && (
          <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {grupos.length === 0 ? (
          <EmptyState title="Nenhuma rota em aberto" description="Todas as OS estão finalizadas ou canceladas no momento." />
        ) : (
          <div className="space-y-5">
            {grupos.map((g) => (
              <Card key={g.condominio_id}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-sm font-semibold text-white">{g.nome}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone="neutral">{g.total} em aberto</Badge>
                    {g.urgentes > 0 && <Badge tone="red">{g.urgentes} urgente{g.urgentes > 1 ? 's' : ''}</Badge>}
                    {g.altas > 0 && <Badge tone="warning">{g.altas} alta{g.altas > 1 ? 's' : ''}</Badge>}
                  </div>
                </div>
                <div className="space-y-2">
                  {g.oss.map((os) => {
                    const prioridade = computeOsPrioridade(os);
                    return (
                      <div
                        key={os.id}
                        className="flex items-center gap-3 bg-amx-panel-2 border border-amx-line rounded-lg px-3 py-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedOsId(os.id)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${prioridade.nivel === 'urgente' || prioridade.nivel === 'alta' ? 'bg-amx-red' : 'bg-amx-blue'}`}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate">
                              {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}
                              {os.observacao && ` · ${os.observacao}`}
                            </p>
                            <p className="text-[11px] text-amx-muted truncate">
                              {OS_STATUS_LABELS[os.status]} · aberta há {prioridade.elapsedLabel}
                              {/* Sem cair pro id: o fallback anterior passava o
                                  UUID do técnico pela função de iniciais e
                                  exibia uma letra sem sentido na tela. */}
                              {os.tecnico_id ? ` · ${tecnicoNome(os.tecnico_id) ?? 'técnico atribuído'}` : ' · não atribuído'}
                            </p>
                          </div>
                          <Badge tone={prioridade.nivel === 'urgente' ? 'red' : prioridade.nivel === 'alta' ? 'warning' : 'info'}>
                            {prioridade.label}
                          </Badge>
                        </button>
                        {canMarcar && (
                          os.entrada_em ? (
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
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
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

export default function RotasPage() {
  return (
    <AppShell>
      <RotasContent />
    </AppShell>
  );
}
