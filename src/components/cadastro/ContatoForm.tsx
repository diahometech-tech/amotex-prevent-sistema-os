'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import type { Contato } from '@/lib/db';

interface ContatoFormProps {
  initial?: Partial<Contato>;
  onSubmit: (data: Partial<Contato>) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

const getIdentificadorHint = (
  canal: 'telegram' | 'whatsapp' | 'email'
): string => {
  switch (canal) {
    case 'whatsapp':
      return 'Número com DDD, ex.: +55 11 99999-9999';
    case 'telegram':
      return '@usuário do Telegram, ex.: @joaosilva';
    case 'email':
      return 'E-mail, ex.: joao@example.com';
  }
};

const getIdentificadorPlaceholder = (
  canal: 'telegram' | 'whatsapp' | 'email'
): string => {
  switch (canal) {
    case 'whatsapp':
      return '+55 11 99999-9999';
    case 'telegram':
      return '@usuario_telegram';
    case 'email':
      return 'contato@example.com';
  }
};

export function ContatoForm({
  initial,
  onSubmit,
  onCancel,
  busy = false,
}: ContatoFormProps) {
  const [form, setForm] = useState<Partial<Contato>>({
    nome: initial?.nome ?? '',
    papel: initial?.papel ?? 'zelador',
    canal_preferencial: initial?.canal_preferencial ?? 'whatsapp',
    identificador_canal: initial?.identificador_canal ?? '',
    nivel_escalonamento: initial?.nivel_escalonamento ?? 1,
    ativo: initial?.ativo !== undefined ? initial.ativo : true,
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
          placeholder="ex.: João Silva"
          required
          disabled={busy}
        />
      </Field>

      <Field label="Papel" required>
        <Select
          value={form.papel ?? 'zelador'}
          onChange={(e) =>
            setForm({
              ...form,
              papel: e.target.value as
                | 'zelador'
                | 'sindico'
                | 'administradora'
                | 'conservadora'
                | 'plantao',
            })
          }
          disabled={busy}
        >
          <option value="zelador">Zelador</option>
          <option value="sindico">Síndico</option>
          <option value="administradora">Administradora</option>
          <option value="conservadora">Conservadora</option>
          <option value="plantao">Plantão</option>
        </Select>
      </Field>

      <Field label="Canal Preferencial" required>
        <Select
          value={form.canal_preferencial ?? 'whatsapp'}
          onChange={(e) =>
            setForm({
              ...form,
              canal_preferencial: e.target.value as
                | 'telegram'
                | 'whatsapp'
                | 'email',
            })
          }
          disabled={busy}
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram">Telegram</option>
          <option value="email">E-mail</option>
        </Select>
      </Field>

      <Field
        label={
          form.canal_preferencial === 'email'
            ? 'E-mail'
            : form.canal_preferencial === 'telegram'
              ? '@usuário'
              : 'Número com DDD'
        }
        required
        hint={getIdentificadorHint(form.canal_preferencial ?? 'whatsapp')}
      >
        <Input
          value={form.identificador_canal ?? ''}
          onChange={(e) =>
            setForm({ ...form, identificador_canal: e.target.value })
          }
          placeholder={getIdentificadorPlaceholder(
            form.canal_preferencial ?? 'whatsapp'
          )}
          required
          disabled={busy}
        />
      </Field>

      <Field label="Nível de Escalonamento" required>
        <Select
          value={form.nivel_escalonamento?.toString() ?? '1'}
          onChange={(e) =>
            setForm({
              ...form,
              nivel_escalonamento: parseInt(e.target.value) as 1 | 2 | 3,
            })
          }
          disabled={busy}
        >
          <option value="1">Nível 1 (primeiro a ser acionado)</option>
          <option value="2">Nível 2</option>
          <option value="3">Nível 3 (último recurso)</option>
        </Select>
      </Field>

      <Field>
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={form.ativo ?? true}
            onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
            className="w-4 h-4 accent-amx-red cursor-pointer"
            disabled={busy}
          />
          <span className="text-sm font-medium text-white">Ativo</span>
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
