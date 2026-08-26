'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import type { Condominio } from '@/lib/db';

interface CondominiosResponse {
  condominios?: Condominio[];
  error?: string;
}

export default function PainelPage() {
  return (
    <AppShell>
      <PainelContent />
    </AppShell>
  );
}

function PainelContent() {
  const user = useAmxUser();
  const router = useRouter();
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadCondominios = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch('/api/condominios', { cache: 'no-store' });
        const data: CondominiosResponse = await response.json();

        if (!response.ok || data.error) {
          setError(data.error || 'Erro ao carregar condomínios');
          setCondominios([]);
          return;
        }

        const loaded = data.condominios ?? [];
        setCondominios(loaded);

        // Se síndico com exatamente um condomínio, redireciona direto
        if (user?.role === 'sindico' && loaded.length === 1) {
          router.replace(`/painel/${loaded[0].id}`);
        }
      } catch {
        setError('Erro ao carregar condomínios');
        setCondominios([]);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadCondominios();
    }
  }, [user, router]);

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  // Síndico com zero condomínios
  if (user.role === 'sindico' && condominios.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <EmptyState
          title="Nenhum condomínio vinculado"
          description="Sua conta ainda não foi vinculada a nenhum condomínio. Entre em contato com o administrador."
        />
      </div>
    );
  }

  // Admin/técnico com múltiplos condomínios — mostra lista
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-white mb-1">Painel do Síndico</h1>
        <p className="text-xs text-amx-muted">Selecione um condomínio para ver o painel.</p>
      </div>

      {error && (
        <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 mx-8 mt-4 rounded-lg px-3 py-2">{error}</p>
      )}

      {condominios.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <EmptyState title="Nenhum condomínio cadastrado" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-8 py-6">
          <div className="grid gap-3 max-w-2xl">
            {condominios.map((condominio) => (
              <Link key={condominio.id} href={`/painel/${condominio.id}`}>
                <Card className="cursor-pointer hover:border-amx-muted transition-colors">
                  <h3 className="font-semibold text-white">{condominio.nome}</h3>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
