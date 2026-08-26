'use client';

import React, { useEffect, useState } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Field, Input } from '@/components/ui/Form';
import { SignaturePad } from '@/components/os/SignaturePad';
import { FotoUpload } from '@/components/os/FotoUpload';
import { HistoricoPanel } from '@/components/os/HistoricoPanel';
import { useAmxUser } from '@/components/layout/AppShell';
import { canFinalizeOS, canManageOS } from '@/lib/permissions';
import { computeOsPrioridade, OS_STATUS_LABELS, OS_TIPO_LABELS } from '@/lib/os-priority';
import type { AuditLog, ChecklistItem, Foto, OS } from '@/lib/db';

type Tab = 'checklist' | 'fotos' | 'assinaturas' | 'historico';

export function OSModal({
  osId,
  condominioNome,
  onClose,
  onChanged,
}: {
  osId: string;
  condominioNome: string;
  onClose: () => void;
  onChanged: (os: OS) => void;
}) {
  const user = useAmxUser();
  const canManage = !!user && canManageOS(user.role);
  const canFinalize = !!user && canFinalizeOS(user.role);

  const [os, setOs] = useState<OS | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('checklist');
  const [actionError, setActionError] = useState('');

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(true);

  const [fotos, setFotos] = useState<Foto[]>([]);
  const [fotosLoaded, setFotosLoaded] = useState(false);
  const [fotosLoading, setFotosLoading] = useState(false);
  const [uploadingMomento, setUploadingMomento] = useState<'antes' | 'depois' | null>(null);

  const [historico, setHistorico] = useState<AuditLog[]>([]);
  const [historicoLoaded, setHistoricoLoaded] = useState(false);
  const [historicoLoading, setHistoricoLoading] = useState(false);

  const [savingSignature, setSavingSignature] = useState<'tecnico' | 'zelador' | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // OS + checklist carregam de cara — o checklist decide se o botão de
  // finalizar aparece habilitado mesmo antes de abrir a aba correspondente.
  useEffect(() => {
    let cancelled = false;
    // Sem setLoading(true)/setLoadError('') aqui: o pai monta este modal com
    // key={osId} (ver src/app/page.tsx), então cada troca de OS já remonta o
    // componente do zero com os valores iniciais de useState (true/'').
    Promise.all([
      fetch(`/api/os/${osId}`, { cache: 'no-store' }),
      fetch(`/api/os/${osId}/checklist`, { cache: 'no-store' }),
    ])
      .then(async ([osRes, checklistRes]) => {
        if (cancelled) return;
        if (osRes.ok) {
          const data = await osRes.json();
          setOs(data.os);
        } else {
          const data = await osRes.json().catch(() => ({}));
          setLoadError(data.error || 'Não foi possível carregar esta OS.');
        }
        if (checklistRes.ok) {
          const data = await checklistRes.json();
          setChecklist(data.checklist || []);
        }
        setChecklistLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Erro de conexão ao carregar a OS.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [osId]);

  useEffect(() => {
    if (tab === 'fotos' && !fotosLoaded) {
      // Carregamento lazy disparado por troca de aba, não pelo mount do
      // efeito — não dá pra resolver com valor inicial de useState (a aba
      // pode ser aberta bem depois do mount).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFotosLoading(true);
      fetch(`/api/os/${osId}/fotos`, { cache: 'no-store' })
        .then(async (r) => {
          if (r.ok) {
            const data = await r.json();
            setFotos(data.fotos || []);
          }
        })
        .finally(() => {
          setFotosLoading(false);
          setFotosLoaded(true);
        });
    }
    if (tab === 'historico' && !historicoLoaded) {
      setHistoricoLoading(true);
      fetch(`/api/os/${osId}/historico`, { cache: 'no-store' })
        .then(async (r) => {
          if (r.ok) {
            const data = await r.json();
            setHistorico(data.logs || []);
          }
        })
        .finally(() => {
          setHistoricoLoading(false);
          setHistoricoLoaded(true);
        });
    }
  }, [tab, osId, fotosLoaded, historicoLoaded]);

  const isClosed = os?.status === 'finalizada' || os?.status === 'cancelada';
  const itensObrigatoriosPendentes = checklist.filter((i) => i.obrigatorio && !i.concluido);
  const podeFinalizar = canFinalize && !isClosed && itensObrigatoriosPendentes.length === 0;

  const toggleChecklistItem = async (item: ChecklistItem) => {
    setActionError('');
    const novoValor = !item.concluido;
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: novoValor } : i)));
    try {
      const res = await fetch(`/api/checklist/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concluido: novoValor }),
      });
      if (!res.ok) {
        // Reverte otimismo se o servidor recusar (ex.: OS já finalizada).
        setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: item.concluido } : i)));
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || 'Falha ao atualizar item do checklist.');
      }
    } catch {
      setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: item.concluido } : i)));
      setActionError('Erro de conexão ao atualizar checklist.');
    }
  };

  const addChecklistItem = async (descricao: string, obrigatorio: boolean) => {
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descricao, obrigatorio }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.item) {
        setChecklist((prev) => [...prev, data.item]);
      } else {
        setActionError(data.error || 'Falha ao adicionar item.');
      }
    } catch {
      setActionError('Erro de conexão ao adicionar item.');
    }
  };

  const iniciarAtendimento = async () => {
    if (!os) return;
    setBusyAction(true);
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'em_andamento' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        setActionError(data.error || 'Falha ao iniciar atendimento.');
      }
    } catch {
      setActionError('Erro de conexão.');
    } finally {
      setBusyAction(false);
    }
  };

  const finalizar = async () => {
    if (!podeFinalizar) return;
    setBusyAction(true);
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}/finalizar`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        // Mesma mensagem da trava de qualidade do backend
        // (Database.finalizarOS em src/lib/db.ts) quando a corrida entre
        // duas abas deixar passar um item obrigatório pendente.
        setActionError(data.error || 'Falha ao finalizar OS.');
      }
    } catch {
      setActionError('Erro de conexão.');
    } finally {
      setBusyAction(false);
    }
  };

  const uploadFoto = async (momento: 'antes' | 'depois', file: File) => {
    setUploadingMomento(momento);
    setActionError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('momento', momento);
      const res = await fetch(`/api/os/${osId}/fotos`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.foto) {
        setFotos((prev) => [...prev, data.foto]);
      } else {
        setActionError(data.error || 'Falha ao enviar foto.');
      }
    } catch {
      setActionError('Erro de conexão ao enviar foto.');
    } finally {
      setUploadingMomento(null);
    }
  };

  const saveAssinatura = async (papel: 'tecnico' | 'zelador', dataUrl: string) => {
    setSavingSignature(papel);
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}/assinatura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ papel, dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        setActionError(data.error || 'Falha ao salvar assinatura.');
      }
    } catch {
      setActionError('Erro de conexão ao salvar assinatura.');
    } finally {
      setSavingSignature(null);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !os ? (
        <>
          <ModalHeader title="Ordem de Serviço" onClose={onClose} />
          <div className="p-5">
            <EmptyState title="Não foi possível abrir esta OS" description={loadError || undefined} />
          </div>
        </>
      ) : (
        <>
          <ModalHeader
            title={condominioNome || 'Ordem de Serviço'}
            subtitle={`Aberta em ${new Date(os.criado_em).toLocaleString('pt-BR')}`}
            onClose={onClose}
          />
          <div className="p-5 flex flex-col gap-4">
            <OsSummary os={os} />

            {actionError && (
              <p className="text-xs font-semibold text-amx-red-600 bg-amx-red-50 rounded-lg px-3 py-2">{actionError}</p>
            )}

            {canManage && !isClosed && (
              <div className="flex items-center gap-2 flex-wrap">
                {os.status === 'aberta' && (
                  <Button size="sm" variant="secondary" onClick={iniciarAtendimento} disabled={busyAction}>
                    Iniciar atendimento
                  </Button>
                )}
                {canFinalize && (
                  <div className="flex flex-col gap-1">
                    <Button size="sm" onClick={finalizar} disabled={!podeFinalizar || busyAction}>
                      {busyAction ? 'Finalizando...' : 'Finalizar OS'}
                    </Button>
                    {itensObrigatoriosPendentes.length > 0 && (
                      <p className="text-[11px] font-semibold text-amx-red-600">
                        {itensObrigatoriosPendentes.length} item(ns) obrigatório(s) do checklist ainda pendente(s).
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 bg-amx-canvas border border-amx-border rounded-full p-1 w-fit">
              {(
                [
                  ['checklist', `Checklist${checklist.length ? ` (${checklist.length})` : ''}`],
                  ['fotos', 'Fotos'],
                  ['assinaturas', 'Assinaturas'],
                  ['historico', 'Histórico'],
                ] as [Tab, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    tab === value ? 'bg-amx-navy-800 text-white' : 'text-amx-muted hover:bg-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'checklist' && (
              <ChecklistTab
                items={checklist}
                loading={checklistLoading}
                readOnly={!canManage || isClosed}
                onToggle={toggleChecklistItem}
                onAdd={addChecklistItem}
              />
            )}

            {tab === 'fotos' &&
              (fotosLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner className="h-5 w-5" />
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <FotoUpload
                    momento="antes"
                    fotos={fotos.filter((f) => f.momento === 'antes')}
                    onUpload={(file) => uploadFoto('antes', file)}
                    disabled={!canManage || isClosed}
                    busy={uploadingMomento === 'antes'}
                  />
                  <FotoUpload
                    momento="depois"
                    fotos={fotos.filter((f) => f.momento === 'depois')}
                    onUpload={(file) => uploadFoto('depois', file)}
                    disabled={!canManage || isClosed}
                    busy={uploadingMomento === 'depois'}
                  />
                </div>
              ))}

            {tab === 'assinaturas' && (
              <div className="flex flex-col gap-5">
                <SignaturePad
                  label="Assinatura do técnico"
                  value={os.assinatura_tecnico_url}
                  onSave={(dataUrl) => saveAssinatura('tecnico', dataUrl)}
                  disabled={!canManage || isClosed}
                  busy={savingSignature === 'tecnico'}
                />
                <SignaturePad
                  label="Assinatura do zelador"
                  value={os.assinatura_zelador_url}
                  onSave={(dataUrl) => saveAssinatura('zelador', dataUrl)}
                  disabled={!canManage || isClosed}
                  busy={savingSignature === 'zelador'}
                />
              </div>
            )}

            {tab === 'historico' && <HistoricoPanel logs={historico} loading={historicoLoading} />}
          </div>
        </>
      )}
    </Modal>
  );
}

function OsSummary({ os }: { os: OS }) {
  const prioridade = computeOsPrioridade(os);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={os.tipo === 'corretiva' ? 'red' : 'info'}>{OS_TIPO_LABELS[os.tipo]}</Badge>
      <Badge tone={prioridade.tone}>{prioridade.label}</Badge>
      <Badge tone={os.status === 'finalizada' ? 'success' : 'neutral'}>{OS_STATUS_LABELS[os.status]}</Badge>
      {os.origem === 'hermes_automatica' && <Badge tone="navy">🤖 Aberta automaticamente pelo Hermes</Badge>}
    </div>
  );
}

function ChecklistTab({
  items,
  loading,
  readOnly,
  onToggle,
  onAdd,
}: {
  items: ChecklistItem[];
  loading: boolean;
  readOnly: boolean;
  onToggle: (item: ChecklistItem) => void;
  onAdd: (descricao: string, obrigatorio: boolean) => void;
}) {
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novoObrigatorio, setNovoObrigatorio] = useState(true);
  const [adding, setAdding] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaDescricao.trim()) return;
    setAdding(true);
    await onAdd(novaDescricao.trim(), novoObrigatorio);
    setNovaDescricao('');
    setNovoObrigatorio(true);
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <EmptyState title="Checklist vazio" description="Nenhum item cadastrado para esta OS ainda." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2.5 bg-white border border-amx-border rounded-lg px-3 py-2.5"
            >
              <input
                type="checkbox"
                checked={item.concluido}
                disabled={readOnly}
                onChange={() => onToggle(item)}
                className="mt-0.5 accent-amx-navy-700 disabled:opacity-50"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.concluido ? 'text-amx-muted line-through' : 'text-amx-ink font-medium'}`}>
                  {item.descricao}
                </p>
              </div>
              {item.obrigatorio && !item.concluido && <Badge tone="red">Obrigatório</Badge>}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={handleAdd} className="flex items-end gap-2 flex-wrap bg-amx-canvas rounded-lg p-3">
          <Field label="Novo item do checklist" hint="Ex.: Verificar nível da caixa d'água">
            <Input
              value={novaDescricao}
              onChange={(e) => setNovaDescricao(e.target.value)}
              placeholder="Descrição do item"
              className="w-64"
            />
          </Field>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-amx-ink pb-2.5">
            <input
              type="checkbox"
              checked={novoObrigatorio}
              onChange={(e) => setNovoObrigatorio(e.target.checked)}
              className="accent-amx-navy-700"
            />
            Obrigatório
          </label>
          <Button type="submit" size="sm" disabled={adding || !novaDescricao.trim()}>
            + Adicionar
          </Button>
        </form>
      )}
    </div>
  );
}
