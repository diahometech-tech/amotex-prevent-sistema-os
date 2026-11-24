'use client';

// Bloco "Contatos do condomínio" dentro da OS: Ligar, Adicionar contato e
// Editar. O técnico cadastra e corrige zelador/gerente/portaria/síndico dos
// condomínios das OS dele (só nome, papel e telefone; sem excluir e sem mexer
// no nível de escalonamento). O servidor confere o vínculo com a OS.
import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import type { Contato } from '@/lib/db';
import { telefoneDiscavel } from '@/lib/endereco';
import { PAPEIS_CONTATO_TECNICO, ROTULO_PAPEL_CONTATO, nivelPadraoDoPapel } from '@/lib/contato-acesso';

type PapelEscolha = Contato['papel'];

export function ContatosDoCondominio({
  condominioId,
  contatos,
  podeEditar,
  onChange,
}: {
  condominioId: string;
  contatos: Contato[];
  podeEditar: boolean;
  onChange: (contatos: Contato[]) => void;
}) {
  // null = fechado; 'novo' = adicionando; Contato = editando.
  const [form, setForm] = useState<Contato | 'novo' | null>(null);
  const [nome, setNome] = useState('');
  const [papel, setPapel] = useState<PapelEscolha>('zelador');
  const [telefone, setTelefone] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const abrirNovo = () => {
    setNome('');
    setPapel('zelador');
    setTelefone('');
    setErro('');
    setForm('novo');
  };
  const abrirEdicao = (c: Contato) => {
    setNome(c.nome);
    setPapel(c.papel);
    setTelefone(c.identificador_canal);
    setErro('');
    setForm(c);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || salvando) return;
    if (nome.trim().length < 2) return setErro('Informe o nome.');
    if (!telefoneDiscavel(telefone)) return setErro('Telefone inválido. Informe o DDD e o número.');
    setSalvando(true);
    setErro('');
    try {
      const res =
        form === 'novo'
          ? await fetch(`/api/condominios/${condominioId}/contatos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nome: nome.trim(),
                papel,
                canal_preferencial: 'whatsapp',
                identificador_canal: telefone.trim(),
                nivel_escalonamento: nivelPadraoDoPapel(papel),
              }),
            })
          : await fetch(`/api/contatos/${form.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nome: nome.trim(),
                identificador_canal: telefone.trim(),
                ...(papel !== form.papel ? { papel } : {}),
              }),
            });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.contato) {
        onChange(
          form === 'novo'
            ? [...contatos, data.contato]
            : contatos.map((c) => (c.id === data.contato.id ? data.contato : c))
        );
        setForm(null);
      } else {
        setErro(data.error || 'Não foi possível salvar o contato.');
      }
    } catch {
      setErro('Sem conexão. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const ativos = contatos.filter((c) => c.ativo);
  const opcoesPapel: PapelEscolha[] =
    form && form !== 'novo' && !PAPEIS_CONTATO_TECNICO.includes(form.papel)
      ? [form.papel, ...PAPEIS_CONTATO_TECNICO]
      : PAPEIS_CONTATO_TECNICO;

  return (
    <div className="rounded-lg border border-amx-line bg-amx-panel-2/40 px-3.5 py-3 flex flex-col gap-2.5">
      <p className="font-heading text-[11px] font-semibold tracking-wider text-amx-muted">CONTATOS DO CONDOMÍNIO</p>
      {ativos.length === 0 ? (
        <p className="text-[13px] text-amx-muted">Nenhum contato cadastrado.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-amx-line">
          {ativos.map((c) => {
            const tel = c.canal_preferencial === 'email' ? null : telefoneDiscavel(c.identificador_canal);
            // O técnico só edita contato de WhatsApp; o resto é do escritório.
            const editavel = podeEditar && c.canal_preferencial === 'whatsapp';
            return (
              <li key={c.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-[13px] font-semibold text-white truncate">{c.nome}</p>
                  <p className="text-xs text-amx-muted">
                    {ROTULO_PAPEL_CONTATO[c.papel]} · {c.identificador_canal}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {tel && (
                    <a
                      href={tel}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amx-red hover:bg-amx-red-hover text-white text-xs font-semibold px-3 min-h-[44px]"
                    >
                      <Icon name="telefone" size={14} />
                      Ligar
                    </a>
                  )}
                  {editavel && (
                    <button
                      type="button"
                      onClick={() => abrirEdicao(c)}
                      className="inline-flex items-center rounded-lg border border-amx-line text-xs font-semibold text-white hover:border-amx-muted px-3 min-h-[44px]"
                    >
                      Editar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {podeEditar && (
        <Button size="sm" variant="secondary" onClick={abrirNovo} className="w-fit min-h-[44px]">
          <Icon name="mais" size={14} />
          Adicionar contato
        </Button>
      )}

      <Modal open={form !== null} onClose={salvando ? () => {} : () => setForm(null)} maxWidth="max-w-md">
        <ModalHeader title={form === 'novo' ? 'Adicionar contato' : 'Editar contato'} onClose={() => !salvando && setForm(null)} />
        <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
          <Field label="Nome" required>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus />
          </Field>
          <Field label="Quem é" required>
            <Select value={papel} onChange={(e) => setPapel(e.target.value as PapelEscolha)}>
              {opcoesPapel.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PAPEL_CONTATO[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Telefone ou WhatsApp" required hint="Com DDD, ex.: (11) 99999-9999">
            <Input type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={40} />
          </Field>
          {erro && <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{erro}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setForm(null)} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" size="sm" disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
