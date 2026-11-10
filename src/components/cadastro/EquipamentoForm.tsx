'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import type { Equipamento } from '@/lib/db';
import { CATEGORIAS_EQUIPAMENTO, CATEGORIA_OUTRO, categoriaDoTipo } from '@/lib/catalogo-equipamentos';
import { fotoReduzidaDataUrl } from '@/lib/imagem-cliente';

// O que o formulário entrega: os campos do equipamento + `foto` (data URL)
// quando uma foto nova foi tirada. Ver POST /api/condominios/[id]/equipamentos
// e PATCH /api/equipamentos/[id].
export type EquipamentoFormData = Partial<Equipamento> & { foto?: string };

interface EquipamentoFormProps {
  inicial?: Equipamento;
  onSubmit: (data: EquipamentoFormData) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

interface CatalogoItem {
  tipo: string;
  modelo?: string;
  potencia_hp?: number;
}

const OUTRO_TIPO = '__outro__';

function tiposDe(categoria: string): string[] {
  return CATEGORIAS_EQUIPAMENTO.find((c) => c.id === categoria)?.tipos ?? [];
}

export function EquipamentoForm({ inicial, onSubmit, onCancel, busy = false }: EquipamentoFormProps) {
  const categoriaInicial = inicial ? inicial.categoria ?? categoriaDoTipo(inicial.tipo) ?? CATEGORIA_OUTRO : '';
  const tipoInicialNoCatalogo = !!inicial && tiposDe(categoriaInicial).includes(inicial.tipo);
  const [categoria, setCategoria] = useState<string>(categoriaInicial);
  const [tipoEscolhido, setTipoEscolhido] = useState<string>(
    inicial ? (tipoInicialNoCatalogo ? inicial.tipo : OUTRO_TIPO) : ''
  );
  const [tipoLivre, setTipoLivre] = useState(inicial && !tipoInicialNoCatalogo ? inicial.tipo : '');
  const [identificacao, setIdentificacao] = useState(inicial?.identificacao ?? '');
  const [modelo, setModelo] = useState(inicial?.modelo ?? '');
  const [potencia, setPotencia] = useState(inicial?.potencia_hp != null ? String(inicial.potencia_hp) : '');
  const [foto, setFoto] = useState<string | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [erro, setErro] = useState('');
  const fotoRef = useRef<HTMLInputElement>(null);

  // Modelos/potências já cadastrados em outros condomínios: sugestão pro
  // campo Modelo do mesmo tipo (bombas se repetem entre condomínios).
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/equipamentos/catalogo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.catalogo) setCatalogo(data.catalogo);
      })
      .catch(() => {
        // Sugestão é atalho; sem ela o cadastro segue manual.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const outro = categoria === CATEGORIA_OUTRO || tipoEscolhido === OUTRO_TIPO;
  const tipo = outro ? tipoLivre : tipoEscolhido;
  const modelosSugeridos = useMemo(() => catalogo.filter((c) => c.tipo === tipo && c.modelo), [catalogo, tipo]);

  const escolherModelo = (valor: string) => {
    setModelo(valor);
    const item = modelosSugeridos.find((c) => c.modelo === valor);
    if (item?.potencia_hp != null && !potencia) setPotencia(String(item.potencia_hp));
  };

  const escolherFoto = async (file?: File) => {
    if (!file) return;
    setPreparandoFoto(true);
    try {
      setFoto(await fotoReduzidaDataUrl(file));
    } finally {
      setPreparandoFoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!categoria) return setErro('Escolha a categoria.');
    if (!tipo.trim()) return setErro('Escolha ou digite o tipo do equipamento.');
    const pot = potencia.trim() === '' ? undefined : Number(potencia.replace(',', '.'));
    if (pot !== undefined && !Number.isFinite(pot)) return setErro('Potência deve ser um número, ex.: 1,5');
    await onSubmit({
      categoria,
      tipo: tipo.trim(),
      identificacao,
      modelo,
      potencia_hp: pot,
      ...(foto ? { foto } : {}),
    });
  };

  const fotoAtual = foto ?? inicial?.foto_url;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Categoria" required>
        <Select
          value={categoria}
          onChange={(e) => {
            setCategoria(e.target.value);
            setTipoEscolhido('');
          }}
          disabled={busy}
        >
          <option value="">Escolha…</option>
          {CATEGORIAS_EQUIPAMENTO.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
          <option value={CATEGORIA_OUTRO}>Outro</option>
        </Select>
      </Field>

      {categoria && categoria !== CATEGORIA_OUTRO && (
        <Field label="Tipo" required>
          <Select value={tipoEscolhido} onChange={(e) => setTipoEscolhido(e.target.value)} disabled={busy}>
            <option value="">Escolha…</option>
            {tiposDe(categoria).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={OUTRO_TIPO}>Outro (digitar)</option>
          </Select>
        </Field>
      )}

      {categoria && outro && (
        <Field label="Qual equipamento?" required>
          <Input
            value={tipoLivre}
            onChange={(e) => setTipoLivre(e.target.value)}
            placeholder="ex.: Bomba de reaproveitamento da piscina"
            disabled={busy}
          />
        </Field>
      )}

      <Field label="Identificação no local" hint="Como a equipe acha o equipamento: número, posição, casa de bombas.">
        <Input
          value={identificacao}
          onChange={(e) => setIdentificacao(e.target.value)}
          placeholder="ex.: Bomba 2 — barrilete, torre A"
          disabled={busy}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
        <Field label="Marca / modelo">
          <Input
            list="equipamento-modelos"
            value={modelo}
            onChange={(e) => escolherModelo(e.target.value)}
            placeholder="ex.: WEG 1050"
            disabled={busy}
          />
          <datalist id="equipamento-modelos">
            {modelosSugeridos.map((c) => (
              <option key={`${c.modelo}-${c.potencia_hp ?? ''}`} value={c.modelo} />
            ))}
          </datalist>
        </Field>
        <Field label="Potência (CV/HP)">
          <Input
            inputMode="decimal"
            value={potencia}
            onChange={(e) => setPotencia(e.target.value)}
            placeholder="ex.: 2"
            disabled={busy}
          />
        </Field>
      </div>

      <Field label="Foto" hint="Do equipamento inteiro, com a plaqueta legível se der.">
        <div className="flex items-center gap-3">
          {fotoAtual ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto autenticada servida por /uploads, sem otimização do Next
            <img src={fotoAtual} alt="Foto do equipamento" className="h-20 w-20 object-cover rounded-[10px] border border-amx-line" />
          ) : (
            <div className="h-20 w-20 rounded-[10px] border border-dashed border-amx-line grid place-items-center text-[11px] text-amx-muted">
              sem foto
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fotoRef.current?.click()}
            disabled={busy || preparandoFoto}
          >
            {preparandoFoto ? 'Preparando…' : fotoAtual ? 'Trocar foto' : 'Tirar foto'}
          </Button>
          <input
            ref={fotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              escolherFoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </Field>

      {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={busy || preparandoFoto}>
          {busy ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}
