'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import type { Reservatorio } from '@/lib/db';

interface ReservatorioFormProps {
  initial?: Partial<Reservatorio>;
  onSubmit: (data: Partial<Reservatorio>) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function ReservatorioForm({
  initial,
  onSubmit,
  onCancel,
  busy = false,
}: ReservatorioFormProps) {
  const [form, setForm] = useState<Partial<Reservatorio>>({
    nome_interno: initial?.nome_interno ?? '',
    nome_sensorlog: initial?.nome_sensorlog ?? '',
    tipo: initial?.tipo ?? 'cisterna',
    capacidade_litros: initial?.capacidade_litros ?? undefined,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        label="Nome Interno"
        required
        hint="Nome usado internamente, ex.: Caixa Torre 03"
      >
        <Input
          value={form.nome_interno ?? ''}
          onChange={(e) => setForm({ ...form, nome_interno: e.target.value })}
          placeholder="ex.: Caixa Torre 03"
          required
          disabled={busy}
        />
      </Field>

      <Field
        label="Nome SensorLog"
        required
        hint="Precisa ser IDÊNTICO ao nome que a SensorLog usa pra esse reservatório — é assim que o Hermes resolve o alerta"
      >
        <Input
          value={form.nome_sensorlog ?? ''}
          onChange={(e) => setForm({ ...form, nome_sensorlog: e.target.value })}
          placeholder="ex.: Caixa 3 (deve ser EXATO)"
          required
          disabled={busy}
        />
      </Field>

      <Field label="Tipo" required>
        <Select
          value={form.tipo ?? 'cisterna'}
          onChange={(e) =>
            setForm({
              ...form,
              tipo: e.target.value as 'cisterna' | 'superior' | 'torre',
            })
          }
          disabled={busy}
        >
          <option value="cisterna">Cisterna</option>
          <option value="superior">Superior</option>
          <option value="torre">Torre</option>
        </Select>
      </Field>

      <Field label="Capacidade (Litros)">
        <Input
          type="number"
          value={form.capacidade_litros ?? ''}
          onChange={(e) =>
            setForm({
              ...form,
              // null (e não undefined) ao esvaziar: JSON.stringify descarta
              // chaves undefined, então o PATCH nem enviava o campo e a
              // capacidade antiga continuava gravada em silêncio.
              capacidade_litros: e.target.value
                ? parseInt(e.target.value)
                : null,
            })
          }
          placeholder="ex.: 5000"
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
