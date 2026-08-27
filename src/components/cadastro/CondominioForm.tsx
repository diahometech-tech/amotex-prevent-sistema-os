'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Toggle } from '@/components/ui/Form';
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

      <Toggle
        checked={form.monitoramento_ativo ?? false}
        onChange={(checked) => setForm({ ...form, monitoramento_ativo: checked })}
        label="Monitoramento ativo (Agente Hermes)"
        hint="Quando ativo, alertas de sensor geram OS automaticamente"
        disabled={busy}
      />

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
          disabled={busy}
        >
          {busy ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
