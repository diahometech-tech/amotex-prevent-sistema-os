'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { CondominioForm } from '@/components/cadastro/CondominioForm';
import { ReservatorioForm } from '@/components/cadastro/ReservatorioForm';
import { ContatoForm } from '@/components/cadastro/ContatoForm';
import { EquipamentoForm } from '@/components/cadastro/EquipamentoForm';
import { canEditCadastro } from '@/lib/permissions';
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
  const id = params?.id as string;

  const [condominio, setCondominio] = useState<Condominio | null>(null);
  const [loadingCondominio, setLoadingCondominio] = useState(true);
  const [condominioError, setCondominioError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>('reservatorios');
  const [tabData, setTabData] = useState<TabState>({});
  const [loadingTab, setLoadingTab] = useState(false);

  const [editingType, setEditingType] = useState<EditingItemType | null>(null);
  // Equipamento nunca entra aqui (não tem modo de edição, só criação) — daí
  // o union cobrir só os dois tipos que realmente são editados.
  const [editingItem, setEditingItem] = useState<Reservatorio | Contato | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load condominio on mount
  useEffect(() => {
    const loadCondominio = async () => {
      try {
        setLoadingCondominio(true);
        setCondominioError(null);
        const response = await fetch(`/api/condominios/${id}`);
        const result: { condominio?: Condominio; error?: string } =
          await response.json();

        if (!response.ok || result.error) {
          setCondominioError(
            result.error || 'Condomínio não encontrado'
          );
          setCondominio(null);
          return;
        }

        setCondominio(result.condominio ?? null);
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

  const handleEditCondominio = async (data: Partial<Condominio>) => {
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

  const handleCreateEquipamento = async (data: Partial<Equipamento>) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch(`/api/condominios/${id}/equipamentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { equipamento?: Equipamento; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao criar equipamento');
        return;
      }

      setTabData((prev: TabState) => ({
        ...prev,
        equipamentos: {
          data: [...(prev.equipamentos?.data ?? []), result.equipamento!],
          loaded: true,
        },
      }));
      setEditingType(null);
    } catch {
      setSubmitError('Erro ao criar equipamento');
    } finally {
      setSubmitting(false);
    }
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
          description="O condomínio que você tentou acessar não existe ou foi removido."
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
    <div className="w-full max-w-4xl mx-auto px-8 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          <h1 className="text-white mb-2">
            {condominio.nome}
          </h1>
          {(condominio.endereco || condominio.administradora) && (
            <p className="text-xs text-amx-muted">
              {condominio.endereco}
              {condominio.endereco && condominio.administradora && ' · '}
              {condominio.administradora}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            tone={condominio.monitoramento_ativo ? 'success' : 'neutral'}
          >
            {condominio.monitoramento_ativo
              ? 'Monitorado'
              : 'Sem monitoramento'}
          </Badge>
          {canEditCadastro(user.role) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingType('condominio');
                setEditingItem(null);
                setSubmitError(null);
              }}
            >
              Editar
            </Button>
          )}
          <Link href={`/painel/${condominio.id}`}>
            <Button variant="secondary" size="sm">
              Ver painel
            </Button>
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 border-b border-amx-line pb-4">
        {(['reservatorios', 'contatos', 'equipamentos'] as TabType[]).map(
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
            setEditingItem(null);
            setSubmitError(null);
          }}
        />
      )}

      {/* Modals */}
      <Modal
        open={editingType === 'condominio'}
        onClose={() => {
          setEditingType(null);
          setSubmitError(null);
        }}
        maxWidth="max-w-md"
      >
        <ModalHeader
          title="Editar Condomínio"
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
        maxWidth="max-w-md"
      >
        <ModalHeader
          title="Novo Equipamento"
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
            onSubmit={handleCreateEquipamento}
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
  const canEdit = canEditCadastro(user.role);

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
          <div className="flex items-start justify-between">
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
  const canEdit = canEditCadastro(user.role);

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
          <div className="flex items-start justify-between">
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
}: TabPanelProps<Equipamento>) {
  const canEdit = canEditCadastro(user.role);

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
        action={
          canEdit ? (
            <Button onClick={onCreateClick}>
              + Novo Equipamento
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
            + Novo Equipamento
          </Button>
        </div>
      )}
      {data.map((equipamento: Equipamento) => (
        <Card key={equipamento.id}>
          <div>
            <h3 className="font-semibold text-white mb-1">
              {equipamento.tipo}
            </h3>
            {equipamento.modelo && (
              <p className="text-sm text-amx-muted mb-1">
                Modelo: {equipamento.modelo}
              </p>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-amx-muted">
              {equipamento.potencia_hp && (
                <span>{equipamento.potencia_hp.toLocaleString('pt-BR')} HP</span>
              )}
              <span>
                Cadastrado em{' '}
                {new Date(equipamento.cadastrado_em).toLocaleString(
                  'pt-BR'
                )}
              </span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
