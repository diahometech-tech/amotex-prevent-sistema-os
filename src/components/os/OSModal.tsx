'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { SignaturePad } from '@/components/os/SignaturePad';
import { FotoUpload } from '@/components/os/FotoUpload';
import { HistoricoPanel } from '@/components/os/HistoricoPanel';
import { useAmxUser } from '@/components/layout/AppShell';
import { canFinalizeOS, canManageOS } from '@/lib/permissions';
import { computeOsPrioridade, OS_STATUS_LABELS, OS_TIPO_LABELS } from '@/lib/os-priority';
import { pendenciasFinalizacao } from '@/lib/os-finalizacao';
import { formatarDataCurta } from '@/lib/os-agenda';
import { slaChegada } from '@/lib/os-sla';
import { textoAviso, type ResultadoAviso } from '@/lib/aviso';
import { useTick } from '@/lib/useTick';
import { enfileirar, ouvirFila } from '@/lib/fila-envio';
import { useFilaEnvio } from '@/lib/useFilaEnvio';
import { fotoReduzidaDataUrl } from '@/lib/imagem-cliente';
import { itensComFotoObrigatoria, nomeEquipamentoDoItem } from '@/lib/os-finalizacao';
import type { AuditLog, ChecklistItem, Foto, OS } from '@/lib/db';
import type { VinculosOS } from '@/lib/os-vinculos';

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
  useTick();
  const canManage = !!user && canManageOS(user.role);
  const [avisoMsg, setAvisoMsg] = useState<{ texto: string; ok: boolean } | null>(null);
  const canFinalize = !!user && canFinalizeOS(user.role);

  const [os, setOs] = useState<OS | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('checklist');
  const [actionError, setActionError] = useState('');

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [historico, setHistorico] = useState<AuditLog[]>([]);
  const [vinculos, setVinculos] = useState<VinculosOS | null>(null);
  const [tecnicos, setTecnicos] = useState<{ id: string; nome: string }[]>([]);

  const [uploadingMomento, setUploadingMomento] = useState<'antes' | 'depois' | null>(null);
  const [savingSignature, setSavingSignature] = useState<'tecnico' | 'zelador' | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // Fila de envio offline (src/lib/fila-envio.ts): foto e assinatura entram
  // primeiro no aparelho e sobem sozinhas quando houver rede. O que já subiu
  // chega aqui pelo evento e entra na tela sem recarregar a OS.
  const fila = useFilaEnvio(osId);
  const fotosPendentes = fila.flatMap((i) => (i.tipo === 'foto' ? [i] : []));
  const assinaturaPendente = (papel: 'tecnico' | 'zelador') =>
    fila.find((i) => i.tipo === 'assinatura' && i.papel === papel && !i.recusado);
  const aguardandoEnvio = fila.filter((i) => !i.recusado).length;
  // Quem usa o modal passa onChanged inline; o ref evita reinscrever a cada render.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  useEffect(
    () =>
      ouvirFila((e) => {
        if (e.tipo === 'foto_enviada' && e.foto.os_id === osId) {
          setFotos((prev) => (prev.some((f) => f.id === e.foto.id) ? prev : [...prev, e.foto]));
        }
        if (e.tipo === 'assinatura_enviada' && e.os.id === osId) {
          setOs(e.os);
          onChangedRef.current(e.os);
        }
      }),
    [osId]
  );

  // GET /api/os/:id já retorna os, checklist, fotos e histórico (logs) num
  // único payload (ver src/app/api/os/[id]/route.ts) — não existem rotas
  // GET separadas por aba, então uma chamada só basta.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/os/${osId}`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setOs(data.os);
          setChecklist(data.checklist || []);
          setFotos(data.fotos || []);
          setHistorico(data.logs || []);
          setVinculos(data.vinculos || null);
        } else {
          const data = await res.json().catch(() => ({}));
          setLoadError(data.error || 'Não foi possível carregar esta OS.');
        }
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

  // Diretório de técnicos pro bloco de agendamento. Mesmo cuidado de
  // src/app/page.tsx: técnico recebe {id, nome} sem `papel`.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    fetch('/api/users', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const users: { id: string; nome: string; papel?: string }[] = data.users || [];
        setTecnicos(users.filter((u) => u.papel === undefined || u.papel === 'tecnico'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const isClosed = os?.status === 'finalizada' || os?.status === 'cancelada';
  // Mesma função que o backend usa em Database.finalizarOS — o botão trava
  // exatamente pelo que o servidor recusaria.
  // Envio ainda no aparelho também trava: o PDF sairia sem aquela foto.
  const pendencias = os
    ? [
        ...pendenciasFinalizacao({ os, checklist, fotos }),
        ...(aguardandoEnvio > 0 ? [`${aguardandoEnvio} envio(s) aguardando rede — finalize depois que subirem`] : []),
      ]
    : [];
  const podeFinalizar = canFinalize && !isClosed && pendencias.length === 0;

  // Agendamento (data da visita / técnico) — PATCH simples de um campo.
  const salvarAgendamento = async (campo: 'data_programada' | 'tecnico_id', valor: string) => {
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
        setAvisoMsg(data.aviso ? textoAviso(data.aviso) : null);
      } else {
        setActionError(data.error || 'Falha ao salvar o agendamento.');
      }
    } catch {
      setActionError('Erro de conexão ao salvar o agendamento.');
    }
  };

  // API só marca item como concluído (Database.concluirChecklistItem é uma
  // via só de ida — ver src/lib/db.ts) — não existe "desmarcar" no backend.
  const concluirChecklistItem = async (item: ChecklistItem) => {
    if (item.concluido) return;
    setActionError('');
    setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: true } : i)));
    try {
      const res = await fetch(`/api/os/${osId}/checklist/${item.id}`, { method: 'PATCH' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.item) {
        setChecklist((prev) => prev.map((i) => (i.id === item.id ? data.item : i)));
      } else {
        setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: false } : i)));
        setActionError(data.error || 'Falha ao concluir item do checklist.');
      }
    } catch {
      setChecklist((prev) => prev.map((i) => (i.id === item.id ? { ...i, concluido: false } : i)));
      setActionError('Erro de conexão ao concluir item.');
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

  // Finalizar não é uma rota própria — é PATCH /api/os/:id com
  // { finalizar: true } (a trava de qualidade roda dentro de
  // Database.finalizarOS e volta 422 se algo obrigatório ficou pendente).
  const finalizar = async () => {
    if (!podeFinalizar) return;
    setBusyAction(true);
    setActionError('');
    try {
      const res = await fetch(`/api/os/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalizar: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        setOs(data.os);
        onChanged(data.os);
      } else {
        setActionError(data.error || 'Falha ao finalizar OS.');
      }
    } catch {
      setActionError('Erro de conexão.');
    } finally {
      setBusyAction(false);
    }
  };

  // A foto é reduzida no aparelho (1600 px — foto de celular sai com 4–8 MB,
  // pesada demais no 4G) e vai pra fila de envio, que guarda no aparelho
  // antes de mandar (POST /api/os/:id/fotos). Sem sinal, ela aparece como
  // "aguardando" e sobe sozinha.
  const uploadFoto = async (momento: 'antes' | 'depois', file: File, equipamento_id?: string) => {
    setUploadingMomento(momento);
    setActionError('');
    try {
      const data = await fotoReduzidaDataUrl(file);
      await enfileirar({ tipo: 'foto', os_id: osId, momento, data, ...(equipamento_id ? { equipamento_id } : {}) });
    } catch {
      setActionError('Não foi possível ler a foto. Tente tirar de novo.');
    } finally {
      setUploadingMomento(null);
    }
  };

  // Assinatura é PATCH /api/os/:id com assinatura_zelador/assinatura_tecnico
  // (data URL) — também passa pela fila de envio.
  const saveAssinatura = async (papel: 'tecnico' | 'zelador', dataUrl: string) => {
    setSavingSignature(papel);
    setActionError('');
    try {
      await enfileirar({ tipo: 'assinatura', os_id: osId, papel, data: dataUrl });
    } catch {
      setActionError('Não foi possível guardar a assinatura. Tente de novo.');
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
            subtitle={`OS #${os.id.slice(0, 6).toUpperCase()} · ${OS_TIPO_LABELS[os.tipo].toUpperCase()} · aberta em ${new Date(os.criado_em).toLocaleString('pt-BR')}`}
            onClose={onClose}
          />
          <div className="p-5 flex flex-col gap-4">
            <OsSummary os={os} />

            {(os.descricao_problema || os.solicitante_nome || os.solicitante_telefone) && (
              <div className="rounded-lg border border-amx-red/40 bg-amx-red/5 px-3.5 py-3 flex flex-col gap-1">
                <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-red-hover">CHAMADO</p>
                {os.descricao_problema && <p className="text-[13px] text-white">{os.descricao_problema}</p>}
                {(os.solicitante_nome || os.solicitante_telefone) && (
                  <p className="text-xs text-amx-muted">
                    {[os.solicitante_nome, os.solicitante_telefone].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            )}

            {os.observacao && <p className="text-[13px] text-amx-muted">{os.observacao}</p>}

            <SlaBox os={os} />

            {canManage && !isClosed && !os.tecnico_id && user?.role === 'tecnico' && (
              <Button size="sm" onClick={() => salvarAgendamento('tecnico_id', user.id)} className="w-fit">
                Assumir esta OS
              </Button>
            )}

            {avisoMsg && (
              <p
                className={`text-xs font-semibold rounded-lg px-3 py-2 ${
                  avisoMsg.ok ? 'text-amx-green bg-amx-green/10' : 'text-amx-amber bg-amx-amber/10'
                }`}
              >
                {avisoMsg.texto}
              </p>
            )}

            {canManage && !isClosed ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Data da visita">
                  <Input
                    id="os-data-programada"
                    type="date"
                    value={os.data_programada || ''}
                    onChange={(e) => salvarAgendamento('data_programada', e.target.value)}
                  />
                </Field>
                <Field label="Técnico responsável">
                  <Select id="os-tecnico" value={os.tecnico_id || ''} onChange={(e) => salvarAgendamento('tecnico_id', e.target.value)}>
                    <option value="">Não atribuído</option>
                    {tecnicos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : (
              os.data_programada && (
                <p className="text-xs text-amx-muted">Visita agendada: {formatarDataCurta(os.data_programada)}</p>
              )
            )}

            {vinculos?.origem && (
              <a
                href={`/?os=${vinculos.origem.id}`}
                className="text-xs font-semibold text-amx-blue-light hover:text-white transition-colors w-fit"
              >
                ↩ Aberta durante a preventiva #{vinculos.origem.id.slice(0, 6).toUpperCase()}
              </a>
            )}
            {vinculos?.equipamento && (
              <p className="text-xs text-amx-muted">
                Equipamento:{' '}
                <span className="text-white">
                  {[vinculos.equipamento.tipo, vinculos.equipamento.identificacao, vinculos.equipamento.modelo]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
            )}
            {os.tipo === 'preventiva' && (
              <CorretivasDaPreventiva
                os={os}
                checklist={checklist}
                corretivas={vinculos?.corretivas ?? []}
                podeAbrir={canManage && os.status !== 'cancelada'}
                tecnicoId={user?.role === 'tecnico' ? user.id : undefined}
                onAberta={(nova, aviso) => {
                  setVinculos((v) => ({
                    origem: v?.origem ?? null,
                    equipamento: v?.equipamento ?? null,
                    corretivas: [...(v?.corretivas ?? []), nova],
                  }));
                  setAvisoMsg(aviso ? textoAviso(aviso) : null);
                }}
              />
            )}

            {os.pdf_url && (
              <a
                href={os.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amx-muted hover:text-white transition-colors w-fit"
              >
                📄 Baixar PDF da OS
              </a>
            )}

            {actionError && (
              <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{actionError}</p>
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
                    {pendencias.length > 0 && (
                      <ul className="text-[11px] font-semibold text-amx-amber list-disc pl-4">
                        {pendencias.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 bg-amx-panel-2 border border-amx-line rounded-full p-1 w-fit">
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
                    tab === value ? 'bg-amx-red text-white' : 'text-amx-muted hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'checklist' && (
              <ChecklistTab
                items={checklist}
                readOnly={!canManage || isClosed}
                onConcluir={concluirChecklistItem}
                onAdd={addChecklistItem}
                fotoObrigatoria={new Set(itensComFotoObrigatoria(os, checklist).map((i) => i.equipamento_id))}
                fotosEquip={fotos.filter((f) => f.equipamento_id)}
                pendentesEquip={fotosPendentes.filter((p) => p.equipamento_id)}
                onFotoEquip={(equipamentoId, file) => uploadFoto('depois', file, equipamentoId)}
              />
            )}

            {tab === 'fotos' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <FotoUpload
                  momento="antes"
                  fotos={fotos.filter((f) => f.momento === 'antes' && !f.equipamento_id)}
                  pendentes={fotosPendentes.filter((p) => p.momento === 'antes' && !p.equipamento_id)}
                  onUpload={(file) => uploadFoto('antes', file)}
                  disabled={!canManage || isClosed}
                  busy={uploadingMomento === 'antes'}
                />
                <FotoUpload
                  momento="depois"
                  fotos={fotos.filter((f) => f.momento === 'depois' && !f.equipamento_id)}
                  pendentes={fotosPendentes.filter((p) => p.momento === 'depois' && !p.equipamento_id)}
                  onUpload={(file) => uploadFoto('depois', file)}
                  disabled={!canManage || isClosed}
                  busy={uploadingMomento === 'depois'}
                />
              </div>
            )}

            {tab === 'assinaturas' && (
              <div className="flex flex-col gap-5">
                <SignaturePad
                  label="Assinatura do técnico"
                  value={assinaturaPendente('tecnico')?.data ?? os.assinatura_tecnico_url}
                  pendente={!!assinaturaPendente('tecnico')}
                  onSave={(dataUrl) => saveAssinatura('tecnico', dataUrl)}
                  disabled={!canManage || isClosed}
                  busy={savingSignature === 'tecnico'}
                />
                <SignaturePad
                  label="Assinatura do zelador"
                  value={assinaturaPendente('zelador')?.data ?? os.assinatura_zelador_url}
                  pendente={!!assinaturaPendente('zelador')}
                  onSave={(dataUrl) => saveAssinatura('zelador', dataUrl)}
                  disabled={!canManage || isClosed}
                  busy={savingSignature === 'zelador'}
                />
              </div>
            )}

            {tab === 'historico' && <HistoricoPanel logs={historico} />}
          </div>
        </>
      )}
    </Modal>
  );
}

// Pedido 10: durante a preventiva o técnico acha um defeito (ex.: bomba que
// precisa ir pra oficina) e abre a corretiva ali mesmo, já ligada à
// preventiva e ao equipamento. A corretiva segue o fluxo normal (prazo de 3h,
// aviso no Telegram); "Eu mesmo vou atender" já atribui a quem abriu.
function CorretivasDaPreventiva({
  os,
  checklist,
  corretivas,
  podeAbrir,
  tecnicoId,
  onAberta,
}: {
  os: OS;
  checklist: ChecklistItem[];
  corretivas: VinculosOS['corretivas'];
  podeAbrir: boolean;
  tecnicoId?: string;
  onAberta: (nova: VinculosOS['corretivas'][number], aviso?: ResultadoAviso) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [equipamentoId, setEquipamentoId] = useState('');
  const [problema, setProblema] = useState('');
  const [euAtendo, setEuAtendo] = useState(!!tecnicoId);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const equipamentos = checklist.filter((i, idx, arr) => i.equipamento_id && arr.findIndex((j) => j.equipamento_id === i.equipamento_id) === idx);

  const abrir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problema.trim()) return;
    setSalvando(true);
    setErro('');
    try {
      const res = await fetch('/api/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          condominio_id: os.condominio_id,
          tipo: 'corretiva',
          os_origem_id: os.id,
          equipamento_id: equipamentoId || undefined,
          descricao_problema: problema.trim(),
          observacao: `Aberta durante a preventiva #${os.id.slice(0, 6).toUpperCase()}`,
          tecnico_id: euAtendo && tecnicoId ? tecnicoId : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        onAberta(
          {
            id: data.os.id,
            status: data.os.status,
            descricao_problema: data.os.descricao_problema,
            equipamento_id: data.os.equipamento_id,
            criado_em: data.os.criado_em,
          },
          data.aviso
        );
        setAberto(false);
        setProblema('');
        setEquipamentoId('');
      } else {
        setErro(data.error || 'Não foi possível abrir a corretiva.');
      }
    } catch {
      setErro('Sem conexão: a corretiva precisa de rede para ser aberta. Tente de novo quando o sinal voltar.');
    } finally {
      setSalvando(false);
    }
  };

  if (!podeAbrir && corretivas.length === 0) return null;

  return (
    <div className="rounded-lg border border-amx-line bg-amx-panel-2 px-3.5 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted">
          CORRETIVAS ABERTAS NESTA PREVENTIVA{corretivas.length ? ` (${corretivas.length})` : ''}
        </p>
        {podeAbrir && !aberto && (
          <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
            + Abrir corretiva
          </Button>
        )}
      </div>
      {corretivas.map((c) => (
        <a
          key={c.id}
          href={`/?os=${c.id}`}
          className="text-xs text-white hover:text-amx-blue-light transition-colors flex items-center gap-2"
        >
          <Badge tone={c.status === 'finalizada' ? 'success' : 'red'}>{OS_STATUS_LABELS[c.status]}</Badge>
          <span>
            #{c.id.slice(0, 6).toUpperCase()} — {c.descricao_problema || 'sem descrição'}
            {c.equipamento_id && (() => {
              const item = equipamentos.find((i) => i.equipamento_id === c.equipamento_id);
              return item ? ` · ${nomeEquipamentoDoItem(item.descricao)}` : '';
            })()}
          </span>
        </a>
      ))}
      {aberto && (
        <form onSubmit={abrir} className="flex flex-col gap-2.5 pt-1">
          {equipamentos.length > 0 && (
            <Field label="Equipamento com defeito">
              <Select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)}>
                <option value="">Nenhum específico</option>
                {equipamentos.map((i) => (
                  <option key={i.equipamento_id} value={i.equipamento_id}>
                    {nomeEquipamentoDoItem(i.descricao)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="O que foi encontrado" hint="Ex.: bomba 2 com selo vazando, precisa ir para a oficina">
            <Textarea value={problema} onChange={(e) => setProblema(e.target.value)} rows={2} required />
          </Field>
          {tecnicoId && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <input type="checkbox" checked={euAtendo} onChange={(e) => setEuAtendo(e.target.checked)} className="accent-amx-red" />
              Eu mesmo vou atender
            </label>
          )}
          {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={salvando || !problema.trim()}>
              {salvando ? 'Abrindo…' : 'Abrir corretiva'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function SlaBox({ os }: { os: OS }) {
  const sla = slaChegada(os);
  if (!sla) return null;
  const cor =
    sla.tone === 'red'
      ? 'border-amx-red bg-amx-red/10 text-amx-red-hover'
      : sla.tone === 'success'
        ? 'border-amx-green/50 bg-amx-green/10 text-amx-green'
        : 'border-amx-amber/50 bg-amx-amber/10 text-amx-amber';
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 text-[13px] font-semibold ${cor}`}>
      ⏱ Prazo de chegada (3h): {sla.label}
    </div>
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

// Foto de um equipamento do checklist (pedido 8). Na preventiva é
// obrigatória — sem ela a OS não finaliza (src/lib/os-finalizacao.ts).
function FotoEquipamento({
  obrigatoria,
  fotos,
  pendentes,
  readOnly,
  onFoto,
}: {
  obrigatoria: boolean;
  fotos: Foto[];
  pendentes: { id: string; data: string; recusado?: boolean; erro?: string }[];
  readOnly: boolean;
  onFoto: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const tem = fotos.length + pendentes.length > 0;
  if (readOnly && !tem) return null;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {fotos.map((f) => (
        <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer">
          <img src={f.url} alt="Foto do equipamento" className="w-9 h-9 rounded-md object-cover border border-amx-line" />
        </a>
      ))}
      {pendentes.map((p) => (
        <img
          key={p.id}
          src={p.data}
          alt="Foto aguardando envio"
          title={p.recusado ? p.erro : 'Aguardando envio'}
          className={`w-9 h-9 rounded-md object-cover border-2 border-dashed opacity-80 ${
            p.recusado ? 'border-amx-red' : 'border-amx-amber'
          }`}
        />
      ))}
      {!readOnly && (
        <button
          type="button"
          disabled={lendo}
          onClick={() => inputRef.current?.click()}
          className={`h-9 px-2 rounded-md border text-[10px] font-semibold flex items-center gap-1 transition-colors disabled:opacity-50 ${
            !tem && obrigatoria
              ? 'border-amx-red text-amx-red-hover hover:bg-amx-red/10'
              : 'border-amx-line text-amx-muted hover:text-white'
          }`}
        >
          {lendo ? <Spinner className="w-3.5 h-3.5" /> : '📷'}
          {tem ? '+' : obrigatoria ? 'Foto obrig.' : 'Foto'}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setLendo(true);
              try {
                await onFoto(file);
              } finally {
                setLendo(false);
              }
            }}
          />
        </button>
      )}
    </div>
  );
}

function ChecklistTab({
  items,
  readOnly,
  onConcluir,
  onAdd,
  fotoObrigatoria,
  fotosEquip,
  pendentesEquip,
  onFotoEquip,
}: {
  items: ChecklistItem[];
  readOnly: boolean;
  onConcluir: (item: ChecklistItem) => void;
  onAdd: (descricao: string, obrigatorio: boolean) => void;
  fotoObrigatoria: Set<string>;
  fotosEquip: Foto[];
  pendentesEquip: { id: string; data: string; equipamento_id?: string; recusado?: boolean; erro?: string }[];
  onFotoEquip: (equipamentoId: string, file: File) => Promise<void>;
}) {
  const [novaDescricao, setNovaDescricao] = useState('');
  const [novoObrigatorio, setNovoObrigatorio] = useState(true);
  const [adding, setAdding] = useState(false);

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
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            // Item obrigatório e pendente ganha borda vermelha — é ele que
            // está travando o botão "Finalizar OS" (ver podeFinalizar acima).
            const bloqueando = item.obrigatorio && !item.concluido;
            return (
              <li
                key={item.id}
                className={`flex flex-wrap items-center gap-2.5 rounded-[9px] px-3.5 py-3 bg-amx-panel border ${
                  bloqueando ? 'border-amx-red' : 'border-amx-line'
                }`}
              >
                <button
                  type="button"
                  disabled={readOnly || item.concluido}
                  onClick={() => onConcluir(item)}
                  aria-label="Marcar como concluído"
                  title={item.concluido ? 'Concluído — não é possível desmarcar' : undefined}
                  className={`w-[22px] h-[22px] rounded-[6px] shrink-0 flex items-center justify-center transition-colors disabled:cursor-not-allowed ${
                    item.concluido
                      ? 'bg-amx-green'
                      : `border-2 ${bloqueando ? 'border-amx-red' : 'border-amx-muted'} ${readOnly ? '' : 'hover:border-white'}`
                  }`}
                >
                  {item.concluido && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
                <span
                  className={`text-[13px] flex-1 ${
                    item.concluido ? 'text-amx-muted line-through' : item.obrigatorio ? 'text-white' : 'text-amx-muted'
                  }`}
                >
                  {item.descricao}
                </span>
                {item.obrigatorio && !item.concluido && (
                  <span className="font-heading text-[9px] font-semibold text-amx-red tracking-wider shrink-0">OBRIG.</span>
                )}
                {item.equipamento_id && (
                  <FotoEquipamento
                    obrigatoria={fotoObrigatoria.has(item.equipamento_id)}
                    fotos={fotosEquip.filter((f) => f.equipamento_id === item.equipamento_id)}
                    pendentes={pendentesEquip.filter((p) => p.equipamento_id === item.equipamento_id)}
                    readOnly={readOnly}
                    onFoto={(file) => onFotoEquip(item.equipamento_id!, file)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={handleAdd} className="flex items-end gap-2 flex-wrap bg-amx-panel-2 border border-amx-line rounded-lg p-3">
          <Field label="Novo item do checklist" hint="Ex.: Verificar nível da caixa d'água">
            <Input
              value={novaDescricao}
              onChange={(e) => setNovaDescricao(e.target.value)}
              placeholder="Descrição do item"
              className="w-64"
            />
          </Field>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-white pb-2.5">
            <input
              type="checkbox"
              checked={novoObrigatorio}
              onChange={(e) => setNovoObrigatorio(e.target.checked)}
              className="accent-amx-red"
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
