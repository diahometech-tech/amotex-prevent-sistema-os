'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { CondominioForm } from '@/components/cadastro/CondominioForm';
import { canEditCadastro } from '@/lib/permissions';
import type { Condominio } from '@/lib/db';

interface CondominiosResponse {
  condominios?: Condominio[];
  error?: string;
}

export default function CondominiosPage() {
  return (
    <AppShell>
      <CondominiosContent />
    </AppShell>
  );
}

function CondominiosContent() {
  const user = useAmxUser();
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const loadCondominios = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/condominios');
        const data: CondominiosResponse = await response.json();

        if (!response.ok || data.error) {
          setError(data.error || 'Erro ao carregar condomínios');
          setCondominios([]);
          return;
        }

        setCondominios(data.condominios ?? []);
      } catch {
        setError('Erro ao carregar condomínios');
        setCondominios([]);
      } finally {
        setLoading(false);
      }
    };

    loadCondominios();
  }, []);

  const handleCreateCondominio = async (data: Partial<Condominio>) => {
    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch('/api/condominios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result: { condominio?: Condominio; error?: string } =
        await response.json();

      if (!response.ok || result.error) {
        setSubmitError(result.error || 'Erro ao criar condomínio');
        return;
      }

      setCondominios([...condominios, result.condominio!]);
      setShowForm(false);
    } catch {
      setSubmitError('Erro ao criar condomínio');
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white">Condomínios</h1>
        {canEditCadastro(user.role) && (
          <Button
            onClick={() => {
              setShowForm(true);
              setSubmitError(null);
            }}
          >
            + Novo Condomínio
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-amx-red/12 border border-amx-red/30 rounded-lg text-amx-red-hover text-xs font-semibold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : condominios.length === 0 ? (
        <EmptyState
          title="Nenhum condomínio cadastrado"
          description="Comece a criar um novo condomínio para gerenciar as OS"
          action={
            canEditCadastro(user.role) ? (
              <Button
                variant="primary"
                onClick={() => {
                  setShowForm(true);
                  setSubmitError(null);
                }}
              >
                + Novo Condomínio
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {condominios.map((condominio) => (
            <Link
              key={condominio.id}
              href={`/condominios/${condominio.id}`}
              className="block"
            >
              <Card className="cursor-pointer hover:border-amx-muted transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-white mb-1">
                      {condominio.nome}
                    </h3>
                    {condominio.endereco && (
                      <p className="text-sm text-amx-muted mb-1">
                        {condominio.endereco}
                      </p>
                    )}
                    {condominio.administradora && (
                      <p className="text-xs text-amx-muted">
                        {condominio.administradora}
                      </p>
                    )}
                  </div>
                  <Badge
                    tone={
                      condominio.monitoramento_ativo ? 'success' : 'neutral'
                    }
                  >
                    {condominio.monitoramento_ativo
                      ? 'Monitorado'
                      : 'Sem monitoramento'}
                  </Badge>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setSubmitError(null);
        }}
        maxWidth="max-w-md"
      >
        <ModalHeader
          title="Novo Condomínio"
          onClose={() => {
            setShowForm(false);
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
            onSubmit={handleCreateCondominio}
            onCancel={() => {
              setShowForm(false);
              setSubmitError(null);
            }}
            busy={submitting}
          />
        </div>
      </Modal>
    </div>
  );
}
