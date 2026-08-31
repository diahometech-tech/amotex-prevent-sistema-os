'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import type { Equipamento } from '@/lib/db';

interface EquipamentoFormProps {
  onSubmit: (data: Partial<Equipamento>) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

interface CatalogoItem {
  tipo: string;
  modelo?: string;
  potencia_hp?: number;
}

// O label é a chave que identifica o item do catálogo (value do <option>,
// key do React e critério de match na seleção), então precisa ser único.
// `if (item.potencia_hp)` era falso para 0 — e o campo aceita 0 (`min="0"`) —
// fazendo "Bomba X com 0 HP" e "Bomba X sem potência" colidirem no mesmo
// label: chave duplicada no React e seleção do item errado.
function catalogoLabel(item: CatalogoItem): string {
  const partes = [item.tipo];
  if (item.modelo) partes.push(item.modelo);
  if (item.potencia_hp != null) partes.push(`${item.potencia_hp} HP`);
  return partes.join(' — ');
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

  // Combinações já cadastradas em QUALQUER condomínio (bombas/boias se
  // repetem entre condomínios — ver issue #6). Selecionar uma preenche os 3
  // campos abaixo; continuar digitando algo que não bate segue como cadastro
  // novo, sem passo extra — o catálogo se atualiza sozinho na próxima busca.
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/equipamentos/catalogo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.catalogo) setCatalogo(data.catalogo);
      })
      .catch(() => {
        // Catálogo é um atalho, não uma dependência — falha aqui não impede
        // o cadastro manual normal.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuscaChange = (valor: string) => {
    setBusca(valor);
    const item = catalogo.find((c) => catalogoLabel(c) === valor);
    if (item) {
      setForm({ ...form, tipo: item.tipo, modelo: item.modelo ?? '', potencia_hp: item.potencia_hp });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {catalogo.length > 0 && (
        <Field label="Buscar no catálogo" hint="Selecione um equipamento já cadastrado em outro condomínio, ou preencha os campos abaixo manualmente">
          <Input
            list="equipamento-catalogo"
            value={busca}
            onChange={(e) => handleBuscaChange(e.target.value)}
            placeholder="Digite para buscar..."
            disabled={busy}
          />
          <datalist id="equipamento-catalogo">
            {catalogo.map((item) => (
              <option key={catalogoLabel(item)} value={catalogoLabel(item)} />
            ))}
          </datalist>
        </Field>
      )}

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
