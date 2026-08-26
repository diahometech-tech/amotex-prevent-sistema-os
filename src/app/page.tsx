'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Field, Select, Textarea } from '@/components/ui/Form';
import { OSModal } from '@/components/os/OSModal';
import { canManageOS } from '@/lib/permissions';
import { computeOsPrioridade, OS_TIPO_LABELS, OS_STATUS_LABELS, type OsPrioridade } from '@/lib/os-priority';
import type { Condominio, OS, OsStatus, OsTipo } from '@/lib/db';

type StatusFiltro = 'ativas' | OsStatus | 'todas';

const PRIORIDADE_ORDER: Record<OsPrioridade, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

function ordenarPorPrioridade(oss: OS[]): OS[] {
  return [...oss].sort((a, b) => {
    const pa = computeOsPrioridade(a);
    const pb = computeOsPrioridade(b);
    const diff = PRIORIDADE_ORDER[pa.nivel] - PRIORIDADE_ORDER[pb.nivel];
    if (diff !== 0) return diff;
    return pb.elapsedHours - pa.elapsedHours; // dentro do mesmo nível, a mais antiga primeiro
  });
}

function OsListContent() {
  const user = useAmxUser();
  const [oss, setOss] = useState<OS[]>([]);
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('ativas');
  const [tipoFiltro, setTipoFiltro] = useState<OsTipo | 'todos'>('todos');
  const [condominioFiltro, setCondominioFiltro] = useState<string>('todos');

  const [showCreate, setShowCreate] = useState(false);
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);

  const condominioNome = useMemo(() => {
    const map = new Map(condominios.map((c) => [c.id, c.nome]));
    return (id: string) => map.get(id) || 'Condomínio desconhecido';
  }, [condominios]);

  const load = async () => {
    try {
      const [osRes, condRes] = await Promise.all([
        fetch('/api/os', { cache: 'no-store' }),
        fetch('/api/condominios', { cache: 'no-store' }),
      ]);
      if (osRes.ok) {
        const data = await osRes.json();
        setOss(data.oss || []);
      } else {
        const data = await osRes.json().catch(() => ({}));
        setError(data.error || 'Não foi possível carregar as ordens de serviço.');
      }
      if (condRes.ok) {
        const data = await condRes.json();
        setCondominios(data.condominios || []);
      }
    } catch {
      setError('Erro de conexão ao carregar as ordens de serviço.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // load() só faz setState depois do primeiro await (busca de OS/condomínios) —
    // o lint ainda assim marca a chamada por não seguir a função até lá.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filtradas = useMemo(() => {
    return oss.filter((os) => {
      if (statusFiltro === 'ativas' && (os.status === 'finalizada' || os.status === 'cancelada')) return false;
      if (statusFiltro !== 'ativas' && statusFiltro !== 'todas' && os.status !== statusFiltro) return false;
      if (tipoFiltro !== 'todos' && os.tipo !== tipoFiltro) return false;
      if (condominioFiltro !== 'todos' && os.condominio_id !== condominioFiltro) return false;
      return true;
    });
  }, [oss, statusFiltro, tipoFiltro, condominioFiltro]);

  const ordenadas = useMemo(() => ordenarPorPrioridade(filtradas), [filtradas]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-amx-ink">Ordens de Serviço</h1>
          <p className="text-xs text-amx-muted mt-0.5">
            {ordenadas.length} OS{statusFiltro === 'ativas' ? ' em aberto' : ''} · ordenadas por prioridade
          </p>
        </div>
        {user && canManageOS(user.role) && (
          <Button onClick={() => setShowCreate(true)}>+ Nova OS</Button>
        )}
      </div>

      {error && (
        <p className="text-xs font-semibold text-amx-red-600 bg-amx-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-white border border-amx-border rounded-full p-1">
          {(
            [
              ['ativas', 'Em aberto'],
              ['finalizada', 'Finalizadas'],
              ['todas', 'Todas'],
            ] as [StatusFiltro, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFiltro(value)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                statusFiltro === value ? 'bg-amx-navy-800 text-white' : 'text-amx-muted hover:bg-amx-navy-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Select
          value={tipoFiltro}
          onChange={(e) => setTipoFiltro(e.target.value as OsTipo | 'todos')}
          className="w-auto"
        >
          <option value="todos">Todos os tipos</option>
          <option value="preventiva">Preventiva</option>
          <option value="corretiva">Corretiva</option>
        </Select>

        {condominios.length > 1 && (
          <Select
            value={condominioFiltro}
            onChange={(e) => setCondominioFiltro(e.target.value)}
            className="w-auto"
          >
            <option value="todos">Todos os condomínios</option>
            {condominios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        )}
      </div>

      {ordenadas.length === 0 ? (
        <EmptyState
          title="Nenhuma OS encontrada"
          description="Ajuste os filtros acima ou crie uma nova ordem de serviço."
          action={
            user && canManageOS(user.role) ? (
              <Button onClick={() => setShowCreate(true)}>+ Nova OS</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {ordenadas.map((os) => (
            <OsRow key={os.id} os={os} condominioNome={condominioNome(os.condominio_id)} onClick={() => setSelectedOsId(os.id)} />
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} maxWidth="max-w-md">
        <NovaOsForm
          condominios={condominios}
          onClose={() => setShowCreate(false)}
          onCreated={(os) => {
            setShowCreate(false);
            setOss((prev) => [os, ...prev]);
          }}
        />
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

const TIPO_TONE: Record<OsTipo, BadgeTone> = { preventiva: 'info', corretiva: 'red' };
const TIPO_DOT: Record<OsTipo, string> = { preventiva: 'bg-amx-navy-600', corretiva: 'bg-amx-red-600' };
const STATUS_TONE: Record<OsStatus, BadgeTone> = {
  aberta: 'neutral',
  em_andamento: 'warning',
  finalizada: 'success',
  cancelada: 'neutral',
};

function OsRow({ os, condominioNome, onClick }: { os: OS; condominioNome: string; onClick: () => void }) {
  const prioridade = computeOsPrioridade(os);
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className="p-4 flex items-center gap-3 cursor-pointer hover:border-amx-navy-500 transition-colors"
    >
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TIPO_DOT[os.tipo]}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold text-amx-ink truncate">{condominioNome}</p>
          <Badge tone={TIPO_TONE[os.tipo]}>{OS_TIPO_LABELS[os.tipo]}</Badge>
          {os.origem === 'hermes_automatica' && <Badge tone="navy">🤖 Hermes</Badge>}
        </div>
        {os.observacao && <p className="text-xs text-amx-muted truncate mt-0.5">{os.observacao}</p>}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Badge tone={prioridade.tone}>{prioridade.label}</Badge>
        <Badge tone={STATUS_TONE[os.status]}>{OS_STATUS_LABELS[os.status]}</Badge>
      </div>
    </Card>
  );
}

function NovaOsForm({
  condominios,
  onClose,
  onCreated,
}: {
  condominios: Condominio[];
  onClose: () => void;
  onCreated: (os: OS) => void;
}) {
  const [condominioId, setCondominioId] = useState(condominios[0]?.id || '');
  const [tipo, setTipo] = useState<OsTipo>('preventiva');
  const [observacao, setObservacao] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!condominioId) {
      setError('Selecione um condomínio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condominio_id: condominioId, tipo, origem: 'manual', observacao: observacao || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        onCreated(data.os);
      } else {
        setError(data.error || 'Falha ao criar OS.');
      }
    } catch {
      setError('Erro de conexão.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ModalHeader title="Nova Ordem de Serviço" onClose={onClose} />
      <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
        <Field label="Condomínio" required>
          <Select value={condominioId} onChange={(e) => setCondominioId(e.target.value)} required>
            <option value="">Selecione...</option>
            {condominios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo" required>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as OsTipo)}>
            <option value="preventiva">Preventiva</option>
            <option value="corretiva">Corretiva</option>
          </Select>
        </Field>
        <Field label="Observação" hint="Opcional — contexto inicial do serviço">
          <Textarea rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Field>
        {error && <p className="text-xs font-semibold text-amx-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Criando...' : 'Criar OS'}
          </Button>
        </div>
      </form>
    </>
  );
}

export default function Home() {
  return (
    <AppShell>
      <OsListContent />
    </AppShell>
  );
}
