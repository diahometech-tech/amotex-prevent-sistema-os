'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Form';
import type { Condominio, IndiceReajuste } from '@/lib/db';
import { cnpjValido, formatarCnpj, limparCnpj, type DadosCnpj } from '@/lib/financeiro/cnpj';
import { INDICE_LABEL } from '@/lib/financeiro/reajuste';

// O formulário trabalha em texto (como o usuário digita); quem valida e
// converte (centavos, CNPJ só dígitos, e-mails) é o servidor, com
// src/lib/financeiro/cadastro.ts.
export type CondominioFormData = Record<string, string | boolean | number | null>;

interface CondominioFormProps {
  initial?: Partial<Condominio>;
  onSubmit: (data: CondominioFormData) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

function centavosParaTexto(c?: number): string {
  return c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

export function CondominioForm({ initial, onSubmit, onCancel, busy = false }: CondominioFormProps) {
  const editando = !!initial?.id;
  const [form, setForm] = useState({
    cnpj: initial?.cnpj ? formatarCnpj(initial.cnpj) : '',
    nome: initial?.nome ?? '',
    razao_social: initial?.razao_social ?? '',
    endereco: initial?.endereco ?? '',
    bairro: initial?.bairro ?? '',
    cidade: initial?.cidade ?? '',
    uf: initial?.uf ?? '',
    cep: initial?.cep ?? '',
    administradora: initial?.administradora ?? '',
    responsavel_nome: initial?.responsavel_nome ?? '',
    responsavel_telefone: initial?.responsavel_telefone ?? '',
    responsavel_email: initial?.responsavel_email ?? '',
    emails_cobranca: initial?.emails_cobranca ?? '',
    valor_mensal: centavosParaTexto(initial?.valor_mensal_centavos),
    dia_vencimento: initial?.dia_vencimento ? String(initial.dia_vencimento) : '',
    contrato_inicio: initial?.contrato_inicio ?? '',
    reajuste_indice: (initial?.reajuste_indice ?? '') as IndiceReajuste | '',
    reajuste_percentual_fixo: initial?.reajuste_percentual_fixo != null ? String(initial.reajuste_percentual_fixo).replace('.', ',') : '',
    preventivas_por_mes: String(initial?.preventivas_por_mes ?? 1),
    observacoes: initial?.observacoes ?? '',
    monitoramento_ativo: initial?.monitoramento_ativo ?? false,
    ativo: initial?.ativo !== false,
  });
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Busca os dados públicos do CNPJ e preenche só o que está vazio — nunca
  // apaga o que o usuário já digitou.
  const buscarCnpj = async () => {
    const cnpj = limparCnpj(form.cnpj);
    if (!cnpjValido(cnpj)) {
      setAviso({ texto: 'CNPJ inválido (confira os números).', ok: false });
      return;
    }
    setBuscando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/cnpj/${cnpj}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      const duplicado = data.existente && data.existente.id !== initial?.id;
      if (duplicado) setAviso({ texto: `Este CNPJ já está cadastrado em "${data.existente.nome}".`, ok: false });
      if (!res.ok || !data.dados) {
        if (!duplicado) setAviso({ texto: data.error || 'Não foi possível consultar o CNPJ.', ok: false });
        return;
      }
      const d: DadosCnpj = data.dados;
      setForm((f) => ({
        ...f,
        cnpj: formatarCnpj(d.cnpj),
        nome: f.nome || d.nome_fantasia || d.razao_social || '',
        razao_social: f.razao_social || d.razao_social || '',
        endereco: f.endereco || d.endereco || '',
        bairro: f.bairro || d.bairro || '',
        cidade: f.cidade || d.cidade || '',
        uf: f.uf || d.uf || '',
        cep: f.cep || d.cep || '',
        responsavel_telefone: f.responsavel_telefone || d.telefone || '',
        emails_cobranca: f.emails_cobranca || d.email || '',
      }));
      if (!duplicado) {
        setAviso({ texto: `Dados da Receita preenchidos${d.situacao ? ` (situação: ${d.situacao})` : ''}. Confira e complete o resto.`, ok: true });
      }
    } catch {
      setAviso({ texto: 'Erro de conexão ao consultar o CNPJ.', ok: false });
    } finally {
      setBuscando(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dados: CondominioFormData = { ...form, cnpj: form.cnpj ? limparCnpj(form.cnpj) : '' };
    if (form.reajuste_indice !== 'fixo') dados.reajuste_percentual_fixo = '';
    if (!editando) delete dados.ativo;
    await onSubmit(dados);
  };

  const input = (k: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Input id={`cond-${k}`} value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} disabled={busy} {...props} />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Secao titulo="Identificação">
        <Field label="CNPJ" hint="Digite e toque Buscar: nome e endereço vêm da Receita">
          <div className="flex gap-2">
            {input('cnpj', { placeholder: '00.000.000/0000-00', inputMode: 'numeric', className: 'flex-1 min-w-0' })}
            <Button type="button" variant="secondary" onClick={buscarCnpj} disabled={busy || buscando || !form.cnpj}>
              {buscando ? 'Buscando...' : 'Buscar'}
            </Button>
          </div>
        </Field>
        {aviso && <p className={`text-xs font-semibold ${aviso.ok ? 'text-amx-green' : 'text-amx-amber'}`}>{aviso.texto}</p>}
        <Field label="Nome" required>
          {input('nome', { placeholder: 'ex.: Condomínio Edifício Gaivotas', required: true })}
        </Field>
        <Field label="Razão social">{input('razao_social')}</Field>
      </Secao>

      <Secao titulo="Endereço">
        <Field label="Endereço">{input('endereco', { placeholder: 'Rua, número - complemento' })}</Field>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2"><Field label="Bairro">{input('bairro')}</Field></div>
          <Field label="CEP">{input('cep', { inputMode: 'numeric' })}</Field>
          <Field label="UF">{input('uf', { maxLength: 2 })}</Field>
        </div>
        <Field label="Cidade">{input('cidade')}</Field>
        <Field label="Administradora">{input('administradora')}</Field>
      </Secao>

      <Secao titulo="Responsável e cobrança">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Responsável" hint="Síndico ou contato na administradora">{input('responsavel_nome')}</Field>
          <Field label="Telefone/WhatsApp">{input('responsavel_telefone', { type: 'tel', placeholder: '(11) 90000-0000' })}</Field>
        </div>
        <Field label="E-mail do responsável">{input('responsavel_email', { type: 'email' })}</Field>
        <Field label="E-mails de cobrança" hint="Para boleto, nota e aviso de reajuste. Separe por ponto e vírgula.">
          {input('emails_cobranca', { placeholder: 'financeiro@adm.com.br; sindico@gmail.com' })}
        </Field>
      </Secao>

      <Secao titulo="Contrato">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Valor mensal (R$)">{input('valor_mensal', { inputMode: 'decimal', placeholder: '500,00' })}</Field>
          <Field label="Dia de vencimento" hint="1 a 28 (padrão 10)">{input('dia_vencimento', { inputMode: 'numeric' })}</Field>
          <Field label="Início do contrato" hint="Aniversário do reajuste">{input('contrato_inicio', { type: 'date' })}</Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Índice de reajuste">
            <Select id="cond-reajuste_indice" value={form.reajuste_indice} onChange={(e) => set('reajuste_indice', e.target.value)} disabled={busy}>
              <option value="">Não informado</option>
              {(Object.keys(INDICE_LABEL) as IndiceReajuste[]).map((k) => (
                <option key={k} value={k}>{INDICE_LABEL[k]}</option>
              ))}
            </Select>
          </Field>
          {form.reajuste_indice === 'fixo' && (
            <Field label="% ao ano">{input('reajuste_percentual_fixo', { inputMode: 'decimal', placeholder: '2,00' })}</Field>
          )}
          <Field label="Preventivas por mês">
            <Select id="cond-preventivas_por_mes" value={form.preventivas_por_mes} onChange={(e) => set('preventivas_por_mes', e.target.value)} disabled={busy}>
              <option value="1">1 (mensal)</option>
              <option value="2">2 (quinzenal)</option>
              <option value="4">4 (semanal)</option>
            </Select>
          </Field>
        </div>
        <Field label="Observações">
          <Textarea id="cond-observacoes" rows={2} value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} disabled={busy} />
        </Field>
      </Secao>

      <Toggle
        checked={form.monitoramento_ativo}
        onChange={(checked) => set('monitoramento_ativo', checked)}
        label="Monitoramento ativo (Agente Hermes)"
        hint="Quando ativo, alertas de sensor geram OS automaticamente"
        disabled={busy}
      />
      {editando && (
        <Toggle
          checked={form.ativo}
          onChange={(checked) => set('ativo', checked)}
          label="Contrato ativo"
          hint="Desligado: sai da carteira, das cobranças e dos reajustes (o histórico fica)"
          disabled={busy}
        />
      )}

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-heading text-[11px] font-semibold tracking-wider uppercase text-amx-blue-light mb-1">{titulo}</legend>
      {children}
    </fieldset>
  );
}
