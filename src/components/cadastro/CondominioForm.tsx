'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import type { Condominio } from '@/lib/db';

interface CondominioFormProps {
  initial?: Partial<Condominio>;
  onSubmit: (data: Partial<Condominio>) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function CondominioForm({
  initial,
  onSubmit,
  onCancel,
  busy = false,
}: CondominioFormProps) {
  const [form, setForm] = useState<Partial<Condominio>>({
    nome: initial?.nome ?? '',
    endereco: initial?.endereco ?? '',
    administradora: initial?.administradora ?? '',
    monitoramento_ativo: initial?.monitoramento_ativo ?? false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Nome" required>
        <Input
          value={form.nome ?? ''}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          placeholder="ex.: Condomínio Vila Brasil"
          required
          disabled={busy}
        />
      </Field>

      <Field label="Endereço" hint="Completo, com CEP">
        <Input
          value={form.endereco ?? ''}
          onChange={(e) => setForm({ ...form, endereco: e.target.value })}
          placeholder="ex.: Av. Paulista, 1000, São Paulo, SP 01311-100"
          disabled={busy}
        />
      </Field>

      <Field label="Administradora" hint="Empresa responsável pela administração">
        <Input
          value={form.administradora ?? ''}
          onChange={(e) => setForm({ ...form, administradora: e.target.value })}
          placeholder="ex.: Administradora ABC Ltda"
          disabled={busy}
        />
      </Field>

      <Field hint="Quando ativo, alertas de sensor deste condomínio geram OS automaticamente">
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={form.monitoramento_ativo ?? false}
            onChange={(e) =>
              setForm({ ...form, monitoramento_ativo: e.target.checked })
            }
            className="w-4 h-4 accent-amx-navy-600 cursor-pointer"
            disabled={busy}
          />
          <span className="text-sm font-medium text-amx-ink">
            Monitoramento ativo (Agente Hermes)
          </span>
        </label>
      </Field>

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy}
        >
          {busy ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
