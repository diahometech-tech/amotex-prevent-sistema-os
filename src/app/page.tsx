'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Field, Select, Textarea } from '@/components/ui/Form';
import { OSModal } from '@/components/os/OSModal';
import { canManageOS } from '@/lib/permissions';
import { computeOsPrioridade, compararPorPrioridade, OS_STATUS_LABELS, type OsPrioridade } from '@/lib/os-priority';
import { useCondominioNome } from '@/lib/useCondominioNome';
import { parseTecnicosResponse, type TecnicoLite } from '@/lib/tecnicos';
import type { Condominio, OS, OsStatus, OsTipo } from '@/lib/db';

// Os 3 níveis do campo manual os.prioridade (distinto de OsPrioridade, a
// escala visual de 4 níveis calculada em src/lib/os-priority.ts).
type OsPrioridadeManual = NonNullable<OS['prioridade']>;

type StatusFiltro = 'ativas' | OsStatus | 'todas';

const ROW_GRID = 'grid-cols-[28px_2.2fr_1.1fr_1fr_1.1fr_100px_20px]';
const AVATAR_TONES = ['bg-amx-blue', 'bg-amx-red', 'bg-amx-green', 'bg-amx-amber'];

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function avatarTone(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function OsListContent() {
  const user = useAmxUser();
  const [oss, setOss] = useState<OS[]>([]);
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [tecnicos, setTecnicos] = useState<TecnicoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>('ativas');
  const [tipoFiltro, setTipoFiltro] = useState<OsTipo | 'todos'>('todos');
  const [condominioFiltro, setCondominioFiltro] = useState<string>('todos');

  const [showCreate, setShowCreate] = useState(false);
  const [selectedOsId, setSelectedOsId] = useState<string | null>(null);

  const condominioNome = useCondominioNome(condominios);

  const tecnicoNome = useMemo(() => {
    const map = new Map(tecnicos.map((t) => [t.id, t.nome]));
    return (id?: string) => (id ? map.get(id) : undefined);
  }, [tecnicos]);

  const load = async () => {
    try {
      const [osRes, condRes, userRes] = await Promise.all([
        fetch('/api/os', { cache: 'no-store' }),
        fetch('/api/condominios', { cache: 'no-store' }),
        // Diretório de técnicos — só pra resolver nome/avatar na lista, uma
        // falha aqui não impede o resto da tela (cai no fallback "—").
        fetch('/api/users', { cache: 'no-store' }).catch(() => null),
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
      if (userRes?.ok) {
        setTecnicos(parseTecnicosResponse(await userRes.json()));
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
    const termo = busca.trim().toLowerCase();
    return oss.filter((os) => {
      if (statusFiltro === 'ativas' && (os.status === 'finalizada' || os.status === 'cancelada')) return false;
      if (statusFiltro !== 'ativas' && statusFiltro !== 'todas' && os.status !== statusFiltro) return false;
      if (tipoFiltro !== 'todos' && os.tipo !== tipoFiltro) return false;
      if (condominioFiltro !== 'todos' && os.condominio_id !== condominioFiltro) return false;
      if (termo) {
        const alvo = `${condominioNome(os.condominio_id)} ${tecnicoNome(os.tecnico_id) || ''} ${os.observacao || ''}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [oss, statusFiltro, tipoFiltro, condominioFiltro, busca, condominioNome, tecnicoNome]);

  const ordenadas = useMemo(() => [...filtradas].sort(compararPorPrioridade), [filtradas]);
  const totalAbertas = useMemo(() => oss.filter((o) => o.status !== 'finalizada' && o.status !== 'cancelada').length, [oss]);
  const totalPrioridadeAlta = useMemo(
    () =>
      oss.filter((o) => {
        const p = computeOsPrioridade(o).nivel;
        return (p === 'alta' || p === 'urgente') && o.status !== 'finalizada' && o.status !== 'cancelada';
      }).length,
    [oss]
  );

  const FILTROS_TIPO: { value: OsTipo | 'todos'; label: string; count: number }[] = [
    { value: 'todos', label: 'Todas', count: oss.length },
    { value: 'preventiva', label: 'Preventiva', count: oss.filter((o) => o.tipo === 'preventiva').length },
    { value: 'corretiva', label: 'Corretiva', count: oss.filter((o) => o.tipo === 'corretiva').length },
  ];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* TOPBAR */}
      <div className="px-8 pt-6 pb-4 border-b border-amx-line">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[22px] font-semibold text-white normal-case tracking-normal">Ordens de Serviço</h1>
            <p className="text-[13px] text-amx-muted mt-1">
              {totalAbertas} abertas{totalPrioridadeAlta > 0 ? ` · ${totalPrioridadeAlta} com prioridade alta` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 bg-amx-panel border border-amx-line rounded-lg px-3.5 py-2 w-60">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-amx-muted)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar condomínio, técnico..."
                className="bg-transparent outline-none text-[13px] text-white placeholder:text-amx-muted flex-1 min-w-0"
              />
            </div>
            {user && canManageOS(user.role) && (
              <Button onClick={() => setShowCreate(true)}>+ Nova OS</Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {FILTROS_TIPO.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTipoFiltro(f.value)}
              className={`font-heading text-[11px] font-semibold tracking-wider uppercase px-3.5 py-1.5 rounded-full transition-colors ${
                tipoFiltro === f.value ? 'bg-amx-red text-white' : 'border border-amx-line text-amx-muted hover:text-white'
              }`}
            >
              {f.label} · {f.count}
            </button>
          ))}
          {condominios.length > 1 && (
            <Select value={condominioFiltro} onChange={(e) => setCondominioFiltro(e.target.value)} className="w-auto py-1.5 text-xs">
              <option value="todos">Todos os condomínios</option>
              {condominios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          )}
          <div className="flex items-center gap-1 ml-auto">
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
                  statusFiltro === value ? 'bg-amx-panel-2 text-white border border-amx-line' : 'text-amx-muted hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 mx-8 mt-4 rounded-lg px-3 py-2">{error}</p>
      )}

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
        <>
          {/* LIST HEADER */}
          <div className={`hidden md:grid ${ROW_GRID} gap-4 px-8 pt-4 pb-2 font-heading text-[11px] tracking-wider text-amx-muted`}>
            <div />
            <div>CONDOMÍNIO</div>
            <div>STATUS</div>
            <div>PRIORIDADE</div>
            <div>TÉCNICO</div>
            <div>ABERTA HÁ</div>
            <div />
          </div>

          <div className="flex-1 overflow-auto px-8 pb-6 flex flex-col gap-2">
            {ordenadas.map((os) => (
              <OsRow
                key={os.id}
                os={os}
                condominioNome={condominioNome(os.condominio_id)}
                tecnicoNome={tecnicoNome(os.tecnico_id)}
                onClick={() => setSelectedOsId(os.id)}
              />
            ))}
          </div>
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} maxWidth="max-w-md">
        <NovaOsForm
          condominios={condominios}
          tecnicos={tecnicos}
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

const TIPO_ICON: Record<OsTipo, React.ReactNode> = {
  // Chave inglesa — corretiva (equipamento já com problema)
  corretiva: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  // Prancheta com check — preventiva (rotina programada)
  preventiva: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M9 16l2 2 4-4" />
    </>
  ),
};
const TIPO_ICON_COLOR: Record<OsTipo, string> = { preventiva: 'var(--color-amx-blue)', corretiva: 'var(--color-amx-red)' };
const TIPO_BORDA: Record<OsTipo, string> = { preventiva: 'border-l-amx-blue', corretiva: 'border-l-amx-red' };
const STATUS_TONE: Record<OsStatus, BadgeTone> = {
  aberta: 'info',
  em_andamento: 'warning',
  finalizada: 'success',
  cancelada: 'neutral',
};
const PRIORIDADE_DOT: Record<OsPrioridade, string> = {
  urgente: 'bg-amx-red',
  alta: 'bg-amx-red',
  normal: 'bg-amx-blue',
  baixa: 'bg-amx-blue',
};

function OsRow({
  os,
  condominioNome,
  tecnicoNome,
  onClick,
}: {
  os: OS;
  condominioNome: string;
  tecnicoNome?: string;
  onClick: () => void;
}) {
  const prioridade = computeOsPrioridade(os);
  const encerrada = os.status === 'finalizada' || os.status === 'cancelada';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className={`grid ${ROW_GRID} gap-4 items-center bg-amx-panel border border-amx-line border-l-[3px] ${TIPO_BORDA[os.tipo]} rounded-[10px] py-3.5 px-3 pl-4 cursor-pointer hover:border-amx-muted transition-colors ${
        encerrada ? 'opacity-75' : ''
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TIPO_ICON_COLOR[os.tipo]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {TIPO_ICON[os.tipo]}
      </svg>

      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white truncate">{condominioNome}</p>
          {os.origem === 'hermes_automatica' && <Badge tone="navy">🤖 Hermes</Badge>}
        </div>
        {os.observacao && <p className="text-xs text-amx-muted truncate mt-0.5">{os.observacao}</p>}
      </div>

      <div>
        <Badge tone={STATUS_TONE[os.status]}>{OS_STATUS_LABELS[os.status]}</Badge>
      </div>

      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${PRIORIDADE_DOT[prioridade.nivel]}`} aria-hidden />
        <span className="text-xs text-white">{prioridade.label}</span>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {os.tecnico_id ? (
          <>
            <span
              className={`w-[26px] h-[26px] rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white ${avatarTone(os.tecnico_id)}`}
            >
              {tecnicoNome ? initials(tecnicoNome) : '?'}
            </span>
            <span className="text-xs text-white truncate">{tecnicoNome || 'Técnico'}</span>
          </>
        ) : (
          <span className="text-xs text-amx-muted">Não atribuído</span>
        )}
      </div>

      <div className="text-xs text-amx-muted">{prioridade.elapsedLabel}</div>

      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-amx-muted)" strokeWidth="2" strokeLinecap="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </div>
  );
}

function NovaOsForm({
  condominios,
  tecnicos,
  onClose,
  onCreated,
}: {
  condominios: Condominio[];
  tecnicos: TecnicoLite[];
  onClose: () => void;
  onCreated: (os: OS) => void;
}) {
  const [condominioId, setCondominioId] = useState(condominios[0]?.id || '');
  const [tipo, setTipo] = useState<OsTipo>('preventiva');
  // Vazio = deixa o backend aplicar o padrão por tipo (corretiva nasce alta,
  // preventiva média — ver Database.createOS em src/lib/db.ts).
  const [prioridade, setPrioridade] = useState<'' | OsPrioridadeManual>('');
  const [tecnicoId, setTecnicoId] = useState('');
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
        body: JSON.stringify({
          condominio_id: condominioId,
          tipo,
          prioridade: prioridade || undefined,
          tecnico_id: tecnicoId || undefined,
          observacao: observacao || undefined,
        }),
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
        <Field
          label="Prioridade"
          hint="Padrão por tipo: corretiva nasce alta, preventiva média. Tipo/origem/tempo em aberto ainda podem escalar a exibição pra cima."
        >
          <Select value={prioridade} onChange={(e) => setPrioridade(e.target.value as '' | OsPrioridadeManual)}>
            <option value="">Padrão do tipo</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </Select>
        </Field>
        <Field label="Técnico responsável" hint="Opcional — pode ser atribuído depois">
          <Select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
            <option value="">Não atribuído</option>
            {tecnicos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Observação" hint="Opcional — contexto inicial do serviço">
          <Textarea rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Field>
        {error && <p className="text-xs font-semibold text-amx-red-hover">{error}</p>}
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
