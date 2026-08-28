'use client';

import React, { useEffect, useState } from 'react';
import { AppShell, useAmxUser } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Form';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { ROLE_LABELS } from '@/lib/permissions';
import type { Condominio, UserRole } from '@/lib/db';

// Shape de src/app/api/users/route.ts `safe()` — User sem senha_hash.
interface UserRow {
  id: string;
  nome: string;
  login: string;
  papel: UserRole;
  condominio_id?: string;
  ativo: boolean;
  criado_em: string;
}

const PAPEL_TONE: Record<UserRole, 'red' | 'info' | 'navy'> = {
  admin: 'red',
  tecnico: 'info',
  sindico: 'navy',
};

function UsuariosContent() {
  const user = useAmxUser();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [condominios, setCondominios] = useState<Condominio[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState('');

  const [createForm, setCreateForm] = useState({
    nome: '',
    login: '',
    senha: '',
    papel: 'tecnico' as UserRole,
    condominio_id: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [novaSenha, setNovaSenha] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  const condominioNome = (id?: string) => condominios.find((c) => c.id === id)?.nome;

  const load = async () => {
    try {
      const res = await fetch('/api/users', { cache: 'no-store' });
      if (res.status === 403) {
        setDenied(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      setMsg('Erro de conexão ao carregar usuários.');
    }
  };

  const loadCondominios = async () => {
    try {
      const res = await fetch('/api/condominios', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setCondominios(data.condominios || []);
      }
    } catch {
      // Só alimenta o seletor de síndico — falha aqui não impede o resto da tela.
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load()/loadCondominios() só fazem setState depois do primeiro await
    Promise.all([load(), loadCondominios()]).finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (createForm.papel === 'sindico' && !createForm.condominio_id) {
      setCreateError('Selecione o condomínio do síndico.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: createForm.nome,
          login: createForm.login,
          senha: createForm.senha,
          papel: createForm.papel,
          condominio_id: createForm.papel === 'sindico' ? createForm.condominio_id : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`"${createForm.login}" criado.`);
        setCreateForm({ nome: '', login: '', senha: '', papel: 'tecnico', condominio_id: '' });
        load();
      } else {
        setCreateError(data.error || 'Falha ao criar usuário.');
      }
    } catch {
      setCreateError('Erro de conexão.');
    } finally {
      setCreating(false);
    }
  };

  const handleResetSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !novaSenha) return;
    setResetting(true);
    setResetError('');
    try {
      const res = await fetch(`/api/users/${resetTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: novaSenha }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Senha de "${resetTarget.login}" redefinida.`);
        setResetTarget(null);
        setNovaSenha('');
      } else {
        setResetError(data.error || 'Falha ao redefinir senha.');
      }
    } catch {
      setResetError('Erro de conexão.');
    } finally {
      setResetting(false);
    }
  };

  const handleToggleAtivo = async (u: UserRow) => {
    setMsg('');
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !u.ativo }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`"${u.login}" ${u.ativo ? 'desativado' : 'ativado'}.`);
      load();
    } else {
      setMsg(data.error || 'Falha ao atualizar status.');
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (!window.confirm(`Excluir definitivamente o acesso de "${u.nome}" (${u.login})?\n\nEsta ação não pode ser desfeita.`)) return;
    setMsg('');
    const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`Acesso de "${u.login}" excluído.`);
      load();
    } else {
      setMsg(data.error || 'Falha ao excluir usuário.');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (denied || (user && user.role !== 'admin')) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <EmptyState title="Acesso negado" description="Só administradores gerenciam usuários." />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-8 pt-6 pb-4 border-b border-amx-line">
        <h1 className="text-white">Gestão de Usuários</h1>
        <p className="text-xs text-amx-muted mt-1">Crie e gerencie acessos de técnicos, síndicos e administradores.</p>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 flex flex-col gap-6 max-w-4xl">
        {msg && <p className="text-xs font-semibold text-amx-blue-light bg-amx-blue/10 rounded-lg px-3 py-2">{msg}</p>}

        <Card className="p-5">
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-4">Novo acesso</p>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome" required>
              <Input
                value={createForm.nome}
                onChange={(e) => setCreateForm({ ...createForm, nome: e.target.value })}
                required
                placeholder="Nome completo"
              />
            </Field>
            <Field label="Login" required hint="Identificador único de acesso">
              <Input
                value={createForm.login}
                onChange={(e) => setCreateForm({ ...createForm, login: e.target.value })}
                required
                placeholder="ex.: maria.tecnica"
              />
            </Field>
            <Field label="Senha" required>
              <Input
                type="text"
                value={createForm.senha}
                onChange={(e) => setCreateForm({ ...createForm, senha: e.target.value })}
                required
                placeholder="senha inicial"
              />
            </Field>
            <Field label="Papel" required>
              <Select
                value={createForm.papel}
                onChange={(e) => setCreateForm({ ...createForm, papel: e.target.value as UserRole })}
              >
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            {createForm.papel === 'sindico' && (
              <Field label="Condomínio" required hint="Síndico só enxerga o próprio condomínio" >
                <Select
                  value={createForm.condominio_id}
                  onChange={(e) => setCreateForm({ ...createForm, condominio_id: e.target.value })}
                  required
                >
                  <option value="">Selecione...</option>
                  {condominios.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="md:col-span-2 flex items-center justify-between gap-4">
              {createError && <span className="text-xs font-semibold text-amx-red-hover">{createError}</span>}
              <Button type="submit" disabled={creating} className="ml-auto">
                {creating ? 'Criando...' : '+ Criar acesso'}
              </Button>
            </div>
          </form>
        </Card>

        {users.length === 0 ? (
          <EmptyState title="Nenhum usuário cadastrado" />
        ) : (
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <Card key={u.id} className="p-4 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{u.nome}</p>
                  <p className="text-xs text-amx-muted">{u.login}</p>
                </div>
                <Badge tone={PAPEL_TONE[u.papel]}>{ROLE_LABELS[u.papel]}</Badge>
                {u.papel === 'sindico' && (
                  <span className="text-xs text-amx-muted">{condominioNome(u.condominio_id) || 'sem condomínio'}</span>
                )}
                <Badge tone={u.ativo ? 'success' : 'neutral'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setResetTarget(u);
                      setNovaSenha('');
                      setResetError('');
                    }}
                  >
                    Resetar senha
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => handleToggleAtivo(u)}>
                    {u.ativo ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => handleDelete(u)}>
                    Excluir
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="max-w-sm">
        <ModalHeader title={`Redefinir senha — ${resetTarget?.login ?? ''}`} onClose={() => setResetTarget(null)} />
        <form onSubmit={handleResetSenha} className="p-5 flex flex-col gap-4">
          <Field label="Nova senha" required>
            <Input
              type="text"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              required
              autoFocus
            />
          </Field>
          {resetError && <p className="text-xs font-semibold text-amx-red-hover">{resetError}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setResetTarget(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={resetting || !novaSenha}>
              {resetting ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function UsuariosAdmin() {
  return (
    <AppShell>
      <UsuariosContent />
    </AppShell>
  );
}
