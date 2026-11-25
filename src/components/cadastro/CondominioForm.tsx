'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/Form';
import type { Condominio, IndiceReajuste } from '@/lib/db';
import { cnpjValido, formatarCnpj, limparCnpj, type DadosCnpj } from '@/lib/financeiro/cnpj';
import { INDICE_LABEL } from '@/lib/financeiro/reajuste';
import { REGIOES, regiaoPorCep } from '@/lib/regioes';
import { lerCoordenadaColada } from '@/lib/rastreio';
import { obterLocalizacao } from '@/lib/localizacao-cliente';
import { linkMapaCoordenadas } from '@/lib/localizacao';
import { CAMPOS_ENDERECO_CONDOMINIO } from '@/lib/roles';

// O formulário trabalha em texto (como o usuário digita); quem valida e
// converte (centavos, CNPJ só dígitos, e-mails) é o servidor, com
// src/lib/financeiro/cadastro.ts.
export type CondominioFormData = Record<string, string | boolean | number | null>;

interface CondominioFormProps {
  initial?: Partial<Condominio>;
  onSubmit: (data: CondominioFormData) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
  /** Secretária: só a seção Endereço (com a localização no mapa). */
  somenteEndereco?: boolean;
}

function centavosParaTexto(c?: number): string {
  return c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

export function CondominioForm({ initial, onSubmit, onCancel, busy = false, somenteEndereco = false }: CondominioFormProps) {
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
    regiao: initial?.regiao ?? '',
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

  // Localização no mapa (24/11): "lat, lng" colado do Google Maps, link com
  // @lat,lng ou a posição do aparelho. Só vai no pedido se a pessoa mudou.
  const locInicial = initial?.lat != null && initial?.lng != null ? `${Number(initial.lat).toFixed(6)}, ${Number(initial.lng).toFixed(6)}` : '';
  const [loc, setLoc] = useState(locInicial);
  const [locAviso, setLocAviso] = useState<{ texto: string; ok: boolean } | null>(null);
  const [pegandoLoc, setPegandoLoc] = useState(false);
  const usarMinhaLocalizacao = async () => {
    setPegandoLoc(true);
    setLocAviso(null);
    const l = await obterLocalizacao();
    setPegandoLoc(false);
    if (!l) {
      setLocAviso({ texto: 'Não foi possível pegar a localização deste aparelho. Libere o acesso à localização ou cole as coordenadas.', ok: false });
      return;
    }
    setLoc(`${l.lat.toFixed(6)}, ${l.lng.toFixed(6)}`);
    setLocAviso({ texto: `Localização do aparelho preenchida${l.precisao_m !== undefined ? ` (±${l.precisao_m} m)` : ''}. Salve para gravar.`, ok: true });
  };
  const origemLoc = (() => {
    if (!initial || initial.lat == null || initial.lng == null) return null;
    if (initial.localizacao_origem === 'chegada') {
      const dia = initial.localizacao_em
        ? new Date(initial.localizacao_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
        : '';
      return `Origem: pela chegada do técnico${dia ? ` em ${dia}` : ''}.`;
    }
    return 'Origem: informada manualmente.';
  })();

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  // Ao digitar o CEP (8 dígitos), sugere a região da capital. Só preenche se a
  // região ainda está vazia ou é a sugestão do CEP anterior: nunca desfaz uma
  // escolha feita à mão.
  const [regiaoSugerida, setRegiaoSugerida] = useState(initial?.regiao && regiaoPorCep(initial.cep) === initial.regiao ? initial.regiao : '');
  const mudarCep = (cep: string) => {
    const sugestao = regiaoPorCep(cep) ?? '';
    setForm((f) => ({ ...f, cep, regiao: f.regiao === '' || f.regiao === regiaoSugerida ? sugestao : f.regiao }));
    setRegiaoSugerida(sugestao);
  };

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
        regiao: f.regiao || (f.cep ? '' : (regiaoPorCep(d.cep) ?? '')),
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
    if (editando && loc.trim() !== locInicial) {
      if (loc.trim() === '') {
        dados.lat = null;
        dados.lng = null;
      } else {
        const c = lerCoordenadaColada(loc);
        if (!c) {
          setLocAviso({ texto: 'Não entendi a localização. Cole como "-23.5505, -46.6333" ou um link do Google Maps com @lat,lng.', ok: false });
          return;
        }
        dados.lat = c.lat;
        dados.lng = c.lng;
      }
    }
    if (form.reajuste_indice !== 'fixo') dados.reajuste_percentual_fixo = '';
    if (!editando) delete dados.ativo;
    if (somenteEndereco) {
      const permitidos = new Set<string>(CAMPOS_ENDERECO_CONDOMINIO);
      for (const k of Object.keys(dados)) if (!permitidos.has(k)) delete dados[k];
    }
    await onSubmit(dados);
  };

  const input = (k: keyof typeof form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Input id={`cond-${k}`} value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value)} disabled={busy} {...props} />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {!somenteEndereco && (
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
      )}

      <Secao titulo="Endereço">
        <Field label="Endereço">{input('endereco', { placeholder: 'Rua, número - complemento' })}</Field>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2"><Field label="Bairro">{input('bairro')}</Field></div>
          <Field label="CEP">{input('cep', { inputMode: 'numeric', onChange: (e) => mudarCep(e.target.value) })}</Field>
          <Field label="UF">{input('uf', { maxLength: 2 })}</Field>
        </div>
        <Field label="Região" hint="Sugerida pelo CEP; pode trocar. Agrupa as visitas que ficam perto.">
          <Select id="cond-regiao" value={form.regiao} onChange={(e) => set('regiao', e.target.value)} disabled={busy}>
            <option value="">Sem região</option>
            {REGIOES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cidade">{input('cidade')}</Field>
        {!somenteEndereco && <Field label="Administradora">{input('administradora')}</Field>}
        {editando && (
          <Field label="Localização no mapa" hint="Usada para a estimativa de chegada do técnico. No Google Maps, toque e segure no local e copie as coordenadas.">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  id="cond-localizacao"
                  value={loc}
                  onChange={(e) => setLoc(e.target.value)}
                  disabled={busy}
                  placeholder="-23.550520, -46.633308 ou link do Google Maps"
                  className="flex-1 min-w-0"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={usarMinhaLocalizacao} disabled={busy || pegandoLoc}>
                  {pegandoLoc ? 'Pegando a localização...' : 'Usar minha localização atual'}
                </Button>
                {origemLoc && initial?.lat != null && initial?.lng != null && loc.trim() === locInicial && (
                  <a
                    href={linkMapaCoordenadas(Number(initial.lat), Number(initial.lng))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-amx-blue-light hover:text-white transition-colors min-h-[44px] inline-flex items-center"
                  >
                    Ver no mapa
                  </a>
                )}
              </div>
              {origemLoc && loc.trim() === locInicial && <p className="text-xs text-amx-muted">{origemLoc}</p>}
              {!initial?.lat && !loc && <p className="text-xs text-amx-muted">Ainda sem localização. Ela é gravada sozinha na primeira chegada do técnico com boa precisão.</p>}
              {locAviso && <p className={`text-xs font-semibold ${locAviso.ok ? 'text-amx-green' : 'text-amx-amber'}`}>{locAviso.texto}</p>}
            </div>
          </Field>
        )}
      </Secao>

      {!somenteEndereco && (<>
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
      </>)}

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
