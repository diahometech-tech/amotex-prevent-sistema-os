'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { CondominioForm, type CondominioFormData } from '@/components/cadastro/CondominioForm';
import { ContratoCondominio } from '@/components/financeiro/ContratoCondominio';
import { AcessoSindico } from '@/components/cadastro/AcessoSindico';
import { ReservatorioForm } from '@/components/cadastro/ReservatorioForm';
import { ContatoForm } from '@/components/cadastro/ContatoForm';
import { EquipamentoForm, type EquipamentoFormData } from '@/components/cadastro/EquipamentoForm';
import { CATEGORIAS_EQUIPAMENTO, nomeCategoria } from '@/lib/catalogo-equipamentos';
import {
  podeEditarCondominio,
  podeEditarEnderecoCondominio,
  podeEditarContato,
  podeEditarEquipamento,
  podeVerContrato,
  podeVerModulo,
  podeVerReservatorios,
} from '@/lib/roles';
import type { AmxUser } from '@/components/layout/AppShell';
import type {
  Condominio,
  Reservatorio,
  Contato,
  Equipamento,
} from '@/lib/db';

type TabType = 'reservatorios' | 'contatos' | 'equipamentos';
type EditingItemType = 'condominio' | 'reservatorio' | 'contato' | 'equipamento';

interface TabState {
  reservatorios?: { data: Reservatorio[]; loaded: boolean };
  contatos?: { data: Contato[]; loaded: boolean };
  equipamentos?: { data: Equipamento[]; loaded: boolean };
}

export default function CondominioDetailPage() {
  return (
    <AppShell>
      <CondominioDetailContent />
    </AppShell>
  );
}

function CondominioDetailContent() {
  const user = useAmxUser();
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [equipamentoParaRemover, setEquipamentoParaRemover] = useState<Equipamento | null>(null);
  const [apagandoCondominio, setApagandoCondominio] = useState(false);

  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [loadingCondominio, setLoadingCondominio] = useState(true);
  const [condominioError, setCondominioError] = useState<string | null>(null);

  // Técnico não tem a aba Reservatórios: abre direto em Contatos.
  const [activeTab, setActiveTab] = useState<TabType>(podeVerReservatorios(user?.role) ? 'reservatorios' : 'contatos');
  const [tabData, setTabData] = useState<TabState>({});
  const [loadingTab, setLoadingTab] = useState(false);

  const [editingType, setEditingType] = useState<EditingItemType | null>(null);
  const [editingItem, setEditingItem] = useState<Reservatorio | Contato | null>(null);
  // Equipamento em edição (null = cadastro novo) — estado próprio porque o
  // formulário e a rota de salvar são outros.
  const [editingEquipamento, setEditingEquipamento] = useState<Equipamento | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load condominio on mount
  useEffect(() => {
    const loadCondominio = async () => {
      try {
        setLoadingCondominio(true);
        setCondominioError(null);
        const response = await fetch(`/api/condominios/${id}`);
        const result: {
          condominio?: Condominio;
          reservatorios?: Reservatorio[];
          contatos?: Contato[];
          equipamentos?: Equipamento[];
          error?: string;
        } = await response.json();

        if (!response.ok || result.error) {
          setCondominioError(
            result.error || 'Condomínio não encontrado'
          );
          setCondominio(null);
          return;
        }

        setCondominio(result.condominio ?? null);
        // Este mesmo payload já traz as três listas das abas — preencher
        // tudo aqui evita um GET por aba (ver a rota: ela retorna
        // condominio + reservatorios + contatos + equipamentos + oss).
        setTabData({
          reservatorios: { data: result.reservatorios ?? [], loaded: true },
          contatos: { data: result.contatos ?? [], loaded: true },
          equipamentos: { data: result.equipamentos ?? [], loaded: true },
        });
      } catch {
        setCondominioError('Erro ao carregar condomínio');
        setCondominio(null);
      } finally {
        setLoadingCondominio(false);
      }
    };

    if (id) {
      loadCondominio();
    }
  }, [id]);

  // Lazy-load tab data when tab is clicked
  const loadTabData = async (tab: TabType) => {
    if (tabData[tab]?.loaded) {
      return; // Already loaded
    }

    try {
      setLoadingTab(true);
      const endpoint = `/api/condominios/${id}/${tab}`;
      const response = await fetch(endpoint);
      const result: {
        reservatorios?: Reservatorio[];
        contatos?: Contato[];
        equipamentos?: Equipamento[];
        error?: string;
      } = await response.json();

      if (!response.ok || result.error) {
        // Still set empty array on error, just don't re-fetch
        setTabData((prev) => ({
          ...prev,
          [tab]: { data: [], loaded: true },
        }));
        return;
      }

      const key =
        tab === 'reservatorios'
          ? 'reservatorios'
          : tab === 'contatos'
            ? 'contatos'
            : 'equipamentos';
      const data = result[key] ?? [];

      setTabData((prev: TabState) => ({
        ...prev,
        [tab]: { data, loaded: true },
      }));
    } catch {
      setTabData((prev: TabState) => ({
        ...prev,
        [tab]: { data: [], loaded: true },
      }));
    } finally {
      setLoadingTab(false);
    }
  };

  const handleEditCondominio = async (data: CondominioFormData) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch(`/api/condominios/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { condominio?: Condominio; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao atualizar condomínio');
        return;
      }

      setCondominio(result.condominio ?? null);
      setEditingType(null);
    } catch {
      setSubmitError('Erro ao atualizar condomínio');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateReservatorio = async (data: Partial<Reservatorio>) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch(`/api/condominios/${id}/reservatorios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { reservatorio?: Reservatorio; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao criar reservatório');
        return;
      }

      setTabData((prev: TabState) => ({
        ...prev,
        reservatorios: {
          data: [...(prev.reservatorios?.data ?? []), result.reservatorio!],
          loaded: true,
        },
      }));
      setEditingType(null);
    } catch {
      setSubmitError('Erro ao criar reservatório');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditReservatorio = async (data: Partial<Reservatorio>) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      // Não-nulo garantido: só é chamada quando editingItem existe (ver o
      // onSubmit condicional no Modal de reservatório mais abaixo).
      const response = await fetch(`/api/reservatorios/${editingItem!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { reservatorio?: Reservatorio; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao atualizar reservatório');
        return;
      }

      setTabData((prev: TabState) => ({
        ...prev,
        reservatorios: {
          data: (prev.reservatorios?.data ?? []).map((r: Reservatorio) =>
            r.id === editingItem!.id ? result.reservatorio! : r
          ),
          loaded: true,
        },
      }));
      setEditingType(null);
    } catch {
      setSubmitError('Erro ao atualizar reservatório');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateContato = async (data: Partial<Contato>) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch(`/api/condominios/${id}/contatos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { contato?: Contato; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao criar contato');
        return;
      }

      setTabData((prev: TabState) => ({
        ...prev,
        contatos: {
          data: [...(prev.contatos?.data ?? []), result.contato!],
          loaded: true,
        },
      }));
      setEditingType(null);
    } catch {
      setSubmitError('Erro ao criar contato');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditContato = async (data: Partial<Contato>) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      // Não-nulo garantido: só é chamada quando editingItem existe (ver o
      // onSubmit condicional no Modal de contato mais abaixo).
      const response = await fetch(`/api/contatos/${editingItem!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { contato?: Contato; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao atualizar contato');
        return;
      }

      setTabData((prev: TabState) => ({
        ...prev,
        contatos: {
          data: (prev.contatos?.data ?? []).map((c: Contato) =>
            c.id === editingItem!.id ? result.contato! : c
          ),
          loaded: true,
        },
      }));
      setEditingType(null);
    } catch {
      setSubmitError('Erro ao atualizar contato');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEquipamento = async (data: EquipamentoFormData) => {
    const editando = editingEquipamento;
    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch(editando ? `/api/equipamentos/${editando.id}` : `/api/condominios/${id}/equipamentos`, {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { equipamento?: Equipamento; error?: string } = await response.json().catch(() => ({}));

      if (!response.ok || result.error || !result.equipamento) {
        setSubmitError(result.error || 'Erro ao salvar equipamento');
        return;
      }

      const salvo = result.equipamento;
      setTabData((prev: TabState) => {
        const lista = prev.equipamentos?.data ?? [];
        return {
          ...prev,
          equipamentos: {
            data: editando ? lista.map((e) => (e.id === salvo.id ? salvo : e)) : [...lista, salvo],
            loaded: true,
          },
        };
      });
      setEditingType(null);
      setEditingEquipamento(null);
    } catch {
      setSubmitError('Erro ao salvar equipamento');
    } finally {
      setSubmitting(false);
    }
  };

  // Confirmação dentro do sistema (ConfirmDialog), não window.confirm.
  // Devolve a mensagem de erro pra o diálogo mostrar, ou nada se deu certo.
  const removerEquipamento = async (): Promise<string | void> => {
    const equipamento = equipamentoParaRemover;
    if (!equipamento) return;
    const response = await fetch(`/api/equipamentos/${equipamento.id}`, { method: 'DELETE' }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) return result.error || 'Não foi possível remover o equipamento.';
    setTabData((prev: TabState) => ({
      ...prev,
      equipamentos: { data: (prev.equipamentos?.data ?? []).filter((e) => e.id !== equipamento.id), loaded: true },
    }));
    setEquipamentoParaRemover(null);
  };

  const apagarCondominio = async (): Promise<string | void> => {
    if (!condominio) return;
    const response = await fetch(`/api/condominios/${condominio.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmar_nome: condominio.nome }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) return result.error || 'Não foi possível apagar o condomínio.';
    router.push('/condominios');
  };

  const handleTabClick = (tab: TabType) => {
    setActiveTab(tab);
    loadTabData(tab);
  };

  if (!user) {
    return null;
  }

  if (loadingCondominio) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-6 flex justify-center">
        <Spinner />
      </div>
    );
  }

  if (!condominio || condominioError) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-6">
        <EmptyState
          title="Condomínio não encontrado"
          description={condominioError || 'O condomínio que você tentou acessar não existe ou foi removido.'}
          action={
            <Link href="/condominios">
              <Button variant="secondary">Voltar para Condomínios</Button>
            </Link>
          }
        />
      </div>
    );
  }

  // Bindings separados (em vez de tabData[activeTab]) pra cada painel receber
  // o array já no tipo certo — indexar por activeTab daria um union dos 3
  // tipos, que o TypeScript não consegue estreitar de volta sem um `any`.
  const reservatoriosData = tabData.reservatorios;
  const contatosData = tabData.contatos;
  const equipamentosData = tabData.equipamentos;
  const isLoadingCurrentTab = loadingTab;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-8 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-white mb-2 break-words">
            {condominio.nome}
          </h1>
          {(condominio.endereco || condominio.administradora) && (
            <p className="text-xs text-amx-muted">
              {condominio.endereco}
              {condominio.endereco && condominio.administradora && ' · '}
              {condominio.administradora}
            </p>
          )}
          {condominio.regiao && <p className="text-xs text-amx-muted mt-0.5">Região: {condominio.regiao}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={condominio.monitoramento_ativo ? 'success' : 'neutral'}
          >
            {condominio.monitoramento_ativo
              ? 'Monitorado'
              : 'Sem monitoramento'}
          </Badge>
          {podeEditarEnderecoCondominio(user.role) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingType('condominio');
                setEditingItem(null);
                setSubmitError(null);
              }}
            >
              {podeEditarCondominio(user.role) ? 'Editar' : 'Editar endereço'}
            </Button>
          )}
          {podeVerModulo(user.role, 'painel') && (
            <Link href={`/painel/${condominio.id}`}>
              <Button variant="secondary" size="sm">
                Ver painel
              </Button>
            </Link>
          )}
        </div>
      </div>

      {podeVerContrato(user.role) && (
        <ContratoCondominio condominio={condominio} somenteLeitura={!podeEditarCondominio(user.role)} />
      )}
      {podeEditarCondominio(user.role) && <AcessoSindico condominio={condominio} contatos={contatosData?.data ?? []} />}

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 border-b border-amx-line pb-4">
        {(['reservatorios', 'contatos', 'equipamentos'] as TabType[]).filter((tab) => tab !== 'reservatorios' || podeVerReservatorios(user.role)).map(
          (tab) => (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`font-heading text-[11px] font-semibold tracking-wider uppercase px-3 py-1.5 rounded-full transition-colors ${
                activeTab === tab
                  ? 'bg-amx-red text-white'
                  : 'border border-amx-line text-amx-muted hover:text-white'
              }`}
            >
              {tab === 'reservatorios'
                ? 'Reservatórios'
                : tab === 'contatos'
                  ? 'Contatos'
                  : 'Equipamentos'}
            </button>
          )
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'reservatorios' && (
        <ReservatoriosTab
          condominio={condominio}
          user={user}
          data={reservatoriosData?.data ?? []}
          loading={isLoadingCurrentTab}
          onCreateClick={() => {
            setEditingType('reservatorio');
            setEditingItem(null);
            setSubmitError(null);
          }}
          onEditClick={(item) => {
            setEditingType('reservatorio');
            setEditingItem(item);
            setSubmitError(null);
          }}
        />
      )}

      {activeTab === 'contatos' && (
        <ContatosTab
          condominio={condominio}
          user={user}
          data={contatosData?.data ?? []}
          loading={isLoadingCurrentTab}
          onCreateClick={() => {
            setEditingType('contato');
            setEditingItem(null);
            setSubmitError(null);
          }}
          onEditClick={(item) => {
            setEditingType('contato');
            setEditingItem(item);
            setSubmitError(null);
          }}
        />
      )}

      {activeTab === 'equipamentos' && (
        <EquipamentosTab
          condominio={condominio}
          user={user}
          data={equipamentosData?.data ?? []}
          loading={isLoadingCurrentTab}
          onCreateClick={() => {
            setEditingType('equipamento');
            setEditingEquipamento(null);
            setSubmitError(null);
          }}
          onEditClick={(item) => {
            setEditingType('equipamento');
            setEditingEquipamento(item);
            setSubmitError(null);
          }}
          onDeleteClick={setEquipamentoParaRemover}
        />
      )}

      {podeEditarCondominio(user.role) && (
        <div className="mt-10 rounded-lg border border-amx-red/40 bg-amx-red/5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[13px] font-semibold text-white">Apagar condomínio</p>
            <p className="text-xs text-amx-muted">
              Só para cadastro de teste ou feito por engano. Cliente que saiu: use Editar › &quot;Contrato ativo&quot;, que mantém o histórico.
            </p>
          </div>
          <Button size="sm" variant="danger" onClick={() => setApagandoCondominio(true)}>
            Apagar condomínio
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={!!equipamentoParaRemover}
        titulo="Remover equipamento?"
        confirmarLabel="Remover"
        perigo
        onConfirm={removerEquipamento}
        onClose={() => setEquipamentoParaRemover(null)}
      >
        {equipamentoParaRemover && (
          <p>
            <b className="text-white">{equipamentoParaRemover.tipo}</b>
            {equipamentoParaRemover.identificacao ? ` (${equipamentoParaRemover.identificacao})` : ''} sai do parque de máquinas.
          </p>
        )}
        <p>Equipamento que já tem foto ou serviço registrado não pode ser removido.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={apagandoCondominio}
        titulo="Apagar este condomínio de vez?"
        confirmarLabel="Apagar condomínio"
        perigo
        digitarParaConfirmar={condominio.nome}
        onConfirm={apagarCondominio}
        onClose={() => setApagandoCondominio(false)}
      >
        <p>
          Apaga o condomínio com todas as OS, fotos, PDFs, equipamentos, cobranças e o acesso do síndico.{' '}
          <b className="text-white">Não tem como desfazer.</b>
        </p>
      </ConfirmDialog>

      {/* Modals */}
      <Modal
        open={editingType === 'condominio'}
        onClose={() => {
          setEditingType(null);
          setSubmitError(null);
        }}
        maxWidth="max-w-2xl"
      >
        <ModalHeader
          title={podeEditarCondominio(user.role) ? 'Editar Condomínio' : 'Editar endereço e localização'}
          onClose={() => {
            setEditingType(null);
            setSubmitError(null);
          }}
        />
        <div className="p-5">
          {submitError && (
            <div className="mb-4 p-3 bg-amx-red/12 border border-amx-red/30 rounded text-amx-red-hover text-xs font-semibold">
              {submitError}
            </div>
          )}
          <CondominioForm
            initial={condominio}
            somenteEndereco={!podeEditarCondominio(user.role)}
            onSubmit={handleEditCondominio}
            onCancel={() => {
              setEditingType(null);
              setSubmitError(null);
            }}
            busy={submitting}
          />
        </div>
      </Modal>

      <Modal
        open={editingType === 'reservatorio'}
        onClose={() => {
          setEditingType(null);
          setSubmitError(null);
        }}
        maxWidth="max-w-md"
      >
        <ModalHeader
          title={editingItem ? 'Editar Reservatório' : 'Novo Reservatório'}
          onClose={() => {
            setEditingType(null);
            setSubmitError(null);
          }}
        />
        <div className="p-5">
          {submitError && (
            <div className="mb-4 p-3 bg-amx-red/12 border border-amx-red/30 rounded text-amx-red-hover text-xs font-semibold">
              {submitError}
            </div>
          )}
          <ReservatorioForm
            // Cast seguro: este Modal só abre com editingType === 'reservatorio',
            // e todo onEditClick de reservatório guarda um Reservatorio aqui.
            initial={editingItem as Reservatorio | null ?? undefined}
            onSubmit={
              editingItem
                ? handleEditReservatorio
                : handleCreateReservatorio
            }
            onCancel={() => {
              setEditingType(null);
              setSubmitError(null);
            }}
            busy={submitting}
          />
        </div>
      </Modal>

      <Modal
        open={editingType === 'contato'}
        onClose={() => {
          setEditingType(null);
          setSubmitError(null);
        }}
        maxWidth="max-w-md"
      >
        <ModalHeader
          title={editingItem ? 'Editar Contato' : 'Novo Contato'}
          onClose={() => {
            setEditingType(null);
            setSubmitError(null);
          }}
        />
        <div className="p-5">
          {submitError && (
            <div className="mb-4 p-3 bg-amx-red/12 border border-amx-red/30 rounded text-amx-red-hover text-xs font-semibold">
              {submitError}
            </div>
          )}
          <ContatoForm
            // Cast seguro: este Modal só abre com editingType === 'contato',
            // e todo onEditClick de contato guarda um Contato aqui.
            initial={editingItem as Contato | null ?? undefined}
            onSubmit={editingItem ? handleEditContato : handleCreateContato}
            onCancel={() => {
              setEditingType(null);
              setSubmitError(null);
            }}
            busy={submitting}
          />
        </div>
      </Modal>

      <Modal
        open={editingType === 'equipamento'}
        onClose={() => {
          setEditingType(null);
          setSubmitError(null);
        }}
        maxWidth="max-w-lg"
      >
        <ModalHeader
          title={editingEquipamento ? 'Editar equipamento' : 'Novo equipamento'}
          onClose={() => {
            setEditingType(null);
            setSubmitError(null);
          }}
        />
        <div className="p-5">
          {submitError && (
            <div className="mb-4 p-3 bg-amx-red/12 border border-amx-red/30 rounded text-amx-red-hover text-xs font-semibold">
              {submitError}
            </div>
          )}
          <EquipamentoForm
            key={editingEquipamento?.id ?? 'novo'}
            inicial={editingEquipamento ?? undefined}
            onSubmit={handleSaveEquipamento}
            onCancel={() => {
              setEditingType(null);
              setSubmitError(null);
            }}
            busy={submitting}
          />
        </div>
      </Modal>
    </div>
  );
}

// Tab panel components — genérico em T pra cada painel (Reservatorio,
// Contato ou Equipamento) manter o tipo certo em `data`/`onEditClick`.
interface TabPanelProps<T> {
  condominio: Condominio;
  user: AmxUser;
  data: T[];
  loading: boolean;
  onCreateClick: () => void;
  onEditClick?: (item: T) => void;
}

function ReservatoriosTab({
  user,
  data,
  loading,
  onCreateClick,
  onEditClick,
}: TabPanelProps<Reservatorio>) {
  const canEdit = podeEditarCondominio(user.role);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="Nenhum reservatório cadastrado"
        action={
          canEdit ? (
            <Button variant="primary" onClick={onCreateClick}>
              + Novo Reservatório
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="mb-4">
          <Button onClick={onCreateClick}>
            + Novo Reservatório
          </Button>
        </div>
      )}
      {data.map((reservatorio: Reservatorio) => (
        <Card key={reservatorio.id}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">
                {reservatorio.nome_interno}
              </h3>
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge tone="info">{reservatorio.tipo}</Badge>
                {reservatorio.capacidade_litros && (
                  <span className="text-xs text-amx-muted">
                    {reservatorio.capacidade_litros.toLocaleString('pt-BR')} L
                  </span>
                )}
              </div>
              <div className="mt-2.5 px-2.5 py-2 bg-amx-panel-2 rounded-md border border-dashed border-amx-line">
                <p className="font-heading text-[9px] text-amx-muted uppercase tracking-wider">Nome na SensorLog (de-para)</p>
                <p className="text-xs mt-0.5 font-mono text-amx-blue-light">&quot;{reservatorio.nome_sensorlog}&quot;</p>
              </div>
              {reservatorio.ultima_mensagem_recebida_em && (
                <p className="text-xs text-amx-muted mt-2">
                  Última atualização:{' '}
                  {new Date(
                    reservatorio.ultima_mensagem_recebida_em
                  ).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEditClick?.(reservatorio)}
              >
                Editar
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ContatosTab({
  user,
  data,
  loading,
  onCreateClick,
  onEditClick,
}: TabPanelProps<Contato>) {
  const canEdit = podeEditarContato(user.role);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="Nenhum contato cadastrado"
        action={
          canEdit ? (
            <Button variant="primary" onClick={onCreateClick}>
              + Novo Contato
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="mb-4">
          <Button onClick={onCreateClick}>
            + Novo Contato
          </Button>
        </div>
      )}
      {data.map((contato: Contato) => (
        <Card key={contato.id}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="flex-1">
              <h3 className="font-semibold text-white mb-1">
                {contato.nome}
              </h3>
              <div className="flex flex-wrap gap-2 mb-2">
                <Badge tone="navy">{contato.papel}</Badge>
                <Badge tone="warning">Nível {contato.nivel_escalonamento}</Badge>
                <Badge tone={contato.ativo ? 'success' : 'neutral'}>
                  {contato.ativo ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              <p className="text-sm text-amx-muted">
                {contato.canal_preferencial === 'whatsapp' && 'WhatsApp'}
                {contato.canal_preferencial === 'telegram' && 'Telegram'}
                {contato.canal_preferencial === 'email' && 'E-mail'} ·{' '}
                {contato.identificador_canal}
              </p>
            </div>
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEditClick?.(contato)}
              >
                Editar
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function EquipamentosTab({
  user,
  data,
  loading,
  onCreateClick,
  onEditClick,
  onDeleteClick,
}: TabPanelProps<Equipamento> & { onDeleteClick?: (item: Equipamento) => void }) {
  const canEdit = podeEditarEquipamento(user.role);
  const canDelete = podeEditarCondominio(user.role) || podeEditarEquipamento(user.role);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="Nenhum equipamento cadastrado"
        description="O parque de máquinas é montado na visita: categoria, tipo, identificação no local e foto de cada bomba ou motor."
        action={canEdit ? <Button onClick={onCreateClick}>+ Novo equipamento</Button> : undefined}
      />
    );
  }

  // Agrupa na ordem do catálogo da Amotex; "Outro"/sem categoria no fim.
  const ordem = [...CATEGORIAS_EQUIPAMENTO.map((c) => c.id), 'outro', ''];
  const grupos = new Map<string, Equipamento[]>();
  for (const e of data) {
    const k = e.categoria && ordem.includes(e.categoria) ? e.categoria : '';
    grupos.set(k, [...(grupos.get(k) ?? []), e]);
  }
  const semFoto = data.filter((e) => !e.foto_url).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 gap-3 flex-wrap">
        <p className="text-sm text-amx-muted">
          <b className="text-white">{data.length}</b> equipamento{data.length > 1 ? 's' : ''}
          {semFoto > 0 && <> · <span className="text-amx-amber">{semFoto} sem foto</span></>}
        </p>
        {canEdit && <Button onClick={onCreateClick}>+ Novo equipamento</Button>}
      </div>
      {ordem
        .filter((k) => grupos.has(k))
        .map((k) => (
          <section key={k || 'sem'}>
            <h3 className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-2">{nomeCategoria(k || undefined)}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {grupos.get(k)!.map((equipamento) => (
                <Card key={equipamento.id} className="p-3 flex gap-3">
                  {equipamento.foto_url ? (
                    <a href={equipamento.foto_url} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- foto autenticada servida por /uploads */}
                      <img
                        src={equipamento.foto_url}
                        alt={`Foto: ${equipamento.tipo}`}
                        className="h-20 w-20 object-cover rounded-[10px] border border-amx-line"
                      />
                    </a>
                  ) : (
                    <div className="h-20 w-20 shrink-0 rounded-[10px] border border-dashed border-amx-amber/50 grid place-items-center text-[11px] text-amx-amber">
                      sem foto
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white text-sm">{equipamento.tipo}</p>
                    {equipamento.identificacao && <p className="text-xs text-white/80">{equipamento.identificacao}</p>}
                    <p className="text-xs text-amx-muted mt-0.5">
                      {[equipamento.modelo, equipamento.potencia_hp != null ? `${equipamento.potencia_hp.toLocaleString('pt-BR')} CV` : null]
                        .filter(Boolean)
                        .join(' · ') || 'modelo não informado'}
                    </p>
                    {(canEdit || canDelete) && (
                      <div className="flex gap-1.5 mt-2">
                        {canEdit && onEditClick && (
                          <Button size="sm" variant="secondary" onClick={() => onEditClick(equipamento)}>
                            {equipamento.foto_url ? 'Editar' : 'Editar / foto'}
                          </Button>
                        )}
                        {canDelete && onDeleteClick && (
                          <Button size="sm" variant="secondary" onClick={() => onDeleteClick(equipamento)}>
                            Remover
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
