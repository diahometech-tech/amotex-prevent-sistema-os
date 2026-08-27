'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import type { Equipamento } from '@/lib/db';

interface EquipamentoFormProps {
  onSubmit: (data: Partial<Equipamento>) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function EquipamentoForm({
  onSubmit,
  onCancel,
  busy = false,
}: EquipamentoFormProps) {
  const [form, setForm] = useState<Partial<Equipamento>>({
    tipo: '',
    modelo: '',
    potencia_hp: undefined,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Tipo" required>
        <Input
          value={form.tipo ?? ''}
          onChange={(e) => setForm({ ...form, tipo: e.target.value })}
          placeholder="ex.: Bomba d'água, Pressurizador"
          required
          disabled={busy}
        />
      </Field>

      <Field label="Modelo">
        <Input
          value={form.modelo ?? ''}
          onChange={(e) => setForm({ ...form, modelo: e.target.value })}
          placeholder="ex.: WEG 1050"
          disabled={busy}
        />
      </Field>

      <Field label="Potência (HP)">
        <Input
          type="number"
          value={form.potencia_hp ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              potencia_hp: e.target.value ? parseFloat(e.target.value) : undefined,
            })
          }
          placeholder="ex.: 2.0"
          step="0.1"
          min="0"
          disabled={busy}
        />
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
