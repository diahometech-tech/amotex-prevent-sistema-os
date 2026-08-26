'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Dossier, ActivityLog } from '@/lib/db';
import { computeSla, computeBottlenecks } from '@/lib/sla';
import { useIdleLogout } from '@/lib/useIdleLogout';
import { normalizeSearch, certificadoA1FileName, empresaOuPessoa } from '@/lib/text';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';
import 'react-day-picker/style.css';

// Mapas de cor por tom semântico do SLA (classes literais p/ o Tailwind detectar).
const SLA_BADGE_TONE: Record<'sky' | 'amber' | 'rose' | 'emerald', string> = {
  sky: 'text-slate-400',
  amber: 'text-amber-400 bg-amber-950/20 border border-amber-900/30',
  rose: 'text-rose-400 bg-rose-950/30 border border-rose-900/40',
  emerald: 'text-emerald-400',
};

const SLA_DOT_TONE: Record<'sky' | 'amber' | 'rose' | 'emerald', string> = {
  sky: 'bg-slate-500',
  amber: 'bg-amber-400 animate-pulse',
  rose: 'bg-rose-500 animate-pulse',
  emerald: 'bg-emerald-400',
};

// Realce de borda do card quando a OS está em atenção/atraso.
const SLA_CARD_ACCENT: Record<'sky' | 'amber' | 'rose' | 'emerald', string> = {
  sky: '',
  amber: 'ring-1 ring-amber-500/30',
  rose: 'ring-1 ring-rose-500/40',
  emerald: '',
};

type EmpresaData = {
  empresa_nome: string; nome_fantasia: string; empresa_endereco: string; cnae: string; capital_social: string;
  quadro_societario: string; regime_tributario: string; porte_empresa: string; forma_atuacao: string; gov_socios: string;
  forma_pagamento: string; codigo_acesso: string;
};

// Opções de "Forma de Atuação" — mesmas categorias do cadastro na Junta
// Comercial/Simples Nacional (pedido explícito, print de referência do
// próprio portal do governo). Uma empresa pode ter mais de uma forma ao
// mesmo tempo (ex.: Internet + Televendas), por isso é seleção múltipla.
const FORMA_ATUACAO_OPTIONS = [
  'Atividade Desenvolvida Fora do Estabelecimento',
  'Correio',
  'Em Local Fixo Fora de Loja',
  'Internet',
  'Máquinas Automáticas',
  'Porta a Porta, Postos Móveis ou por Ambulantes',
  'Televendas',
] as const;
type AberturaChecklist = {
  cad_junta: boolean; cad_receita: boolean; cad_estado: boolean; cad_prefeitura: boolean;
  planilha_mensalidade: boolean; planilha_simples: boolean;
  opcao_simples: boolean; criar_pasta_rede: boolean;
};

const EMPRESA_FIELDS: { key: keyof EmpresaData; label: string; placeholder?: string; options?: { value: string; label: string }[]; multi?: boolean }[] = [
  { key: 'empresa_nome', label: 'Nome da Empresa (Razão Social)' },
  { key: 'nome_fantasia', label: 'Nome Fantasia' },
  { key: 'empresa_endereco', label: 'Endereço da Empresa', placeholder: 'Rua, Número, Bairro, Cidade - UF' },
  { key: 'cnae', label: 'Atividades (CNAE)' },
  { key: 'capital_social', label: 'Capital Social', placeholder: 'R$ 0,00' },
  { key: 'quadro_societario', label: 'Quadro Societário' },
  { key: 'regime_tributario', label: 'Regime Tributário', placeholder: 'Simples Nacional / Lucro Presumido...' },
  { key: 'porte_empresa', label: 'Porte da Empresa', options: [
    { value: 'ME', label: 'ME (Micro Empresa)' },
    { value: 'EPP', label: 'EPP (Empresa de Pequeno Porte)' },
  ] },
  { key: 'forma_atuacao', label: 'Forma de Atuação', multi: true,
    options: FORMA_ATUACAO_OPTIONS.map(o => ({ value: o, label: o })) },
  { key: 'gov_socios', label: 'Gov.br dos Sócios' },
  { key: 'forma_pagamento', label: 'Forma de Pagamento' },
  { key: 'codigo_acesso', label: 'Código de Acesso' },
];

const CHECKLIST_FIELDS: { key: keyof AberturaChecklist; label: string }[] = [
  { key: 'cad_junta', label: 'Cadastro Junta Comercial' },
  { key: 'cad_receita', label: 'Cadastro Receita Federal' },
  { key: 'cad_estado', label: 'Cadastro Estado' },
  { key: 'cad_prefeitura', label: 'Cadastro Prefeitura' },
  { key: 'planilha_mensalidade', label: 'Planilha de Mensalidade' },
  { key: 'planilha_simples', label: 'Planilha do Simples' },
  { key: 'opcao_simples', label: 'Opção do Simples' },
  { key: 'criar_pasta_rede', label: 'Criar Pasta na Rede' },
];

// Contadores responsáveis pela abertura de empresa — dados completos para o diretório.
const CONTADORES_INFO = [
  { key: 'Joao', label: 'João', nome: 'João Nakayama Filho', crc: '347659/0-9', cpf: '135.523.468-99', endereco: 'Rua Pindava, 178', email: 'joaonakayama123@gmail.com', telefone: '11 99495-2112' },
  { key: 'Keli', label: 'Keli', nome: 'Keli Farias de Sá', crc: '1SP214158/0-7', cpf: '189.749.588-99', endereco: 'Rua Madre Emilie de Villeneuve, 360', email: 'keli@contex.com.br', telefone: '11 5563-9900 / 11 95563-9900' },
  { key: 'Arnaldo', label: 'Arnaldo', nome: 'Arnaldo Augusto de Sá Neto', crc: '1SP206373/0-0', cpf: '146.825.828-10', endereco: 'Rua Madre Emilie de Villeneuve, 360', email: 'atendimento@contex.com.br', telefone: '11 5679-7515 / 11 95679-7515' },
] as const;
const CONTADORES = CONTADORES_INFO.map((c) => c.label);

// Rótulos amigáveis dos papéis (para exibir a sessão atual).
// Quais etapas cada papel enxerga (isola o fluxo de trabalho de cada acesso).
type Step = 'captacao' | 't1' | 't2' | 't3' | 'finalizado';
function stepsForRole(role: string): Step[] {
  switch (role) {
    case 'gestor':
    case 'admin':
      return ['captacao', 't1', 't2', 't3', 'finalizado'];
    case 'operador_abertura':
      // Só enxerga a partir da E3 (abertura) — não vê Captados, Recusadas,
      // E1 nem E2. "Finalizado" é filtrado depois por resp_abertura (só as
      // OS que ele mesmo trabalhou), não a esteira inteira.
      return ['t3', 'finalizado'];
    case 'operador_certificacao':
      return ['t3', 'finalizado'];
    case 'terceiro':
      return ['finalizado'];
    default:
      return [];
  }
}

const ROLE_LABELS: Record<string, string> = {
  captador: '📸 Captador',
  operador_certificacao: '📜 Certificação (BIRD/A1)',
  operador_abertura: '🏢 Abertura de Empresa',
  gestor: '💼 Gestor',
  admin: '💻 Administrador',
  terceiro: '🤝 Terceiro',
};

// ---------------------------------------------------------------------------
// Upload de certificados A1 em lote
// ---------------------------------------------------------------------------
// Um item da conferência: o arquivo lido, a OS escolhida e o que aconteceu
// com ele depois do envio. `status` descreve o CASAMENTO, não o envio.
interface LoteA1Item {
  nome: string;
  data: string;               // data URL — enviada ao /upload como qualquer anexo
  osId: string;               // vazio = ainda sem OS escolhida
  status: 'auto' | 'ambiguo' | 'nenhum';
  candidatos: string[];       // ids das OS que casaram (pra montar o select)
  resultado?: string;         // preenchido só depois de confirmar
}

// Normaliza nome de arquivo e razão social pro mesmo formato comparável:
// sem acento, sem extensão, sem sufixo societário e sem pontuação. A regra
// de negócio é do próprio certificador — "todo certificado hoje tem o nome
// da empresa; se divergir, está errado".
function normalizeEmpresa(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/\b(ltda|me|epp|eireli|sa|s\/a)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Casa um nome de arquivo com as OS do pool. Tenta CNPJ (dígitos no nome do
// arquivo) primeiro — é identificador exato — e só depois o nome da empresa.
function matchArquivoParaOS(nomeArquivo: string, pool: Dossier[]): string[] {
  const digits = nomeArquivo.replace(/\D/g, '');
  if (digits.length >= 14) {
    const porCnpj = pool.filter((d) => d.cnpj_number && digits.includes(d.cnpj_number.replace(/\D/g, '')));
    if (porCnpj.length > 0) return porCnpj.map((d) => d.id);
  }
  const alvo = normalizeEmpresa(nomeArquivo);
  if (!alvo) return [];
  const casaram = pool.filter((d) => {
    if (!d.empresa_nome) return false;
    const emp = normalizeEmpresa(d.empresa_nome);
    // Nome curto demais casaria com quase tudo — exige um mínimo de sinal.
    if (emp.length < 4) return false;
    return alvo.includes(emp) || emp.includes(alvo);
  });
  // Mais específico primeiro: se "ACME" e "ACME COMERCIO" casarem, o mais
  // longo é o palpite melhor — mas os dois continuam na lista como
  // candidatos, porque com 2+ a conferência vira manual de qualquer forma.
  return casaram
    .sort((a, b) => normalizeEmpresa(b.empresa_nome!).length - normalizeEmpresa(a.empresa_nome!).length)
    .map((d) => d.id);
}

// Campo de anexo: faz upload de um arquivo (imagem/PDF) para um campo do dossiê.
function FileAttach({
  dossierId, field, label, currentUrl, operator, onUploaded, accept, disabled, disabledMessage,
  sendOriginalName, downloadName,
}: {
  dossierId: string;
  field: string;
  label: string;
  currentUrl?: string;
  operator: string;
  onUploaded: () => void;
  // undefined = usa o default (imagem/PDF/.pfx); string vazia ("") = SEM
  // restrição — o seletor nativo do SO abre com "Todos os arquivos" em vez
  // de "Arquivos personalizados" (10/08/2026, pedido real: o Certificado A1
  // é .zip/.rar, que nem estava no default, então o operador tinha que
  // trocar manualmente o filtro do seletor toda vez pra achar o arquivo).
  // Por isso o input usa `accept ?? default` (nullish coalescing), não
  // `accept || default` — precisa distinguir "não passou nada" de "passou
  // vazio de propósito".
  accept?: string;
  disabled?: boolean;
  disabledMessage?: string;
  // Só usado pelo Certificado A1 até aqui (10/08/2026) — os demais campos já
  // têm nome amigável fixo, não precisam do nome original do arquivo.
  sendOriginalName?: boolean;
  // Nome sugerido pro navegador ao clicar "Baixar" (ver certificadoA1FileName
  // em src/lib/text.ts) — sem isso, o atributo `download` vazio faz o
  // navegador usar o nome bruto salvo em disco (nome do CAMPO, não do
  // certificado).
  downloadName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const inputId = `file_${field}`;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch(`/api/dossiers/${dossierId}/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field, data: reader.result, operator_name: operator,
            ...(sendOriginalName ? { original_name: file.name } : {}),
          }),
        });
        if (res.ok) onUploaded();
        else alert('Falha ao enviar o anexo.');
      } catch {
        alert('Falha ao enviar o anexo.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    if (!confirm(`Excluir o arquivo "${label}"? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/dossiers/${dossierId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: '' }),
      });
      if (res.ok) onUploaded();
      else alert('Falha ao excluir o anexo.');
    } catch {
      alert('Falha ao excluir o anexo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold text-slate-400">{label}</label>
      <div className="flex items-center gap-2 flex-wrap">
        <label
          htmlFor={disabled ? undefined : inputId}
          className={`text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
            disabled
              ? 'opacity-50 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
              : `cursor-pointer bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200${busy ? ' opacity-60 pointer-events-none' : ''}`
          }`}
        >
          {busy ? '⏳...' : currentUrl ? '🔄 Substituir' : '📎 Anexar'}
        </label>
        <input id={inputId} type="file" accept={accept ?? 'image/*,application/pdf,.pfx'} className="hidden" onChange={handleFile} disabled={disabled} />
        {disabled && disabledMessage && (
          <span className="text-[10px] text-amber-500 italic">{disabledMessage}</span>
        )}
        {currentUrl && (
          <>
            <a href={currentUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">
              👁️ Ver
            </a>
            <a href={currentUrl} download={downloadName || true} className="text-xs text-emerald-400 hover:underline">
              ⬇️ Baixar
            </a>
            <button type="button" onClick={handleDelete} disabled={busy} className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40">
              🗑️ Excluir
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Anexo avulso (1 de 3 slots livres): além do arquivo, pede um nome digitado
// por quem anexa — sem isso um "Documento avulso 2" não diz nada pra quem
// olhar o dossiê depois. O nome é salvo via PATCH assim que o campo perde o
// foco; o arquivo reaproveita o FileAttach normal.
function GenericDocAttach({
  dossierId, index, nome, url, operator, onSaved,
}: {
  dossierId: string;
  index: 1 | 2 | 3;
  nome?: string;
  url?: string;
  operator: string;
  onSaved: () => void;
}) {
  const [nomeVal, setNomeVal] = useState(nome || '');
  // Ressincroniza ao trocar de OS selecionada (o componente não desmonta,
  // só troca de props) — sem isso o campo ficava com o nome da OS anterior.
  useEffect(() => { setNomeVal(nome || ''); }, [dossierId, nome]);
  const urlField = `doc_extra_${index}_url`;
  const nomeField = `doc_extra_${index}_nome`;

  const saveNome = async () => {
    if (nomeVal.trim() === (nome || '').trim()) return;
    try {
      await fetch(`/api/dossiers/${dossierId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [nomeField]: nomeVal.trim(), operator_name: operator }),
      });
      onSaved();
    } catch {
      alert('Falha ao salvar o nome do documento.');
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-slate-800/60 pt-2.5 first:border-t-0 first:pt-0">
      <input
        type="text"
        value={nomeVal}
        onChange={(e) => setNomeVal(e.target.value)}
        onBlur={saveNome}
        placeholder={`Nome do documento avulso ${index} (ex.: Procuração assinada)`}
        className="text-xs bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 outline-none focus:border-sky-500"
      />
      <FileAttach
        dossierId={dossierId}
        field={urlField}
        label={nomeVal.trim() || `Documento avulso ${index}`}
        currentUrl={url}
        operator={operator}
        onUploaded={onSaved}
      />
    </div>
  );
}

// Bloco de dados da abertura da empresa (alimenta a OS de Abertura).
// Formata dígitos em moeda BRL (R$ 1.234,56) enquanto o usuário digita.
function formatCurrencyBRL(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Formata dígitos como CPF (000.000.000-00) enquanto o usuário digita.
function formatCPF(raw: string): string {
  let value = raw.replace(/\D/g, '').slice(0, 11);
  if (value.length > 9) {
    value = value.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2})$/, '$1.$2.$3-$4');
  } else if (value.length > 6) {
    value = value.replace(/^(\d{3})(\d{3})(\d{0,3})$/, '$1.$2.$3');
  } else if (value.length > 3) {
    value = value.replace(/^(\d{3})(\d{0,3})$/, '$1.$2');
  }
  return value;
}

// Formata dígitos como CNPJ (00.000.000/0001-00) enquanto o usuário digita.
function formatCNPJ(raw: string): string {
  let value = raw.replace(/\D/g, '').slice(0, 14);
  if (value.length > 12) {
    value = value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/, '$1.$2.$3/$4-$5');
  } else if (value.length > 8) {
    value = value.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})$/, '$1.$2.$3/$4');
  } else if (value.length > 5) {
    value = value.replace(/^(\d{2})(\d{3})(\d{0,3})$/, '$1.$2.$3');
  } else if (value.length > 2) {
    value = value.replace(/^(\d{2})(\d{0,3})$/, '$1.$2');
  }
  return value;
}

// Formata dígitos como telefone BR ((11) 90000-0000) enquanto o usuário digita.
function formatPhoneBR(raw: string): string {
  let value = raw.replace(/\D/g, '').slice(0, 11);
  if (value.length > 10) {
    value = value.replace(/^(\d{2})(\d{5})(\d{0,4})$/, '($1) $2-$3');
  } else if (value.length > 6) {
    value = value.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
  } else if (value.length > 2) {
    value = value.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
  } else if (value.length > 0) {
    value = value.replace(/^(\d{0,2})$/, '($1');
  }
  return value;
}

function EmpresaAberturaFields({
  empresa, setEmpresa, checklist, setChecklist, readOnly,
}: {
  empresa: EmpresaData;
  setEmpresa: React.Dispatch<React.SetStateAction<EmpresaData>>;
  checklist: AberturaChecklist;
  setChecklist: React.Dispatch<React.SetStateAction<AberturaChecklist>>;
  // Campos já preenchidos no E2 ficam travados pro operador de abertura no E3
  // (só gestor/admin sobrescrevem) — evita apagar dado que já foi conferido.
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border border-slate-800 bg-slate-900/40 rounded-lg p-4">
      <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wide">🏢 Dados da Abertura (Ordem de Serviço)</h5>
      <div className="grid grid-cols-1 gap-2.5">
        {EMPRESA_FIELDS.map(f => {
          const locked = !!readOnly && !!empresa[f.key];
          return (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400">{f.label}{locked && <span className="text-slate-600 font-normal"> · definido no E2</span>}</label>
            <div className="flex items-center gap-2">
              {f.options && f.multi ? (
                // Seleção múltipla — valor persistido como lista separada
                // por vírgula (mesmo formato de gestor_projetos/
                // terceiro_projeto, ver src/lib/gestor-scope.ts).
                (() => {
                  const selected = empresa[f.key] ? empresa[f.key].split(',').map(s => s.trim()).filter(Boolean) : [];
                  return (
                    <div className={`w-full flex flex-col gap-1.5 border rounded-lg p-2.5 ${locked ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-950 border-slate-800'}`}>
                      {f.options!.map(o => (
                        <label key={o.value} className={`flex items-center gap-2 text-xs ${locked ? 'text-slate-500 cursor-not-allowed' : 'text-slate-200 cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={selected.includes(o.value)}
                            disabled={locked}
                            onChange={(e) => {
                              if (locked) return;
                              const next = e.target.checked
                                ? [...selected, o.value]
                                : selected.filter(v => v !== o.value);
                              setEmpresa(prev => ({ ...prev, [f.key]: next.join(', ') }));
                            }}
                            className="rounded border-slate-700 text-sky-600 focus:ring-sky-500 bg-slate-950 w-3.5 h-3.5"
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  );
                })()
              ) : f.options ? (
                <select
                  value={empresa[f.key]}
                  disabled={locked}
                  onChange={(e) => {
                    if (locked) return;
                    setEmpresa(prev => ({ ...prev, [f.key]: e.target.value }));
                  }}
                  className={`w-full text-xs border rounded-lg p-2.5 outline-none ${locked ? 'bg-slate-900/60 border-slate-800 text-slate-400 cursor-not-allowed' : 'bg-slate-950 border-slate-800 text-slate-200 focus:border-sky-500'}`}
                >
                  <option value="">Selecione...</option>
                  {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={empresa[f.key]}
                  placeholder={f.placeholder}
                  readOnly={locked}
                  onChange={(e) => {
                    if (locked) return;
                    const v = f.key === 'capital_social' ? formatCurrencyBRL(e.target.value) : e.target.value;
                    setEmpresa(prev => ({ ...prev, [f.key]: v }));
                  }}
                  className={`w-full text-xs border rounded-lg p-2.5 outline-none ${locked ? 'bg-slate-900/60 border-slate-800 text-slate-400 cursor-not-allowed' : 'bg-slate-950 border-slate-800 text-slate-200 focus:border-sky-500'}`}
                />
              )}
              <CopyButton value={empresa[f.key]} keepSpaces />
            </div>
          </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {CHECKLIST_FIELDS.map(c => (
          <label key={c.key} className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={checklist[c.key]}
              onChange={(e) => setChecklist(prev => ({ ...prev, [c.key]: e.target.checked }))}
              className="rounded border-slate-700 text-sky-600 focus:ring-sky-500 bg-slate-950 w-3.5 h-3.5"
            />
            {c.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Botão de copiar valor (removendo espaços) — facilita preencher certificados.
function CopyButton({ value, keepSpaces }: { value?: string | null; keepSpaces?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(keepSpaces ? String(value) : String(value).replace(/\s+/g, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard indisponível */ }
  };
  return (
    <button
      type="button"
      onClick={handle}
      title="Copiar (sem espaços)"
      className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${copied ? 'text-emerald-400 border-emerald-700/40 bg-emerald-950/20' : 'text-slate-400 border-slate-700 hover:bg-slate-800'}`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

// Formata um Date local como "YYYY-MM-DDTHH:mm" (mesmo formato que <input type="datetime-local"> produzia).
function toLocalDateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Converte minutos do dia (ex: 810 = 13h30) em "HH:MM".
function fmtMinutes(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Regras de horário de atendimento da agenda de certificação.
// Retorna { startMin, endMin } em minutos do dia, ou null se o dia estiver fechado.
function agendaDayBounds(date: Date): { startMin: number; endMin: number } | null {
  const dow = date.getDay(); // 0=Dom, 1=Seg..., 6=Sáb
  if (dow === 0) return null;                              // Domingo — fechado
  if (dow === 6) return { startMin: 8 * 60, endMin: 18 * 60 };  // Sáb 08h-18h
  return { startMin: 8 * 60, endMin: 20 * 60 };             // Seg-Sex 08h-20h
}

// Gera o ISO "YYYY-MM-DDTHH:MM" de um slot (dia + minutos do dia).
function slotIsoFor(day: Date, minuteOfDay: number): string {
  const d = new Date(day);
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return toLocalDateTimeString(d);
}

// Calendário interativo (dia/mês/ano) + seletor de horário, substitui o datetime-local
// digitado manualmente — usado no agendamento de certificação.
function DateTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedDate = value ? new Date(value) : undefined;
  const time = value ? value.slice(11, 16) : '09:00';

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const applyDate = (date: Date | undefined) => {
    if (!date) return;
    const [hh, mm] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(hh, mm, 0, 0);
    onChange(toLocalDateTimeString(d));
  };

  const applyTime = (newTime: string) => {
    const base = selectedDate || new Date();
    const [hh, mm] = newTime.split(':').map(Number);
    const d = new Date(base);
    d.setHours(hh, mm, 0, 0);
    onChange(toLocalDateTimeString(d));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500 text-left"
      >
        <span>{value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Selecionar data e horário'}</span>
        <span className="text-slate-500">📅</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-2 bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl flex flex-col gap-2">
          <DayPicker
            mode="single"
            locale={ptBR}
            selected={selectedDate}
            onSelect={applyDate}
            captionLayout="dropdown"
            className="nexus-daypicker"
          />
          <div className="flex items-center gap-2 border-t border-slate-800 pt-2">
            <label className="text-[11px] text-slate-400 font-semibold">Horário:</label>
            <input
              type="time"
              value={time}
              onChange={(e) => applyTime(e.target.value)}
              className="text-xs bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-slate-200 outline-none focus:border-sky-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Dropdown clicável para atribuir responsável — exibe lista de operadores elegíveis.
function ResponsibleSelect({ label, value, options, onSelect }: {
  label: string; value: string; options: string[]; onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <label className="text-[11px] font-semibold text-slate-400 block mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500 text-left"
      >
        <span className={value ? '' : 'text-slate-500'}>{value || 'Atribuir...'}</span>
        <span className="text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto thin-scroll">
          {options.length === 0 && (
            <div className="text-[11px] text-slate-500 p-2">Nenhum operador cadastrado</div>
          )}
          {value && (
            <button
              type="button"
              onClick={() => { onSelect(''); setOpen(false); }}
              className="w-full text-left text-xs px-3 py-2 hover:bg-slate-800 transition-colors text-rose-400 font-semibold border-b border-slate-800"
            >
              ✕ Remover atribuição (deixar livre)
            </button>
          )}
          {options.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => { onSelect(name); setOpen(false); }}
              className={`w-full text-left text-xs px-3 py-2 hover:bg-slate-800 transition-colors ${name === value ? 'text-sky-400 font-semibold' : 'text-slate-200'}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Chip de nível Gov (Ouro/Prata) para os cards do Kanban.
function GovChip({ level }: { level: 'ouro' | 'prata' }) {
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${level === 'ouro' ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' : 'bg-slate-700/30 text-slate-400 border border-slate-700/40'}`}>
      {level === 'ouro' ? '🥇 OURO' : '🥈 PRATA'}
    </span>
  );
}

// Badge compacto de SLA exibido no rodapé de cada card do Kanban.
function SlaBadge({ dossier }: { dossier: Dossier }) {
  const sla = computeSla(dossier);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${SLA_BADGE_TONE[sla.tone]}`}
      title={`Decorrido: ${sla.elapsedLabel}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${SLA_DOT_TONE[sla.tone]}`} />
      {sla.remainingLabel}
    </span>
  );
}

// Chip de responsável nos cards do kanban — mostra quem assumiu a OS.
function RespChip({ name }: { name?: string }) {
  if (!name) return <span className="text-[10px] text-slate-600 italic">Livre</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-400/90 bg-indigo-950/30 px-1.5 py-0.5 rounded-full border border-indigo-800/30">
      👤 {name.split(' ')[0]}
    </span>
  );
}

// Identificação de projeto nos cards da Esteira (10/08/2026, pedido explícito
// — inclusive "sem projeto ainda" precisa aparecer, não só quando tem, pra
// dar visibilidade de auditoria direto no kanban, sem precisar abrir a tela
// Projetos). Mesmo estilo do badge que já existia só na coluna Finalizado.
function ProjetoChip({ projeto }: { projeto?: string }) {
  if (!projeto) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-500 border border-slate-700/40">
        📁 sem projeto
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950/30 text-emerald-400 border border-emerald-900/30 truncate max-w-[130px]" title={projeto}>
      📁 {projeto}
    </span>
  );
}

export default function Home() {
  // Desloga automaticamente após 10min sem atividade — captador fica de fora
  // (usa public/captador.html, um PWA offline separado). Esta tela nunca
  // renderiza pra captador: ele é redirecionado assim que a sessão carrega
  // (ver checagem de role logo abaixo).
  useIdleLogout(10);

  // Estados do Sistema
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [selectedOS, setSelectedOS] = useState<Dossier | null>(null);
  const [selectedOSLogs, setSelectedOSLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  // "dados" é a aba "👤 Dossiê" — unifica o que antes eram 3 abas
  // separadas (Documentos, Pessoa, Senha Gov), pedido explícito do gestor
  // pra parar de ter duas visualizações com a mesma informação duplicada
  // (ver SKILL.md/historico.md pra contexto completo da unificação).
  const [activeTab, setActiveTab] = useState<'dados' | 'trabalho' | 'auditoria' | 'tarefas' | 'editar'>('dados');
  // Alterna entre visão de Pessoa Física e Pessoa Jurídica dentro do Dossiê.
  const [pessoaViewTab, setPessoaViewTab] = useState<'fisica' | 'juridica'>('fisica');
  const [gestorEdit, setGestorEdit] = useState<Record<string, string>>({});
  const [osTasks, setOsTasks] = useState<{ id: string; from_user: string; to_user: string; text: string; done: boolean; done_by?: string; created_at: string; done_at?: string }[]>([]);
  const [newTaskTo, setNewTaskTo] = useState<string>('');
  const [newTaskText, setNewTaskText] = useState<string>('');

  // Notificações visuais
  type Notif = { id: string; type: 'task_open' | 'task_done' | 'os_open' | 'os_done' | 'sla' | 'cobrar'; text: string; time: string; dossier_id?: string };
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifSeenAt, setNotifSeenAt] = useState<string>(() => {
    if (typeof window === 'undefined') return new Date(0).toISOString();
    return localStorage.getItem('nexus-notif-seen') ?? new Date(0).toISOString();
  });
  const notifRef = useRef<HTMLDivElement>(null);
  // Pop-up centralizado (toast) — dispara sozinho quando chega notificação
  // NOVA (não é preciso abrir o sino pra ver). Pedido do gestor/certificador/
  // operador de abertura/captador/terceiro: clicável, redireciona direto pra
  // tarefa/OS, e some sozinho (não é modal bloqueante — decisão confirmada
  // com o usuário). `seenNotifIdsRef` guarda os ids já vistos entre polls;
  // null = ainda não inicializado (evita disparar um toast pra cada
  // notificação já existente no primeiro carregamento da página).
  const [toastNotif, setToastNotif] = useState<Notif | null>(null);
  const seenNotifIdsRef = useRef<Set<string> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal de intervenção do gestor (mover etapa com justificativa)
  const [gestorMoveModal, setGestorMoveModal] = useState<{ targetStep: Step; justification: string } | null>(null);

  // Navegação e UI
  const [view, setView] = useState<'dashboard' | 'esteira' | 'certificacao' | 'agenda' | 'logs' | 'concluidos' | 'projetos' | 'captadores'>('dashboard');
  const [sessionOpen, setSessionOpen] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Filtros da Esteira de Trabalho (24/07/2026, pedido explícito — mesmo
  // padrão já aplicado no kanban do terceiro): filtro por captador + busca
  // por texto que filtra os CARDS de cada coluna direto (diferente da busca
  // global do header, que é um dropdown de "pular pra uma OS", não filtra
  // o kanban em si).
  const [esteiraQuery, setEsteiraQuery] = useState<string>('');
  const [esteiraCaptadorFilter, setEsteiraCaptadorFilter] = useState<string>('');
  // Filtro por responsável, um por tipo de acesso (10/08/2026, pedido
  // explícito) — abertura = resp_abertura, certificador = resp_certificacao.
  // Mais o filtro por projeto. (Filtro por "Gestor (E1/E2)"/assigned_to
  // removido no mesmo dia, pedido de acompanhamento: não foi qualificado
  // como necessário.)
  const [esteiraAberturaFilter, setEsteiraAberturaFilter] = useState<string>('');
  const [esteiraCertificadorFilter, setEsteiraCertificadorFilter] = useState<string>('');
  const [esteiraProjetoFilter, setEsteiraProjetoFilter] = useState<string>('');
  // Filtro por contador usado na abertura (18/08/2026, pedido explícito).
  const [esteiraContadorFilter, setEsteiraContadorFilter] = useState<string>('');
  // Toggle "sem nome/CNPJ" (24/08/2026, pedido explícito: "filtrar as
  // empresas que ainda não tem nome empresarial ou cnpj atribuídos") —
  // diferente dos demais (que são `<select>` de valor), este é um booleano,
  // então vira checkbox em vez de dropdown.
  const [esteiraSemEmpresaFilter, setEsteiraSemEmpresaFilter] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  // Usuário logado (vem da sessão). O papel controla o que cada um vê/faz.
  const [currentOperator, setCurrentOperator] = useState<string>('');
  const [currentRole, setCurrentRole] = useState<'captador' | 'operador_certificacao' | 'operador_abertura' | 'gestor' | 'admin' | 'terceiro'>('captador');
  const [authReady, setAuthReady] = useState<boolean>(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  // Formulários de Trabalho (T1, T2, T3/T4)
  const [t1Checklist, setT1Checklist] = useState({
    processos: false,
    beneficios: false,
    financeiro: false,
    redes: false
  });
  const [t1Justification, setT1Justification] = useState<string>('');
  
  const [t2Email, setT2Email] = useState<string>('');
  const [t2Phone, setT2Phone] = useState<string>('');
  // Endereço PESSOAL do cliente — obrigatório no servidor pra avançar T2→T3 no
  // nível Prata (usado no Bird ID). Editável aqui só quando ainda não existe,
  // pra não travar o avanço sem dar como corrigir na hora.
  const [t2ClientAddress, setT2ClientAddress] = useState<string>('');
  
  const [t3CertificadoUrl, setT3CertificadoUrl] = useState<string>('');
  const [t3Cnpj, setT3Cnpj] = useState<string>('');
  const [cnpjFetching, setCnpjFetching] = useState(false);

  // Dados da abertura da empresa (Ordem de Serviço - Abertura)
  const [empresa, setEmpresa] = useState({
    empresa_nome: '', nome_fantasia: '', empresa_endereco: '', cnae: '', capital_social: '',
    quadro_societario: '', regime_tributario: '', porte_empresa: '', forma_atuacao: '', gov_socios: '',
    forma_pagamento: '', codigo_acesso: '',
  });
  const [aberturaChecklist, setAberturaChecklist] = useState({
    cad_junta: false, cad_receita: false, cad_estado: false, cad_prefeitura: false,
    planilha_mensalidade: false, planilha_simples: false,
    opcao_simples: false, criar_pasta_rede: false,
  });
  // Responsáveis pela etapa de certificação/abertura
  const [respCert, setRespCert] = useState<string>('');
  const [respAbertura, setRespAbertura] = useState<string>('');
  // Responsável do vínculo e-commerce (terceiro_responsavel) — reatribuível
  // só por gestor/admin (10/08/2026, caso real: OS já vinculada por um
  // parceiro precisava ser passada pra outro do mesmo projeto).
  const [respTerceiro, setRespTerceiro] = useState<string>('');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [contadorAbertura, setContadorAbertura] = useState<string>('');
  // Operador de abertura: painel do contador responsável fica recolhido por padrão.
  const [contadorAbertOpen, setContadorAbertOpen] = useState<boolean>(false);
  // Reagendamento (certificador) — justificativa em edição antes de solicitar.
  const [reagendaModal, setReagendaModal] = useState<{ osId: string; novoSlot: string; deSlot: string; tipo: 'mover' | 'cancelar'; justificativa: string } | null>(null);
  // Recusa do agendamento feito pelo captador (certificador/gestor) — motivo
  // obrigatório, mesmo padrão do modal de reagendamento acima.
  const [recusaAgendaModal, setRecusaAgendaModal] = useState<{ osId: string; nome: string; slot: string; motivo: string } | null>(null);
  // Redesign da tela Certificação (pedido do gestor: "do jeito que está não
  // está funcional") — lista única paginada, com abas de status, no lugar
  // dos grupos de cards espalhados. Clicar na linha abre a OS.
  const [certListViewTab, setCertListViewTab] = useState<'todos' | 'andamento' | 'livre' | 'aguardando' | 'atencao' | 'concluido_ecpf' | 'concluidos'>('todos');
  const [certListViewPage, setCertListViewPage] = useState(0);
  // Filtro por data + ordenação (pedido do gestor, 24/07/2026 — mesmo padrão
  // já aplicado no kanban do terceiro): certificador precisa filtrar por
  // período (quando a OS entrou na fila dele / quando foi finalizada) e
  // escolher a ordem, sem depender só da ordem "de fábrica" da lista.
  const [certListSortDir, setCertListSortDir] = useState<'novas' | 'antigas'>('novas');
  const [certListDateField, setCertListDateField] = useState<'entrada' | 'finalizacao'>('entrada');
  const [certListDateFrom, setCertListDateFrom] = useState('');
  const [certListDateTo, setCertListDateTo] = useState('');
  // Filtro por nível Gov.br (Ouro/Prata) e por tipo de certificado
  // (e-CPF/e-CNPJ), pedido explícito do usuário (24/07/2026).
  const [certListGovFilter, setCertListGovFilter] = useState<'todos' | 'ouro' | 'prata'>('todos');
  const [certListTipoFilter, setCertListTipoFilter] = useState<'todos' | 'ecpf' | 'ecnpj'>('todos');
  // Tela "Concluídos por Certificador" (gestor/admin) — filtro por nome.
  const [concluidosFilter, setConcluidosFilter] = useState('');
  // Filtro por status de pagamento (pedido do gestor: separar o que já foi
  // pago do que ainda precisa ser cobrado/marcado).
  const [concluidosPagoFilter, setConcluidosPagoFilter] = useState<'todos' | 'pago' | 'pendente'>('todos');
  // Paginação por certificador (10 por página) na tela "Concluídos por Certificador".
  const [concluidosPage, setConcluidosPage] = useState<Record<string, number>>({});
  const [agendamentoCert, setAgendamentoCert] = useState<string>('');
  const [gestorNote, setGestorNote] = useState<string>('');
  // Central de Agendamentos — semana exibida e slot em edição
  const [agendaWeekStart, setAgendaWeekStart] = useState<Date>(() => {
    const now = new Date();
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    mon.setHours(0, 0, 0, 0);
    return mon;
  });
  const [agendaAssignSlot, setAgendaAssignSlot] = useState<string | null>(null);
  // Lista de operadores (p/ atribuição de responsável via clique, sem digitar nome).
  const [operatorsList, setOperatorsList] = useState<{ name: string; role: string; active: boolean }[]>([]);
  // Projetos disponíveis para classificação de empresas abertas.
  const [projectsList, setProjectsList] = useState<{ nome: string; capacidade: number; usados: number; contador_abertura?: string }[]>([
    { nome: 'Projeto 01', capacidade: 0, usados: 0 },
    { nome: 'Projeto 02', capacidade: 0, usados: 0 },
  ]);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [newProjectCap, setNewProjectCap] = useState<string>('');
  const [newProjectContador, setNewProjectContador] = useState<string>('');
  const [selectedOSProject, setSelectedOSProject] = useState<string>('');
  // Tela dedicada "📁 Projetos" — qual projeto está em edição inline (capacidade/contador).
  const [editingProject, setEditingProject] = useState<string>('');
  const [editProjectCap, setEditProjectCap] = useState<string>('');
  const [editProjectContador, setEditProjectContador] = useState<string>('');
  // Paginação da tela "Projetos" (mesmo padrão da lista de Certificação).
  const [projetosPage, setProjetosPage] = useState<number>(0);
  // Qual projeto está com a lista de OS financeiras expandida (pra marcar
  // pagamento) — só um por vez, pra não poluir a tela com N listas abertas.
  const [expandedProjectPagamentos, setExpandedProjectPagamentos] = useState<string>('');
  // Qual projeto está com a lista de "finalizadas sem certificação
  // registrada" expandida (auditoria de dado, 18/07/2026 — ver
  // handleSelectOS abaixo pra investigar cada caso).
  const [expandedProjectSemCert, setExpandedProjectSemCert] = useState<string>('');
  // Idem, pra lista de dados incompletos e pro banner de OS sem projeto.
  const [expandedProjectDadosIncompletos, setExpandedProjectDadosIncompletos] = useState<string>('');
  const [semProjetoExpanded, setSemProjetoExpanded] = useState<boolean>(false);
  // Auditoria de "cartão CNPJ sem número" (24/07/2026, caso real).
  const [cnpjSemNumeroExpanded, setCnpjSemNumeroExpanded] = useState<boolean>(false);
  // Auditoria de duplicidade de número/chip e aparelho (03/08/2026) — a trava
  // no PATCH /terceiro-update só evita duplicidade NOVA daqui pra frente;
  // isso lista o que já ficou duplicado antes da trava existir.
  const [duplicidadeVinculoExpanded, setDuplicidadeVinculoExpanded] = useState<boolean>(false);
  // Auditoria de "empresa sem nome/CNPJ" (24/08/2026, pedido explícito).
  const [semEmpresaOuCnpjExpanded, setSemEmpresaOuCnpjExpanded] = useState<boolean>(false);
  // Idem, pra lista de certificações elegíveis mas ainda pendentes.
  const [expandedProjectPendentes, setExpandedProjectPendentes] = useState<string>('');
  // Lista de TODAS as OS's de um projeto (03/08/2026, pedido do gestor: ver
  // quais OS's são de cada projeto, em formato lista compacta + paginação —
  // diferente dos blocos de auditoria acima, que só mostram subconjuntos
  // com algum problema). Um projeto expandido por vez (mesmo padrão dos
  // outros blocos); página independente por projeto pra não perder o lugar
  // ao alternar entre projetos diferentes.
  const [expandedProjectOS, setExpandedProjectOS] = useState<string>('');
  const [projectOSPage, setProjectOSPage] = useState<Record<string, number>>({});

  // Tela dedicada "📸 Captadores" — filtro de nome e qual captador está expandido.
  const [captadorFilter, setCaptadorFilter] = useState<string>('');
  const [expandedCaptador, setExpandedCaptador] = useState<string>('');

  // Revelação de Senha Gov.br
  const [revealedGovLogin, setRevealedGovLogin] = useState<string>('');
  const [revealedGovPassword, setRevealedGovPassword] = useState<string>('');
  const [passwordRevealed, setPasswordRevealed] = useState<boolean>(false);
  const [govPasswordEdit, setGovPasswordEdit] = useState<string>('');
  const [slaEditOpen, setSlaEditOpen] = useState<boolean>(false);
  const [slaEditValue, setSlaEditValue] = useState<string>('');
  const [slaBulkOpen, setSlaBulkOpen] = useState<boolean>(false);

  // Dados de acesso à certificação (BIRD ID / A1) — centraliza o que hoje fica
  // espalhado em planilha paralela do certificador.
  const [certForm, setCertForm] = useState({
    cert_certificadora: '', cert_sistema_usado: '', cert_aparelho: '', cert_email: '',
    cert_email_senha: '', cert_senha_acesso: '',
  });
  const [revealedCertEmailSenha, setRevealedCertEmailSenha] = useState<string>('');
  const [certEmailSenhaRevealed, setCertEmailSenhaRevealed] = useState<boolean>(false);
  const [revealedCertSenhaAcesso, setRevealedCertSenhaAcesso] = useState<string>('');
  const [certSenhaAcessoRevealed, setCertSenhaAcessoRevealed] = useState<boolean>(false);
  const [revealedT2EmailSenha, setRevealedT2EmailSenha] = useState<string>('');
  const [t2EmailSenhaRevealed, setT2EmailSenhaRevealed] = useState<boolean>(false);
  // Toggle de "mostrar o que estou digitando" nos 2 campos de senha do
  // certificado ANTES de salvar (24/07/2026, bug real reportado: "quando
  // está com o campo limpo... não aparece o que está sendo preenchido, só
  // dá pra ver depois da senha preenchida e salva"). `type="password"`
  // mascara a digitação e o botão "👁️ Revelar" só existe pra senha JÁ
  // SALVA (`has_cert_*`) — enquanto digitando uma senha nova, não tinha
  // NENHUM jeito de conferir o que foi digitado antes de salvar. Não
  // confundir com `certEmailSenhaRevealed`/`certSenhaAcessoRevealed`
  // (que mostram a senha JÁ SALVA, vinda do servidor via /reveal) — este
  // é só um toggle de visibilidade local do campo de digitação.
  const [showTypedCertEmailSenha, setShowTypedCertEmailSenha] = useState<boolean>(false);
  const [showTypedCertSenhaAcesso, setShowTypedCertSenhaAcesso] = useState<boolean>(false);
  const [t2EmailSenhaEdit, setT2EmailSenhaEdit] = useState<string>('');
  const [certRejectModal, setCertRejectModal] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });
  // Upload de certificados A1 em lote — o certificador emite vários de uma vez
  // e anexava um por um. Os arquivos vêm nomeados com o nome da empresa, então
  // o casamento é automático; o que não casar sozinho exige escolha manual, e
  // NADA é gravado antes da conferência (ver `loteA1` na tela Certificação).
  const [loteA1Open, setLoteA1Open] = useState(false);
  const [loteA1Itens, setLoteA1Itens] = useState<LoteA1Item[]>([]);
  const [loteA1Busy, setLoteA1Busy] = useState(false);

  // Carrega todos os dossiês ao iniciar
  const fetchDossiers = async () => {
    try {
      const res = await fetch('/api/dossiers', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setDossiers(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Guard de autenticação: sem sessão → vai para /login. Com sessão → define papel.
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.user) {
          window.location.href = '/login';
          return;
        }
        // Captador só tem acesso à tela de cadastro — nunca à esteira/kanban,
        // mesmo navegando direto pra "/" (bookmark, back button etc.).
        if (data.user.role === 'captador') {
          window.location.href = '/captador.html';
          return;
        }
        // Terceiro (parceiro e-commerce) tem portal próprio — nunca a esteira interna.
        if (data.user.role === 'terceiro') {
          window.location.href = '/terceiro';
          return;
        }
        // Certificador (acesso restrito de emissão) só tem o Modo Consulta —
        // igual captador/terceiro, nunca chega na esteira/kanban interno,
        // mesmo navegando direto pra "/" (bookmark, back button etc.).
        if (data.user.role === 'certificador') {
          window.location.href = '/consulta';
          return;
        }
        setCurrentOperator(data.user.name);
        setCurrentRole(data.user.role);
        setAuthReady(true);
        // Lista de operadores (nome/papel/ativo) — qualquer papel interno usa pra
        // atribuir/cobrar tarefa entre colegas; gestor/admin também usam pra
        // "Atribuir Responsáveis". /api/users/directory não expõe username (isso
        // fica só em /api/users, restrito a gestor/admin para o painel de usuários).
        fetch('/api/users/directory', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((u) => { if (u?.users) setOperatorsList(u.users); })
          .catch(() => {});
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/dossiers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (active) {
          setDossiers(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error(e);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Polling de notificações — a cada 45s compara estado dos dossiês e tarefas.
  useEffect(() => {
    if (!authReady || !currentOperator) return;
    const buildNotifs = (dos: Dossier[], tasks: Notif[]) => {
      // O certificador é notificado SÓ nas 3 situações dele (todas baseadas em
      // tarefa: demanda de certificação, tarefa que ele atribuiu concluída,
      // documento recusado reenviado). Não recebe os avisos globais de
      // SLA/triagem/finalização da operação.
      if (currentRole === 'operador_certificacao') return tasks;
      const items: Notif[] = [];
      const now = new Date().toISOString();
      const osAbertas = dos.filter(d => d.status === 'captado');
      const osFinalizadas = dos.filter(d => d.current_step === 'finalizado' || d.empresa_aberta);
      const slaEstourados = dos.filter(d => computeSla(d).status === 'estourado');
      const slaAlerta = dos.filter(d => computeSla(d).status === 'atencao');
      if (slaEstourados.length > 0) items.push({ id: 'sla_est', type: 'sla', text: `⚠️ ${slaEstourados.length} OS com SLA estourado — ação imediata necessária`, time: now });
      if (slaAlerta.length > 0) items.push({ id: 'sla_alert', type: 'sla', text: `🟡 ${slaAlerta.length} OS entrando em alerta de prazo`, time: now });
      if (osAbertas.length > 0) items.push({ id: 'os_open', type: 'os_open', text: `${osAbertas.length} OS aguardando triagem`, time: now });
      if (osFinalizadas.length > 0) items.push({ id: 'os_done', type: 'os_done', text: `${osFinalizadas.length} empresa${osFinalizadas.length > 1 ? 's' : ''} finalizada${osFinalizadas.length > 1 ? 's' : ''}`, time: now });
      // Pedidos de reagendamento do certificador aguardando aprovação (gestor/admin).
      if (currentRole === 'gestor' || currentRole === 'admin') {
        const reagendaPend = dos.filter(d => d.reagendamento_pendente);
        if (reagendaPend.length > 0) items.push({ id: 'reagenda_pend', type: 'sla', text: `🔄 ${reagendaPend.length} pedido${reagendaPend.length > 1 ? 's' : ''} de reagendamento aguardando sua aprovação`, time: now });
      }
      return [...tasks, ...items];
    };
    const poll = async () => {
      try {
        const [dosRes, taskRes] = await Promise.all([
          fetch('/api/dossiers', { cache: 'no-store' }),
          fetch('/api/tasks', { cache: 'no-store' }),
        ]);
        const dos: Dossier[] = dosRes.ok ? await dosRes.json() : [];
        const rawTasks = taskRes.ok ? (await taskRes.json()).tasks ?? [] : [];
        const taskNotifs: Notif[] = rawTasks
          .filter((t: {to_user:string;done:boolean;from_user:string}) => t.to_user === currentOperator && !t.done)
          .map((t: {id:string;text:string;created_at:string;from_user:string;dossier_id:string}) => ({ id: `task_open_${t.id}`, type: 'task_open' as const, text: `Tarefa de ${t.from_user}: ${t.text}`, time: t.created_at, dossier_id: t.dossier_id }));
        const doneNotifs: Notif[] = rawTasks
          .filter((t: {from_user:string;done:boolean;done_at?:string}) => t.from_user === currentOperator && t.done && t.done_at && t.done_at > notifSeenAt)
          .map((t: {id:string;text:string;done_at:string;to_user:string;dossier_id:string}) => ({ id: `task_done_${t.id}`, type: 'task_done' as const, text: `✓ ${t.to_user} concluiu: ${t.text}`, time: t.done_at, dossier_id: t.dossier_id }));
        const combined = buildNotifs(dos, [...taskNotifs, ...doneNotifs]);
        setNotifs(combined);

        // Pop-up: detecta notificações NOVAS (id nunca visto) desde o último
        // poll. Na primeira execução só grava o estado inicial (sem popup) —
        // senão todo mundo levaria uma enxurrada de toasts ao abrir o app
        // com notificações já existentes.
        const currentIds = new Set(combined.map((n) => n.id));
        if (seenNotifIdsRef.current === null) {
          seenNotifIdsRef.current = currentIds;
        } else {
          const novas = combined.filter((n) => !seenNotifIdsRef.current!.has(n.id));
          seenNotifIdsRef.current = currentIds;
          if (novas.length > 0) {
            const maisRecente = [...novas].sort((a, b) => b.time.localeCompare(a.time))[0];
            setToastNotif(maisRecente);
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            toastTimerRef.current = setTimeout(() => setToastNotif(null), 8000);
          }
        }
      } catch { /* silencioso */ }
    };
    poll();
    const id = setInterval(poll, 45_000);
    return () => clearInterval(id);
  }, [authReady, currentOperator, notifSeenAt]);

  // Fecha painel de notificações ao clicar fora.
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  // Tema claro/escuro — persiste em localStorage e aplica classe no <html>.
  useEffect(() => {
    const saved = localStorage.getItem('nexus-theme') as 'dark' | 'light' | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle('light', saved === 'light');
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    // Adiciona classe de transição por 300ms para suavizar a troca
    document.documentElement.classList.add('theme-transition');
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 300);
    setTheme(next);
    document.documentElement.classList.toggle('light', next === 'light');
    localStorage.setItem('nexus-theme', next);
  };

  // Carrega lista de projetos disponíveis (usada tanto pelo seletor "📁
  // Projeto" dentro de qualquer OS quanto pela tela "Projetos" em si).
  useEffect(() => {
    fetch('/api/projects', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.projects) setProjectsList(d.projects); })
      .catch(() => {});
  }, []);

  // Rebusca ao ABRIR a tela "Projetos" — sem isso, `projectsList` (e os
  // contadores "X/Y vagas" que vêm dela) ficava travado no valor buscado na
  // ABERTURA da sessão (fetch acima, roda só uma vez) até um hard refresh da
  // página inteira. Bug real reportado (11/08/2026): dois gestores olhando o
  // mesmo projeto na mesma hora viam contagens diferentes (26 vs 27) — o que
  // tinha mudado (uma OS nova em "em andamento") só aparecia pra quem tinha
  // recarregado a página DEPOIS da mudança; navegar pra "Projetos" dentro da
  // mesma sessão não bastava. `view` muda toda vez que o usuário clica no
  // menu, então isso cobre tanto abrir a tela quanto voltar a ela depois.
  // `dossiers` (usado pro TOTAL/EM ANDAMENTO/CONCLUÍDAS de cada card, ver
  // `osDoProjeto`) tem exatamente o mesmo problema — é o mesmo `useState`
  // usado pelo Kanban inteiro, só atualizado depois de uma AÇÃO de escrita
  // (nunca por navegação entre telas) — por isso rebuscamos os dois juntos.
  useEffect(() => {
    if (view !== 'projetos') return;
    fetch('/api/projects', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.projects) setProjectsList(d.projects); })
      .catch(() => {});
    fetchDossiers();
  }, [view]);

  // Seleciona uma OS e busca dados completos + logs.
  // keepView=true: mantém a aba atual e a senha revelada (usado ao só atualizar
  // os dados após uma ação, sem "jogar" o usuário de volta para Documentos).
  const handleSelectOS = async (os: Dossier, opts: { keepView?: boolean } = {}) => {
    try {
      // cache: 'no-store' — sem isso, o navegador podia servir uma resposta
      // desta OS já em cache em vez de buscar a versão recém-salva (relato
      // real: gestor editava/salvava e via os campos "em branco"/desatualizados
      // até dar um hard refresh). Todo outro fetch de dossiê no arquivo já usa
      // essa opção (ver fetchDossiers) — esta era a única exceção.
      const res = await fetch(`/api/dossiers/${os.id}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSelectedOS(data.dossier);
        setSelectedOSLogs(data.logs);
        fetch(`/api/dossiers/${os.id}/tasks`, { cache: 'no-store' }).then(r => r.ok ? r.json() : { tasks: [] }).then(d => setOsTasks(d.tasks || []));
        if (!opts.keepView) {
          setPasswordRevealed(false);
          setRevealedGovPassword('');
          setCertEmailSenhaRevealed(false);
          setRevealedCertEmailSenha('');
          setCertSenhaAcessoRevealed(false);
          setRevealedCertSenhaAcesso('');
          // BUG REAL (corrigido, 21/07/2026): faltavam aqui — senha do
          // e-mail do vínculo e-commerce continuava revelada ao abrir uma
          // OS diferente na mesma sessão (o valor de texto plano da OS
          // ANTERIOR ficava visível até o usuário clicar em "Revelar" de
          // novo, o que ele nem precisava fazer pra já estar vendo um
          // dado sensível errado). A aba Pessoa Física/Jurídica também
          // nunca resetava, então uma OS sem CNPJ podia abrir direto na
          // aba PJ vazia porque a anterior tinha ficado nela.
          setT2EmailSenhaRevealed(false);
          setRevealedT2EmailSenha('');
          setPessoaViewTab('fisica');
          setActiveTab('dados');
          // Mesmo cuidado do bug acima: toggle local de "mostrar digitação"
          // não é dado sensível vindo do servidor, mas ainda assim não deve
          // ficar "ligado" ao abrir uma OS diferente.
          setShowTypedCertEmailSenha(false);
          setShowTypedCertSenhaAcesso(false);
        }

        // Carrega dados existentes do dossiê nos formulários correspondentes — só na
        // abertura inicial da OS. Com keepView=true (refresh após upload/ação em outra
        // aba) NÃO sobrescreve esses campos: já são mantidos em sincronia localmente por
        // quem os edita, e reaplicá-los aqui apagava edições ainda não salvas do
        // operador (bug: dado sumia ao trocar de aba/anexar documento no meio da edição).
        if (!opts.keepView) {
          setT1Justification(data.dossier.t1_justification || '');
          setT2Email(data.dossier.t2_new_email || '');
          setT2Phone(data.dossier.t2_new_phone || '');
          setT2ClientAddress(data.dossier.address || '');
          setT3CertificadoUrl(data.dossier.certificado_a1_url || '');
          setT3Cnpj(data.dossier.cnpj_number || '');

          const dd = data.dossier;
          setEmpresa({
            empresa_nome: dd.empresa_nome || '', nome_fantasia: dd.nome_fantasia || '',
            empresa_endereco: dd.empresa_endereco || '',
            cnae: dd.cnae || '', capital_social: dd.capital_social || '',
            quadro_societario: dd.quadro_societario || '', regime_tributario: dd.regime_tributario || '',
            porte_empresa: dd.porte_empresa || '', forma_atuacao: dd.forma_atuacao || '',
            gov_socios: dd.gov_socios || '', forma_pagamento: dd.forma_pagamento || '',
            codigo_acesso: dd.codigo_acesso || '',
          });
          setAberturaChecklist({
            cad_junta: !!dd.cad_junta, cad_receita: !!dd.cad_receita, cad_estado: !!dd.cad_estado,
            cad_prefeitura: !!dd.cad_prefeitura, planilha_mensalidade: !!dd.planilha_mensalidade,
            planilha_simples: !!dd.planilha_simples,
            opcao_simples: !!dd.opcao_simples, criar_pasta_rede: !!dd.criar_pasta_rede,
          });
          setRespCert(dd.resp_certificacao || '');
          setRespAbertura(dd.resp_abertura || '');
          setRespTerceiro(dd.terceiro_responsavel || '');
          setAssignedTo(dd.assigned_to || '');
          setContadorAbertura(dd.contador_abertura || '');
          setContadorAbertOpen(false); // recolhe o painel do contador a cada OS
          setAgendamentoCert(dd.agendamento_cert || '');
          setSelectedOSProject(dd.projeto || '');
          setGestorNote(dd.gestor_note || '');
          setCertForm({
            cert_certificadora: dd.cert_certificadora || '', cert_sistema_usado: dd.cert_sistema_usado || '',
            cert_aparelho: dd.cert_aparelho || '',
            // Auto-preenche com o e-mail do vínculo e-commerce (já cadastrado
            // pelo terceiro) quando o certificador ainda não tiver definido um
            // e-mail próprio de certificação — evita digitar de novo um dado
            // que já existe. Nunca sobrescreve um cert_email já salvo.
            cert_email: dd.cert_email || dd.t2_new_email || '',
            cert_email_senha: '', cert_senha_acesso: '',
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Clique numa notificação (sino OU pop-up) — mesmo destino pros dois:
  // abre a OS direto e, se for notificação de tarefa, já cai na aba certa
  // (Trabalho pro operador de abertura, que não usa aba de tarefas no dia a
  // dia; Tarefas pros demais papéis).
  const openNotif = (n: Notif) => {
    if (!n.dossier_id) return;
    setNotifOpen(false);
    setToastNotif(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const isTaskType = n.type === 'task_open' || n.type === 'task_done';
    handleSelectOS({ id: n.dossier_id } as Dossier, { keepView: false }).then(() => {
      if (isTaskType) setActiveTab(currentRole === 'operador_abertura' ? 'trabalho' : 'tarefas');
    });
  };

  // Atualiza campo no dossiê. Aceita também campos transientes em texto puro
  // (ex.: cert_email_senha) que a API criptografa antes de persistir.
  // Retorna se a gravação teve sucesso — quem chama pode usar isso pra dar
  // sua própria confirmação de sucesso (a função só alerta sozinha em falha).
  const updateDossierStatus = async (osId: string, updates: Partial<Dossier> & Record<string, unknown>, opts: { keepView?: boolean } = {}): Promise<boolean> => {
    try {
      const res = await fetch(`/api/dossiers/${osId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updates,
          operator_name: currentOperator
        })
      });
      if (res.ok) {
        const data = await res.json();
        await fetchDossiers();
        if (selectedOS && selectedOS.id === osId) {
          handleSelectOS(data.dossier, { keepView: opts.keepView ?? true });
        }
        return true;
      } else {
        // Sem isso, uma validação recusada pelo servidor (ex.: campo obrigatório
        // faltando) ficava muda na tela — o botão "Salvar"/"Avançar Etapa"
        // parecia não fazer nada, sem nenhuma pista do motivo.
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Não foi possível salvar as alterações.');
        return false;
      }
    } catch (e) {
      console.error(e);
      alert('Falha de conexão ao salvar as alterações.');
      return false;
    }
  };

  // Ação de Revelar Senha Gov (Segurança por Auditoria!)
  const handleRevealPassword = async () => {
    if (!selectedOS) return;
    try {
      const res = await fetch(`/api/dossiers/${selectedOS.id}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_name: currentOperator,
          operator_role: currentRole
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedGovLogin(data.gov_login);
        setRevealedGovPassword(data.gov_password);
        setPasswordRevealed(true);
        // Atualiza os logs SEM trocar de aba nem esconder a senha recém-revelada.
        handleSelectOS(selectedOS, { keepView: true });
      } else {
        const err = await res.json();
        alert(err.error || 'Acesso negado.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveGovPassword = async () => {
    if (!selectedOS || !govPasswordEdit.trim()) return;
    await updateDossierStatus(selectedOS.id, { gov_password: govPasswordEdit.trim() }, { keepView: true });
    setGovPasswordEdit('');
  };

  const handleSaveT2EmailSenha = async () => {
    if (!selectedOS || !t2EmailSenhaEdit.trim()) return;
    await updateDossierStatus(selectedOS.id, { t2_new_email_senha: t2EmailSenhaEdit.trim() }, { keepView: true });
    setT2EmailSenhaEdit('');
  };

  // Busca dados públicos do CNPJ e auto-preenche os campos da abertura.
  const autoFillFromCnpj = async (cnpj: string) => {
    const digits = cnpj.replace(/\D/g, '');
    if (digits.length !== 14) return;
    setCnpjFetching(true);
    try {
      const res = await fetch(`/api/cnpj/${digits}`);
      if (!res.ok) return;
      const data = await res.json() as Partial<typeof empresa>;
      setEmpresa(prev => ({
        ...prev,
        ...(data.empresa_nome ? { empresa_nome: data.empresa_nome } : {}),
        ...(data.nome_fantasia ? { nome_fantasia: data.nome_fantasia } : {}),
        ...(data.cnae ? { cnae: data.cnae } : {}),
        ...(data.capital_social ? { capital_social: data.capital_social } : {}),
        ...(data.quadro_societario ? { quadro_societario: data.quadro_societario } : {}),
        ...(data.regime_tributario ? { regime_tributario: data.regime_tributario } : {}),
        // Gov.br dos Sócios é manual (login/senha de cada um), mas a lista de
        // nomes já sai pronta do quadro societário — só falta o operador
        // completar o acesso de cada sócio.
        ...(data.quadro_societario && !prev.gov_socios ? { gov_socios: data.quadro_societario } : {}),
      }));
    } catch { /* silencioso — o operador preenche manualmente */ }
    finally { setCnpjFetching(false); }
  };

  // Triagem: move uma OS de "Captados" para a fila do T1 (análise de risco).
  const handleEnviarParaT1 = async () => {
    if (!selectedOS) return;
    await updateDossierStatus(selectedOS.id, { status: 't1_pendente', current_step: 't1' });
  };

  // Ação T1: Decisão Verde/Vermelho
  const handleT1Decision = async (decision: 'verde' | 'vermelho') => {
    if (!selectedOS) return;
    // Recusa exige justificativa (pedido do gestor) — aprovação não precisa.
    // Antes o campo era só um texto opcional pros dois casos; sem trava
    // nenhuma, a recusa podia sair sem motivo registrado nenhum.
    if (decision === 'vermelho' && !t1Justification.trim()) {
      alert('Preencha a justificativa antes de recusar (E1 Vermelho).');
      return;
    }
    const updates: Partial<Dossier> = {
      t1_justification: t1Justification,
      status: decision === 'verde' ? 't2_pendente' : 't1_vermelho',
      current_step: decision === 'verde' ? 't2' : 't1'
    };
    await updateDossierStatus(selectedOS.id, updates);
    // Recusa T1 → cria tarefa automática para o captador tentar recuperar o cadastro
    if (decision === 'vermelho' && selectedOS.captured_by) {
      await fetch(`/api/dossiers/${selectedOS.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_user: selectedOS.captured_by,
          text: `🔴 Cadastro recusado na análise de risco.\n\nMotivo: ${t1Justification?.trim() || 'Não informado'}\n\nO que fazer: Entre em contato com o cliente, explique a situação e colete documentação complementar ou corrija os dados para reenvio.`
        })
      });
    }
  };

  // Ação T2: Complemento Cadastral
  const handleT2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOS) return;
    if (!empresa.empresa_endereco.trim()) {
      alert('Preencha o endereço da empresa (campo "Endereço da Empresa" nos Dados da Abertura).');
      return;
    }
    // Regra de Bifurcação automática: Prata vai para BIRD ID (T3), Ouro vai direto para Abertura (T4/Abertura)
    const isGovPrata = selectedOS.gov_level === 'prata';
    // No Prata o servidor exige o endereço PESSOAL do cliente (usado no Bird
    // ID) — valida aqui também pra dar feedback imediato, em vez de só
    // descobrir com a OS já "presa" na tentativa de avançar.
    if (isGovPrata && !selectedOS.address && !t2ClientAddress.trim()) {
      alert('Preencha o endereço do cliente (obrigatório no nível Prata para o Bird ID).');
      return;
    }

    const updates: Partial<Dossier> = {
      t2_new_email: t2Email,
      t2_new_phone: t2Phone,
      ...empresa,
      ...aberturaChecklist,
      status: isGovPrata ? 't3_bird_id' : 't3_abertura',
      current_step: 't3'
    };
    if (!selectedOS.address && t2ClientAddress.trim()) {
      updates.address = t2ClientAddress.trim();
    }
    await updateDossierStatus(selectedOS.id, updates);
  };

  // Salva os dados da empresa/checklist sem mudar a etapa (para preencher e baixar a OS).
  const handleSaveEmpresa = async () => {
    if (!selectedOS) return;
    // t3Cnpj só era persistido em cnpj_number no clique de "Concluir Abertura"
    // — quem baixava a OS impressa logo após "Salvar Dados" (sem concluir a
    // etapa ainda) recebia o documento sem o CNPJ preenchido.
    const updates: Partial<Dossier> & Record<string, unknown> = { ...empresa, ...aberturaChecklist };
    if (t3Cnpj.trim()) updates.cnpj_number = t3Cnpj.trim();
    await updateDossierStatus(selectedOS.id, updates);
    alert('Dados da empresa salvos. Você já pode baixar a OS de Abertura preenchida.');
  };

  // Atribui os responsáveis pela certificação e pela abertura (gestor/admin).
  const handleAssignResp = async () => {
    if (!selectedOS) return;
    await updateDossierStatus(selectedOS.id, { resp_certificacao: respCert, resp_abertura: respAbertura });
    alert('Responsáveis atribuídos. Eles recebem a OS para trabalhar.');
  };

  const handleSaveAgendamento = async () => {
    if (!selectedOS || !agendamentoCert) return;
    await updateDossierStatus(selectedOS.id, { agendamento_cert: agendamentoCert });
  };

  // Cria um novo projeto e atualiza a lista local.
  const handleAddProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const capacidade = parseInt(newProjectCap.trim() || '0', 10) || 0;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, capacidade, contador_abertura: newProjectContador }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectsList(data.projects);
        setNewProjectName('');
        setNewProjectCap('');
        setNewProjectContador('');
      }
    } catch {}
  };

  // Salva capacidade/contador de um projeto já existente (tela "Projetos").
  const handleSaveProjectEdit = async (nome: string) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nome,
          capacidade: parseInt(editProjectCap.trim() || '0', 10) || 0,
          contador_abertura: editProjectContador,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectsList(data.projects);
        setEditingProject('');
      }
    } catch {}
  };

  // Marca/desmarca pagamento (BIRD, A1, Colaborador) — controle centralizado
  // na tela "Projetos" (pedido do gestor: antes dava pra marcar em 3 telas
  // diferentes, virava bagunça). Certificação e Concluídos por Certificador
  // continuam mostrando o status, só não deixam mais clicar pra alterar.
  const togglePagamento = (d: Dossier, field: 'bird_pago' | 'a1_pago' | 'colaborador_pago') => {
    updateDossierStatus(d.id, { [field]: !d[field] });
  };

  // Remove um projeto (qualquer um, inclusive os de exemplo Projeto 01/02).
  const handleDeleteProject = async (nome: string) => {
    if (!confirm(`Remover o projeto "${nome}"? OS já classificadas nele mantêm o campo "projeto" preenchido (não são apagadas nem desvinculadas), só o projeto some da lista de opções.`)) return;
    try {
      const res = await fetch('/api/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome }),
      });
      if (res.ok) {
        const data = await res.json();
        setProjectsList(data.projects);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Não foi possível remover o projeto.');
      }
    } catch {}
  };

  // Atribui um projeto à OS e, se o projeto tiver um contador padrão
  // definido, já preenche o contador_abertura junto — evita o erro de
  // atribuição manual (mais de uma pessoa mexendo no mesmo lote por engano).
  // Não sobrescreve um contador já definido manualmente na OS.
  const assignProjeto = (p: { nome: string; contador_abertura?: string }) => {
    if (!selectedOS) return;
    setSelectedOSProject(p.nome);
    const updates: Record<string, unknown> = { projeto: p.nome };
    if (p.contador_abertura && !selectedOS.contador_abertura) {
      updates.contador_abertura = p.contador_abertura;
      setContadorAbertura(p.contador_abertura);
    }
    updateDossierStatus(selectedOS.id, updates);
  };

  // Salva os dados de acesso à certificação. As senhas só são enviadas (e
  // sobrescritas) quando o campo foi preenchido — em branco mantém a atual.
  const handleSaveCertAccess = async () => {
    if (!selectedOS) return;
    const payload: Record<string, unknown> = {
      cert_certificadora: certForm.cert_certificadora,
      cert_sistema_usado: certForm.cert_sistema_usado,
      cert_aparelho: certForm.cert_aparelho,
      cert_email: certForm.cert_email,
    };
    if (certForm.cert_email_senha) payload.cert_email_senha = certForm.cert_email_senha;
    if (certForm.cert_senha_acesso) payload.cert_senha_acesso = certForm.cert_senha_acesso;
    await updateDossierStatus(selectedOS.id, payload);
    setCertForm((f) => ({ ...f, cert_email_senha: '', cert_senha_acesso: '' }));
    alert('Dados de acesso à certificação salvos.');
  };

  const handleRevealCertField = async (field: 'cert_email_senha' | 'cert_senha_acesso' | 't2_new_email_senha') => {
    if (!selectedOS) return;
    try {
      const res = await fetch(`/api/dossiers/${selectedOS.id}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field }),
      });
      if (res.ok) {
        const data = await res.json();
        if (field === 'cert_email_senha') {
          setRevealedCertEmailSenha(data.password);
          setCertEmailSenhaRevealed(true);
        } else if (field === 'cert_senha_acesso') {
          setRevealedCertSenhaAcesso(data.password);
          setCertSenhaAcessoRevealed(true);
        } else {
          setRevealedT2EmailSenha(data.password);
          setT2EmailSenhaRevealed(true);
        }
        handleSelectOS(selectedOS, { keepView: true });
      } else {
        const err = await res.json();
        alert(err.error || 'Acesso negado.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Pedido do gestor: e-mail/senha de vínculo e-commerce (já cadastrados pelo
  // terceiro) devem ficar disponíveis pro certificador reaproveitar sem
  // redigitar — cert_email já é auto-preenchido (ver setCertForm acima), e a
  // senha é copiada aqui via /reveal (mesma auditoria de revelação) direto
  // pro campo de senha do certificado, em vez do certificador ter que abrir
  // a aba de vínculo separadamente pra ver a senha e copiar manualmente.
  const handleUseSenhaVinculo = async () => {
    if (!selectedOS) return;
    try {
      const res = await fetch(`/api/dossiers/${selectedOS.id}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 't2_new_email_senha' }),
      });
      if (res.ok) {
        const data = await res.json();
        setCertForm((f) => ({ ...f, cert_email_senha: data.password || '' }));
      } else {
        const err = await res.json();
        alert(err.error || 'Acesso negado.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Corrige a EXTENSÃO do Certificado A1 já anexado (24/07/2026, pedido
  // explícito: "não é possível aproveitar o que já está anexado?") — não
  // reenvia nada, só renomeia o arquivo no servidor com base na assinatura
  // real dele (bytes ZIP/RAR), pra OS que ficaram com ".bin"/".pfx" por
  // causa do bug de detecção de mime (ver extFromMime, já corrigido pra
  // uploads novos). Só gestor/admin.
  const handleFixA1Extension = async () => {
    if (!selectedOS) return;
    try {
      const res = await fetch(`/api/dossiers/${selectedOS.id}/fix-a1-extension`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(data.message || 'Extensão verificada.');
        if (data.changed) handleSelectOS(selectedOS, { keepView: true });
      } else {
        alert(data.error || 'Não foi possível corrigir a extensão.');
      }
    } catch (e) {
      console.error(e);
      alert('Falha de conexão ao corrigir a extensão.');
    }
  };

  const handleCertRejectDoc = async () => {
    if (!selectedOS || !certRejectModal.reason.trim()) return;
    const text = `🚫 DOCUMENTOS RECUSADOS pelo certificador.\n\nMotivo: ${certRejectModal.reason.trim()}\n\n📋 Padrão exigido (Decreto 10.278/2020):\n• Formatos aceitos: PDF, JPEG ou PNG\n• Tamanho máximo: 10 MB\n• Resolução mínima: 300 DPI\n• RG: frente e verso em arquivos separados, alinhados, sem cortes\n• CNH: aberta completamente, frente visível, sem dobras\n• Sem borrões, reflexos ou partes cortadas`;
    const captured = selectedOS.captured_by;
    // Sempre a OS do próprio captador dela — nunca outro captador. Sem
    // captured_by (não deveria acontecer nesta etapa), não cria tarefa
    // fantasma pra um destinatário que não existe.
    if (!captured) {
      alert('Esta OS não tem um captador atribuído — a OS ainda sai da fila, mas nenhuma tarefa foi criada.');
    } else {
      // Endpoint correto é escopado à OS (POST /api/dossiers/[id]/tasks); o
      // POST /api/tasks (sem escopo) nunca existiu — só tem GET — então essa
      // chamada sempre falhava silenciosamente (sem checar res.ok) e a
      // tarefa nunca era criada, mesmo mostrando "sucesso" ao certificador.
      const res = await fetch(`/api/dossiers/${selectedOS.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_user: captured, text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Falha ao criar a tarefa de correção pro captador.');
        return;
      }
    }
    // Sai do fluxo ativo do certificador até o captador reenviar (o cadastro-update
    // limpa esta flag automaticamente ao receber o reenvio dos documentos).
    await updateDossierStatus(selectedOS.id, { cert_docs_recusados: new Date().toISOString() });
    setCertRejectModal({ open: false, reason: '' });
    if (captured) alert('Tarefa de correção criada para o captador. A OS saiu da sua fila até o reenvio.');
  };

  // Conclui uma sub-etapa de certificação/abertura. Finaliza a OS automaticamente
  // quando todas as etapas exigidas pelo nível Gov estão completas.
  // Ouro (paralelo): abertura + A1.  Prata (sequencial): BIRD ID → abertura → A1.
  const completeSubStep = async (step: 'bird' | 'abertura' | 'a1') => {
    if (!selectedOS) return;
    const updates: Partial<Dossier> = { ...empresa, ...aberturaChecklist };
    // Cada certificação é distinta e cobrada individualmente — registra quando
    // e quem concluiu (conferência de cobrança p/ gestor e certificador).
    if (step === 'bird') {
      updates.bird_id_done = true;
      updates.bird_id_done_em = new Date().toISOString();
      updates.bird_id_done_por = currentOperator;
    }
    if (step === 'abertura') {
      updates.abertura_done = true;
      updates.abertura_done_em = new Date().toISOString();
      updates.abertura_done_por = currentOperator;
      updates.cnpj_number = t3Cnpj;
    }
    if (step === 'a1') {
      updates.a1_done = true;
      updates.a1_done_em = new Date().toISOString();
      updates.a1_done_por = currentOperator;
      if (t3CertificadoUrl) updates.certificado_a1_url = t3CertificadoUrl;
    }

    // Atribuição automática: quem executa a etapa vira o responsável, se ainda não houver um.
    if ((step === 'bird' || step === 'a1') && !selectedOS.resp_certificacao && currentOperator) {
      updates.resp_certificacao = currentOperator;
    }
    if (step === 'abertura' && !selectedOS.resp_abertura && currentOperator) {
      updates.resp_abertura = currentOperator;
    }

    const after = { ...selectedOS, ...updates };
    const isPrata = selectedOS.gov_level === 'prata';
    const complete = isPrata
      ? (!!after.bird_id_done && !!after.abertura_done && !!after.a1_done)
      : (!!after.abertura_done && !!after.a1_done);
    if (complete) {
      updates.empresa_aberta = true;
      updates.status = 'finalizado';
      updates.current_step = 'finalizado';
    }
    await updateDossierStatus(selectedOS.id, updates);
    // Pedido do gestor: "a marcação geral deve levar para a lista de
    // concluídos" — ao marcar BIRD ou A1 como feito, a tela Certificação já
    // fica pronta na aba "Concluídos" quando o usuário voltar pra lista.
    if (step === 'bird' || step === 'a1') {
      setCertListViewTab(step === 'a1' ? 'concluidos' : 'concluido_ecpf');
      setCertListViewPage(0);
    }
  };

  // Filtra dossiês por etapas do Kanban
  // Resultados da busca (nome, CPF, nº da OS ou captador).
  const searchResults = (() => {
    const t = normalizeSearch(searchTerm.trim());
    if (!t) return [] as Dossier[];
    // Restringe a busca às etapas que o papel pode ver (isolamento por acesso).
    // BUG REAL (corrigido, 21/07/2026, caso OS #EO2VHZ1): `stepsForRole`
    // pro operador_certificacao é só ['t3','finalizado'] — não inclui 't2'.
    // Isso é certo pra visibilidade de coluna do kanban (Esteira), mas a
    // tela Certificação tem um recurso à parte (BIRD ID antecipado,
    // isEarlyBirdWindow) que libera esse papel pra trabalhar em OS ainda
    // na E2 — e a busca global nunca soube disso. Resultado: uma OS
    // legitimamente na fila dele (early bird) ficava impossível de achar
    // pelo nome, "sumindo" pra quem só usa a busca do topo. Pro
    // certificador, o pool de busca passa a ser o mesmo que o servidor já
    // devolve pra ele (t2+t3+finalizado, ver GET /api/dossiers) — mesmo
    // critério que getCertColumnDossiers/isEarlyBirdWindow já usam.
    const stepOf = (d: Dossier): Step => (d.status === 'captado' ? 'captacao' : (d.current_step as Step));
    const searchPool = currentRole === 'operador_certificacao'
      ? dossiers.filter(d => ['t2', 't3', 'finalizado'].includes(stepOf(d)))
      : dossiers.filter(d => stepsForRole(currentRole).includes(stepOf(d)));
    return searchPool
      .filter(d =>
        normalizeSearch(d.client_name).includes(t) ||
        normalizeSearch(d.empresa_nome).includes(t) ||
        normalizeSearch(d.cpf).includes(t) ||
        normalizeSearch(d.id).includes(t) ||
        normalizeSearch(d.captured_by).includes(t) ||
        normalizeSearch(d.protocolo).includes(t) ||
        normalizeSearch(d.phone).includes(t) ||
        normalizeSearch(d.t2_new_phone).includes(t) ||
        normalizeSearch(d.cnpj_number).includes(t) ||
        normalizeSearch(d.cert_aparelho).includes(t)
      )
      .slice(0, 12);
  })();

  // Filtro de texto da Esteira — mesmos campos já usados na busca global
  // (nome, CPF, OS, empresa, CNPJ, aparelho) + telefone/e-mail do vínculo
  // e-commerce (t2_new_phone/t2_new_email), igual foi feito no kanban do
  // terceiro. Só usado dentro de `getColumnDossiers`, exclusivo da Esteira.
  const matchEsteiraFilters = (d: Dossier) => {
    const q = normalizeSearch(esteiraQuery.trim());
    const matchesQuery = !q ||
      normalizeSearch(d.client_name).includes(q) ||
      normalizeSearch(d.cpf).includes(q) ||
      normalizeSearch(d.id).includes(q) ||
      normalizeSearch(d.empresa_nome).includes(q) ||
      normalizeSearch(d.cnpj_number).includes(q) ||
      normalizeSearch(d.cert_aparelho).includes(q) ||
      normalizeSearch(d.phone).includes(q) ||
      normalizeSearch(d.t2_new_phone).includes(q) ||
      normalizeSearch(d.t2_new_email).includes(q) ||
      normalizeSearch(d.captured_by).includes(q);
    const matchesCaptador = !esteiraCaptadorFilter || d.captured_by === esteiraCaptadorFilter;
    const matchesAbertura = !esteiraAberturaFilter || d.resp_abertura === esteiraAberturaFilter;
    const matchesCertificador = !esteiraCertificadorFilter || d.resp_certificacao === esteiraCertificadorFilter;
    const matchesProjeto = !esteiraProjetoFilter || d.projeto === esteiraProjetoFilter;
    const matchesContador = !esteiraContadorFilter || d.contador_abertura === esteiraContadorFilter;
    const matchesSemEmpresa = !esteiraSemEmpresaFilter || !d.empresa_nome || !d.cnpj_number;
    return matchesQuery && matchesCaptador && matchesAbertura && matchesCertificador && matchesProjeto && matchesContador && matchesSemEmpresa;
  };

  const getColumnDossiers = (step: 'captacao' | 't1' | 't2' | 't3' | 'finalizado') => {
    return dossiers.filter(d => {
      if (step === 'captacao') { if (d.current_step !== 'captacao' && d.status !== 'captado') return false; }
      else if (d.current_step !== step) return false;
      return matchEsteiraFilters(d);
    });
  };

  // A1 só libera quando a abertura entregou o cartão CNPJ + Certidão de Inteiro
  // Teor (anexos que o certificador precisa) — não depende do checklist inteiro.
  // A1 (e-CNPJ) exige, além dos anexos da abertura, que o e-CPF (BIRD ID/SYNC)
  // do sócio já tenha sido feito no mesmo aparelho — regra válida tanto pra
  // Ouro quanto pra Prata (antes só Prata exigia isso).
  // `cnpj_number` também é obrigatório (21/07/2026, pedido do gestor): os
  // anexos podiam ser enviados sem que o operador/gestor tivesse preenchido
  // e salvo o número do CNPJ (campo digitado separadamente, só persistido em
  // "Salvar Dados" ou "Concluir Abertura") — a OS chegava pronta pro
  // certificador fazer o A1 sem o dado essencial pra emitir o certificado.
  const a1ReadyOf = (d: Dossier) => !!d.cnpj_comprovante_url && !!d.certidao_inteiro_teor_url && !!d.bird_id_done && !!d.cnpj_number;

  // Certificação concluída da OS: A1 feito (+ BIRD, exigido pros dois níveis).
  const certConcluida = (d: Dossier) => !!d.a1_done && !!d.bird_id_done;

  // Agendamento do captador aguardando a ciência do certificador. O slot já
  // fica reservado enquanto pendente (senão dois captadores marcam o mesmo
  // horário), mas só vira compromisso firme depois de aprovado.
  // COMPATIBILIDADE: agendamento anterior a esse fluxo não tem
  // `agendamento_status` — ausência conta como APROVADO, pra não jogar
  // retroativamente todos os compromissos já marcados pra "pendente".
  const agendamentoPendente = (d: Dossier) => !!d.agendamento_cert && d.agendamento_status === 'pendente';

  // BIRD marcado como concluído mas com dado incompleto por trás — caso
  // real reportado (18/07/2026, OS Maysa Farias Leal): "Aparelho A65"
  // preenchido mas Certificadora/Sistema/E-mail vazios, e nenhuma senha
  // definida. Critério inicial exigia os 4 campos de texto TODOS vazios
  // (perdia esse caso parcial); revisado pra "falta pelo menos 1" — inclui
  // as 2 senhas também (pedido explícito: sem senha o certificador não
  // acessa o e-mail/app de verdade). Escopo de componente (não dentro de
  // uma IIFE de view) porque é usado em 2 lugares (badge da tela
  // Certificação e auditoria da tela Projetos) — antes de existir aqui,
  // cada view tinha sua própria cópia da regra, risco real de ficarem
  // dessincronizadas (já eram 3 cópias de `vinculoReady` por esse mesmo
  // motivo, ver skill). Se mudar o critério de novo, mude só aqui.
  // AJUSTE (24/07/2026, pedido explícito, caso real reportado com
  // screenshot: "Certificadora" vazio marcava dado incompleto mesmo com
  // "Sistema usado" (BIRD ID/Syngular) já selecionado — o usuário
  // confirmou que o Sistema usado já é suficiente pra identificar quem
  // está certificando, "Certificadora" (texto livre) virou informação
  // complementar opcional, não é mais exigida aqui). Removido
  // `!d.cert_certificadora` do critério — o campo continua existindo no
  // formulário, só não bloqueia mais nada.
  const birdDadosFaltando = (d: Dossier) =>
    !!d.bird_id_done && (
      !d.cert_sistema_usado || !d.cert_aparelho || !d.cert_email ||
      !d.has_cert_email_senha || !d.has_cert_senha_acesso
    );

  // Mesmo padrão do BIRD acima — A1 marcado como concluído sem o arquivo do
  // certificado (.zip/.rar) anexado. Só 1 campo por trás (não tem o mesmo
  // risco de "preenchimento parcial" do BIRD, que tem 6 campos), mas
  // promovido a função só mesmo assim: antes de existir aqui, a condição
  // estava copiada igual nos mesmos 2 lugares que o BIRD estava (badge da
  // Certificação + auditoria de Projetos) — sem função única, alguém podia
  // mudar um critério novo (ex.: exigir também outro campo do A1) só numa
  // cópia e as duas telas saírem divergentes pra mesma OS.
  const a1ArquivoFaltando = (d: Dossier) => !!d.a1_done && !d.certificado_a1_url;

  // Fila do certificador — regra única pros dois níveis (Prata e Ouro exigem
  // BIRD ID/SYNC antes do A1, ver a1ReadyOf acima): entra a partir da E2 (já
  // passou risco) e some da fila ativa só quando a certificação (BIRD+A1)
  // estiver concluída. BUG HISTÓRICO (corrigido): antes o Ouro só entrava na
  // fila quando a1ReadyOf já era true — mas a1ReadyOf também exige
  // bird_id_done, então uma OS Ouro sem BIRD feito nunca aparecia pro
  // certificador nem pra fazer o BIRD, travando silenciosamente (relatado
  // pelo certificador/gestor — caso real: OS da Maysa Farias Leal).
  const getCertColumnDossiers = () => {
    const emFila = dossiers.filter(d =>
      ['t2', 't3'].includes(d.current_step) &&
      !certConcluida(d)
    );
    const concluidasRecentes = dossiers.filter(d => certConcluida(d) && d.current_step !== 'finalizado');
    return [...emFila, ...concluidasRecentes];
  };

  // Exclusão de cadastro — restrita a gestor/admin (ação destrutiva demais para
  // ficar liberada a qualquer operador). Restauração fica na Lixeira.
  const canDelete = currentRole === 'gestor' || currentRole === 'admin';
  const handleDeleteOS = async () => {
    if (!selectedOS) return;
    if (!confirm(`Excluir a OS #${selectedOS.id} — ${selectedOS.client_name}?\n\nEla vai para a Lixeira e pode ser restaurada depois.`)) return;
    try {
      const res = await fetch(`/api/dossiers/${selectedOS.id}`, { method: 'DELETE' });
      if (res.ok) {
        setSelectedOS(null);
        await fetchDossiers();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Falha ao excluir.');
      }
    } catch {
      alert('Falha ao excluir.');
    }
  };

  // Lixeira — gestor/admin veem e restauram cadastros excluídos.
  const [lixeiraOpen, setLixeiraOpen] = useState<boolean>(false);
  const [lixeiraList, setLixeiraList] = useState<Dossier[]>([]);
  const [lixeiraLoading, setLixeiraLoading] = useState<boolean>(false);
  const openLixeira = async () => {
    setLixeiraOpen(true);
    setLixeiraLoading(true);
    try {
      const res = await fetch('/api/dossiers/deleted', { cache: 'no-store' });
      const data = await res.json();
      setLixeiraList(res.ok ? (data.dossiers || []) : []);
    } catch {
      setLixeiraList([]);
    } finally {
      setLixeiraLoading(false);
    }
  };
  const handleRestoreOS = async (id: string) => {
    try {
      const res = await fetch(`/api/dossiers/${id}/restore`, { method: 'POST' });
      if (res.ok) {
        setLixeiraList(prev => prev.filter(d => d.id !== id));
        await fetchDossiers();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Falha ao restaurar.');
      }
    } catch {
      alert('Falha ao restaurar.');
    }
  };

  // Manager = gestor ou admin (podem ver tudo, atribuir operadores, etc.)
  const isManager = currentRole === 'gestor' || currentRole === 'admin';

  // RBAC: quem pode EXECUTAR o trabalho de cada setor.
  // Gestor e Admin podem tudo; cada operador só age em OS atribuída a ele
  // (ou ainda sem responsável) — evita que um operador conclua/decida sobre
  // uma OS de um colega achando ela pela busca, contornando o kanban.
  const canWorkStep = (step: string): boolean => {
    if (isManager) return true;
    const mine = (assignedField?: string) => !assignedField || assignedField === currentOperator;
    // operador_abertura só age a partir da E3 (abertura) — não enxerga nem
    // trabalha Captados/Recusadas/E1/E2 (fora do escopo dele).
    if (currentRole === 'operador_abertura') {
      return step === 't3' && mine(selectedOS?.resp_abertura);
    }
    if (step === 't3') return currentRole === 'operador_certificacao' && mine(selectedOS?.resp_certificacao);
    return false;
  };

  // Quais colunas/etapas o papel atual ENXERGA (isola o fluxo de cada acesso).
  const canSeeStep = (step: Step) => stepsForRole(currentRole).includes(step);

  // Requisito 12 PRD: Possibilidade de cobrar o setor/responsável (Alerta SLA)
  const handleCobrarSetor = async () => {
    if (!selectedOS) return;
    const mensagem = prompt('O que está faltando? (opcional, vai direto pro responsável)') || '';
    try {
      const res = await fetch(`/api/dossiers/${selectedOS.id}/alert-sla`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem }),
      });
      if (res.ok) {
        alert(`Setor cobrado com sucesso! E-mail de notificação de SLA enviado para a gerência e registrado na trilha de auditoria.`);
        setNotifs(prev => [{
          id: `cobrar_${selectedOS.id}_${Date.now()}`,
          type: 'cobrar' as const,
          text: `📣 Cobrança de SLA enviada para o setor responsável pela OS de ${selectedOS.client_name || selectedOS.id}`,
          time: new Date().toISOString(),
          dossier_id: selectedOS.id,
        }, ...prev]);
        // Atualiza os logs para mostrar o log do alerta de imediato
        handleSelectOS(selectedOS, { keepView: true });
      } else {
        alert('Erro ao disparar cobrança de SLA.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Mapeamento de etapa → status padrão para intervenção do gestor
  const STEP_ORDER: Step[] = ['captacao', 't1', 't2', 't3', 'finalizado'];
  const STEP_LABELS_NAV: Record<Step, string> = {
    captacao: 'Captação',
    t1: 'Análise de Risco (E1)',
    t2: 'Complemento Cadastral (E2)',
    t3: 'Certificação / Abertura (E3)',
    finalizado: 'Finalizado',
  };
  const stepDefaultStatus = (step: Step, dossier: typeof selectedOS): string => {
    if (step === 'captacao') return 'captado';
    if (step === 't1') return 't1_pendente';
    if (step === 't2') return 't2_pendente';
    if (step === 't3') return dossier?.gov_level === 'ouro' ? 't3_abertura' : 't3_bird_id';
    return 'finalizado';
  };

  const handleGestorMoveStep = async (targetStep: Step, justification: string) => {
    if (!selectedOS || !justification.trim()) return;
    const newStatus = stepDefaultStatus(targetStep, selectedOS);
    // BUG REAL corrigido (24/07/2026, mesma sessão da trava de finalização
    // abaixo): esta função nunca checava `res.ok` — uma rejeição do servidor
    // (ex.: a nova trava de dados obrigatórios pra finalizar) ficava muda,
    // o modal fechava normalmente e a OS continuava na etapa antiga sem
    // nenhuma explicação. Mesmo padrão já corrigido em `updateDossierStatus`
    // (#50) — só que esta função tinha seu próprio `fetch` cru, fora dali.
    const res = await fetch(`/api/dossiers/${selectedOS.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_step: targetStep,
        status: newStatus,
        operator_name: currentOperator,
        gestor_override_reason: justification.trim(),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Não foi possível mover a OS de etapa.');
      return;
    }
    setGestorMoveModal(null);
    handleSelectOS(selectedOS, { keepView: true });
  };

  // Enquanto valida a sessão, não renderiza o painel (evita flash antes do redirect).
  if (!authReady) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 text-slate-500 text-sm">
        Verificando acesso...
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">

      {/* 1. SIDEBAR DE OPERAÇÃO E MÉTRICAS (recolhível; vira drawer com backdrop no mobile) */}
      {sidebarOpen && (
      <>
      <div
        onClick={() => setSidebarOpen(false)}
        className="fixed inset-0 bg-black/60 z-40 md:hidden"
      />
      <aside className="fixed md:relative inset-y-0 left-0 z-50 w-[85vw] max-w-80 md:w-80 h-full border-r border-slate-800 bg-slate-950 flex flex-col justify-between p-5 md:p-6 shrink-0 overflow-y-auto thin-scroll">
        <div className="flex flex-col gap-6">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-600 rounded-xl flex items-center justify-center font-bold text-white text-xl shadow-lg shadow-sky-500/20">NF</div>
            <div className="flex-1">
              <h1 className="font-semibold text-lg leading-tight bg-gradient-to-r from-sky-400 to-amber-400 bg-clip-text text-transparent">NexusFlow</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Gestão de Tratativas</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              title="Recolher menu"
              className="text-slate-500 hover:text-slate-200 text-lg leading-none px-1"
            >
              «
            </button>
          </div>

          {/* Sessão do usuário logado (recolhível) */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            <button
              onClick={() => setSessionOpen(o => !o)}
              className="flex items-center justify-between w-full text-left"
            >
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                👤 {currentOperator}
              </span>
              <span className="text-slate-500 text-xs">{sessionOpen ? '▾' : '▸'}</span>
            </button>
            {sessionOpen && (
              <div className="flex flex-col gap-2.5 pt-1">
                <span className="text-[11px] font-semibold text-sky-400">{ROLE_LABELS[currentRole]}</span>
                {(currentRole === 'gestor' || currentRole === 'admin') && (
                  <a
                    href="/admin/usuarios"
                    className="text-[11px] font-bold text-center bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 py-2 rounded-lg transition-colors"
                  >
                    ⚙️ Gerenciar Usuários
                  </a>
                )}
                <button
                  onClick={handleLogout}
                  className="text-[10px] font-bold text-rose-400 hover:text-rose-300 bg-rose-950/20 border border-rose-900/30 py-1.5 rounded transition-colors"
                >
                  Sair
                </button>
              </div>
            )}
          </div>

          {/* Navegação entre telas */}
          <nav className="flex flex-col gap-2">
            <button
              onClick={() => setView('dashboard')}
              className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'dashboard' ? 'bg-sky-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
            >
              📊 Dashboard
            </button>
            {currentRole !== 'operador_certificacao' && (
              <button
                onClick={() => setView('esteira')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'esteira' ? 'bg-sky-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                🗂️ Esteira de Trabalho
              </button>
            )}
            {(currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_certificacao') && (
              <button
                onClick={() => setView('certificacao')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'certificacao' ? 'bg-sky-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                🔐 Certificação
              </button>
            )}
            {(currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_certificacao') && (
              <button
                onClick={() => setView('agenda')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'agenda' ? 'bg-violet-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                📅 Agenda Certificação
              </button>
            )}
            {(currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_certificacao') && (
              <button
                onClick={() => { window.location.href = '/consulta'; }}
                title="Tela enxuta pra usar na máquina de emissão, com o cliente por perto"
                className="flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800"
              >
                🖥️ Modo Consulta
              </button>
            )}
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <button
                onClick={openLixeira}
                className="flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800"
              >
                🗑️ Lixeira
              </button>
            )}
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <button
                onClick={() => setView('logs')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'logs' ? 'bg-sky-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                🛡️ Log de Acessos
              </button>
            )}
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <button
                onClick={() => setView('concluidos')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'concluidos' ? 'bg-emerald-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                📊 Concluídos por Certificador
              </button>
            )}
            {/* Pedido do gestor: tela própria pra criar/gerenciar projetos e ter
                visão clara do escopo/números — antes só dava pra criar um
                projeto novo de dentro de uma OS qualquer (ninguém tinha visão
                consolidada, e o cadastro ficava escondido dentro do painel de
                trabalho de uma OS específica). */}
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <button
                onClick={() => setView('projetos')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'projetos' ? 'bg-emerald-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                📁 Projetos
              </button>
            )}
            {/* Pedido do gestor: ver todas as OS de um captador de uma vez
                (a busca do topo mistura resultados e limita a 12) e
                controlar pagamento por captação — mesmo padrão de
                pago/pendente já usado em "Concluídos por Certificador". */}
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <button
                onClick={() => setView('captadores')}
                className={`flex items-center gap-2 text-xs font-bold py-2.5 px-3 rounded-lg transition-colors ${view === 'captadores' ? 'bg-emerald-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800'}`}
              >
                📸 Captadores
              </button>
            )}
            {/* Tela do captador — o certificador não atua na captação, não vê este atalho. */}
            {currentRole !== 'operador_certificacao' && (
              <a
                href="/captador.html"
                target="_blank"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold text-xs py-2.5 rounded-lg transition-transform active:scale-[0.98] mt-1"
              >
                📱 Abrir Tela do Captador
              </a>
            )}
            <a
              href={`/manual.html?role=${currentRole}`}
              target="_blank"
              className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold text-xs py-2.5 rounded-lg transition-colors"
            >
              📖 Manual do Usuário
            </a>
          </nav>

        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center justify-center gap-2 text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 py-2 rounded-lg transition-colors"
          >
            {theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Escuro'}
          </button>
          <div className="text-[10px] text-slate-600 font-medium text-center">
            NexusFlow MVP • 2026<br />Operação de Alto Impacto
          </div>
        </div>
      </aside>
      </>
      )}

      {/* 2. AREA DE TRABALHO E KANBAN */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Header Superior */}
        <header className="min-h-16 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Abrir menu"
              className="text-slate-300 hover:text-white text-xl leading-none shrink-0"
            >
              ☰
            </button>
          )}
          <div className="shrink-0">
            <h2 className="font-semibold text-sm">
              {view === 'dashboard' ? 'Dashboard Operacional'
                : view === 'esteira' ? 'Esteira de Processos de Contabilidade'
                : view === 'certificacao' ? 'Certificação (BIRD ID / A1)'
                : view === 'projetos' ? 'Projetos'
                : view === 'captadores' ? 'Captadores'
                : 'Central de Agendamentos'}
            </h2>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              {view === 'dashboard' ? 'Visão geral, gargalos e indicadores'
                : view === 'esteira' ? 'Acompanhamento e resolução de gargalos operacionais'
                : view === 'certificacao' ? 'OS em processo de certificação, mesmo as que estão paralelamente na abertura'
                : view === 'projetos' ? 'Escopo, capacidade e pagamentos por projeto/lote'
                : view === 'captadores' ? 'Todas as OS por captador e controle de pagamento por captação'
                : 'Seg–Sex 08h–20h · Sáb 08h–18h · slots de 30 min'}
            </p>
          </div>

          {/* Busca (lupinha) — procura cadastros em qualquer tela */}
          <div className="relative flex-1 min-w-[160px] order-3 basis-full sm:basis-auto sm:order-none sm:max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, empresa, CPF, OS, captador, telefone ou código do aparelho..."
              className="w-full text-xs bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
            {searchTerm.trim() && (
              <div className="absolute z-30 mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg shadow-2xl max-h-80 overflow-y-auto thin-scroll">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-slate-500 p-3">Nenhum cadastro encontrado.</p>
                ) : (
                  searchResults.map(d => (
                    <button
                      key={d.id}
                      onClick={() => { handleSelectOS(d); setSearchTerm(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-900 border-b border-slate-800/60 last:border-0 flex items-center justify-between gap-2"
                    >
                      <span className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-200">{d.client_name}{d.empresa_nome ? ` · ${d.empresa_nome}` : ''}</span>
                        <span className="text-[10px] text-slate-500">OS #{d.id} • {d.cpf}{d.cert_aparelho ? ` • 📱 ${d.cert_aparelho}` : ''}</span>
                      </span>
                      <span className="text-[9px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded uppercase">{d.empresa_aberta ? '✓ aberta' : d.current_step}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={fetchDossiers}
              className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 text-xs px-3 py-1.5 rounded-md hover:bg-slate-800 transition-colors"
            >
              🔄 Recarregar
            </button>

            {/* Bell de notificações */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(o => !o)}
                className="relative flex items-center justify-center w-8 h-8 bg-slate-900 border border-slate-800 rounded-md hover:bg-slate-800 transition-colors text-base"
                title="Notificações"
              >
                🔔
                {notifs.filter(n => n.time > notifSeenAt || n.type === 'task_open' || n.type === 'os_open').length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                    {notifs.filter(n => n.type === 'task_open' || n.type === 'os_open' || n.time > notifSeenAt).length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-10 w-80 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                    <span className="text-xs font-bold text-slate-300">Notificações</span>
                    <button
                      onClick={() => { const now = new Date().toISOString(); setNotifSeenAt(now); localStorage.setItem('nexus-notif-seen', now); setNotifOpen(false); }}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      Marcar tudo como lido
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto thin-scroll divide-y divide-slate-800/60">
                    {notifs.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-6">Nenhuma notificação.</p>
                    ) : (
                      notifs.map(n => (
                        <div
                          key={n.id}
                          onClick={() => openNotif(n)}
                          className={`px-4 py-3 flex items-start gap-2.5 ${n.time > notifSeenAt ? 'bg-slate-900/60' : ''} ${n.dossier_id ? 'cursor-pointer hover:bg-slate-900/80' : ''}`}
                        >
                          <span className="text-base shrink-0">
                            {n.type === 'task_open' ? '📋' : n.type === 'task_done' ? '✅' : n.type === 'os_open' ? '📥' : '🏁'}
                          </span>
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <p className="text-xs text-slate-200 leading-snug break-words">{n.text}</p>
                            <span className="text-[10px] text-slate-500">
                              {new Date(n.time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {n.time > notifSeenAt && <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0 mt-1" />}
                        </div>
                      ))
                    )}
                  </div>
                  <PushToggle />
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Pop-up centralizado de notificação — some sozinho (8s), clicável.
            Vale pra qualquer papel (gestor, certificador, operador de
            abertura, captador, terceiro): mesma origem de dados do sino,
            só que avisa sem precisar abrir o sino pra ver. */}
        {toastNotif && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] w-full max-w-sm px-4 pointer-events-none">
            <div
              onClick={() => openNotif(toastNotif)}
              className={`pointer-events-auto flex items-start gap-2.5 bg-slate-900 border border-sky-700/50 shadow-2xl shadow-black/60 rounded-xl px-4 py-3 animate-[fadeIn_0.2s_ease-out] ${toastNotif.dossier_id ? 'cursor-pointer hover:border-sky-500' : ''}`}
            >
              <span className="text-base shrink-0">
                {toastNotif.type === 'task_open' ? '📋' : toastNotif.type === 'task_done' ? '✅' : toastNotif.type === 'os_open' ? '📥' : toastNotif.type === 'os_done' ? '🏁' : '⚠️'}
              </span>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wide">Nova notificação</span>
                <p className="text-xs text-slate-200 leading-snug break-words">{toastNotif.text}</p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setToastNotif(null); if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }}
                className="text-slate-500 hover:text-slate-300 text-sm leading-none shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ===== TELA DASHBOARD ===== */}
        {view === 'dashboard' && (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 bg-slate-900/30 thin-scroll">

            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setSlaBulkOpen(true)}
                  className="text-xs font-bold bg-slate-900/60 border border-slate-800 text-slate-300 hover:bg-slate-800 px-3 py-2 rounded-lg transition-colors"
                >
                  ⏱️ Ajuste de SLA em Lote
                </button>
              </div>
            )}

            {/* KPIs por papel (cada setor vê os números do seu fluxo) */}
            {(() => {
              const COLOR: Record<string, string> = { sky: 'text-sky-400', amber: 'text-amber-400', emerald: 'text-emerald-400', rose: 'text-rose-400' };
              const allowed = stepsForRole(currentRole);
              const stepOf = (d: Dossier): Step => (d.status === 'captado' ? 'captacao' : (d.current_step as Step));
              const meus = (currentRole === 'gestor' || currentRole === 'admin') ? dossiers : dossiers.filter(d => allowed.includes(stepOf(d)));
              const slaEst = meus.filter(d => computeSla(d).status === 'estourado').length;
              let cards: { n: number; label: string; c: string }[] = [];
              if (currentRole === 'gestor' || currentRole === 'admin') {
                cards = [
                  { n: dossiers.length, label: 'Total de Cadastros', c: 'sky' },
                  { n: dossiers.filter(d => d.current_step !== 'finalizado' && !d.empresa_aberta).length, label: 'Em Andamento', c: 'amber' },
                  { n: dossiers.filter(d => d.current_step === 'finalizado' || d.empresa_aberta).length, label: 'Empresas Abertas', c: 'emerald' },
                  { n: dossiers.filter(d => computeSla(d).status === 'estourado').length, label: 'SLA Estourado', c: 'rose' },
                ];
              } else if (currentRole === 'operador_certificacao') {
                // Mesma lógica da tela Certificação (isRelevantParaMim/
                // vinculoReady/a1ReadyOf) — antes esses cartões usavam um
                // cálculo próprio (só stepOf === 't3' && resp_certificacao
                // === operador), que divergia dos números que o
                // certificador via de fato ao entrar em Certificação
                // (reportado como "dashboard mostrando dados
                // desatualizados"). Agora conta OS relevantes pra ele
                // (atribuídas a ele OU livres, igual `isRelevantParaMim`)
                // que já estão prontas pra trabalhar (mesmo gate de
                // `vinculoReady`/`a1ReadyOf` usado na fila).
                const feitaPorDash = (por?: string, resp?: string) => por || resp || '';
                const vinculoReadyDash = (d: Dossier) => !!d.t2_new_email && !!d.t2_new_phone;
                const isRelevantDash = (d: Dossier) =>
                  d.resp_certificacao === currentOperator || !d.resp_certificacao
                  || feitaPorDash(d.bird_id_done_por, d.resp_certificacao) === currentOperator
                  || feitaPorDash(d.a1_done_por, d.resp_certificacao) === currentOperator;
                const minhas = dossiers.filter(d => isRelevantDash(d) && ['t2', 't3'].includes(d.current_step));
                // "SLA Estourado" trocado por "Necessita Atenção"/"Concluídos"
                // (pedido explícito do gestor, 21/07/2026): o card de SLA já
                // estava zerado de propósito (ver comentário histórico
                // abaixo) e não agregava nada; esses dois números — quantas OS
                // relevantes pra ele têm certificação com dado faltando/só
                // parcialmente feita vs. quantas estão 100% ok — são a
                // informação que ele mais usa na tela Certificação. Mesma
                // lógica das abas de lá (`listPool`/`statusOf`), replicada
                // aqui pelo mesmo motivo de `vinculoReadyDash` acima (closure
                // de IIFE diferente, não dá pra importar a constante).
                const finalizadasParaConsultaDash = dossiers.filter(d => d.current_step === 'finalizado');
                const listPoolDash = [...getCertColumnDossiers(), ...finalizadasParaConsultaDash.filter(f => !getCertColumnDossiers().some(x => x.id === f.id))]
                  .filter(isRelevantDash)
                  .filter(d => isManager || !d.cert_docs_recusados);
                const concluidaSemPendenciaDash = (d: Dossier) => !!d.bird_id_done && !!d.a1_done && !birdDadosFaltando(d) && !a1ArquivoFaltando(d);
                // BUG REAL (corrigido, 24/07/2026 — reportado pelo próprio
                // certificador: "está como precisa de atenção e não tem
                // alerta de nenhum item faltando"): a condição antiga
                // `d.bird_id_done || d.a1_done || finalizado` marcava como
                // "Necessita Atenção" QUALQUER OS com só uma das duas
                // certificações feita — inclusive o caso normal de "BIRD
                // feito, A1 ainda aguardando a abertura terminar" (não é
                // problema nenhum, é só o fluxo seguindo). Sem nenhum dado
                // realmente incompleto por trás, nenhum badge de alerta
                // aparecia, e a OS ficava "presa" numa aba de atenção sem
                // motivo — inflando "Necessita Atenção" e esvaziando
                // "Concluídos" ao mesmo tempo. Corrigido pra só contar como
                // atenção de verdade: dado marcado como feito mas incompleto
                // (`birdDadosFaltando`/`a1ArquivoFaltando`) OU empresa já
                // FINALIZADA (aberta) sem certificação 100% limpa — aí sim é
                // atraso real, a empresa já devia estar certificada.
                // 2º ajuste (mesmo dia): "atenção" por finalizado só quando
                // faltam AS DUAS certificações — BIRD (e-CPF, pessoa
                // física) e A1 (e-CNPJ, pessoa jurídica) são independentes,
                // ter uma feita e a outra ainda por fazer é o próximo
                // processo normal, não pendência (ver comentário espelho na
                // tela Certificação, `precisaAtencao`).
                const precisaAtencaoDash = (d: Dossier) =>
                  birdDadosFaltando(d) || a1ArquivoFaltando(d) || (d.current_step === 'finalizado' && !d.bird_id_done && !d.a1_done);
                const necessitaAtencaoDash = listPoolDash.filter(d => !concluidaSemPendenciaDash(d) && precisaAtencaoDash(d)).length;
                const concluidosDash = listPoolDash.filter(concluidaSemPendenciaDash).length;
                // "Minhas OS (E3)" trocado por "Em andamento" (pedido
                // explícito, 21/07/2026): hoje todo o fluxo de certificação
                // vai pra um único certificador, então "Minhas OS" (toda OS
                // atribuída a ele, IGNORANDO o estado — inclusive uma já em
                // Necessita Atenção ou Concluídos) inflava o número e não
                // batia com nenhuma aba da tela Certificação, criando risco
                // de leitura errada. `emAndamentoDash` espelha exatamente
                // `statusOf(d) === 'andamento'` de lá: atribuída E ainda
                // ativa pra trabalhar (`ativaDash`) E não caiu em
                // atencao/concluidos antes — mesma ordem de prioridade.
                const ativaDash = (d: Dossier) => (!d.bird_id_done && vinculoReadyDash(d)) || (a1ReadyOf(d) && !d.a1_done);
                const emAndamentoDash = listPoolDash.filter(d =>
                  !!d.resp_certificacao && ativaDash(d) &&
                  !concluidaSemPendenciaDash(d) && !precisaAtencaoDash(d)
                ).length;
                cards = [
                  { n: emAndamentoDash, label: 'Em andamento', c: 'sky' },
                  { n: minhas.filter(d => !d.bird_id_done && vinculoReadyDash(d)).length, label: 'BIRD ID Pendente', c: 'amber' },
                  { n: minhas.filter(d => !d.a1_done && a1ReadyOf(d)).length, label: 'A1 Pendente', c: 'emerald' },
                  { n: necessitaAtencaoDash, label: 'Necessita Atenção', c: 'rose' },
                  { n: concluidosDash, label: 'Concluídos', c: 'emerald' },
                ];
              } else if (currentRole === 'operador_abertura') {
                const minhas = meus.filter(d => stepOf(d) === 't3' && d.resp_abertura === currentOperator);
                cards = [
                  { n: minhas.length, label: 'Minhas OS (E3)', c: 'sky' },
                  { n: minhas.filter(d => !d.abertura_done).length, label: 'Abertura Pendente', c: 'amber' },
                  { n: slaEst, label: 'SLA Estourado', c: 'rose' },
                ];
              } else {
                cards = [{ n: meus.length, label: 'Empresas Concluídas', c: 'emerald' }];
              }
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {cards.map((k, i) => (
                    <div key={i} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                      <span className={`text-2xl font-bold ${COLOR[k.c]}`}>{k.n}</span>
                      <p className="text-[11px] text-slate-500 font-semibold mt-1">{k.label}</p>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Gargalos por setor (gestor/admin) */}
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">⏱️ Gargalos por Setor</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  {computeBottlenecks(dossiers).map(b => (
                    <div
                      key={b.step}
                      className={`rounded-lg border p-2.5 flex flex-col gap-1 ${
                        b.estourados > 0
                          ? 'border-rose-900/50 bg-rose-950/15'
                          : b.atencao > 0
                          ? 'border-amber-900/40 bg-amber-950/10'
                          : 'border-slate-800 bg-slate-900/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{b.label}</span>
                        <span className="text-base font-bold text-slate-200">{b.total}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-semibold">
                        {b.estourados > 0 && (
                          <span className="text-rose-400">🔴 {b.estourados} atrasado{b.estourados > 1 ? 's' : ''}</span>
                        )}
                        {b.atencao > 0 && (
                          <span className="text-amber-400">🟡 {b.atencao} em risco</span>
                        )}
                        {b.estourados === 0 && b.atencao === 0 && (
                          <span className="text-slate-500">{b.total > 0 ? 'no prazo' : 'vazio'}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-medium">
                        Espera máx: <span className="text-slate-300 font-semibold">{b.maxWaitLabel}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Atalho — pro certificador vai direto pra Certificação (a
                Esteira/kanban foi retirada do menu dele, ver nav acima);
                pros demais papéis continua indo pra Esteira. */}
            <button
              onClick={() => setView(currentRole === 'operador_certificacao' ? 'certificacao' : 'esteira')}
              className="self-start text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white px-4 py-2.5 rounded-lg transition-colors"
            >
              {currentRole === 'operador_certificacao' ? '🔐 Ir para Certificação →' : '🗂️ Ir para a Esteira de Trabalho →'}
            </button>
          </div>
        )}

        {/* ===== TELA ESTEIRA (KANBAN) ===== */}
        {view === 'esteira' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filtro por captador + busca (24/07/2026, mesmo padrão do kanban
              do terceiro) — filtra os cards de TODAS as colunas ao mesmo
              tempo, diferente da busca do header (que é um dropdown de
              "pular pra uma OS"). Estendido (10/08/2026, pedido explícito)
              com filtro por responsável de cada tipo de acesso (Abertura,
              Certificador) e por Projeto. (Filtro por "Gestor (E1/E2)"
              removido no mesmo dia — não qualificado como necessário.) */}
          <div className="shrink-0 px-6 pt-4 pb-1 flex flex-wrap items-center gap-2 bg-slate-900/30">
            <input
              type="text"
              value={esteiraQuery}
              onChange={(e) => setEsteiraQuery(e.target.value)}
              placeholder="Filtrar por nome, empresa, CPF, OS, CNPJ, número ou e-mail..."
              className="flex-1 min-w-[220px] text-xs bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-sky-500"
            />
            <select
              value={esteiraCaptadorFilter}
              onChange={(e) => setEsteiraCaptadorFilter(e.target.value)}
              className="text-xs font-bold bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="">Captador: Todos</option>
              {Array.from(new Set(dossiers.map((d) => d.captured_by).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b)).map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            <select
              value={esteiraAberturaFilter}
              onChange={(e) => setEsteiraAberturaFilter(e.target.value)}
              className="text-xs font-bold bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="">Abertura: Todos</option>
              {Array.from(new Set(dossiers.map((d) => d.resp_abertura).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b)).map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            <select
              value={esteiraCertificadorFilter}
              onChange={(e) => setEsteiraCertificadorFilter(e.target.value)}
              className="text-xs font-bold bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="">Certificador: Todos</option>
              {Array.from(new Set(dossiers.map((d) => d.resp_certificacao).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b)).map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            <select
              value={esteiraProjetoFilter}
              onChange={(e) => setEsteiraProjetoFilter(e.target.value)}
              className="text-xs font-bold bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="">Projeto: Todos</option>
              {Array.from(new Set(dossiers.map((d) => d.projeto).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b)).map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            <select
              value={esteiraContadorFilter}
              onChange={(e) => setEsteiraContadorFilter(e.target.value)}
              className="text-xs font-bold bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="">Contador: Todos</option>
              {CONTADORES.map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={esteiraSemEmpresaFilter}
                onChange={(e) => setEsteiraSemEmpresaFilter(e.target.checked)}
                className="accent-amber-500"
              />
              Sem nome/CNPJ
            </label>
            {(esteiraQuery || esteiraCaptadorFilter || esteiraAberturaFilter || esteiraCertificadorFilter || esteiraProjetoFilter || esteiraContadorFilter || esteiraSemEmpresaFilter) && (
              <button
                type="button"
                onClick={() => {
                  setEsteiraQuery(''); setEsteiraCaptadorFilter('');
                  setEsteiraAberturaFilter('');
                  setEsteiraCertificadorFilter(''); setEsteiraProjetoFilter('');
                  setEsteiraContadorFilter(''); setEsteiraSemEmpresaFilter(false);
                }}
                className="text-[11px] font-bold text-rose-400 hover:text-rose-300"
              >
                ✕ limpar
              </button>
            )}
          </div>
        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 pt-2 flex gap-4 bg-slate-900/30 thin-scroll">

          {/* Coluna 1: Captado */}
          {canSeeStep('captacao') && (
          <div className="flex-1 min-w-[210px] bg-slate-950/40 border border-slate-800/60 rounded-xl flex flex-col h-full">
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 rounded-t-xl flex justify-between items-center shrink-0">
              <span className="text-xs font-bold text-slate-400 tracking-wider">📥 CAPTADOS</span>
              <span className="bg-slate-800 text-[10px] font-bold px-2 py-0.5 rounded-full text-slate-300">
                {getColumnDossiers('captacao').length}
              </span>
            </div>
            <div className="flex-grow p-3 flex flex-col gap-3 overflow-y-auto thin-scroll">
              {getColumnDossiers('captacao').map(d => (
                <div
                  key={d.id}
                  onClick={() => handleSelectOS(d)}
                  className={`bg-slate-900/80 border p-3.5 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${SLA_CARD_ACCENT[computeSla(d).tone]} ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-semibold text-sm truncate flex-1">{empresaOuPessoa(d.client_name, d.empresa_nome)}</h4>
                    <GovChip level={d.gov_level} />
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-1.5">
                    <span className="text-xs text-slate-500 font-medium">{d.cpf}</span>
                    <SlaBadge dossier={d} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <RespChip name={d.captured_by} />
                    <ProjetoChip projeto={d.projeto} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          )}

          {/* Coluna 2: T1 Risco */}
          {canSeeStep('t1') && (
          <div className="flex-1 min-w-[210px] bg-slate-950/40 border border-slate-800/60 rounded-xl flex flex-col h-full">
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 rounded-t-xl flex justify-between items-center shrink-0">
              <span className="text-xs font-bold text-rose-400 tracking-wider">🛡️ E1 - RISCO</span>
              <span className="bg-rose-950/30 text-[10px] font-bold px-2 py-0.5 rounded-full text-rose-400 border border-rose-900/30">
                {getColumnDossiers('t1').filter(d => d.status !== 't1_vermelho').length}
              </span>
            </div>
            <div className="flex-grow p-3 flex flex-col gap-3 overflow-y-auto thin-scroll">
              {(() => {
                const all = getColumnDossiers('t1').filter(d => d.status !== 't1_vermelho');
                const livre = isManager ? all.filter(d => !d.assigned_to) : [];
                const emAndamento = isManager
                  ? all.filter(d => !!d.assigned_to)
                  : all.filter(d => d.assigned_to === currentOperator);
                const renderCard = (d: Dossier) => (
                  <div key={d.id} onClick={() => handleSelectOS(d)}
                    className={`bg-slate-900/80 border p-3.5 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${SLA_CARD_ACCENT[computeSla(d).tone]} ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                      <span className="text-[10px] font-bold text-rose-400 bg-rose-950/20 px-1.5 py-0.5 rounded">E1 PENDENTE</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-semibold text-sm truncate flex-1">{empresaOuPessoa(d.client_name, d.empresa_nome)}</h4>
                      <GovChip level={d.gov_level} />
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5">
                      <RespChip name={d.assigned_to} />
                      <SlaBadge dossier={d} />
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <ProjetoChip projeto={d.projeto} />
                    </div>
                  </div>
                );
                const group = (label: string, color: string, items: Dossier[]) => items.length > 0 && (
                  <div key={label} className="flex flex-col gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{label} ({items.length})</span>
                    {items.map(renderCard)}
                  </div>
                );
                return [
                  group('🔓 Livre', 'text-slate-400', livre),
                  group('⚡ Em andamento', 'text-rose-400', emAndamento),
                ];
              })()}
            </div>
          </div>

          )}

          {/* Coluna 3: T2 Cadastro */}
          {canSeeStep('t2') && (
          <div className="flex-1 min-w-[210px] bg-slate-950/40 border border-slate-800/60 rounded-xl flex flex-col h-full">
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 rounded-t-xl flex justify-between items-center shrink-0">
              <span className="text-xs font-bold text-amber-400 tracking-wider">📝 E2 - CADASTRO</span>
              <span className="bg-amber-950/30 text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-400 border border-amber-900/30">
                {getColumnDossiers('t2').length}
              </span>
            </div>
            <div className="flex-grow p-3 flex flex-col gap-3 overflow-y-auto thin-scroll">
              {(() => {
                const all = getColumnDossiers('t2');
                const livre = isManager ? all.filter(d => !d.assigned_to) : [];
                const emAndamento = isManager
                  ? all.filter(d => !!d.assigned_to)
                  : all.filter(d => d.assigned_to === currentOperator);
                const renderCard = (d: Dossier) => (
                  <div key={d.id} onClick={() => handleSelectOS(d)}
                    className={`bg-slate-900/80 border p-3.5 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${SLA_CARD_ACCENT[computeSla(d).tone]} ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-950/20 px-1.5 py-0.5 rounded">COMPLEMENTAR</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-semibold text-sm truncate flex-1">{empresaOuPessoa(d.client_name, d.empresa_nome)}</h4>
                      <GovChip level={d.gov_level} />
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5">
                      <RespChip name={d.assigned_to} />
                      <SlaBadge dossier={d} />
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <ProjetoChip projeto={d.projeto} />
                    </div>
                  </div>
                );
                const group = (label: string, color: string, items: Dossier[]) => items.length > 0 && (
                  <div key={label} className="flex flex-col gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{label} ({items.length})</span>
                    {items.map(renderCard)}
                  </div>
                );
                return [
                  group('🔓 Livre', 'text-slate-400', livre),
                  group('⚡ Em andamento', 'text-amber-400', emAndamento),
                ];
              })()}
            </div>
          </div>

          )}

          {/* Coluna 4: T3/T4 Certificados e Abertura */}
          {/* Coluna T3: Abertura */}
          {(currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_abertura') && (
          <div className="flex-1 min-w-[210px] bg-slate-950/40 border border-slate-800/60 rounded-xl flex flex-col h-full">
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 rounded-t-xl flex justify-between items-center shrink-0">
              <span className="text-xs font-bold text-amber-400 tracking-wider">🏢 E3 - ABERTURA</span>
              <span className="bg-amber-950/30 text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-400 border border-amber-900/30">
                {getColumnDossiers('t3').length}
              </span>
            </div>
            <div className="flex-grow p-3 flex flex-col gap-3 overflow-y-auto thin-scroll">
              {(() => {
                const all = getColumnDossiers('t3');
                const livre = isManager ? all.filter(d => !d.resp_abertura && !d.abertura_done) : [];
                const emAndamento = isManager
                  ? all.filter(d => !!d.resp_abertura && !d.abertura_done)
                  : all.filter(d => d.resp_abertura === currentOperator && !d.abertura_done);
                const concluido = isManager
                  ? all.filter(d => !!d.abertura_done)
                  : all.filter(d => d.resp_abertura === currentOperator && !!d.abertura_done);
                const renderCard = (d: Dossier) => (
                  <div key={d.id} onClick={() => handleSelectOS(d)}
                    className={`bg-slate-900/80 border p-3.5 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${SLA_CARD_ACCENT[computeSla(d).tone]} ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${d.abertura_done ? 'text-emerald-400 bg-emerald-950/20' : 'text-amber-400 bg-amber-950/20'}`}>
                        {d.abertura_done ? 'CONCLUÍDO' : 'ABERTURA'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-semibold text-sm truncate flex-1">{empresaOuPessoa(d.client_name, d.empresa_nome)}</h4>
                      <GovChip level={d.gov_level} />
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5">
                      <RespChip name={d.resp_abertura} />
                      <SlaBadge dossier={d} />
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <ProjetoChip projeto={d.projeto} />
                    </div>
                  </div>
                );
                const group = (label: string, color: string, items: Dossier[]) => items.length > 0 && (
                  <div key={label} className="flex flex-col gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{label} ({items.length})</span>
                    {items.map(renderCard)}
                  </div>
                );
                return [
                  group('🔓 Livre', 'text-slate-400', livre),
                  group('⚡ Em andamento', 'text-amber-400', emAndamento),
                  group('✅ Concluído', 'text-emerald-400', concluido),
                ];
              })()}
            </div>
          </div>
          )}

          {/* E4 - Certificação saiu do kanban principal: agora é a tela dedicada
              "🔐 Certificação" (evita confundir com a Abertura quando as duas
              etapas rodam em paralelo na mesma OS Prata). */}

          {/* Coluna: Recusadas — OSes reprovadas em qualquer etapa. operador_abertura
              não vê (fora do escopo dele: só age a partir da E3). */}
          {(currentRole === 'gestor' || currentRole === 'admin') && (() => {
            // BUG REAL corrigido (04/08/2026, reportado pelo gestor): esta
            // coluna filtrava `dossiers` direto, sem passar por
            // `matchEsteiraFilters` — era a única coluna da Esteira que
            // ignorava a busca de texto e o filtro de captador (todas as
            // outras usam `getColumnDossiers`, que já aplica esse filtro).
            const recusadas = dossiers.filter(d => d.status === 't1_vermelho' && matchEsteiraFilters(d));
            return (
              <div className="flex-1 min-w-[210px] bg-slate-950/40 border border-rose-900/30 rounded-xl flex flex-col h-full">
                <div className="p-3 bg-rose-950/10 border-b border-rose-900/30 rounded-t-xl flex justify-between items-center shrink-0">
                  <span className="text-xs font-bold text-rose-400 tracking-wider">❌ RECUSADAS</span>
                  <span className="bg-rose-950/30 text-[10px] font-bold px-2 py-0.5 rounded-full text-rose-400 border border-rose-900/30">
                    {recusadas.length}
                  </span>
                </div>
                <div className="flex-grow p-3 flex flex-col gap-3 overflow-y-auto thin-scroll">
                  {recusadas.length === 0 ? (
                    <div className="flex items-center justify-center flex-1 py-8">
                      <span className="text-[10px] text-slate-600 text-center italic">Nenhuma OS recusada</span>
                    </div>
                  ) : recusadas.map(d => (
                    <div key={d.id} onClick={() => handleSelectOS(d)}
                      className={`bg-slate-900/80 border border-rose-900/40 p-3.5 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-rose-700/50 ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-950/30 px-1.5 py-0.5 rounded">E1 REPROVADO</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-semibold text-sm truncate flex-1">{empresaOuPessoa(d.client_name, d.empresa_nome)}</h4>
                        <GovChip level={d.gov_level} />
                      </div>
                      {d.t1_justification && (
                        <p className="text-[10px] text-rose-300/70 mt-1.5 line-clamp-2 italic leading-relaxed">
                          &quot;{d.t1_justification}&quot;
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-1 mt-1.5">
                        <RespChip name={d.captured_by} />
                        <span className="text-[9px] text-slate-600">
                          {d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR') : ''}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <ProjetoChip projeto={d.projeto} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Coluna 5: Finalizado (pro certificador vira "Certificações
              Concluídas", já que a etapa "finalizado" da empresa não é o
              trabalho dele — o dele é a certificação, concluída bem antes
              da empresa fechar tudo).
              Pedido explícito do gestor (11/07/2026): antes essa coluna
              contava `certConcluida` (BIRD *e* A1, o processo inteiro), o
              que gerava um número diferente — e confuso — dos contadores
              da tela Certificação (que contam CADA certificação, BIRD e A1
              separadas). Alinhado: mesma lógica de `feitaPor`/escopo por
              operador usada lá, split em duas listas — E-CPF (BIRD) e
              E-CNPJ (A1) — pra bater exatamente com aqueles números. */}
          {canSeeStep('finalizado') && (() => {
            const isCertRole = currentRole === 'operador_certificacao';
            const feitaPor = (por?: string, resp?: string) => por || resp || '';
            const birdConcluidos = isCertRole
              ? dossiers.filter(d => d.bird_id_done && feitaPor(d.bird_id_done_por, d.resp_certificacao) === currentOperator)
              : [];
            const a1Concluidos = isCertRole
              ? dossiers.filter(d => d.a1_done && feitaPor(d.a1_done_por, d.resp_certificacao) === currentOperator)
              : [];
            const finalizadosList = isCertRole
              ? []
              : currentRole === 'operador_abertura'
                ? getColumnDossiers('finalizado').filter(d => d.resp_abertura === currentOperator)
                : getColumnDossiers('finalizado');
            return (
          <div className="flex-1 min-w-[210px] bg-slate-950/40 border border-slate-800/60 rounded-xl flex flex-col h-full">
            <div className="p-3 bg-slate-950/60 border-b border-slate-800 rounded-t-xl flex justify-between items-center shrink-0">
              <span className="text-xs font-bold text-emerald-400 tracking-wider">{isCertRole ? '🏆 CERTIFICAÇÕES CONCLUÍDAS' : '🏆 ABERTAS / CONCLUÍDAS'}</span>
              <span className="bg-emerald-950/30 text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400 border border-emerald-900/30">
                {isCertRole ? birdConcluidos.length + a1Concluidos.length : finalizadosList.length}
              </span>
            </div>
            <div className="flex-grow p-3 flex flex-col gap-4 overflow-y-auto thin-scroll">
              {isCertRole ? (
                <>
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wide">🆔 E-CPF concluídos ({birdConcluidos.length})</span>
                    {birdConcluidos.length === 0 && <p className="text-[11px] text-slate-600 italic">Nenhum ainda.</p>}
                    {birdConcluidos.map(d => (
                      <div
                        key={`bird-${d.id}`}
                        onClick={() => handleSelectOS(d)}
                        className={`bg-slate-900/80 border p-3 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                          <span className="text-[9px] font-bold text-sky-400 bg-sky-950/20 px-1.5 py-0.5 rounded">🆔 E-CPF ✓</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {/* e-CPF já feito: nome da pessoa física some daqui
                              pro certificador (pedido do gestor) — mostra a
                              empresa quando já existe, senão o CPF como
                              referência (nunca o nome). */}
                          <h4 className="font-semibold text-sm truncate flex-1">{d.empresa_nome || d.cpf}</h4>
                          <GovChip level={d.gov_level} />
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <ProjetoChip projeto={d.projeto} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wide">📜 E-CNPJ concluídos ({a1Concluidos.length})</span>
                    {a1Concluidos.length === 0 && <p className="text-[11px] text-slate-600 italic">Nenhum ainda.</p>}
                    {a1Concluidos.map(d => (
                      <div
                        key={`a1-${d.id}`}
                        onClick={() => handleSelectOS(d)}
                        className={`bg-slate-900/80 border p-3 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                          <span className="text-[9px] font-bold text-violet-400 bg-violet-950/20 px-1.5 py-0.5 rounded">📜 E-CNPJ ✓</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-semibold text-sm truncate flex-1">{d.empresa_nome || d.client_name}</h4>
                          <GovChip level={d.gov_level} />
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <ProjetoChip projeto={d.projeto} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                finalizadosList.map(d => (
                  <div
                    key={d.id}
                    onClick={() => handleSelectOS(d)}
                    className={`bg-slate-900/80 border p-3.5 rounded-lg cursor-pointer transition-all hover:translate-y-[-2px] hover:border-slate-600 ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-bold text-slate-500">OS #{d.id}</span>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/20 px-1.5 py-0.5 rounded">CONCLUÍDO</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-semibold text-sm truncate flex-1">{empresaOuPessoa(d.client_name, d.empresa_nome)}</h4>
                      <GovChip level={d.gov_level} />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-emerald-400 font-semibold">🏢 CNPJ Ativo</p>
                      <ProjetoChip projeto={d.projeto} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
            );
          })()}

        </div>
        </div>
        )}

        {/* ===== TELA CERTIFICAÇÃO (separada da esteira) =====
            Lista as OS em processo de certificação (BIRD ID/A1) mesmo quando
            elas estão, em paralelo, passando pela Abertura — evita a confusão
            de ver a "mesma" OS espelhada em duas colunas do kanban. */}
        {view === 'certificacao' && (() => {
          const all = getCertColumnDossiers();
          // Trabalho ATIVO = tem certificação executável agora. BIRD só conta
          // como executável depois que o vínculo (e-mail + número definidos pelo
          // terceiro) existir — sem isso não tem como abrir o BIRD ID/SYNC pra
          // essa pessoa física ainda, então não é trabalho disponível de verdade
          // (pedido explícito do gestor: "não pode ter erro nesse processo").
          // A1 libera pelos anexos da abertura (a1ReadyOf). BIRD feito sem A1
          // liberado NÃO é pendência do certificador — fica em "Aguardando
          // abertura" (só o gestor acompanha esse grupo, ver abaixo).
          const vinculoReady = (d: Dossier) => !!d.t2_new_email && !!d.t2_new_phone;
          const ativa = (d: Dossier) =>
            (!d.bird_id_done && vinculoReady(d)) || (a1ReadyOf(d) && !d.a1_done);
          // Contadores de cobrança — cada certificação é distinta e cobrada
          // individualmente; certificador vê as dele (nunca de outro certificador
          // — checagem de atribuição, não só papel), gestor vê o total.
          const feitaPor = (por?: string, resp?: string) => por || resp || '';
          const byDoneDesc = (field: 'bird_id_done_em' | 'a1_done_em') => (a: Dossier, b: Dossier) =>
            (b[field] || '').localeCompare(a[field] || '');
          const birdsFeitos = dossiers.filter(d => d.bird_id_done && (isManager || feitaPor(d.bird_id_done_por, d.resp_certificacao) === currentOperator)).sort(byDoneDesc('bird_id_done_em'));
          const a1sFeitos = dossiers.filter(d => d.a1_done && (isManager || feitaPor(d.a1_done_por, d.resp_certificacao) === currentOperator)).sort(byDoneDesc('a1_done_em'));
          const certBadges = (d: Dossier) => (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {d.bird_id_done
                ? <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/20 px-1.5 py-0.5 rounded" title={d.bird_id_done_em ? `Concluído em ${new Date(d.bird_id_done_em).toLocaleDateString('pt-BR')}${d.bird_id_done_por ? ` por ${d.bird_id_done_por}` : ''}` : 'Concluído'}>🆔 BIRD ✓{d.bird_id_done_em ? ` ${new Date(d.bird_id_done_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}</span>
                : vinculoReady(d)
                  ? <span className="text-[9px] font-bold text-sky-400 bg-sky-950/20 px-1.5 py-0.5 rounded">🆔 BIRD pendente</span>
                  // Mesma distinção "liberado vs aguardando" que o A1 já
                  // tinha (linhas abaixo) — pedido explícito do gestor:
                  // "seria bom aparecer essa informação de dados pendentes
                  // pro certificador também". Antes o BIRD só dizia
                  // "pendente" mesmo bloqueado esperando o terceiro definir
                  // o vínculo e-commerce — não dava pra saber se dava pra
                  // trabalhar agora ou não sem abrir a OS.
                  : <span className="text-[9px] font-bold text-slate-500 bg-slate-800/40 px-1.5 py-0.5 rounded" title="Libera com e-mail + número do vínculo e-commerce definidos pelo terceiro">🆔 BIRD aguardando vínculo</span>
              }
              {d.a1_done
                ? <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/20 px-1.5 py-0.5 rounded" title={d.a1_done_em ? `Concluído em ${new Date(d.a1_done_em).toLocaleDateString('pt-BR')}${d.a1_done_por ? ` por ${d.a1_done_por}` : ''}` : 'Concluído'}>📜 A1 ✓{d.a1_done_em ? ` ${new Date(d.a1_done_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}</span>
                : a1ReadyOf(d)
                  ? <span className="text-[9px] font-bold text-sky-400 bg-sky-950/20 px-1.5 py-0.5 rounded">📜 A1 liberado</span>
                  : !d.bird_id_done
                    ? <span className="text-[9px] font-bold text-slate-500 bg-slate-800/40 px-1.5 py-0.5 rounded" title="Libera depois que o BIRD ID/SYNC (e-CPF) do sócio for concluído">📜 A1 aguardando BIRD ID</span>
                    : <span className="text-[9px] font-bold text-slate-500 bg-slate-800/40 px-1.5 py-0.5 rounded" title="Libera com cartão CNPJ + Certidão de Inteiro Teor anexados">📜 A1 aguardando abertura</span>
              }
              {/* Alerta de dado faltando — mesmo critério da auditoria da
                  tela Projetos ("certificação concluída com dado
                  faltando"), que é gestor/admin-only. Pedido explícito do
                  gestor (18/07/2026): o certificador precisa ver isso
                  também, direto na fila dele, sem depender do gestor
                  avisar por fora do sistema — mesmo padrão de badge, sem
                  lista nova (mesma lição do 12º achado). Critério
                  (`birdDadosFaltando`, escopo de componente) revisado no
                  mesmo dia pra pegar preenchimento PARCIAL também, não só
                  "os 4 campos vazios" — ver comentário na função. */}
              {birdDadosFaltando(d) && (
                <span className="text-[9px] font-bold text-rose-400 bg-rose-950/20 px-1.5 py-0.5 rounded" title="BIRD marcado como concluído mas falta pelo menos um dado de acesso (certificadora, sistema, aparelho, e-mail ou senha)">⚠️ BIRD dados incompletos</span>
              )}
              {a1ArquivoFaltando(d) && (
                <span className="text-[9px] font-bold text-rose-400 bg-rose-950/20 px-1.5 py-0.5 rounded" title="A1 marcado como concluído mas sem o arquivo do certificado anexado">⚠️ A1 sem arquivo</span>
              )}
              {!!d.cert_docs_recusados && isManager && (
                <span className="text-[9px] font-bold text-rose-400 bg-rose-950/20 px-1.5 py-0.5 rounded">🚫 docs recusados</span>
              )}
            </div>
          );
          // Pagamento: 3 marcadores independentes (BIRD, A1, Colaborador) —
          // funciona retroativamente (mesmo com a OS já finalizada). Unifica
          // num badge "✅ Pago" só quando os 3 estão marcados (A1 só entra na
          // conta se já foi concluído). Controle de MARCAR/DESMARCAR pagamento
          // agora é exclusivo da tela "Projetos" (pedido do gestor) — aqui é
          // só leitura, um badge sem interação.
          const pagoUnificado = (d: Dossier) => !!d.bird_pago && !!d.colaborador_pago && (!d.a1_done || !!d.a1_pago);
          const pagamentoPill = (d: Dossier, field: 'bird_pago' | 'a1_pago' | 'colaborador_pago', label: string) => (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${d[field] ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' : 'bg-slate-800/60 border-slate-700 text-slate-400'}`}
              title={d[field] ? `Pago em ${d[`${field}_em` as const] ? new Date(d[`${field}_em` as const] as string).toLocaleString('pt-BR') : ''} por ${d[`${field}_por` as const] || ''}` : 'Pendente — marque na tela Projetos'}
            >
              {d[field] ? '✓' : '○'} {label}
            </span>
          );
          // ===== REDESIGN (pedido do gestor: "do jeito que está não está
          // funcional") — lista única paginada com abas de status, no lugar
          // dos grupos de cards espalhados pela tela. Cada linha já mostra o
          // status de BIRD e A1 direto (não precisa abrir a OS pra saber se
          // tem pendência); clicar na linha abre o painel da OS.
          //
          // Inclui também OS já FINALIZADA — os grupos antigos escondiam
          // isso (getCertColumnDossiers exclui 'finalizado' de propósito,
          // é a fila de TRABALHO ativo). Aqui é uma lista de CONSULTA,
          // então uma empresa já aberta continua aparecendo. Ampliado
          // (pedido explícito do gestor, mesmo caso das 29 empresas
          // abertas): ANTES só entravam finalizadas com BIRD/A1 já
          // marcado (`bird_id_done || a1_done`) — uma empresa aberta sem
          // NENHUM certificado marcado nunca aparecia pro certificador,
          // nem pra ele notar que precisa preencher/corrigir. Agora entra
          // toda `finalizado`, sem essa condição — a própria
          // `certBadges(d)` já mostra "BIRD pendente"/"aguardando
          // vínculo" nesse caso, então o alerta visual já existe sem
          // precisar de badge novo, só precisava a OS estar na lista.
          const finalizadasParaConsulta = dossiers.filter(d => d.current_step === 'finalizado');
          const isRelevantParaMim = (d: Dossier) =>
            isManager || d.resp_certificacao === currentOperator || !d.resp_certificacao
            || feitaPor(d.bird_id_done_por, d.resp_certificacao) === currentOperator
            || feitaPor(d.a1_done_por, d.resp_certificacao) === currentOperator;
          const listPool = [...all, ...finalizadasParaConsulta.filter(f => !all.some(x => x.id === f.id))]
            .filter(isRelevantParaMim)
            .filter(d => isManager || !d.cert_docs_recusados);
          // BUG REAL (corrigido): exigir certConcluida (BIRD *e* A1) pra cair em
          // "concluído" deixava a aba com uma contagem bem menor que os
          // contadores do topo (birdsFeitos/a1sFeitos, que contam CADA
          // certificação feita, não a OS inteira "toda concluída"). Uma OS com
          // só o BIRD feito (A1 ainda não liberado/feito) contava lá em cima
          // mas sumia daqui. Alinhado: qualquer certificação feita (BIRD OU A1)
          // já classifica a OS como "concluído" nesta lista.
          // BUG REAL #2 (corrigido agora): statusOf retornava 'concluido'
          // (singular) mas o tipo de certListViewTab e a key da aba são
          // 'concluidos' (plural, ver tabs abaixo) — a comparação
          // `statusOf(d) === certListViewTab` nunca batia, então a aba
          // Concluídos sempre mostrava (0) e ficava vazia ao clicar, pra
          // TODO papel (gestor e certificador), desde o redesenho original.
          // TypeScript não pegou porque os dois são union types de string
          // literal distintos só de nome, sem checagem cruzada entre eles.
          // Pedido de acompanhamento (18/07/2026, mesmo caso dos achados
          // 9-16): "Concluídos" virou uma mistura de 3 coisas bem diferentes
          // depois que empresas finalizadas sem certificação passaram a
          // entrar no pool (15º achado) — empresa aberta sem NENHUM
          // certificado, com só 1 dos 2, ou com os 2 marcados mas dado/
          // arquivo faltando, tudo caindo na mesma aba que quem está
          // realmente 100% ok. Gestor pediu separação explícita: uma aba só
          // pra quem precisa de atenção (responsáveis corrigirem), outra só
          // pra quem está de fato limpo. `certConcluidaSemPendencia` é mais
          // estrito que `certConcluida` (que só exige bird_id_done &&
          // a1_done, ignorando se o dado por trás está completo) — reaproveita
          // birdDadosFaltando/a1ArquivoFaltando (14º achado) em vez de
          // duplicar critério novo.
          const certConcluidaSemPendencia = (d: Dossier) =>
            !!d.bird_id_done && !!d.a1_done && !birdDadosFaltando(d) && !a1ArquivoFaltando(d);
          // Aba "Concluído e-CPF" (24/07/2026, pedido explícito do
          // certificador): antes, uma OS com só o BIRD (e-CPF) feito
          // caía junto com "Necessita Atenção"/"Em andamento" sem nenhuma
          // aba própria — só virava "Concluídos" quando os DOIS
          // certificados estivessem prontos. Como A1 exige `bird_id_done`
          // como pré-requisito (`a1ReadyOf`), não existe caso de A1 feito
          // sem BIRD feito — então esta aba é só o "meio do caminho": BIRD
          // feito, A1 ainda não feito. Assim que o A1 é concluído, a OS sai
          // daqui e entra em `certConcluidaSemPendencia` acima.
          // AJUSTE (mesmo dia, revertido em seguida — pedido explícito do
          // usuário confirmou a regra correta): "se estiver com dados
          // faltando precisa estar em Necessita Atenção, só muda após ser
          // resolvido o que está pendente; se o e-CPF foi feito (dado
          // completo) e está aguardando o A1, ele deve ir para Concluído
          // e-CPF". Ou seja, dado incompleto SEMPRE fica em "Necessita
          // Atenção" até ser corrigido — não deve aparecer em "Concluído
          // e-CPF" só com um badge de aviso. Restaurado `!birdDadosFaltando`
          // como parte do critério (mesmo comportamento do PR #125
          // original; a tentativa de remover essa exigência, pensando que
          // resolvia "só tem 2 e-CPF concluído, tem mais aí", estava
          // errada — aquele caso era dado incompleto de verdade,
          // legitimamente pendente de correção, não um bug de exibição).
          const certConcluidaEcpf = (d: Dossier) =>
            !!d.bird_id_done && !d.a1_done && !birdDadosFaltando(d);
          // BUG REAL (corrigido, 24/07/2026 — reportado pelo próprio
          // certificador: "está como precisa de atenção e não tem alerta de
          // nenhum item faltando"): `d.bird_id_done || d.a1_done ||
          // finalizado` marcava como "atenção" QUALQUER OS com só uma das
          // duas certificações feita — inclusive "BIRD feito, A1 ainda
          // aguardando a abertura terminar", que é fluxo normal, não
          // problema. Sem `birdDadosFaltando`/`a1ArquivoFaltando` (os únicos
          // alertas reais que existem), a OS ficava rotulada "atenção" sem
          // nenhum motivo visível.
          // 2º ajuste (mesmo dia, pedido de acompanhamento): a 1ª correção
          // ainda marcava "atenção" pra QUALQUER OS finalizada com só uma
          // das duas certificações feita — mas o certificador apontou que
          // isso também é normal: "BIRD concluído (e-CPF, pessoa física),
          // vai precisar fazer o A1 (e-CNPJ, pessoa jurídica) — o A1 é
          // simplesmente o PRÓXIMO processo, não uma pendência". BIRD e A1
          // são dois certificados INDEPENDENTES (pessoa física vs pessoa
          // jurídica) — ter um feito e o outro ainda por fazer não é
          // problema, é só o certificador ainda não ter chegado nessa
          // etapa. O que É de fato preocupante: uma empresa já finalizada
          // (aberta) sem NENHUMA das duas certificações sequer iniciada —
          // aí sim ninguém começou a certificar uma empresa que já está
          // operando, atraso real (era exatamente o caso original do 15º
          // achado: "empresa aberta sem NENHUM certificado marcado"). Fix:
          // finalizado só conta como atenção quando faltam AS DUAS, não
          // quando falta só uma.
          const precisaAtencao = (d: Dossier) =>
            birdDadosFaltando(d) || a1ArquivoFaltando(d) || (d.current_step === 'finalizado' && !d.bird_id_done && !d.a1_done);
          const statusOf = (d: Dossier): 'livre' | 'andamento' | 'aguardando' | 'atencao' | 'concluido_ecpf' | 'concluidos' => {
            if (certConcluidaSemPendencia(d)) return 'concluidos';
            if (certConcluidaEcpf(d)) return 'concluido_ecpf';
            if (precisaAtencao(d)) return 'atencao';
            if (!ativa(d)) return 'aguardando';
            return d.resp_certificacao ? 'andamento' : 'livre';
          };
          // Aba "Aguardando abertura" retirada (24/07/2026, pedido explícito
          // do usuário) — na sequência, novo pedido explícito: essas OS
          // (bloqueadas esperando dado do terceiro/abertura, ainda não
          // disponíveis pra trabalhar) não devem aparecer NA LISTA
          // NENHUMA pro certificador — "só deve aparecer pro certificador
          // o que já está disponível pra ele trabalhar". Gestor/admin
          // continuam vendo tudo (é quem acompanha o gargalo). Aplicado
          // ANTES de `poolDateFiltered`, então a contagem de "Todos"/de
          // cada aba já reflete a lista reduzida — sem isso a soma das
          // abas visíveis ficava menor que "Todos" sem nenhuma explicação
          // na tela (as "aguardando" entravam no total sem aparecer em
          // nenhuma aba, já que o botão foi removido antes).
          const listPoolVisible = isManager ? listPool : listPool.filter(d => statusOf(d) !== 'aguardando');
          // "Em andamento" (atribuída a mim) e "Livre" (ninguém pegou) são a
          // MESMA pilha de trabalho pra quem certifica — a distinção é de
          // atribuição, não de estado, e hoje existe um certificador só, então
          // separar as duas só confundia ("o andamento e o livre estava
          // confuso"). Pro certificador vira uma aba única "⚡ A fazer";
          // gestor/admin continuam com as duas separadas, porque pra eles
          // "Livre" é exatamente o trabalho que ninguém assumiu.
          // `statusOf` NÃO muda — a fusão é só na camada de abas, pra não
          // mexer nas 3 cópias do critério (Certificação, Dashboard, Projetos).
          const matchesTab = (d: Dossier, key: typeof certListViewTab) => {
            const s = statusOf(d);
            if (!isManager && key === 'andamento') return s === 'andamento' || s === 'livre';
            return s === key;
          };
          const tabs: { key: typeof certListViewTab; label: string; managerOnly?: boolean }[] = [
            { key: 'todos', label: '📋 Todos' },
            { key: 'andamento', label: isManager ? '⚡ Em andamento' : '⚡ A fazer' },
            ...(isManager ? [{ key: 'livre' as typeof certListViewTab, label: '🔓 Livre' }] : []),
            // Não é managerOnly de propósito — o objetivo é o próprio
            // certificador ver e corrigir, não só o gestor cobrar por fora.
            { key: 'atencao', label: '🚨 Necessita Atenção' },
            { key: 'concluido_ecpf', label: '🆔 Concluído e-CPF' },
            { key: 'concluidos', label: '✅ Concluído e-CPF + e-CNPJ' },
            // managerOnly (bug real reportado, 11/08/2026: soma das abas não
            // batia com "Todos" — ver comentário de `listPoolVisible` acima).
            // Pro certificador, `listPoolVisible` já EXCLUI as OS
            // "aguardando" de `poolFiltered`/"Todos" inteiro, então a soma já
            // batia sem essa aba. Pro gestor/admin, `listPoolVisible =
            // listPool` (sem esse filtro — é quem acompanha o gargalo,
            // precisa ver tudo), mas não existia NENHUMA aba mostrando esse
            // grupo — as OS "aguardando" entravam em "Todos" sem aparecer em
            // nenhuma aba, deixando a soma das abas sempre menor que "Todos"
            // pro gestor. Não reintroduzir sem `managerOnly: true` — foi
            // removida do fluxo do certificador de propósito (pedido
            // explícito: "só deve aparecer pro certificador o que está
            // disponível pra ele trabalhar").
            { key: 'aguardando', label: '⏸ Aguardando abertura', managerOnly: true },
          ];
          // Filtro por data (pedido do gestor, 24/07/2026 — mesmo padrão do
          // kanban do terceiro): "Entrada" usa created_at (quando a OS
          // entrou no fluxo — não existe timestamp específico de "entrou na
          // fila do certificador", created_at é o proxy já usado em
          // `relevantDate` abaixo); "Finalização" usa empresa_aberta_em
          // (existe só a partir do fix do portal do terceiro, 23/07/2026 —
          // OS finalizadas antes disso não têm essa data). Aplicado ANTES da
          // divisão por aba, pra as contagens das abas baterem com o que a
          // lista mostra.
          const dateFieldFor = (d: Dossier) => (certListDateField === 'finalizacao' ? d.empresa_aberta_em : d.created_at) || '';
          const poolDateFiltered = listPoolVisible.filter((d) => {
            if (!certListDateFrom && !certListDateTo) return true;
            const raw = dateFieldFor(d);
            if (!raw) return false;
            const dateOnly = raw.slice(0, 10);
            if (certListDateFrom && dateOnly < certListDateFrom) return false;
            if (certListDateTo && dateOnly > certListDateTo) return false;
            return true;
          });
          // Filtro por nível Gov.br e por tipo de certificado (pedido
          // explícito, 24/07/2026). Tipo segue o mesmo critério já usado
          // pra decidir se o foco da OS é a pessoa física ou a empresa
          // (`primaryIsEmpresa` mais abaixo): uma vez que o BIRD (e-CPF) é
          // concluído, o trabalho relevante passa a ser o A1 (e-CNPJ) —
          // não fica "sem tipo" nunca, mesmo com os dois já feitos.
          const tipoOf = (d: Dossier): 'ecpf' | 'ecnpj' => (d.bird_id_done ? 'ecnpj' : 'ecpf');
          const poolFiltered = poolDateFiltered.filter((d) =>
            (certListGovFilter === 'todos' || d.gov_level === certListGovFilter) &&
            (certListTipoFilter === 'todos' || tipoOf(d) === certListTipoFilter)
          );
          const tabbed = certListViewTab === 'todos' ? poolFiltered : poolFiltered.filter(d => matchesTab(d, certListViewTab));
          // Mais recente primeiro (padrão): prioriza a data de conclusão
          // (BIRD/A1), senão a data de entrada na esteira — mistura ativos e
          // concluídos numa ordem só, sem precisar de abas separadas de
          // ordenação. Toggle de ordenação inverte pra mais antigas primeiro.
          const relevantDate = (d: Dossier) => d.a1_done_em || d.bird_id_done_em || d.created_at || '';
          const sortedList = [...tabbed].sort((a, b) => {
            const cmp = relevantDate(b).localeCompare(relevantDate(a));
            return certListSortDir === 'novas' ? cmp : -cmp;
          });
          const LIST_PAGE_SIZE = 10;
          const totalListPages = Math.max(1, Math.ceil(sortedList.length / LIST_PAGE_SIZE));
          const listPage = Math.min(certListViewPage, totalListPages - 1);
          const pageList = sortedList.slice(listPage * LIST_PAGE_SIZE, listPage * LIST_PAGE_SIZE + LIST_PAGE_SIZE);

          const renderListRow = (d: Dossier) => {
            const status = statusOf(d);
            // Destaque do nome: enquanto o BIRD (e-CPF) ainda não foi feito,
            // o trabalho pendente é da pessoa física, então o nome dela vai
            // em destaque. Depois que o BIRD já foi concluído, o que resta
            // (A1/e-CNPJ, ou já tudo pronto) é sobre a empresa — pedido
            // explícito do gestor pra não confundir "de quem é essa OS" numa
            // lista com nome de pessoa em destaque numa empresa já com BIRD
            // pronto.
            const primaryIsEmpresa = d.bird_id_done && !!d.empresa_nome;
            const primaryName = primaryIsEmpresa ? d.empresa_nome : d.client_name;
            // Pedido explícito (24/07/2026, extensão de acompanhamento):
            // uma vez que o e-CPF (BIRD) já foi concluído, o nome da pessoa
            // física não deve aparecer mais em NENHUMA linha desta lista —
            // nem como secundário — só a empresa, pra qualquer papel
            // (antes era escondido só pro certificador, gestor/admin ainda
            // viam os dois; agora é universal nesta lista).
            const secondaryName = primaryIsEmpresa ? undefined : d.empresa_nome;
            const secondaryIcon = primaryIsEmpresa ? '👤' : '🏢';
            return (
              <div
                key={d.id}
                onClick={() => handleSelectOS(d)}
                className={`bg-slate-900/70 border p-3.5 rounded-lg cursor-pointer hover:border-slate-600 transition-colors flex flex-col gap-1.5 ${selectedOS?.id === d.id ? 'border-sky-500 bg-sky-950/20' : 'border-slate-800'}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[10px] font-bold text-slate-500 shrink-0">OS #{d.id}</span>
                    <h4 className="font-semibold text-sm truncate">{primaryName}</h4>
                    {secondaryName && <span className="text-[11px] text-slate-500 truncate">{secondaryIcon} {secondaryName}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <GovChip level={d.gov_level} />
                    {d.current_step === 'finalizado' && <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/20 px-1.5 py-0.5 rounded">🏆 empresa aberta</span>}
                    {status === 'aguardando' && isManager && <span className="text-[9px] font-bold text-slate-500 bg-slate-800/40 px-1.5 py-0.5 rounded">⏸ com a abertura</span>}
                    {d.agendamento_cert && status !== 'concluidos' && (
                      agendamentoPendente(d)
                        ? <span className="text-[9px] font-bold text-amber-300 bg-amber-950/30 px-1.5 py-0.5 rounded">⏳ {new Date(d.agendamento_cert).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} aguardando aprovação</span>
                        : <span className="text-[9px] font-bold text-sky-400 bg-sky-950/20 px-1.5 py-0.5 rounded">📅 {new Date(d.agendamento_cert).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                    )}
                  </div>
                </div>
                {certBadges(d)}
                {/* Datas de entrada/finalização (pedido do gestor, 24/07/2026
                    — mesmo padrão do kanban do terceiro). Finalização só
                    existe a partir de 23/07/2026, então some pra OS antigas. */}
                <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
                  <span>Entrou: {d.created_at ? new Date(d.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'}</span>
                  {d.empresa_aberta_em && <span>• Finalizado: {new Date(d.empresa_aberta_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <RespChip name={d.resp_certificacao} />
                  {isManager && (d.bird_id_done || d.a1_done) && (
                    pagoUnificado(d) ? (
                      <span className="text-[10px] font-bold text-emerald-400">✅ Pago</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {d.bird_id_done && pagamentoPill(d, 'bird_pago', 'BIRD')}
                        {d.a1_done && pagamentoPill(d, 'a1_pago', 'A1')}
                        {(d.bird_id_done || d.a1_done) && pagamentoPill(d, 'colaborador_pago', 'Colaborador')}
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          };

          return (
            // O container de rolagem ocupa a largura TODA da área útil (senão,
            // com a sidebar recolhida, o max-w gruda tudo à esquerda e a barra
            // de rolagem flutua no meio da tela com uma faixa morta à direita
            // — bug real reportado pelo gestor). O limite de largura fica num
            // wrapper interno, centralizado.
            <div className="flex-1 overflow-y-auto p-6 bg-slate-900/30 thin-scroll">
              <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full">
              {/* Contadores de certificações feitas (base de cobrança) */}
              <div className="flex flex-wrap gap-3">
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl px-4 py-3 flex flex-col">
                  <span className="text-xl font-bold text-emerald-400">{birdsFeitos.length}</span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">🆔 BIRDs concluídos{isManager ? ' (total)' : ''}</span>
                </div>
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl px-4 py-3 flex flex-col">
                  <span className="text-xl font-bold text-emerald-400">{a1sFeitos.length}</span>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">📜 A1s concluídos{isManager ? ' (total)' : ''}</span>
                </div>
                {isManager && (() => {
                  type PorCert = { bird: number; a1: number; birdPend: number; a1Pend: number };
                  const porCert: Record<string, PorCert> = {};
                  const blank = (): PorCert => ({ bird: 0, a1: 0, birdPend: 0, a1Pend: 0 });
                  for (const d of dossiers) {
                    if (d.bird_id_done) { const n = feitaPor(d.bird_id_done_por, d.resp_certificacao); if (n) { porCert[n] = porCert[n] || blank(); porCert[n].bird++; } }
                    if (d.a1_done) { const n = feitaPor(d.a1_done_por, d.resp_certificacao); if (n) { porCert[n] = porCert[n] || blank(); porCert[n].a1++; } }
                  }
                  // Pendentes — pedido do gestor (18/07/2026, após 2 idas e
                  // voltas: tentamos um bloco novo em Projetos, depois em
                  // Concluídos por Certificador, ambos rejeitados por
                  // duplicar o que esta lista já mostra linha a linha via
                  // RespChip). Em vez de mais uma lista, só estende ESTE
                  // resumo (que já existia só pra concluídos) com pendentes
                  // — agrupado por resp_certificacao (atribuído), não por
                  // quem concluiu (ainda não concluiu). "Livre" entra como
                  // mais uma "pessoa" nesse resumo — é trabalho disponível
                  // que ninguém pegou ainda, informação útil pro gestor.
                  for (const d of dossiers) {
                    if (!['t2', 't3'].includes(d.current_step)) continue;
                    const resp = d.resp_certificacao || 'Livre';
                    if (!d.bird_id_done && vinculoReady(d)) { porCert[resp] = porCert[resp] || blank(); porCert[resp].birdPend++; }
                    if (!d.a1_done && a1ReadyOf(d)) { porCert[resp] = porCert[resp] || blank(); porCert[resp].a1Pend++; }
                  }
                  const entries = Object.entries(porCert).sort(([a], [b]) => {
                    if (a === 'Livre') return 1;
                    if (b === 'Livre') return -1;
                    return a.localeCompare(b);
                  });
                  return entries.length > 0 && (
                    <div className="bg-slate-950/40 border border-slate-800 rounded-xl px-4 py-3 flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Por certificador</span>
                      {entries.map(([nome, c]) => (
                        <span key={nome} className="text-[11px] text-slate-300">
                          {nome}: <span className="text-emerald-400 font-bold">{c.bird}</span> BIRD · <span className="text-emerald-400 font-bold">{c.a1}</span> A1
                          {(c.birdPend > 0 || c.a1Pend > 0) && (
                            <> · <span className="text-sky-400 font-bold">{c.birdPend}</span> BIRD · <span className="text-sky-400 font-bold">{c.a1Pend}</span> A1 pendentes</>
                          )}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Upload de A1 em lote — ele emite vários certificados de uma
                  vez e anexava um por um. Fica aqui (e não dentro da OS)
                  justamente porque a operação é entre várias OS. */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setLoteA1Itens([]); setLoteA1Open(true); }}
                  className="text-[11px] font-bold text-emerald-300 bg-emerald-900/20 border border-emerald-700/40 rounded-lg px-3 py-1.5 hover:bg-emerald-900/40 transition-colors"
                >
                  📦 Subir certificados em lote
                </button>
              </div>

              {/* Filtro por data + ordenação — mesmo padrão do kanban do
                  terceiro (23/07/2026): dá pra escolher se o período filtra
                  pela data de entrada na esteira ou pela data de
                  finalização, e alternar mais novas/antigas primeiro. */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => { setCertListSortDir((d) => d === 'novas' ? 'antigas' : 'novas'); setCertListViewPage(0); }}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-200 bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5"
                >
                  {certListSortDir === 'novas' ? '↓ Mais novas primeiro' : '↑ Mais antigas primeiro'}
                </button>
                <select
                  value={certListDateField}
                  onChange={(e) => { setCertListDateField(e.target.value as 'entrada' | 'finalizacao'); setCertListViewPage(0); }}
                  className="text-[11px] font-bold bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 outline-none focus:border-sky-500"
                >
                  <option value="entrada">Filtrar por: Entrada</option>
                  <option value="finalizacao">Filtrar por: Finalização</option>
                </select>
                <input
                  type="date"
                  value={certListDateFrom}
                  onChange={(e) => { setCertListDateFrom(e.target.value); setCertListViewPage(0); }}
                  className="text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 outline-none focus:border-sky-500"
                />
                <span className="text-[11px] text-slate-600">até</span>
                <input
                  type="date"
                  value={certListDateTo}
                  onChange={(e) => { setCertListDateTo(e.target.value); setCertListViewPage(0); }}
                  className="text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 outline-none focus:border-sky-500"
                />
                {(certListDateFrom || certListDateTo) && (
                  <button
                    type="button"
                    onClick={() => { setCertListDateFrom(''); setCertListDateTo(''); setCertListViewPage(0); }}
                    className="text-[11px] font-bold text-rose-400 hover:text-rose-300"
                  >
                    ✕ limpar
                  </button>
                )}
                <select
                  value={certListGovFilter}
                  onChange={(e) => { setCertListGovFilter(e.target.value as 'todos' | 'ouro' | 'prata'); setCertListViewPage(0); }}
                  className="text-[11px] font-bold bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 outline-none focus:border-sky-500"
                >
                  <option value="todos">Nível Gov: Todos</option>
                  <option value="ouro">🥇 Ouro</option>
                  <option value="prata">🥈 Prata</option>
                </select>
                <select
                  value={certListTipoFilter}
                  onChange={(e) => { setCertListTipoFilter(e.target.value as 'todos' | 'ecpf' | 'ecnpj'); setCertListViewPage(0); }}
                  className="text-[11px] font-bold bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 outline-none focus:border-sky-500"
                >
                  <option value="todos">Tipo: Todos</option>
                  <option value="ecpf">🆔 e-CPF</option>
                  <option value="ecnpj">📜 e-CNPJ</option>
                </select>
              </div>

              {/* Abas de status — filtram a lista abaixo */}
              <div className="flex items-center gap-1.5 flex-wrap border-b border-slate-800 pb-2">
                {tabs.filter(t => !t.managerOnly || isManager).map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => { setCertListViewTab(t.key); setCertListViewPage(0); }}
                    className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors ${certListViewTab === t.key ? 'bg-sky-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                  >
                    {t.label} ({t.key === 'todos' ? poolFiltered.length : poolFiltered.filter(d => matchesTab(d, t.key)).length})
                  </button>
                ))}
              </div>

              {/* Lista paginada — 15 por página */}
              {pageList.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhuma OS nesta aba.</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {pageList.map(renderListRow)}
                </div>
              )}
              {totalListPages > 1 && (() => {
                // Janela de números de página (1,2,3...) — mostra até 7 botões
                // em volta da página atual, com "…" quando tem muita página,
                // pra não precisar clicar "Próxima" 20 vezes numa lista grande.
                const WINDOW = 2;
                const pageNums: (number | '…')[] = [];
                for (let i = 0; i < totalListPages; i++) {
                  if (i === 0 || i === totalListPages - 1 || Math.abs(i - listPage) <= WINDOW) {
                    pageNums.push(i);
                  } else if (pageNums[pageNums.length - 1] !== '…') {
                    pageNums.push('…');
                  }
                }
                return (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <span className="text-[11px] text-slate-500">Página {listPage + 1} de {totalListPages} · {sortedList.length} OS</span>
                    <div className="flex items-center gap-1 flex-wrap justify-center">
                      <button
                        type="button"
                        disabled={listPage === 0}
                        onClick={() => setCertListViewPage(listPage - 1)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                      >
                        ← Anterior
                      </button>
                      {pageNums.map((p, idx) => p === '…' ? (
                        <span key={`ellipsis-${idx}`} className="text-[11px] text-slate-600 px-1">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setCertListViewPage(p)}
                          className={`text-[11px] font-bold w-7 h-7 rounded transition-colors ${p === listPage ? 'bg-sky-600 text-white' : 'border border-slate-800 text-slate-300 hover:border-slate-600'}`}
                        >
                          {p + 1}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={listPage >= totalListPages - 1}
                        onClick={() => setCertListViewPage(listPage + 1)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                      >
                        Próxima →
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Modal do upload em lote. Duas etapas: escolher os arquivos
                  (casamento automático pelo nome/CNPJ) e CONFERIR antes de
                  gravar — a conferência é parte do pedido, não um extra:
                  arquivo e empresa divergentes significam certificado errado.
                  Cada arquivo vai num request próprio pro endpoint de upload
                  que já existe, mantendo auditoria e detecção de extensão. */}
              {loteA1Open && (() => {
                const porId = (osId: string) => dossiers.find(d => d.id === osId);
                const rotulo = (d?: Dossier) => d ? `${d.empresa_nome || d.client_name} · OS #${d.id}` : '—';
                const prontos = loteA1Itens.filter(i => i.osId).length;
                const concluido = loteA1Itens.length > 0 && loteA1Itens.every(i => i.resultado);

                const escolherArquivos = (files: FileList | null) => {
                  if (!files || files.length === 0) return;
                  const pool = listPool.filter(d => !!d.empresa_nome || !!d.cnpj_number);
                  Promise.all(Array.from(files).map((file) => new Promise<LoteA1Item>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const candidatos = matchArquivoParaOS(file.name, pool);
                      resolve({
                        nome: file.name,
                        data: String(reader.result || ''),
                        osId: candidatos.length === 1 ? candidatos[0] : '',
                        status: candidatos.length === 1 ? 'auto' : candidatos.length === 0 ? 'nenhum' : 'ambiguo',
                        candidatos,
                      });
                    };
                    reader.readAsDataURL(file);
                  }))).then(setLoteA1Itens);
                };

                const confirmar = async () => {
                  setLoteA1Busy(true);
                  const itens = [...loteA1Itens];
                  for (let i = 0; i < itens.length; i++) {
                    const it = itens[i];
                    if (!it.osId) { itens[i] = { ...it, resultado: '⚠️ sem OS escolhida — ignorado' }; setLoteA1Itens([...itens]); continue; }
                    try {
                      const res = await fetch(`/api/dossiers/${it.osId}/upload`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ field: 'certificado_a1_url', data: it.data, original_name: it.nome }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        itens[i] = { ...it, resultado: `❌ ${err.error || `erro ${res.status}`}` };
                      } else {
                        const d = porId(it.osId);
                        // Marcar A1 concluído só quando a OS está de fato
                        // liberada — a regra de `a1ReadyOf` (CNPJ + cartão +
                        // certidão + BIRD) não é burlada pelo lote. Sem isso,
                        // o arquivo fica anexado e a linha diz o que falta.
                        if (d && a1ReadyOf(d) && !d.a1_done) {
                          const patch = await fetch(`/api/dossiers/${it.osId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              a1_done: true,
                              a1_done_em: new Date().toISOString(),
                              a1_done_por: currentOperator,
                              ...(d.resp_certificacao ? {} : { resp_certificacao: currentOperator }),
                            }),
                          });
                          itens[i] = { ...it, resultado: patch.ok ? '✅ anexado e A1 concluído' : '⚠️ anexado, mas falhou ao concluir o A1' };
                        } else if (d && !a1ReadyOf(d)) {
                          itens[i] = { ...it, resultado: '⚠️ anexado — A1 não liberado (falta CNPJ, cartão, certidão ou BIRD)' };
                        } else {
                          itens[i] = { ...it, resultado: '✅ anexado' };
                        }
                      }
                    } catch {
                      itens[i] = { ...it, resultado: '❌ falha de rede' };
                    }
                    setLoteA1Itens([...itens]);
                  }
                  setLoteA1Busy(false);
                  fetchDossiers();
                };

                return (
                  <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => { if (!loteA1Busy) setLoteA1Open(false); }}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-slate-950 border border-slate-700 rounded-xl shadow-2xl w-full max-w-[720px] max-h-[90vh] overflow-y-auto flex flex-col thin-scroll">
                      <div className="px-5 py-4 border-b border-slate-800">
                        <h3 className="font-bold text-sm text-slate-100">📦 Subir certificados A1 em lote</h3>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Selecione os arquivos (.zip/.rar). O sistema casa cada um com a OS pelo nome da empresa ou pelo CNPJ — confira antes de confirmar.
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          A finalização da OS continua sendo feita na tela da própria OS — aqui só o A1 é anexado e marcado como concluído.
                        </p>
                      </div>

                      <div className="px-5 py-4 flex flex-col gap-3">
                        {loteA1Itens.length === 0 ? (
                          <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-700 rounded-lg py-10 cursor-pointer hover:border-violet-600 transition-colors">
                            <span className="text-2xl">📂</span>
                            <span className="text-xs font-bold text-slate-300">Escolher arquivos</span>
                            <span className="text-[10px] text-slate-500">Pode selecionar vários de uma vez</span>
                            <input
                              type="file"
                              multiple
                              accept=".zip,.rar,application/zip,application/x-rar-compressed,application/octet-stream"
                              className="hidden"
                              onChange={(e) => escolherArquivos(e.target.files)}
                            />
                          </label>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {loteA1Itens.map((it, idx) => (
                              <div key={`${it.nome}-${idx}`} className="border border-slate-800 bg-slate-900/40 rounded-lg px-3 py-2.5 flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-200 break-all">{it.nome}</span>
                                  {it.status === 'auto' && !it.resultado && <span className="text-[10px] font-bold text-emerald-400 shrink-0">✓ casou</span>}
                                  {it.status === 'ambiguo' && !it.resultado && <span className="text-[10px] font-bold text-amber-400 shrink-0">⚠️ ambíguo</span>}
                                  {it.status === 'nenhum' && !it.resultado && <span className="text-[10px] font-bold text-rose-400 shrink-0">✕ não encontrado</span>}
                                </div>
                                {it.resultado ? (
                                  <span className="text-[11px] text-slate-300">{it.resultado} → {rotulo(porId(it.osId))}</span>
                                ) : (
                                  <select
                                    value={it.osId}
                                    onChange={(e) => setLoteA1Itens(prev => prev.map((p, i) => i === idx ? { ...p, osId: e.target.value } : p))}
                                    className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 outline-none focus:border-sky-500"
                                  >
                                    <option value="">— escolher a OS —</option>
                                    {/* Candidatos primeiro; a lista completa
                                        abaixo cobre o caso de o arquivo ter
                                        vindo com nome fora do padrão. */}
                                    {it.candidatos.map(cid => (
                                      <option key={cid} value={cid}>{rotulo(porId(cid))}</option>
                                    ))}
                                    {listPool
                                      .filter(d => !it.candidatos.includes(d.id))
                                      .map(d => <option key={d.id} value={d.id}>{rotulo(d)}</option>)}
                                  </select>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] text-slate-500">
                          {loteA1Itens.length > 0 && `${prontos} de ${loteA1Itens.length} com OS definida`}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setLoteA1Open(false)}
                            disabled={loteA1Busy}
                            className="text-xs text-slate-400 hover:text-slate-200 px-3 py-2 disabled:opacity-40"
                          >{concluido ? 'Fechar' : 'Cancelar'}</button>
                          {!concluido && (
                            <button
                              onClick={confirmar}
                              disabled={loteA1Busy || prontos === 0}
                              className="text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
                            >{loteA1Busy ? 'Enviando…' : `Confirmar e enviar (${prontos})`}</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              </div>
            </div>
          );
        })()}

        {/* ===== TELA AGENDA ===== */}
        {view === 'agenda' && (() => {
          const canAssign = currentRole === 'gestor' || currentRole === 'admin';
          const canManageSelf = currentRole === 'operador_certificacao';
          const canInteractSlot = canAssign || canManageSelf;
          // Seg (0) a Sáb (5) da semana exibida
          const weekDays = Array.from({ length: 6 }, (_, i) => {
            const d = new Date(agendaWeekStart);
            d.setDate(agendaWeekStart.getDate() + i);
            return d;
          });
          // Grade: 08h00 a 20h00 em slots de 30 min = 24 linhas
          const TIME_START = 8 * 60;
          const TIME_END   = 20 * 60;
          const SLOT_MIN   = 30;
          const timeSlots: number[] = [];
          for (let m = TIME_START; m < TIME_END; m += SLOT_MIN) timeSlots.push(m);
          // OS pendentes de certificação (A1 não concluído, no T3)
          const pendingCert = dossiers.filter(d => d.current_step === 't3' && !d.a1_done && !d.empresa_aberta);
          const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
          const today = new Date(); today.setHours(0,0,0,0);

          return (
            <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3 bg-slate-900/30">

              {/* Navegação de semana + contador */}
              <div className="flex items-center justify-between shrink-0 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { const p = new Date(agendaWeekStart); p.setDate(p.getDate()-7); setAgendaWeekStart(p); }}
                    className="text-xs font-bold px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
                  >← Anterior</button>
                  <span className="text-sm font-semibold text-slate-200">
                    {weekDays[0].toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})} — {weekDays[5].toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}
                  </span>
                  <button
                    onClick={() => { const n = new Date(agendaWeekStart); n.setDate(n.getDate()+7); setAgendaWeekStart(n); }}
                    className="text-xs font-bold px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
                  >Próxima →</button>
                  <button
                    onClick={() => {
                      const now = new Date(); const dow = now.getDay();
                      const mon = new Date(now); mon.setDate(now.getDate()-(dow===0?6:dow-1)); mon.setHours(0,0,0,0);
                      setAgendaWeekStart(mon);
                    }}
                    className="text-xs px-2 py-1.5 bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                  >Hoje</button>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-700 inline-block"/>{pendingCert.filter(d=>!d.agendamento_cert).length} sem agenda</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-sky-800 inline-block"/>{pendingCert.filter(d=>!!d.agendamento_cert).length} agendado{pendingCert.filter(d=>!!d.agendamento_cert).length!==1?'s':''}</span>
                  {canAssign && <span className="text-slate-500 italic">Clique num slot livre para agendar</span>}
                </div>
              </div>

              {/* Agendamentos do captador aguardando ciência do certificador.
                  Diferente do painel de reagendamento logo abaixo (que é o
                  certificador PEDINDO ao gestor), aqui é o certificador
                  DECIDINDO sobre o que o captador marcou — ele é quem vai ao
                  compromisso, então aprova ou recusa com motivo (documento
                  ilegível, horários espalhados que não compensam o
                  deslocamento). Recusar libera o slot e devolve a tarefa de
                  agendar pro captador. */}
              {(() => {
                const pendentes = dossiers.filter(agendamentoPendente);
                // Gestor/admin veem todos; o certificador só o que é dele ou
                // ainda está livre — mesma regra de atribuição do servidor.
                const meus = canAssign
                  ? pendentes
                  : pendentes.filter(d => !d.resp_certificacao || d.resp_certificacao === currentOperator);
                if (!canInteractSlot || meus.length === 0) return null;
                const fmtSlot = (iso?: string) => iso ? `${new Date(iso).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'})} ${fmtMinutes(new Date(iso).getHours()*60+new Date(iso).getMinutes())}` : '—';
                return (
                  <div className="shrink-0 border border-sky-700/40 bg-sky-950/20 rounded-lg p-3 flex flex-col gap-2 max-h-52 overflow-y-auto thin-scroll">
                    <h4 className="text-[11px] font-bold text-sky-400 uppercase tracking-wide">
                      ⏳ Agendamentos aguardando aprovação ({meus.length})
                    </h4>
                    {meus.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-100 truncate">{d.client_name} <span className="text-slate-500 font-normal">· OS #{d.id}</span></p>
                          <p className="text-[10px] text-slate-400">Marcado para <span className="text-sky-300 font-semibold">{fmtSlot(d.agendamento_cert)}</span></p>
                          <p className="text-[10px] text-slate-500">Captador: {d.captured_by || '—'}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => updateDossierStatus(d.id, { decidir_agendamento: 'aprovar' })}
                            className="text-[10px] font-bold text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-2.5 py-1.5 rounded-lg hover:bg-emerald-900/50 transition-colors"
                          >✓ Aprovar</button>
                          <button
                            onClick={() => setRecusaAgendaModal({ osId: d.id, nome: d.client_name, slot: d.agendamento_cert || '', motivo: '' })}
                            className="text-[10px] font-bold text-rose-300 bg-rose-900/30 border border-rose-700/40 px-2.5 py-1.5 rounded-lg hover:bg-rose-900/50 transition-colors"
                          >✕ Recusar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Pedidos de reagendamento — gestor aprova/recusa; certificador acompanha o status */}
              {(() => {
                const pendentes = dossiers.filter(d => d.reagendamento_pendente);
                const meus = canAssign ? pendentes : pendentes.filter(d => d.reagendamento_por === currentOperator);
                if (meus.length === 0) return null;
                const fmtSlot = (iso?: string) => iso ? `${new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} ${fmtMinutes(new Date(iso).getHours()*60+new Date(iso).getMinutes())}` : '—';
                const clearReagenda = { reagendamento_pendente: '', reagendamento_de: '', reagendamento_justificativa: '', reagendamento_por: '', reagendamento_em: '' };
                return (
                  <div className="shrink-0 border border-amber-700/40 bg-amber-950/20 rounded-lg p-3 flex flex-col gap-2 max-h-52 overflow-y-auto thin-scroll">
                    <h4 className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">
                      ⏳ Reagendamentos {canAssign ? 'aguardando sua aprovação' : 'aguardando aprovação do gestor'} ({meus.length})
                    </h4>
                    {meus.map(d => {
                      const cancel = d.reagendamento_pendente === 'CANCELAR';
                      return (
                        <div key={d.id} className="flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-100 truncate">{d.client_name} <span className="text-slate-500 font-normal">· OS #{d.id}</span></p>
                            <p className="text-[10px] text-slate-400">
                              {cancel
                                ? <>Pedido: <span className="text-rose-300 font-semibold">CANCELAR</span> agendamento de {fmtSlot(d.reagendamento_de)}</>
                                : <>De {fmtSlot(d.reagendamento_de)} → <span className="text-amber-300 font-semibold">{fmtSlot(d.reagendamento_pendente)}</span></>}
                            </p>
                            <p className="text-[10px] text-slate-500">Por {d.reagendamento_por || '—'} · Motivo: {d.reagendamento_justificativa || '—'}</p>
                          </div>
                          {canAssign ? (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => updateDossierStatus(d.id, cancel ? { agendamento_cert: '', ...clearReagenda } : { agendamento_cert: d.reagendamento_pendente, ...clearReagenda })}
                                className="text-[10px] font-bold text-emerald-300 bg-emerald-900/30 border border-emerald-700/40 px-2.5 py-1.5 rounded-lg hover:bg-emerald-900/50 transition-colors"
                              >✓ Aprovar</button>
                              <button
                                onClick={() => updateDossierStatus(d.id, clearReagenda)}
                                className="text-[10px] font-bold text-rose-300 bg-rose-900/30 border border-rose-700/40 px-2.5 py-1.5 rounded-lg hover:bg-rose-900/50 transition-colors"
                              >✕ Recusar</button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-amber-400/80 italic shrink-0">aguardando gestor</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Grid */}
              <div className="flex-1 overflow-auto thin-scroll rounded-lg border border-slate-800">
                <div style={{minWidth:'680px'}}>

                  {/* Cabeçalho dos dias */}
                  <div className="grid grid-cols-[60px_repeat(6,1fr)] sticky top-0 z-10 bg-slate-950 border-b border-slate-800">
                    <div className="px-1 py-2 text-[10px] font-bold text-slate-600 text-center uppercase">Hora</div>
                    {weekDays.map((day, i) => {
                      const bounds = agendaDayBounds(day);
                      const isToday = day.getTime() === today.getTime();
                      const agendados = dossiers.filter(d => d.agendamento_cert?.startsWith(toLocalDateTimeString(day).slice(0,10)));
                      return (
                        <div key={i} className={`px-1 py-2 text-center border-l border-slate-800 ${isToday ? 'bg-violet-950/30' : ''}`}>
                          <div className={`text-[10px] font-bold uppercase ${isToday ? 'text-violet-400' : 'text-slate-400'}`}>{dayNames[i]}</div>
                          <div className={`text-xs font-semibold ${isToday ? 'text-violet-300' : 'text-slate-200'}`}>{day.getDate()}/{String(day.getMonth()+1).padStart(2,'0')}</div>
                          {bounds
                            ? <div className="text-[9px] text-slate-600">{fmtMinutes(bounds.startMin)}–{fmtMinutes(bounds.endMin)}</div>
                            : <div className="text-[9px] text-rose-900">Fechado</div>}
                          {agendados.length > 0 && <div className="text-[9px] text-sky-500 font-bold">{agendados.length} ag.</div>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Linhas de slots — 30 min cada */}
                  {timeSlots.map((minOfDay) => {
                    const isHourMark = minOfDay % 60 === 0;
                    return (
                      <div
                        key={minOfDay}
                        className={`grid grid-cols-[60px_repeat(6,1fr)] ${isHourMark ? 'border-t border-slate-800' : 'border-t border-slate-800/30'}`}
                      >
                        {/* Coluna de horário */}
                        <div className="flex items-start justify-center pt-1 bg-slate-950 border-r border-slate-800" style={{height:'48px'}}>
                          <span className={`text-[9px] font-mono ${isHourMark ? 'text-slate-400 font-bold' : 'text-slate-600'}`}>
                            {fmtMinutes(minOfDay)}
                          </span>
                        </div>

                        {/* Células dos dias */}
                        {weekDays.map((day, di) => {
                          const bounds = agendaDayBounds(day);
                          const available = bounds !== null && minOfDay >= bounds.startMin && minOfDay < bounds.endMin;
                          const iso = slotIsoFor(day, minOfDay);
                          const booked = available ? dossiers.filter(d => d.agendamento_cert === iso) : [];
                          const isMine = booked.some(d => d.resp_certificacao === currentOperator);
                          const myOsBooked = canManageSelf
                            ? dossiers.find(d => d.agendamento_cert && d.resp_certificacao === currentOperator)
                            : undefined;

                          if (!available) {
                            return (
                              <div key={di} className="border-l border-slate-800/30 bg-slate-950/20" style={{height:'48px'}} />
                            );
                          }

                          if (booked.length > 0) {
                            const d = booked[0];
                            const canManage = canAssign || (canManageSelf && isMine);
                            // Pedido do gestor: clicar num slot ocupado navega direto pra
                            // OS (mesmo padrão do sino/pop-up/tela de Concluídos) — antes
                            // só abria o modal de gerenciar/reagendar. O gerenciamento
                            // continua acessível pelo ícone ⚙️ (não é mais a ação padrão
                            // do clique, mas não foi removido).
                            return (
                              <div
                                key={di}
                                onClick={() => handleSelectOS(d)}
                                style={{height:'48px'}}
                                className={`border-l border-slate-800 border-l-2 flex items-center gap-1 px-1.5 overflow-hidden cursor-pointer
                                  ${agendamentoPendente(d)
                                    ? 'border-l-amber-500 border-dashed bg-amber-950/30 hover:bg-amber-950/50'
                                    : isMine ? 'border-l-violet-500 bg-violet-950/50 hover:bg-violet-950' : 'border-l-sky-600 bg-sky-950/40 hover:bg-sky-950/70'}`}
                                title={`${d.client_name} · OS #${d.id}${d.resp_certificacao ? ` · ${d.resp_certificacao}` : ''}${agendamentoPendente(d) ? ' — aguardando aprovação do certificador' : ''} — clique pra abrir a OS`}
                              >
                                <div className="flex flex-col justify-center gap-0.5 min-w-0 flex-1">
                                  <span className="text-[10px] font-semibold truncate leading-tight" style={{color: agendamentoPendente(d) ? '#fcd34d' : isMine ? '#c4b5fd' : '#7dd3fc'}}>{d.reagendamento_pendente ? '⏳ ' : agendamentoPendente(d) ? '⏳ ' : ''}{d.client_name}</span>
                                  <span className="text-[9px] truncate leading-tight" style={{color: isMine ? '#7c3aed' : '#0369a1'}}>
                                    {d.gov_level === 'prata' ? '🥈' : '🥇'} {d.resp_certificacao ? d.resp_certificacao.split(' ')[0] : '—'}
                                  </span>
                                </div>
                                {canManage && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setAgendaAssignSlot(iso); }}
                                    title="Gerenciar agendamento (reagendar/cancelar)"
                                    className="shrink-0 text-[10px] opacity-70 hover:opacity-100"
                                  >
                                    ⚙️
                                  </button>
                                )}
                              </div>
                            );
                          }

                          // Slot livre — certificador pode clicar para reagendar a própria OS
                          const canClickEmpty = canAssign || (canManageSelf && !!myOsBooked);
                          return (
                            <div
                              key={di}
                              onClick={() => canClickEmpty && setAgendaAssignSlot(iso)}
                              style={{height:'48px'}}
                              className={`border-l border-slate-800 bg-slate-950 transition-colors
                                ${canClickEmpty ? 'cursor-pointer hover:bg-slate-800/50' : 'cursor-default'}`}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal de agendamento — gestor/admin atribuem qualquer OS; certificador gerencia a própria */}
              {agendaAssignSlot && canInteractSlot && (() => {
                const slotDate = new Date(agendaAssignSlot);
                const slotMin  = slotDate.getHours() * 60 + slotDate.getMinutes();
                const alreadyBooked = dossiers.find(d => d.agendamento_cert === agendaAssignSlot);
                // Para certificador: lista apenas as suas próprias OS pendentes
                const availableOS = canAssign
                  ? pendingCert.filter(d => d.id !== alreadyBooked?.id)
                  : pendingCert.filter(d => d.id !== alreadyBooked?.id && d.resp_certificacao === currentOperator);
                const myCurrentBooking = canManageSelf
                  ? dossiers.find(d => d.agendamento_cert && d.resp_certificacao === currentOperator && d.id !== alreadyBooked?.id)
                  : undefined;

                return (
                    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setAgendaAssignSlot(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-slate-950 border border-slate-700 rounded-xl shadow-2xl w-full max-w-[420px] max-h-[90vh] overflow-y-auto flex flex-col gap-0">

                      {/* Cabeçalho */}
                      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                        <div>
                          <h3 className="font-bold text-sm text-slate-100">📅 Agendamento</h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {slotDate.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})} às <strong className="text-slate-200">{fmtMinutes(slotMin)}</strong>
                          </p>
                        </div>
                        <button onClick={() => setAgendaAssignSlot(null)} className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
                      </div>

                      {/* OS ocupando este slot */}
                      {alreadyBooked && (() => {
                        const isOwnSlot = alreadyBooked.resp_certificacao === currentOperator;
                        const canRemove = canAssign || (canManageSelf && isOwnSlot);
                        return (
                          <div className={`px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3 ${isOwnSlot ? 'bg-violet-950/20' : 'bg-sky-950/20'}`}>
                            <div>
                              <p className={`text-xs font-bold ${isOwnSlot ? 'text-violet-300' : 'text-sky-300'}`}>{alreadyBooked.client_name}</p>
                              <p className="text-[10px] text-slate-400">OS #{alreadyBooked.id} · {alreadyBooked.gov_level}{alreadyBooked.resp_certificacao ? ` · ${alreadyBooked.resp_certificacao}` : ''}</p>
                            </div>
                            {canRemove && (
                              <button
                                onClick={async () => {
                                  // Certificador: cancelar é "manobrar" a agenda → precisa do aval do gestor.
                                  if (!canAssign) {
                                    setReagendaModal({ osId: alreadyBooked.id, novoSlot: '', deSlot: alreadyBooked.agendamento_cert || '', tipo: 'cancelar', justificativa: '' });
                                    setAgendaAssignSlot(null);
                                    return;
                                  }
                                  await updateDossierStatus(alreadyBooked.id, { agendamento_cert: '' });
                                  await fetchDossiers();
                                  setAgendaAssignSlot(null);
                                }}
                                className="text-[10px] font-bold text-rose-400 hover:text-rose-300 bg-rose-950/30 border border-rose-800/30 px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                              >🗑️ {canAssign ? 'Cancelar agendamento' : 'Solicitar cancelamento'}</button>
                            )}
                          </div>
                        );
                      })()}

                      {/* Reagendamento do próprio: certificador tem OS em outro horário e quer mover para cá */}
                      {!alreadyBooked && canManageSelf && myCurrentBooking && (
                        <div className="px-5 py-3 bg-violet-950/10 border-b border-slate-800">
                          <p className="text-[11px] font-bold text-violet-400 uppercase tracking-wide mb-2">Reagendar meu compromisso</p>
                          <button
                            onClick={() => {
                              // Reagendar exige justificativa + aprovação do gestor (não muda na hora).
                              setReagendaModal({ osId: myCurrentBooking.id, novoSlot: agendaAssignSlot, deSlot: myCurrentBooking.agendamento_cert || '', tipo: 'mover', justificativa: '' });
                              setAgendaAssignSlot(null);
                            }}
                            disabled={!!myCurrentBooking.reagendamento_pendente}
                            className="w-full text-left flex items-center justify-between gap-2 px-3 py-2.5 bg-violet-950/30 hover:bg-violet-950/60 border border-violet-800/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-violet-200 truncate">{myCurrentBooking.client_name}</p>
                              <p className="text-[10px] text-slate-400">
                                {myCurrentBooking.reagendamento_pendente
                                  ? '⏳ Já há um pedido aguardando aprovação do gestor'
                                  : <>Mover de {new Date(myCurrentBooking.agendamento_cert!).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} {fmtMinutes(new Date(myCurrentBooking.agendamento_cert!).getHours()*60+new Date(myCurrentBooking.agendamento_cert!).getMinutes())} → este horário</>}
                              </p>
                            </div>
                            <span className="text-xs text-violet-400 font-bold shrink-0">Solicitar →</span>
                          </button>
                        </div>
                      )}

                      {/* Lista de OS para agendar — gestor vê todas, certificador vê só as suas */}
                      {(canAssign || (canManageSelf && !myCurrentBooking)) && (
                        <div className="px-5 py-3 flex flex-col gap-2">
                          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                            {alreadyBooked ? 'Substituir por outra OS:' : 'Agendar neste horário:'}
                          </p>
                          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto thin-scroll">
                            {availableOS.length === 0 ? (
                              <p className="text-xs text-slate-500 italic py-2">
                                {canManageSelf ? 'Você não tem OS pendentes de certificação.' : 'Nenhuma OS pendente de certificação.'}
                              </p>
                            ) : availableOS.map(d => (
                              <button
                                key={d.id}
                                onClick={async () => {
                                  // Certificador reagendando uma OS que JÁ tinha horário → aprovação do gestor.
                                  // Primeiro agendamento (sem agenda) continua direto.
                                  if (!canAssign && d.agendamento_cert) {
                                    setReagendaModal({ osId: d.id, novoSlot: agendaAssignSlot, deSlot: d.agendamento_cert, tipo: 'mover', justificativa: '' });
                                    setAgendaAssignSlot(null);
                                    return;
                                  }
                                  await updateDossierStatus(d.id, { agendamento_cert: agendaAssignSlot });
                                  await fetchDossiers();
                                  setAgendaAssignSlot(null);
                                }}
                                className="w-full text-left flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-200 truncate">{d.client_name}</p>
                                  <p className="text-[10px] text-slate-500">
                                    OS #{d.id}
                                    {d.agendamento_cert ? ` · reagendar de ${new Date(d.agendamento_cert).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} ${fmtMinutes(new Date(d.agendamento_cert).getHours()*60+new Date(d.agendamento_cert).getMinutes())}` : ' · sem agenda'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {d.gov_level === 'prata' && <span>🥈</span>}
                                  {d.gov_level === 'ouro'  && <span>🥇</span>}
                                  {d.resp_certificacao && <span className="text-[9px] text-slate-400 max-w-[60px] truncate">{d.resp_certificacao.split(' ')[0]}</span>}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="px-5 py-3 border-t border-slate-800">
                        <button onClick={() => setAgendaAssignSlot(null)} className="w-full text-xs text-slate-400 hover:text-slate-200 py-1.5">Fechar</button>
                      </div>
                    </div>
                    </div>
                );
              })()}

              {/* Modal: certificador justifica o reagendamento/cancelamento antes de enviar ao gestor */}
              {reagendaModal && (() => {
                const fmtSlot = (iso?: string) => iso ? `${new Date(iso).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'})} ${fmtMinutes(new Date(iso).getHours()*60+new Date(iso).getMinutes())}` : '—';
                const isCancel = reagendaModal.tipo === 'cancelar';
                return (
                    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setReagendaModal(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-slate-950 border border-slate-700 rounded-xl shadow-2xl w-full max-w-[440px] max-h-[90vh] overflow-y-auto flex flex-col">
                      <div className="px-5 py-4 border-b border-slate-800">
                        <h3 className="font-bold text-sm text-slate-100">{isCancel ? '🗑️ Solicitar cancelamento' : '🔄 Solicitar reagendamento'}</h3>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {isCancel
                            ? <>Cancelar o compromisso de {fmtSlot(reagendaModal.deSlot)}.</>
                            : <>Mover de {fmtSlot(reagendaModal.deSlot)} → <span className="text-amber-300 font-semibold">{fmtSlot(reagendaModal.novoSlot)}</span>.</>}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">⚠️ O gestor precisa aprovar — o horário só muda após a aprovação.</p>
                      </div>
                      <div className="px-5 py-4 flex flex-col gap-2">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Justificativa (obrigatória)</label>
                        <textarea
                          rows={3}
                          autoFocus
                          value={reagendaModal.justificativa}
                          onChange={e => setReagendaModal(m => m && { ...m, justificativa: e.target.value })}
                          placeholder="Explique o motivo da troca..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 resize-none focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-end gap-2">
                        <button onClick={() => setReagendaModal(null)} className="text-xs text-slate-400 hover:text-slate-200 px-3 py-2">Voltar</button>
                        <button
                          disabled={!reagendaModal.justificativa.trim()}
                          onClick={() => {
                            updateDossierStatus(reagendaModal.osId, {
                              reagendamento_pendente: isCancel ? 'CANCELAR' : reagendaModal.novoSlot,
                              reagendamento_de: reagendaModal.deSlot,
                              reagendamento_justificativa: reagendaModal.justificativa.trim(),
                              reagendamento_por: currentOperator,
                              reagendamento_em: new Date().toISOString(),
                            });
                            setReagendaModal(null);
                          }}
                          className="text-xs font-bold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
                        >Enviar para o gestor</button>
                      </div>
                    </div>
                    </div>
                );
              })()}

              {/* Recusa do agendamento do captador — motivo obrigatório, volta
                  pra ele como tarefa de reagendar (o servidor recria a tarefa
                  "📅 Agendar certificação:" que reabre o botão no captador). */}
              {recusaAgendaModal && (() => {
                const fmtSlot = (iso?: string) => iso ? `${new Date(iso).toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'})} ${fmtMinutes(new Date(iso).getHours()*60+new Date(iso).getMinutes())}` : '—';
                return (
                  <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setRecusaAgendaModal(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-slate-950 border border-slate-700 rounded-xl shadow-2xl w-full max-w-[440px] max-h-[90vh] overflow-y-auto flex flex-col">
                      <div className="px-5 py-4 border-b border-slate-800">
                        <h3 className="font-bold text-sm text-slate-100">✕ Recusar agendamento</h3>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {recusaAgendaModal.nome} — {fmtSlot(recusaAgendaModal.slot)}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">⚠️ O horário será liberado e o captador receberá a tarefa de reagendar com o motivo abaixo.</p>
                      </div>
                      <div className="px-5 py-4 flex flex-col gap-2">
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Motivo (obrigatório)</label>
                        <textarea
                          rows={3}
                          autoFocus
                          value={recusaAgendaModal.motivo}
                          onChange={e => setRecusaAgendaModal(m => m && { ...m, motivo: e.target.value })}
                          placeholder="Ex.: documento ilegível, horário isolado no dia..."
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-600 resize-none focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-end gap-2">
                        <button onClick={() => setRecusaAgendaModal(null)} className="text-xs text-slate-400 hover:text-slate-200 px-3 py-2">Voltar</button>
                        <button
                          disabled={!recusaAgendaModal.motivo.trim()}
                          onClick={() => {
                            updateDossierStatus(recusaAgendaModal.osId, {
                              decidir_agendamento: 'recusar',
                              agendamento_recusa_motivo: recusaAgendaModal.motivo.trim(),
                            });
                            setRecusaAgendaModal(null);
                          }}
                          className="text-xs font-bold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
                        >Recusar e devolver</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          );
        })()}

        {/* ===== TELA LOG DE ACESSOS (gestor/admin) ===== */}
        {view === 'logs' && (currentRole === 'gestor' || currentRole === 'admin') && (
          <AccessLogView />
        )}

        {/* ===== TELA CONCLUÍDOS POR CERTIFICADOR (gestor/admin) =====
            Pedido do gestor: painel de reconciliação de pagamento — quantas
            certificações cada certificador concluiu, quando concluiu, e
            quando a OS entrou na esteira (pra cruzar com o pagamento). */}
        {view === 'concluidos' && (currentRole === 'gestor' || currentRole === 'admin') && (() => {
          type ConcluidoRow = {
            dossier: Dossier;
            certificador: string;
            tipo: 'bird' | 'a1';
            concluidoEm: string;
            pago: boolean;
          };
          const feitaPorLocal = (por?: string, resp?: string) => por || resp || '';
          const rows: ConcluidoRow[] = [];
          for (const d of dossiers) {
            if (d.bird_id_done) {
              const nome = feitaPorLocal(d.bird_id_done_por, d.resp_certificacao);
              if (nome) rows.push({ dossier: d, certificador: nome, tipo: 'bird', concluidoEm: d.bird_id_done_em || '', pago: !!d.bird_pago });
            }
            if (d.a1_done) {
              const nome = feitaPorLocal(d.a1_done_por, d.resp_certificacao);
              if (nome) rows.push({ dossier: d, certificador: nome, tipo: 'a1', concluidoEm: d.a1_done_em || '', pago: !!d.a1_pago });
            }
          }
          // Filtro por status de pagamento — aplicado ANTES de agrupar, pra
          // contagens/paginação por certificador já refletirem só o que o
          // gestor pediu pra ver (ex: só o que falta marcar como pago).
          const rowsPagoFiltrados = concluidosPagoFilter === 'todos'
            ? rows
            : rows.filter(r => concluidosPagoFilter === 'pago' ? r.pago : !r.pago);
          const totalPagoGeral = rows.filter(r => r.pago).length;
          const totalPendenteGeral = rows.length - totalPagoGeral;
          const porCertificador: Record<string, ConcluidoRow[]> = {};
          for (const r of rowsPagoFiltrados) {
            porCertificador[r.certificador] = porCertificador[r.certificador] || [];
            porCertificador[r.certificador].push(r);
          }
          const nomes = Object.keys(porCertificador).sort((a, b) => a.localeCompare(b));
          const q = normalizeSearch(concluidosFilter.trim());
          const nomesFiltrados = q ? nomes.filter(n => normalizeSearch(n).includes(q)) : nomes;
          const PAGE_SIZE = 10;

          // Card no mesmo estilo (já aprovado) da lista da tela Certificação
          // (renderListRow) — reorganizado porque o layout anterior (cards
          // mais estreitos em grade 2 colunas) ficava espremido/cortado em
          // telas menores, "horrível e pouco responsivo" (relato do gestor).
          // Uma coluna só, empilhada, é o padrão mais robusto já validado.
          const renderConcluidoRow = (r: ConcluidoRow) => {
            const isBird = r.tipo === 'bird';
            const titulo = isBird ? r.dossier.client_name : (r.dossier.empresa_nome || r.dossier.client_name);
            const identificador = isBird ? r.dossier.cpf : (r.dossier.cnpj_number || '—');
            return (
              <div
                key={`${r.tipo}-${r.dossier.id}`}
                onClick={() => handleSelectOS(r.dossier)}
                className="bg-slate-900/70 border border-slate-800 p-3.5 rounded-lg cursor-pointer hover:border-slate-600 transition-colors flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[10px] font-bold text-slate-500 shrink-0">OS #{r.dossier.id}</span>
                    <h4 className="font-semibold text-sm truncate">{titulo}</h4>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${isBird ? 'text-sky-400 bg-sky-950/20' : 'text-violet-400 bg-violet-950/20'}`}>
                    {isBird ? '🆔 BIRD' : '📜 A1'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono truncate">{identificador}</p>
                <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] text-slate-500">
                  <span>Esteira: {r.dossier.created_at ? new Date(r.dossier.created_at).toLocaleDateString('pt-BR') : '—'}</span>
                  <span>Concluído: {r.concluidoEm ? new Date(r.concluidoEm).toLocaleDateString('pt-BR') : '—'}</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  {/* Só leitura — marcar/desmarcar pagamento é exclusivo da
                      tela "Projetos" agora (pedido do gestor: controle
                      financeiro centralizado lá). */}
                  <span
                    className={`text-[10px] font-bold px-2.5 py-1 rounded border ${r.pago ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' : 'bg-slate-800/60 border-slate-700 text-slate-400'}`}
                    title={r.pago ? '' : 'Pendente — marque na tela Projetos'}
                  >
                    {r.pago ? '✓ Pago' : '○ Pendente'}
                  </span>
                  {/* Reatribuir executor — corrige o caso do gestor que marcou
                      "Concluir" no próprio nome por engano e passou a aparecer
                      aqui como se ele tivesse feito a certificação. Grava
                      bird_id_done_por/a1_done_por (auditado no servidor,
                      CERT_REATRIBUIDA); o card muda de grupo no próximo render. */}
                  <select
                    value={r.certificador}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      const novo = e.target.value;
                      if (novo && novo !== r.certificador) {
                        updateDossierStatus(r.dossier.id, { [r.tipo === 'bird' ? 'bird_id_done_por' : 'a1_done_por']: novo });
                      }
                    }}
                    title="Reatribuir esta certificação pra quem realmente executou"
                    className="text-[10px] font-bold bg-slate-800/60 border border-slate-700 text-slate-400 hover:border-slate-500 rounded px-1.5 py-1 outline-none cursor-pointer"
                  >
                    {!operatorsList.some(u => u.name === r.certificador) && <option value={r.certificador}>{r.certificador}</option>}
                    {operatorsList.filter(u => u.active && ['operador_certificacao', 'gestor', 'admin'].includes(u.role)).map(u => (
                      <option key={u.name} value={u.name}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            );
          };

          return (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-6 bg-slate-900/30 thin-scroll">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-100">📊 Concluídos por Certificador</h2>
                  <p className="text-xs text-slate-500">BIRD ID e A1 concluídos, com data de conclusão e data de entrada na esteira — pra reconciliar pagamento e conferir totais.</p>
                </div>
                <input
                  type="text"
                  value={concluidosFilter}
                  onChange={(e) => setConcluidosFilter(e.target.value)}
                  placeholder="Filtrar por certificador..."
                  className="text-sm bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 outline-none focus:border-sky-500 w-full sm:w-64"
                />
              </div>

              {/* Filtro por status de pagamento — pedido do gestor: separar
                  rápido o que já foi pago do que ainda precisa ser marcado. */}
              <div className="flex items-center gap-1.5 flex-wrap border-b border-slate-800 pb-2 -mt-2">
                {([
                  { key: 'todos' as const, label: '📋 Todos', count: rows.length },
                  { key: 'pendente' as const, label: '⏳ Pendente de pagamento', count: totalPendenteGeral },
                  { key: 'pago' as const, label: '✅ Pago', count: totalPagoGeral },
                ]).map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setConcluidosPagoFilter(t.key)}
                    className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors ${concluidosPagoFilter === t.key ? 'bg-sky-600 text-white' : 'bg-slate-900/60 border border-slate-800 text-slate-400 hover:bg-slate-800'}`}
                  >
                    {t.label} ({t.count})
                  </button>
                ))}
              </div>

              {nomesFiltrados.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Nenhum certificador com certificação concluída{q ? ' pra esse filtro' : ' ainda'}.</p>
              ) : (
                nomesFiltrados.map((nome) => {
                  const items = [...porCertificador[nome]].sort((a, b) => (b.concluidoEm || '').localeCompare(a.concluidoEm || ''));
                  const totalBird = items.filter(r => r.tipo === 'bird').length;
                  const totalA1 = items.filter(r => r.tipo === 'a1').length;
                  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
                  const page = Math.min(concluidosPage[nome] || 0, totalPages - 1);
                  const pageItems = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
                  return (
                    <div key={nome} className="bg-slate-900/40 border border-slate-800 rounded-lg">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-wrap gap-1">
                        <h3 className="text-xs font-bold text-slate-200">{nome}</h3>
                        <span className="text-[11px] text-slate-400"><span className="text-emerald-400 font-bold">{totalBird}</span> BIRD · <span className="text-emerald-400 font-bold">{totalA1}</span> A1</span>
                      </div>
                      <div className="p-3 flex flex-col gap-2.5">
                        {pageItems.map(renderConcluidoRow)}
                      </div>
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-800">
                          <button
                            type="button"
                            disabled={page === 0}
                            onClick={() => setConcluidosPage((p) => ({ ...p, [nome]: page - 1 }))}
                            className="text-[11px] font-bold px-3 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                          >
                            ← Anterior
                          </button>
                          <span className="text-[11px] text-slate-500">Página {page + 1} de {totalPages}</span>
                          <button
                            type="button"
                            disabled={page >= totalPages - 1}
                            onClick={() => setConcluidosPage((p) => ({ ...p, [nome]: page + 1 }))}
                            className="text-[11px] font-bold px-3 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                          >
                            Próxima →
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {/* ===== TELA PROJETOS (gestor/admin) =====
            Pedido do gestor: tela dedicada pra criar/gerenciar projetos, com
            escopo/capacidade/pagamentos por projeto — criação saiu de dentro
            da OS (lá agora só dá pra selecionar um projeto já criado). */}
        {view === 'projetos' && (currentRole === 'gestor' || currentRole === 'admin') && (() => {
          const feitaPorProj = (por?: string, resp?: string) => por || resp || '';
          // Pagamento clicável — só aqui (tela Projetos é o controle
          // centralizado); Certificação e Concluídos por Certificador viraram
          // só leitura.
          const pagamentoPillClick = (d: Dossier, field: 'bird_pago' | 'a1_pago' | 'colaborador_pago', label: string) => (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePagamento(d, field); }}
              className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${d[field] ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'}`}
              title={d[field] ? `Pago em ${d[`${field}_em` as const] ? new Date(d[`${field}_em` as const] as string).toLocaleString('pt-BR') : ''} por ${d[`${field}_por` as const] || ''}` : 'Marcar como pago'}
            >
              {d[field] ? '✓' : '○'} {label}
            </button>
          );
          const PAGE_SIZE = 10;
          const totalPages = Math.max(1, Math.ceil(projectsList.length / PAGE_SIZE));
          const page = Math.min(projetosPage, totalPages - 1);
          const pagedProjects = projectsList.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
          // Auditoria de "OS sem projeto" — generalizada (10/08/2026, pedido
          // explícito: "validar quantas OS estão sem projetos atribuídos
          // independente do estágio"). Antes só cobria `finalizado` (explicava
          // por que a soma de "Concluídas" dos projetos podia ficar menor que
          // o total global de "🏆 Abertas/Concluídas" da esteira); motivado
          // pelo caso real do isolamento de terceiro por projeto (03/08/2026):
          // uma OS sem `projeto` fica invisível pra qualquer parceiro
          // restrito, e o gap pode existir em QUALQUER etapa, não só em
          // empresas já finalizadas — 13 OS's reais foram achadas em E2
          // (`t2`, "Aguardando vínculo"), sem nenhuma visão que mostrasse isso
          // antes. Exclui `captacao`/`t1` de propósito: a trava de servidor
          // só exige `projeto` na aprovação da E1 (transição t1→t2) — uma OS
          // ainda não aprovada legitimamente não tem (e não deveria ter)
          // projeto ainda, listar essas infla a contagem com "normal", não
          // "problema". Exclui `cancelado` pelo mesmo motivo (não é caso de
          // faltar classificar).
          const semProjeto = dossiers.filter((d) => !d.projeto && d.status !== 'cancelado' && d.current_step !== 'captacao' && d.current_step !== 't1');
          // Auditoria (24/07/2026, caso real reportado: "empresas abertas ou
          // no processo de abertura com cartão CNPJ anexado mas o campo CNPJ
          // vazio"). Causa: `FileAttach` do Cartão CNPJ é um upload
          // independente — sempre foi possível anexar o arquivo sem nunca ter
          // digitado o número (agora travado daqui pra frente, ver o gate no
          // painel de Trabalho T3), mas isso não corrige quem já ficou nesse
          // estado. Global (não por projeto) — o problema não é uma métrica
          // de projeto, é dado faltando em qualquer OS, com ou sem projeto
          // atribuído.
          const cnpjSemNumero = dossiers.filter((d) => !!d.cnpj_comprovante_url && !d.cnpj_number);
          // Auditoria (24/08/2026, pedido explícito: "filtrar as empresas que
          // ainda não tem nome empresarial ou cnpj atribuídos"). Ajustado no
          // mesmo dia (pedido de acompanhamento: "só deve aparecer... se caso
          // ela estiverem na E3 em diante") — diferente do `semProjeto`
          // acima (que só exclui captacao/t1), este só entra a partir da E3
          // (`t3`/`finalizado`): até a E2 esses campos legitimamente ainda
          // não existem na maioria dos casos (só passam a ser preenchidos no
          // cadastro/autofill de CNPJ, tipicamente já perto da abertura),
          // então incluir E2 também inflava a contagem sem sinalizar
          // problema real — E3 em diante é quando a falta desses dados
          // realmente trava o andamento. Global (não por projeto), mesmo
          // motivo do `cnpjSemNumero`.
          const semEmpresaOuCnpj = dossiers.filter((d) =>
            (!d.empresa_nome || !d.cnpj_number) &&
            (d.current_step === 't3' || d.current_step === 'finalizado')
          );
          // Auditoria de duplicidade (03/08/2026): número/chip (t2_new_phone) e
          // código do aparelho (cert_aparelho) devem ser únicos por OS ativa —
          // a trava do servidor (PATCH /terceiro-update) só passou a impedir
          // duplicidade NOVA; isto aqui audita o que já ficou duplicado antes
          // dela existir, agrupando por valor repetido.
          const dupGroups = (getVal: (d: Dossier) => string | undefined) => {
            const byValue = new Map<string, Dossier[]>();
            for (const d of dossiers) {
              const v = getVal(d);
              if (!v) continue;
              if (!byValue.has(v)) byValue.set(v, []);
              byValue.get(v)!.push(d);
            }
            return Array.from(byValue.entries()).filter(([, list]) => list.length > 1);
          };
          const phoneDup = dupGroups((d) => d.t2_new_phone);
          const aparelhoDup = dupGroups((d) => d.cert_aparelho);
          return (
            <div className="flex-1 overflow-y-auto p-6 bg-slate-900/30 thin-scroll">
            <div className="space-y-5 max-w-4xl mx-auto w-full">
              <div>
                <h2 className="text-sm font-bold text-white">📁 Projetos</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Crie e gerencie projetos/lotes aqui — dentro da OS só é possível selecionar um projeto já criado.
                </p>
              </div>

              {/* Explica de cara por que a soma de "Concluídas" dos projetos
                  pode ser menor que o total de "Abertas/Concluídas" da
                  esteira (empresas finalizadas sem projeto ficam fora de
                  qualquer card abaixo) — e, mais importante, mostra TODA OS
                  já aprovada na E1 sem projeto, em qualquer etapa: são
                  invisíveis pra qualquer parceiro terceiro com escopo
                  restrito (ver isolamento por projeto), não só uma métrica
                  de contagem. */}
              {semProjeto.length > 0 && (
                <div className="border border-amber-700/40 bg-amber-950/10 rounded-lg p-4">
                  <button
                    type="button"
                    onClick={() => setSemProjetoExpanded((v) => !v)}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                  >
                    ⚠️ {semProjetoExpanded ? 'Ocultar' : `${semProjeto.length} OS${semProjeto.length !== 1 ? "'s" : ''} sem projeto atribuído (qualquer etapa pós-E1)`}
                  </button>
                  {!semProjetoExpanded && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Inclui OS em qualquer etapa a partir da E2 (não só finalizadas) — ficam invisíveis pra parceiro terceiro com projeto restrito, e finalizadas sem projeto não entram na contagem de nenhum card abaixo.
                    </p>
                  )}
                  {semProjetoExpanded && (
                    <div className="mt-3 space-y-2">
                      {semProjeto.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => handleSelectOS(d)}
                          className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                        >
                          <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.client_name}</span>
                          <span className="flex gap-1.5 shrink-0">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                              {d.current_step === 'finalizado' ? '🏆 empresa aberta' : (STEP_LABELS_NAV as Record<string, string>)[d.current_step] || d.current_step}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Auditoria: cartão CNPJ anexado mas número não preenchido —
                  bloqueia o A1 (a1ReadyOf exige cnpj_number) sem nenhuma
                  pista visível de fora da OS de por que ela está travada. */}
              {cnpjSemNumero.length > 0 && (
                <div className="border border-amber-700/40 bg-amber-950/10 rounded-lg p-4">
                  <button
                    type="button"
                    onClick={() => setCnpjSemNumeroExpanded((v) => !v)}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                  >
                    ⚠️ {cnpjSemNumeroExpanded ? 'Ocultar' : `${cnpjSemNumero.length} OS com Cartão CNPJ anexado mas número do CNPJ não preenchido`}
                  </button>
                  {!cnpjSemNumeroExpanded && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      O A1 (e-CNPJ) não libera pro certificador sem o número do CNPJ preenchido — mesmo com o cartão já anexado.
                    </p>
                  )}
                  {cnpjSemNumeroExpanded && (
                    <div className="mt-3 space-y-2">
                      {cnpjSemNumero.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => handleSelectOS(d)}
                          className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                        >
                          <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.empresa_nome || d.client_name}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.current_step === 'finalizado' ? 'bg-emerald-950/40 text-emerald-400' : 'bg-slate-800/60 text-slate-400'}`}>
                            {d.current_step === 'finalizado' ? '🏆 empresa aberta' : 'em processo'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Auditoria: OS sem razão social e/ou sem CNPJ preenchidos,
                  já além da E1 (24/08/2026, pedido explícito do usuário). Cada
                  linha mostra um badge indicando exatamente o que falta —
                  pode faltar só um dos dois, ou os dois ao mesmo tempo. */}
              {semEmpresaOuCnpj.length > 0 && (
                <div className="border border-amber-700/40 bg-amber-950/10 rounded-lg p-4">
                  <button
                    type="button"
                    onClick={() => setSemEmpresaOuCnpjExpanded((v) => !v)}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                  >
                    ⚠️ {semEmpresaOuCnpjExpanded ? 'Ocultar' : `${semEmpresaOuCnpj.length} OS${semEmpresaOuCnpj.length !== 1 ? "'s" : ''} sem nome da empresa e/ou CNPJ atribuídos`}
                  </button>
                  {!semEmpresaOuCnpjExpanded && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Inclui OS da E3 em diante (Abertura/Certificação ou já finalizadas), com ou sem projeto — mostra separado o que falta em cada uma.
                    </p>
                  )}
                  {semEmpresaOuCnpjExpanded && (
                    <div className="mt-3 space-y-2">
                      {semEmpresaOuCnpj.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => handleSelectOS(d)}
                          className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                        >
                          <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.client_name}</span>
                          <span className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                            {!d.empresa_nome && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-400">sem nome</span>}
                            {!d.cnpj_number && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-400">sem CNPJ</span>}
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                              {d.current_step === 'finalizado' ? '🏆 empresa aberta' : (STEP_LABELS_NAV as Record<string, string>)[d.current_step] || d.current_step}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Auditoria: número/chip ou código do aparelho repetido entre
                  OS's — a trava do PATCH /terceiro-update só barra duplicidade
                  nova; isto lista o que já ficou duplicado antes dela. */}
              {(phoneDup.length > 0 || aparelhoDup.length > 0) && (
                <div className="border border-amber-700/40 bg-amber-950/10 rounded-lg p-4">
                  <button
                    type="button"
                    onClick={() => setDuplicidadeVinculoExpanded((v) => !v)}
                    className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                  >
                    ⚠️ {duplicidadeVinculoExpanded ? 'Ocultar' : `${phoneDup.length + aparelhoDup.length} valor${phoneDup.length + aparelhoDup.length !== 1 ? 'es' : ''} de número/chip ou aparelho duplicado entre OS's`}
                  </button>
                  {!duplicidadeVinculoExpanded && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Número/chip e código do aparelho devem ser únicos por OS — confira e corrija manualmente cada grupo abaixo.
                    </p>
                  )}
                  {duplicidadeVinculoExpanded && (
                    <div className="mt-3 space-y-4">
                      {phoneDup.map(([valor, list]) => (
                        <div key={`phone-${valor}`} className="space-y-1.5">
                          <p className="text-[10px] font-bold text-slate-400">📱 Número/chip "{valor}" em {list.length} OS's:</p>
                          {list.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => handleSelectOS(d)}
                              className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                            >
                              <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.empresa_nome || d.client_name}</span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.current_step === 'finalizado' ? 'bg-emerald-950/40 text-emerald-400' : 'bg-slate-800/60 text-slate-400'}`}>
                                {d.current_step === 'finalizado' ? '🏆 empresa aberta' : 'em processo'}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                      {aparelhoDup.map(([valor, list]) => (
                        <div key={`aparelho-${valor}`} className="space-y-1.5">
                          <p className="text-[10px] font-bold text-slate-400">📟 Aparelho "{valor}" em {list.length} OS's:</p>
                          {list.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => handleSelectOS(d)}
                              className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                            >
                              <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.empresa_nome || d.client_name}</span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.current_step === 'finalizado' ? 'bg-emerald-950/40 text-emerald-400' : 'bg-slate-800/60 text-slate-400'}`}>
                                {d.current_step === 'finalizado' ? '🏆 empresa aberta' : 'em processo'}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Criação de novo projeto */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 space-y-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase">+ Novo Projeto</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Nome do projeto"
                    className="flex-1 min-w-[160px] bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white"
                  />
                  <input
                    type="number"
                    min={0}
                    value={newProjectCap}
                    onChange={(e) => setNewProjectCap(e.target.value)}
                    placeholder="Capacidade (0 = ilimitado)"
                    className="w-44 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white"
                  />
                  <select
                    value={newProjectContador}
                    onChange={(e) => setNewProjectContador(e.target.value)}
                    className="w-52 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white"
                  >
                    <option value="">Contador padrão (opcional)</option>
                    {CONTADORES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddProject}
                    disabled={!newProjectName.trim()}
                    className="text-xs font-bold px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    + Criar
                  </button>
                </div>
              </div>

              {/* Lista de projetos */}
              <div className="space-y-3">
                {pagedProjects.map((p) => {
                  const osDoProjeto = dossiers.filter((d) => d.projeto === p.nome);
                  const total = osDoProjeto.length;
                  const concluidas = osDoProjeto.filter((d) => d.current_step === 'finalizado').length;
                  const emAndamento = total - concluidas;

                  const birdFeitos = osDoProjeto.filter((d) => d.bird_id_done);
                  const a1Feitos = osDoProjeto.filter((d) => d.a1_done);
                  const colabFeitos = osDoProjeto.filter((d) => d.bird_id_done || d.a1_done);

                  // Auditoria de dado (caso real, 18/07/2026): empresa não
                  // deveria virar "finalizado" sem BIRD e A1 concluídos (regra
                  // de negócio — ver skill), mas o servidor não trava essa
                  // transição por etapa (Mover Etapa/Edição Rápida do gestor
                  // não checam isso), então uma certificação real pode ter
                  // sido feita e só não marcada como concluída no sistema.
                  // Lista quem está "finalizado" com BIRD e/ou A1 pendente,
                  // pra investigar/corrigir manualmente — não é uma métrica de
                  // pagamento, é auditoria de consistência.
                  const semCertFinalizadas = osDoProjeto.filter(
                    (d) => d.current_step === 'finalizado' && (!d.bird_id_done || !d.a1_done)
                  );

                  // 2º achado do mesmo caso real (18/07/2026): existem OS onde
                  // BIRD/A1 JÁ estão marcados como concluídos, mas os dados
                  // por trás não foram preenchidos — BIRD com pelo menos um
                  // dado de acesso faltando (sistema/certificadora/aparelho/
                  // e-mail/senhas — ver `birdDadosFaltando`, revisado no 13º
                  // achado pra pegar preenchimento parcial também, não só
                  // "tudo vazio") ou A1 sem o arquivo do certificado (.zip/
                  // .rar) anexado. Isso é diferente do caso acima (aqui a
                  // CONCLUSÃO foi marcada, só falta o dado em si) — precisa
                  // cobrar do certificador as informações faltantes, não só
                  // reabrir a etapa.
                  const birdSemDados = osDoProjeto.filter(birdDadosFaltando);
                  const a1SemArquivo = osDoProjeto.filter(a1ArquivoFaltando);
                  const dadosIncompletosSet = new Map<string, Dossier>();
                  [...birdSemDados, ...a1SemArquivo].forEach((d) => dadosIncompletosSet.set(d.id, d));
                  const dadosIncompletos = Array.from(dadosIncompletosSet.values());

                  // Pedido de acompanhamento (18/07/2026): além dos 3 blocos
                  // de auditoria acima (todos sobre OS já FINALIZADAS ou já
                  // marcadas como concluídas), o gestor pediu visão de quem
                  // ainda está PENDENTE de certificação — mesmo critério já
                  // usado na fila do certificador (`vinculoReady`/`a1ReadyOf`,
                  // tela Certificação): passou da E1 (current_step em t2/t3),
                  // e já tem vínculo e-commerce definido (pronta pra e-CPF) ou
                  // cartão CNPJ + certidão de inteiro teor + BIRD feito
                  // (pronta pra e-CNPJ), mas a certificação em si ainda não
                  // foi concluída. Reaproveita a MESMA regra — não duplica
                  // critério novo — só filtra pelo projeto.
                  const vinculoReadyProj = (d: Dossier) => !!d.t2_new_email && !!d.t2_new_phone;
                  const birdPendentes = osDoProjeto.filter(
                    (d) => ['t2', 't3'].includes(d.current_step) && !d.bird_id_done && vinculoReadyProj(d)
                  );
                  const a1Pendentes = osDoProjeto.filter(
                    (d) => ['t2', 't3'].includes(d.current_step) && !d.a1_done && a1ReadyOf(d)
                  );
                  const pendentesSet = new Map<string, Dossier>();
                  [...birdPendentes, ...a1Pendentes].forEach((d) => pendentesSet.set(d.id, d));
                  const pendentesCert = Array.from(pendentesSet.values());

                  const birdPagos = birdFeitos.filter((d) => d.bird_pago).length;
                  const a1Pagos = a1Feitos.filter((d) => d.a1_pago).length;
                  const colabPagos = colabFeitos.filter((d) => d.colaborador_pago).length;

                  const porColaborador: Record<string, { bird: number; a1: number }> = {};
                  osDoProjeto.forEach((d) => {
                    if (d.bird_id_done) {
                      const n = feitaPorProj(d.bird_id_done_por, d.resp_certificacao);
                      if (n) { porColaborador[n] = porColaborador[n] || { bird: 0, a1: 0 }; porColaborador[n].bird++; }
                    }
                    if (d.a1_done) {
                      const n = feitaPorProj(d.a1_done_por, d.resp_certificacao);
                      if (n) { porColaborador[n] = porColaborador[n] || { bird: 0, a1: 0 }; porColaborador[n].a1++; }
                    }
                  });
                  const colaboradores = Object.entries(porColaborador);

                  const isEditing = editingProject === p.nome;

                  return (
                    <div key={p.nome} className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{p.nome}</span>
                          <span className="text-[11px] text-slate-400">
                            {p.capacidade > 0 ? `${p.usados}/${p.capacidade} vagas` : `${p.usados} empresas · ilimitado`}
                          </span>
                          {p.contador_abertura && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              Contador: {p.contador_abertura}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) { setEditingProject(''); return; }
                              setEditingProject(p.nome);
                              setEditProjectCap(String(p.capacidade || 0));
                              setEditProjectContador(p.contador_abertura || '');
                            }}
                            className="text-[11px] font-bold px-3 py-1.5 rounded border border-slate-800 text-slate-300 hover:border-slate-600"
                          >
                            ✏️ {isEditing ? 'Cancelar' : 'Editar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProject(p.nome)}
                            className="text-[11px] font-bold px-3 py-1.5 rounded border border-red-900/60 text-red-400 hover:bg-red-950/40"
                          >
                            🗑️ Remover
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="flex flex-wrap gap-2 bg-slate-950/60 border border-slate-800 rounded p-3">
                          <input
                            type="number"
                            min={0}
                            value={editProjectCap}
                            onChange={(e) => setEditProjectCap(e.target.value)}
                            placeholder="Capacidade (0 = ilimitado)"
                            className="w-44 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white"
                          />
                          <select
                            value={editProjectContador}
                            onChange={(e) => setEditProjectContador(e.target.value)}
                            className="w-52 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white"
                          >
                            <option value="">Contador padrão (opcional)</option>
                            {CONTADORES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleSaveProjectEdit(p.nome)}
                            className="text-xs font-bold px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                          >
                            Salvar
                          </button>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-slate-950/60 rounded p-2 text-center">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Total</p>
                          <p className="text-sm font-bold text-white">{total}</p>
                        </div>
                        <div className="bg-slate-950/60 rounded p-2 text-center">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Em andamento</p>
                          <p className="text-sm font-bold text-amber-400">{emAndamento}</p>
                        </div>
                        <div className="bg-slate-950/60 rounded p-2 text-center">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Concluídas</p>
                          <p className="text-sm font-bold text-emerald-400">{concluidas}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-slate-950/60 rounded p-2 text-center">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">🆔 BIRD</p>
                          <p className="text-xs text-slate-300">{birdPagos} pago{birdPagos !== 1 ? 's' : ''} · {birdFeitos.length - birdPagos} pendente{(birdFeitos.length - birdPagos) !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="bg-slate-950/60 rounded p-2 text-center">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">📜 A1</p>
                          <p className="text-xs text-slate-300">{a1Pagos} pago{a1Pagos !== 1 ? 's' : ''} · {a1Feitos.length - a1Pagos} pendente{(a1Feitos.length - a1Pagos) !== 1 ? 's' : ''}</p>
                        </div>
                        <div className="bg-slate-950/60 rounded p-2 text-center">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">👤 Colaborador</p>
                          <p className="text-xs text-slate-300">{colabPagos} pago{colabPagos !== 1 ? 's' : ''} · {colabFeitos.length - colabPagos} pendente{(colabFeitos.length - colabPagos) !== 1 ? 's' : ''}</p>
                        </div>
                      </div>

                      {colaboradores.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {colaboradores.map(([nome, v]) => (
                            <span key={nome} className="text-[10px] font-bold px-2 py-1 rounded bg-slate-800 text-slate-300">
                              {nome}: {v.bird} BIRD · {v.a1} A1
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Auditoria: finalizadas sem certificação completa —
                          ver comentário em semCertFinalizadas acima. Aparece
                          em destaque (âmbar) só quando existe pelo menos um
                          caso; clicar numa linha abre a OS pra investigar. */}
                      {semCertFinalizadas.length > 0 && (
                        <div className="border border-amber-700/40 bg-amber-950/10 rounded-lg p-3">
                          <button
                            type="button"
                            onClick={() => setExpandedProjectSemCert(expandedProjectSemCert === p.nome ? '' : p.nome)}
                            className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                          >
                            ⚠️ {expandedProjectSemCert === p.nome ? 'Ocultar' : `${semCertFinalizadas.length} finalizada${semCertFinalizadas.length !== 1 ? 's' : ''} sem certificação completa registrada`}
                          </button>
                          {expandedProjectSemCert !== p.nome && (
                            <p className="text-[10px] text-slate-500 mt-1">
                              Empresa aberta, mas BIRD e/ou A1 não constam como concluídos — provável certificação feita e não marcada no sistema.
                            </p>
                          )}
                          {expandedProjectSemCert === p.nome && (
                            <div className="mt-3 space-y-2">
                              {semCertFinalizadas.map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => handleSelectOS(d)}
                                  className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                                >
                                  <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.client_name}</span>
                                  <span className="flex gap-1.5 shrink-0">
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${d.bird_id_done ? 'bg-emerald-950/40 text-emerald-400' : 'bg-rose-950/40 text-rose-400'}`}>
                                      {d.bird_id_done ? '✓ BIRD' : '✕ BIRD'}
                                    </span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${d.a1_done ? 'bg-emerald-950/40 text-emerald-400' : 'bg-rose-950/40 text-rose-400'}`}>
                                      {d.a1_done ? '✓ A1' : '✕ A1'}
                                    </span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Auditoria: certificação MARCADA como concluída, mas
                          dado por trás incompleto — ver comentário em
                          birdSemDados/a1SemArquivo acima. Serve pra cobrar do
                          certificador a informação faltante (não é caso de
                          reabrir etapa, é caso de pedir o dado). */}
                      {dadosIncompletos.length > 0 && (
                        <div className="border border-amber-700/40 bg-amber-950/10 rounded-lg p-3">
                          <button
                            type="button"
                            onClick={() => setExpandedProjectDadosIncompletos(expandedProjectDadosIncompletos === p.nome ? '' : p.nome)}
                            className="text-[11px] font-bold text-amber-400 hover:text-amber-300"
                          >
                            ⚠️ {expandedProjectDadosIncompletos === p.nome ? 'Ocultar' : `${dadosIncompletos.length} certificação${dadosIncompletos.length !== 1 ? 'ões' : ''} concluída${dadosIncompletos.length !== 1 ? 's' : ''} com dado faltando`}
                          </button>
                          {expandedProjectDadosIncompletos !== p.nome && (
                            <p className="text-[10px] text-slate-500 mt-1">
                              BIRD marcado com pelo menos um dado de acesso faltando, ou A1 marcado sem o arquivo do certificado anexado — cobrar do certificador.
                            </p>
                          )}
                          {expandedProjectDadosIncompletos === p.nome && (
                            <div className="mt-3 space-y-2">
                              {dadosIncompletos.map((d) => {
                                const faltaBird = birdSemDados.some((x) => x.id === d.id);
                                const faltaA1 = a1SemArquivo.some((x) => x.id === d.id);
                                return (
                                  <button
                                    key={d.id}
                                    type="button"
                                    onClick={() => handleSelectOS(d)}
                                    className="w-full bg-slate-950/60 border border-amber-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-amber-700/50 transition-colors"
                                  >
                                    <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.client_name}</span>
                                    <span className="flex gap-1.5 shrink-0">
                                      {faltaBird && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-400">🆔 BIRD dados incompletos</span>}
                                      {faltaA1 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-950/40 text-rose-400">📜 A1 sem arquivo</span>}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Pendências de certificação — NÃO é problema de dado
                          (diferente dos 3 blocos âmbar acima), é a fila de
                          trabalho normal ainda não feita; por isso cor
                          diferente (sky, mesma dos badges "liberado"/
                          "pendente" da tela Certificação) em vez de âmbar. */}
                      {pendentesCert.length > 0 && (
                        <div className="border border-sky-800/40 bg-sky-950/10 rounded-lg p-3">
                          <button
                            type="button"
                            onClick={() => setExpandedProjectPendentes(expandedProjectPendentes === p.nome ? '' : p.nome)}
                            className="text-[11px] font-bold text-sky-400 hover:text-sky-300"
                          >
                            🔵 {expandedProjectPendentes === p.nome ? 'Ocultar' : `${pendentesCert.length} certificação${pendentesCert.length !== 1 ? 'ões' : ''} pendente${pendentesCert.length !== 1 ? 's' : ''} (elegível${pendentesCert.length !== 1 ? 'eis' : ''} pra trabalhar)`}
                          </button>
                          {expandedProjectPendentes !== p.nome && (
                            <p className="text-[10px] text-slate-500 mt-1">
                              Já passou da E1 e tem vínculo e-commerce (e-CPF) ou cartão CNPJ + certidão anexados (e-CNPJ), mas a certificação ainda não foi concluída.
                            </p>
                          )}
                          {expandedProjectPendentes === p.nome && (
                            <div className="mt-3 space-y-2">
                              {pendentesCert.map((d) => {
                                const pendeBird = birdPendentes.some((x) => x.id === d.id);
                                const pendeA1 = a1Pendentes.some((x) => x.id === d.id);
                                return (
                                  <button
                                    key={d.id}
                                    type="button"
                                    onClick={() => handleSelectOS(d)}
                                    className="w-full bg-slate-950/60 border border-sky-900/30 rounded p-2.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-sky-700/50 transition-colors"
                                  >
                                    <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.client_name}</span>
                                    <span className="flex gap-1.5 shrink-0">
                                      {pendeBird && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300">🆔 e-CPF pendente</span>}
                                      {pendeA1 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300">📜 e-CNPJ pendente</span>}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Controle de pagamento — centralizado aqui (pedido do
                          gestor): Certificação e Concluídos por Certificador
                          só mostram o status, marcar/desmarcar é só nesta tela. */}
                      {colabFeitos.length > 0 && (
                        <div className="border-t border-slate-800 pt-3">
                          <button
                            type="button"
                            onClick={() => setExpandedProjectPagamentos(expandedProjectPagamentos === p.nome ? '' : p.nome)}
                            className="text-[11px] font-bold text-sky-400 hover:text-sky-300"
                          >
                            💰 {expandedProjectPagamentos === p.nome ? 'Ocultar pagamentos' : `Gerenciar pagamentos (${colabFeitos.length} certificação${colabFeitos.length !== 1 ? 'ões' : ''})`}
                          </button>
                          {expandedProjectPagamentos === p.nome && (
                            <div className="mt-3 space-y-2">
                              {colabFeitos.map((d) => (
                                <div key={d.id} className="bg-slate-950/60 border border-slate-800 rounded p-2.5 flex flex-wrap items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectOS(d)}
                                    className="text-xs font-semibold text-white hover:underline text-left min-w-0 truncate"
                                  >
                                    OS #{d.id} · {d.client_name}
                                  </button>
                                  <div className="flex flex-wrap gap-1.5 shrink-0">
                                    {d.bird_id_done && pagamentoPillClick(d, 'bird_pago', 'BIRD')}
                                    {d.a1_done && pagamentoPillClick(d, 'a1_pago', 'A1')}
                                    {pagamentoPillClick(d, 'colaborador_pago', 'Colaborador')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Lista de TODAS as OS's do projeto — formato compacto
                          (economiza espaço) + paginação própria por projeto,
                          fechada por padrão pra não poluir a tela com N
                          listas abertas junto com os blocos de auditoria
                          acima. */}
                      {total > 0 && (() => {
                        const OS_LIST_PAGE_SIZE = 10;
                        const isOpen = expandedProjectOS === p.nome;
                        const sorted = [...osDoProjeto].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
                        const totalOSPages = Math.max(1, Math.ceil(sorted.length / OS_LIST_PAGE_SIZE));
                        const osPage = Math.min(projectOSPage[p.nome] || 0, totalOSPages - 1);
                        const pagedOS = sorted.slice(osPage * OS_LIST_PAGE_SIZE, osPage * OS_LIST_PAGE_SIZE + OS_LIST_PAGE_SIZE);
                        return (
                          <div className="border-t border-slate-800 pt-3">
                            <button
                              type="button"
                              onClick={() => setExpandedProjectOS(isOpen ? '' : p.nome)}
                              className="text-[11px] font-bold text-slate-400 hover:text-slate-200"
                            >
                              📋 {isOpen ? 'Ocultar' : `Ver todas as OS's (${total})`}
                            </button>
                            {isOpen && (
                              <div className="mt-3 flex flex-col gap-1.5">
                                {pagedOS.map((d) => (
                                  <button
                                    key={d.id}
                                    type="button"
                                    onClick={() => handleSelectOS(d)}
                                    className="w-full bg-slate-950/60 border border-slate-800 rounded px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-left hover:border-slate-600 transition-colors"
                                  >
                                    <span className="text-xs font-semibold text-white truncate min-w-0">OS #{d.id} · {d.empresa_nome || d.client_name}</span>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.current_step === 'finalizado' ? 'bg-emerald-950/40 text-emerald-400' : 'bg-slate-800/60 text-slate-400'}`}>
                                      {d.current_step === 'finalizado' ? '🏆 empresa aberta' : (STEP_LABELS_NAV as Record<string, string>)[d.current_step] || d.current_step}
                                    </span>
                                  </button>
                                ))}
                                {totalOSPages > 1 && (
                                  <div className="flex items-center justify-between gap-2 pt-1">
                                    <button
                                      type="button"
                                      disabled={osPage === 0}
                                      onClick={() => setProjectOSPage((prev) => ({ ...prev, [p.nome]: osPage - 1 }))}
                                      className="text-[10px] font-bold px-2 py-1 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                                    >
                                      ← Anterior
                                    </button>
                                    <span className="text-[10px] text-slate-500">Página {osPage + 1} de {totalOSPages}</span>
                                    <button
                                      type="button"
                                      disabled={osPage >= totalOSPages - 1}
                                      onClick={() => setProjectOSPage((prev) => ({ ...prev, [p.nome]: osPage + 1 }))}
                                      className="text-[10px] font-bold px-2 py-1 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                                    >
                                      Próxima →
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Paginação — mesmo padrão de botões numerados já usado na
                  tela Certificação (janela de ±2 páginas em volta da atual). */}
              {totalPages > 1 && (() => {
                const WINDOW = 2;
                const pageNums: (number | '…')[] = [];
                for (let i = 0; i < totalPages; i++) {
                  if (i === 0 || i === totalPages - 1 || Math.abs(i - page) <= WINDOW) {
                    pageNums.push(i);
                  } else if (pageNums[pageNums.length - 1] !== '…') {
                    pageNums.push('…');
                  }
                }
                return (
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <span className="text-[11px] text-slate-500">Página {page + 1} de {totalPages} · {projectsList.length} projetos</span>
                    <div className="flex items-center gap-1 flex-wrap justify-center">
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setProjetosPage(page - 1)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                      >
                        ← Anterior
                      </button>
                      {pageNums.map((p, idx) => p === '…' ? (
                        <span key={`ellipsis-${idx}`} className="text-[11px] text-slate-600 px-1">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setProjetosPage(p)}
                          className={`text-[11px] font-bold w-7 h-7 rounded transition-colors ${p === page ? 'bg-sky-600 text-white' : 'border border-slate-800 text-slate-300 hover:border-slate-600'}`}
                        >
                          {p + 1}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={page >= totalPages - 1}
                        onClick={() => setProjetosPage(page + 1)}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                      >
                        Próxima →
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
            </div>
          );
        })()}

        {/* ===== TELA CAPTADORES (gestor/admin) =====
            Pedido do gestor: a busca do topo já encontra OS por nome de
            captador, mas mistura com outros tipos de resultado e limita a
            12 itens — aqui dá pra ver TODAS as OS de um captador de uma vez
            e controlar pagamento por captação (marcação manual, mesmo
            padrão de bird_pago/a1_pago/colaborador_pago). */}
        {view === 'captadores' && (currentRole === 'gestor' || currentRole === 'admin') && (() => {
          // Agrupamento normalizado (21/07/2026, bug real: "FOGUINHO" aparecendo
          // 2x nesta tela com contagens diferentes) — captured_by é texto livre
          // (ver Edição Rápida), então duas OS com o mesmo captador podiam ter
          // grafias ligeiramente diferentes (espaço a mais, capitalização
          // diferente) e o agrupamento por igualdade EXATA de string as tratava
          // como captadores distintos. Agrupa por versão normalizada
          // (espaços colapsados/aparados + case-insensitive), exibindo a
          // grafia normalizada de qualquer uma das variantes encontradas.
          const normCaptador = (s: string) => s.trim().replace(/\s+/g, ' ');
          const gruposCaptador = new Map<string, { display: string; os: Dossier[] }>();
          dossiers.forEach((d) => {
            if (!d.captured_by) return;
            const display = normCaptador(d.captured_by);
            const key = display.toLowerCase();
            const g = gruposCaptador.get(key);
            if (g) g.os.push(d);
            else gruposCaptador.set(key, { display, os: [d] });
          });
          const nomes = Array.from(gruposCaptador.values()).map((g) => g.display).sort((a, b) => a.localeCompare(b));
          const q = normalizeSearch(captadorFilter.trim());
          const nomesFiltrados = q ? nomes.filter((n) => normalizeSearch(n).includes(q)) : nomes;

          return (
            // Mesmo bug já documentado na tela "Projetos" (scroll travado):
            // <main> tem overflow-hidden, então qualquer view nova precisa do
            // próprio wrapper com flex-1 overflow-y-auto, senão o conteúdo
            // que passa da altura da tela fica cortado sem scroll nenhum.
            // Esta view nasceu sem isso — mesmo padrão aplicado agora
            // (container externo flex-1 overflow-y-auto thin-scroll sem
            // max-w, wrapper interno com max-w-4xl mx-auto).
            <div className="flex-1 overflow-y-auto p-6 bg-slate-900/30 thin-scroll">
            <div className="space-y-5 max-w-4xl mx-auto w-full">
              <div>
                <h2 className="text-sm font-bold text-white">📸 Captadores</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Todas as OS de cada captador, com controle de pagamento por captação.
                </p>
              </div>

              <input
                type="text"
                value={captadorFilter}
                onChange={(e) => setCaptadorFilter(e.target.value)}
                placeholder="Filtrar por nome do captador..."
                className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
              />

              <div className="space-y-3">
                {nomesFiltrados.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">Nenhum captador encontrado{q ? ' pra esse filtro' : ''}.</p>
                ) : (
                  nomesFiltrados.map((nome) => {
                    const osDoCaptador = (gruposCaptador.get(nome.toLowerCase())?.os || [])
                      .slice()
                      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
                    const total = osDoCaptador.length;
                    const abertas = osDoCaptador.filter((d) => d.empresa_aberta).length;
                    const emAndamento = total - abertas;
                    const pagas = osDoCaptador.filter((d) => d.captador_pago).length;
                    const pendentes = total - pagas;
                    const mesAtualGlobal = new Date().toISOString().slice(0, 7);
                    const mensalPagoEsteMes = osDoCaptador.filter((d) => {
                      if (!d.empresa_aberta) return false;
                      try {
                        const meses: string[] = d.captador_pagamentos_mensais ? JSON.parse(d.captador_pagamentos_mensais) : [];
                        return meses.includes(mesAtualGlobal);
                      } catch { return false; }
                    }).length;
                    const elegiveisMensal = abertas;
                    const isExpanded = expandedCaptador === nome;

                    return (
                      <div key={nome} className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 space-y-3">
                        <button
                          type="button"
                          onClick={() => setExpandedCaptador(isExpanded ? '' : nome)}
                          className="w-full flex flex-wrap items-center justify-between gap-2 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">📸 {nome}</span>
                            <span className="text-[11px] text-slate-400">{total} OS captada{total !== 1 ? 's' : ''}</span>
                          </div>
                          <span className="text-[11px] text-slate-500">{isExpanded ? '▲ recolher' : '▼ ver todas as OS'}</span>
                        </button>

                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                          <div className="bg-slate-950/60 rounded p-2 text-center">
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Total</p>
                            <p className="text-sm font-bold text-white">{total}</p>
                          </div>
                          <div className="bg-slate-950/60 rounded p-2 text-center">
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Em andamento</p>
                            <p className="text-sm font-bold text-amber-400">{emAndamento}</p>
                          </div>
                          <div className="bg-slate-950/60 rounded p-2 text-center">
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Empresas abertas</p>
                            <p className="text-sm font-bold text-emerald-400">{abertas}</p>
                          </div>
                          <div className="bg-slate-950/60 rounded p-2 text-center">
                            <p className="text-[10px] font-bold text-slate-500 uppercase">1º Pagto pago · pend.</p>
                            <p className="text-sm font-bold text-slate-200">{pagas} · {pendentes}</p>
                          </div>
                          <div className="bg-slate-950/60 rounded p-2 text-center">
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Mensal {mesAtualGlobal}</p>
                            <p className="text-sm font-bold text-slate-200">{mensalPagoEsteMes}/{elegiveisMensal}</p>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="space-y-1.5 pt-1">
                            {osDoCaptador.map((d) => {
                              const mesAtual = new Date().toISOString().slice(0, 7); // "YYYY-MM"
                              let mesesPagos: string[] = [];
                              try { mesesPagos = d.captador_pagamentos_mensais ? JSON.parse(d.captador_pagamentos_mensais) : []; } catch { mesesPagos = []; }
                              const mesAtualPago = mesesPagos.includes(mesAtual);
                              return (
                                <div
                                  key={d.id}
                                  className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 border border-slate-800 rounded px-3 py-2"
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleSelectOS(d)}
                                    className="text-left flex-1 min-w-0"
                                  >
                                    <span className="text-xs font-semibold text-slate-200 truncate block">
                                      {d.client_name}{d.empresa_nome ? ` · ${d.empresa_nome}` : ''}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      OS #{d.id} • {d.cpf} • {d.empresa_aberta ? '✓ aberta' : d.current_step}
                                      {d.bird_id_done ? ' • 🆔 BIRD feito' : ' • aguardando BIRD'}
                                    </span>
                                  </button>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); updateDossierStatus(d.id, { captador_pago: !d.captador_pago }); }}
                                      className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${d.captador_pago ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                      title={d.captador_pago ? `1º pagamento feito em ${d.captador_pago_em ? new Date(d.captador_pago_em).toLocaleString('pt-BR') : ''} por ${d.captador_pago_por || ''}` : 'Liberado na certificação do BIRD — marcar como pago'}
                                    >
                                      {d.captador_pago ? '✓ 1º Pagto' : '○ 1º Pagto'}
                                    </button>
                                    {d.empresa_aberta && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); updateDossierStatus(d.id, { toggle_mes_captador: mesAtual }, { keepView: true }); }}
                                        className={`text-[10px] font-bold px-2 py-1 rounded border transition-colors ${mesAtualPago ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                        title={`Mensalidade de ${mesAtual} — ${mesesPagos.length} mês(es) pago(s) no total`}
                                      >
                                        {mesAtualPago ? `✓ Mensal ${mesAtual}` : `○ Mensal ${mesAtual}`}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            </div>
          );
        })()}

      </main>

      {/* 3. PAINEL DE DETALHES (DRAWER SOBREPOSTO — não espreme o Kanban) */}
      {selectedOS && (
        <>
          {/* Backdrop: clique fora fecha o painel */}
          <div
            onClick={() => setSelectedOS(null)}
            className="fixed inset-0 bg-black/50 z-40 animate-[fadeIn_.15s_ease]"
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 right-0 w-full md:w-[680px] border-l border-slate-800 bg-slate-950 flex flex-col shrink-0 z-50 shadow-2xl shadow-black/50">

          {/* Mini-Dossiê Header — compacto: só identificação */}
          <div className="px-5 py-3 border-b border-slate-800 flex justify-between items-start gap-4">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Dossiê do Cliente</span>
              {/* Pedido do gestor: uma vez que o certificador já concluiu o
                  e-CPF (BIRD ID) de uma OS, o que resta fazer é sobre a
                  EMPRESA (A1/e-CNPJ) — mostrar o nome da pessoa física não
                  ajuda mais nesse momento. Mesmo critério já usado na lista
                  da tela Certificação (`primaryIsEmpresa`); escopado só a
                  operador_certificacao pra não mudar o que gestor/admin/
                  operador_abertura veem (eles continuam vendo o nome do
                  cliente como identificação principal). */}
              <h3 className="font-bold text-base leading-tight truncate">
                {currentRole === 'operador_certificacao' && selectedOS.bird_id_done && selectedOS.empresa_nome
                  ? selectedOS.empresa_nome
                  : selectedOS.client_name}
              </h3>
              {/* Mesma condição do nome acima: depois do e-CPF concluído, o
                  certificador não precisa mais ver o CPF (dado pessoal) —
                  troca por CNPJ (dado da empresa, o que resta fazer),
                  quando disponível. Se o CNPJ ainda não foi digitado/salvo
                  na abertura, omite (não mostra CPF nem CNPJ). */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {currentRole === 'operador_certificacao' && selectedOS.bird_id_done ? (
                  <>
                    <span className="text-xs text-slate-400 font-medium">
                      OS #{selectedOS.id}{selectedOS.cnpj_number && ` • CNPJ: ${selectedOS.cnpj_number}`}
                    </span>
                    {selectedOS.cnpj_number && <CopyButton value={selectedOS.cnpj_number} />}
                  </>
                ) : (
                  <>
                    <span className="text-xs text-slate-400 font-medium">OS #{selectedOS.id} • CPF: {selectedOS.cpf}</span>
                    <CopyButton value={selectedOS.cpf} />
                  </>
                )}
                {selectedOS.captured_by && (
                  <span className="text-[10px] text-slate-500">• 📸 <span className="text-slate-300 font-semibold">{selectedOS.captured_by}</span></span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <SlaBadge dossier={selectedOS} />
                {(currentRole === 'gestor' || currentRole === 'admin') && (
                  <button
                    type="button"
                    onClick={() => { setSlaEditValue(selectedOS.sla_deadline || ''); setSlaEditOpen((o) => !o); }}
                    className="text-[9px] font-bold text-sky-400 hover:text-sky-300 bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-1.5 py-0.5 rounded"
                  >
                    ⏱️ Ajustar Prazo
                  </button>
                )}
                {selectedOS.projeto && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-700/30">📁 {selectedOS.projeto}</span>
                )}
                {contadorAbertura && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-900/30 text-sky-400 border border-sky-700/30">🧾 {contadorAbertura}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setSelectedOS(null)}
                className="text-slate-500 hover:text-slate-300 font-bold text-sm"
              >
                ✕ Fechar
              </button>
              {canDelete && (
                <button
                  onClick={handleDeleteOS}
                  className="text-[10px] bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/20 text-rose-400 font-bold px-2 py-1 rounded transition-colors active:scale-95"
                >
                  🗑️ Excluir
                </button>
              )}
            </div>
          </div>

          {/* Ajuste de prazo (SLA) individual — só gestor/admin */}
          {slaEditOpen && (currentRole === 'gestor' || currentRole === 'admin') && (
            <div className="px-5 py-3 border-b border-slate-800 bg-sky-950/10 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {[6, 12, 24, 48].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      const base = slaEditValue ? new Date(slaEditValue) : new Date();
                      setSlaEditValue(new Date(base.getTime() + h * 60 * 60 * 1000).toISOString());
                    }}
                    className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2 py-1 rounded transition-colors"
                  >
                    +{h}h
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1"><DateTimePicker value={slaEditValue} onChange={setSlaEditValue} /></div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedOS || !slaEditValue) return;
                    await updateDossierStatus(selectedOS.id, { sla_deadline: slaEditValue }, { keepView: true });
                    setSlaEditOpen(false);
                  }}
                  className="text-xs font-bold bg-sky-700 hover:bg-sky-600 text-white px-3 py-2 rounded-lg transition-colors self-stretch"
                >
                  Salvar
                </button>
                <button type="button" onClick={() => setSlaEditOpen(false)} className="text-xs text-slate-500 hover:text-slate-300 px-2">Cancelar</button>
              </div>
              <p className="text-[9px] text-slate-500">Ajusta o prazo desta OS individualmente. Pra ajustar várias de uma vez, use "Ajuste de SLA em Lote" no Dashboard.</p>
            </div>
          )}

          {/* Abas */}
          <div className="flex border-b border-slate-800 bg-slate-900/20 text-xs font-semibold shrink-0">
            <button
              onClick={() => setActiveTab('dados')}
              className={`flex-1 text-center py-3 border-b-2 transition-colors ${activeTab === 'dados' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              👤 Dossiê
            </button>
            <button
              onClick={() => setActiveTab('trabalho')}
              className={`flex-1 text-center py-3 border-b-2 transition-colors ${activeTab === 'trabalho' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              ⚙️ Trabalho
            </button>
            <button
              onClick={() => setActiveTab('auditoria')}
              className={`flex-1 text-center py-3 border-b-2 transition-colors ${activeTab === 'auditoria' ? 'border-sky-500 text-sky-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              📜 Auditoria
            </button>
            <button
              onClick={() => setActiveTab('tarefas')}
              className={`flex-1 text-center py-3 border-b-2 transition-colors relative ${activeTab === 'tarefas' ? 'border-violet-500 text-violet-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              📋 Tarefas
              {osTasks.filter(t => !t.done && t.to_user === currentOperator).length > 0 && (
                <span className="absolute top-1.5 right-1 w-2 h-2 bg-violet-500 rounded-full" />
              )}
            </button>
            {(currentRole === 'gestor' || currentRole === 'admin') && (
              <button
                onClick={() => {
                  setGestorEdit({
                    client_name: selectedOS.client_name || '',
                    cpf: selectedOS.cpf || '',
                    phone: selectedOS.phone || '',
                    email: selectedOS.email || '',
                    address: selectedOS.address || '',
                    empresa_endereco: selectedOS.empresa_endereco || '',
                    gov_level: selectedOS.gov_level || 'prata',
                    empresa_nome: selectedOS.empresa_nome || '',
                    nome_fantasia: selectedOS.nome_fantasia || '',
                    cnpj_number: selectedOS.cnpj_number || '',
                    cnae: selectedOS.cnae || '',
                    capital_social: selectedOS.capital_social || '',
                    regime_tributario: selectedOS.regime_tributario || '',
                    status: selectedOS.status || '',
                    current_step: selectedOS.current_step || '',
                    assigned_to: selectedOS.assigned_to || '',
                    captured_by: selectedOS.captured_by || '',
                    protocolo: selectedOS.protocolo || '',
                    resp_certificacao: selectedOS.resp_certificacao || '',
                    resp_abertura: selectedOS.resp_abertura || '',
                    t2_new_email: selectedOS.t2_new_email || '',
                    t2_new_phone: selectedOS.t2_new_phone || '',
                    cert_aparelho: selectedOS.cert_aparelho || '',
                  });
                  setActiveTab('editar');
                }}
                className={`flex-1 text-center py-3 border-b-2 transition-colors ${activeTab === 'editar' ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                ✏️ Editar
              </button>
            )}
          </div>

          {/* Conteúdo das Abas */}
          <div className="flex-1 overflow-y-auto p-5 thin-scroll">
            
            {/* TAB 1: DADOS E DOCUMENTOS */}
            {/* TAB 1: DOSSIÊ (unifica as antigas abas Documentos + Pessoa +
                Senha Gov — pedido explícito do gestor: as duas primeiras
                mostravam a mesma informação duplicada, só que organizada
                de formas diferentes, e isso confundia o usuário final.
                Continua visível pra TODOS os papéis (inclusive
                captador/terceiro, que já viam Documentos e Senha Gov antes
                — só não viam a antiga aba Pessoa). As seções que eram
                exclusivas da aba Pessoa (blocos de certificação BIRD/A1)
                continuam com o mesmo gate de visibilidade que a aba tinha
                (oculta pra captador/terceiro) pra não virar uma regressão
                de RBAC só por causa da fusão. */}
            {activeTab === 'dados' && (() => {
              const isBirdDone = !!selectedOS.bird_id_done;
              const isA1Done = !!selectedOS.a1_done;
              const canSeeCertBlocks = currentRole !== 'captador' && currentRole !== 'terceiro';
              // Mesma regra já estabelecida: A1 (e-CNPJ) nunca fica visível
              // pro operador de abertura — só os dados de e-CPF (BIRD).
              const canSeeA1File = currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_certificacao';
              const canRevealBirdSenha = isManager
                || (currentRole === 'operador_certificacao' && (!selectedOS.resp_certificacao || selectedOS.resp_certificacao === currentOperator))
                || (currentRole === 'operador_abertura' && (!selectedOS.resp_abertura || selectedOS.resp_abertura === currentOperator));
              const canSeeProcessDocs = currentRole !== 'captador' && currentRole !== 'terceiro';
              // Restrição pedida pelo gestor (18/07/2026): o certificador vinha
              // confundindo o e-mail PESSOAL do cliente (cadastrado pelo captador,
              // `selectedOS.email`) com o e-mail de VÍNCULO e-commerce
              // (`t2_new_email`, preenchido pelo terceiro) na hora de executar a
              // certificação — os dois apareciam juntos na mesma tela. Fix: pro
              // papel `operador_certificacao`, a aba Dossiê mostra só nome/CPF
              // (pessoa física), o vínculo e-commerce (e-mail/telefone/aparelho
              // preenchidos pelo terceiro) e, na Pessoa Jurídica, CNPJ/Razão/
              // Fantasia + só os 2 documentos de abertura que ele precisa (Cartão
              // CNPJ, Certidão de Inteiro Teor) — nada de telefone/e-mail/endereço
              // pessoal, documentos de identidade, avulsos, nem os demais dados da
              // empresa (CNAE/capital social/quadro societário/endereço). Senha
              // Gov.br continua liberada (ele precisa logar como o cliente pra
              // fazer o BIRD ID/e-CPF).
              const isCertLimited = currentRole === 'operador_certificacao';

              const openEditar = () => {
                setGestorEdit({
                  client_name: selectedOS.client_name || '',
                  cpf: selectedOS.cpf || '',
                  phone: selectedOS.phone || '',
                  email: selectedOS.email || '',
                  address: selectedOS.address || '',
                  empresa_endereco: selectedOS.empresa_endereco || '',
                  gov_level: selectedOS.gov_level || 'prata',
                  empresa_nome: selectedOS.empresa_nome || '',
                  nome_fantasia: selectedOS.nome_fantasia || '',
                  cnpj_number: selectedOS.cnpj_number || '',
                  cnae: selectedOS.cnae || '',
                  capital_social: selectedOS.capital_social || '',
                  regime_tributario: selectedOS.regime_tributario || '',
                  status: selectedOS.status || '',
                  current_step: selectedOS.current_step || '',
                  assigned_to: selectedOS.assigned_to || '',
                  captured_by: selectedOS.captured_by || '',
                  protocolo: selectedOS.protocolo || '',
                  resp_certificacao: selectedOS.resp_certificacao || '',
                  resp_abertura: selectedOS.resp_abertura || '',
                  t2_new_email: selectedOS.t2_new_email || '',
                  t2_new_phone: selectedOS.t2_new_phone || '',
                  cert_aparelho: selectedOS.cert_aparelho || '',
                });
                setActiveTab('editar');
              };
              const EditarButton = () => (currentRole === 'gestor' || currentRole === 'admin') ? (
                <button
                  type="button"
                  onClick={openEditar}
                  className="text-[10px] font-semibold text-amber-400 hover:text-amber-300 transition-colors px-2 py-0.5 rounded border border-amber-700/40 hover:border-amber-500/60 bg-amber-950/20"
                >
                  ✏️ Editar
                </button>
              ) : null;

              const DocLink = ({ label, url, downloadName }: { label: string; url?: string; downloadName?: string }) => (
                <div className="flex items-center justify-between gap-2 text-xs bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                  <span className="text-slate-400">{label}</span>
                  {url ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <a href={url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline font-semibold">👁️ Ver</a>
                      <a href={url} download={downloadName || true} className="text-emerald-400 hover:underline font-semibold">⬇️ Baixar</a>
                    </div>
                  ) : <span className="text-slate-600 italic shrink-0">não anexado</span>}
                </div>
              );
              const Field = ({ label, value }: { label: string; value?: string }) => value ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 w-28 shrink-0">{label}</span>
                  <span className="text-slate-200 flex-1 break-all">{value}</span>
                  <CopyButton value={value} keepSpaces />
                </div>
              ) : null;

              return (
                <div className="flex flex-col gap-5">
                  <div className="flex gap-1.5 bg-slate-900/60 border border-slate-800 rounded-lg p-1">
                    <button
                      type="button"
                      onClick={() => setPessoaViewTab('fisica')}
                      className={`flex-1 text-xs font-bold py-2 rounded-md transition-colors ${pessoaViewTab === 'fisica' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      👤 Pessoa Física
                    </button>
                    <button
                      type="button"
                      onClick={() => setPessoaViewTab('juridica')}
                      className={`flex-1 text-xs font-bold py-2 rounded-md transition-colors ${pessoaViewTab === 'juridica' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      🏢 Pessoa Jurídica
                    </button>
                  </div>

                  {pessoaViewTab === 'fisica' && (
                    <div className="flex flex-col gap-5">
                      <div className="flex flex-col gap-2 border border-slate-800 bg-slate-900/40 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-1">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Dados Pessoais</h5>
                          <EditarButton />
                        </div>
                        {/* Pedido do gestor: uma vez que o certificador já
                            fez o e-CPF (BIRD ID) desta OS, o nome da pessoa
                            física deixa de aparecer pra ele — o que resta
                            fazer (A1/e-CNPJ) é sobre a empresa, não a
                            pessoa. CPF continua visível (é o login usado no
                            e-CPF, ainda referência útil). */}
                        {!(isCertLimited && selectedOS.bird_id_done && selectedOS.empresa_nome) && (
                          <Field label="Nome" value={selectedOS.client_name} />
                        )}
                        <Field label="CPF" value={selectedOS.cpf} />
                        {isCertLimited && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-500 w-28 shrink-0">Nível Gov.br</span>
                            <GovChip level={selectedOS.gov_level} />
                          </div>
                        )}
                        {!isCertLimited && (
                          <>
                            <Field label="WhatsApp" value={selectedOS.phone} />
                            <Field label="E-mail" value={selectedOS.email} />
                            <Field label="Endereço" value={selectedOS.address} />
                            <Field label="Captado por" value={selectedOS.captured_by} />
                          </>
                        )}
                      </div>

                      {/* Documentos de identidade — pedido de acompanhamento
                          (18/07/2026): o certificador precisa ver RG/CNH/etc.
                          anexados, mesmo com a restrição de identidade pessoal
                          (nome/CPF/nível gov) que ele já tem. Voltou a ser
                          visível pra ele; continua visível pros demais papéis
                          internos como sempre foi. */}
                      <div className="flex flex-col gap-2 border border-slate-800 bg-slate-900/40 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-1">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Documentos de Identidade</h5>
                          {(currentRole === 'gestor' || currentRole === 'admin') && (
                            <span className="text-[9px] text-slate-500 italic">gestor/admin podem anexar/substituir</span>
                          )}
                        </div>
                        {/* Pedido real (18/07/2026): gestor não tinha como anexar/
                            corrigir documento de identidade quando o captador não
                            subiu pelo sistema e mandou por WhatsApp — antes só dava
                            pra VER (DocLink), nunca anexar, fora do fluxo do
                            captador.html. gestor/admin ganham FileAttach normal;
                            os demais papéis continuam só vendo (DocLink). */}
                        {(currentRole === 'gestor' || currentRole === 'admin') ? (
                          <>
                            <FileAttach dossierId={selectedOS.id} field="photo_doc_frente_url" label="Documento — Frente" currentUrl={selectedOS.photo_doc_frente_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                            <FileAttach dossierId={selectedOS.id} field="photo_doc_verso_url" label="Documento — Verso" currentUrl={selectedOS.photo_doc_verso_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                            <FileAttach dossierId={selectedOS.id} field="photo_doc_completo_url" label="Documento — Completo" currentUrl={selectedOS.photo_doc_completo_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                            <FileAttach dossierId={selectedOS.id} field="photo_cnh_url" label="CNH" currentUrl={selectedOS.photo_cnh_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                            <FileAttach dossierId={selectedOS.id} field="photo_selfie_url" label="Selfie" currentUrl={selectedOS.photo_selfie_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                            <FileAttach dossierId={selectedOS.id} field="photo_selfie_rg_url" label="Selfie + RG" currentUrl={selectedOS.photo_selfie_rg_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                            {selectedOS.video_prova_url && (
                              <div className="flex flex-col gap-1.5 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                                <span className="text-xs text-slate-400">🎥 Prova de Vida (vídeo)</span>
                                <video src={selectedOS.video_prova_url} controls className="w-full max-h-40 rounded border border-slate-800 bg-slate-950" />
                                <a href={selectedOS.video_prova_url} download className="text-[10px] text-emerald-400 hover:underline self-start font-semibold">⬇️ Baixar vídeo</a>
                              </div>
                            )}
                            <FileAttach dossierId={selectedOS.id} field="video_prova_url" label="Prova de Vida (vídeo)" currentUrl={selectedOS.video_prova_url} operator={currentOperator} accept="video/*" onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          </>
                        ) : (
                          <>
                            <DocLink label="Documento — Frente" url={selectedOS.photo_doc_frente_url} />
                            <DocLink label="Documento — Verso" url={selectedOS.photo_doc_verso_url} />
                            <DocLink label="Documento — Completo" url={selectedOS.photo_doc_completo_url} />
                            <DocLink label="CNH" url={selectedOS.photo_cnh_url} />
                            <DocLink label="Selfie" url={selectedOS.photo_selfie_url} />
                            <DocLink label="Selfie + RG" url={selectedOS.photo_selfie_rg_url} />
                            {selectedOS.video_prova_url ? (
                              <div className="flex flex-col gap-1.5 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                                <span className="text-xs text-slate-400">🎥 Prova de Vida (vídeo)</span>
                                <video src={selectedOS.video_prova_url} controls className="w-full max-h-40 rounded border border-slate-800 bg-slate-950" />
                                <a href={selectedOS.video_prova_url} download className="text-[10px] text-emerald-400 hover:underline self-start font-semibold">⬇️ Baixar vídeo</a>
                              </div>
                            ) : <DocLink label="Prova de Vida (vídeo)" url={undefined} />}
                          </>
                        )}
                      </div>

                      {/* Documentos Avulsos — pedido explícito do gestor: precisa
                          ser possível anexar documento extra na Pessoa Física, do
                          mesmo jeito que já existe pra Pessoa Jurídica. São 3
                          slots livres (qualquer arquivo fora dos campos fixos),
                          cada um com nome digitado por quem anexa. */}
                      {canSeeProcessDocs && !isCertLimited && (
                        <div className="flex flex-col gap-3 border border-slate-800 bg-slate-900/30 p-4 rounded-lg">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">🗂️ Documentos Avulsos</h5>
                          <GenericDocAttach dossierId={selectedOS.id} index={1} nome={selectedOS.doc_extra_1_nome} url={selectedOS.doc_extra_1_url} operator={currentOperator} onSaved={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <GenericDocAttach dossierId={selectedOS.id} index={2} nome={selectedOS.doc_extra_2_nome} url={selectedOS.doc_extra_2_url} operator={currentOperator} onSaved={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <GenericDocAttach dossierId={selectedOS.id} index={3} nome={selectedOS.doc_extra_3_nome} url={selectedOS.doc_extra_3_url} operator={currentOperator} onSaved={() => handleSelectOS(selectedOS, { keepView: true })} />
                        </div>
                      )}

                      {/* Senha Gov.br — movida da antiga aba própria "🔑 Senha
                          Gov" pra dentro do Dossiê (pedido do gestor), já que é
                          um dado da pessoa física (login é o CPF do cliente). */}
                      <div className="border border-amber-950/20 bg-amber-950/5 p-4 rounded-lg flex flex-col gap-2">
                        <h5 className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">Acesso de Alta Segurança (Gov.br)</h5>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Dados do Gov.br contêm informações fiscais altamente protegidas por lei.
                          Toda visualização é auditada e permanentemente gravada na trilha de segurança do sistema.
                        </p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Login Gov.br</span>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-slate-200 break-all flex-1">{selectedOS.gov_login || selectedOS.cpf}</span>
                            <CopyButton value={selectedOS.gov_login || selectedOS.cpf} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Senha de Acesso</span>
                          {passwordRevealed ? (
                            <div className="flex flex-col gap-2 bg-slate-950 border border-slate-850 rounded p-3 text-xs">
                              <div className="flex items-center gap-2">
                                <p className="text-emerald-400 font-mono font-bold text-sm tracking-wide break-all flex-1">{revealedGovPassword}</p>
                                <CopyButton value={revealedGovPassword} />
                              </div>
                              <p className="text-[9px] text-rose-400 font-semibold mt-1">⚠️ ATENÇÃO: Esta ação de visualização foi devidamente auditada!</p>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between bg-slate-950 border border-slate-850 rounded px-3 py-2 text-xs">
                              <span className="text-slate-500 tracking-widest text-sm select-none">••••••••••••••••</span>
                              {(currentRole === 'captador' || currentRole === 'terceiro') ? (
                                <span className="text-[10px] text-slate-600 font-semibold">🔒 Sem permissão</span>
                              ) : (
                                <button onClick={handleRevealPassword} className="text-xs text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-1 rounded transition-colors">
                                  👁️ Revelar Senha
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {(currentRole === 'gestor' || currentRole === 'admin') && (
                          <div className="flex flex-col gap-1.5 mt-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Editar Senha Gov.br</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="password"
                                autoComplete="new-password"
                                value={govPasswordEdit}
                                onChange={(e) => setGovPasswordEdit(e.target.value)}
                                placeholder={selectedOS.has_gov_password ? '•••••••• (definir nova)' : 'Definir senha'}
                                className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                              />
                              <button type="button" onClick={handleSaveGovPassword} disabled={!govPasswordEdit.trim()} className="text-xs font-bold bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg transition-colors">Salvar</button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Certificação BIRD/e-CPF — mesma visibilidade que a
                          antiga aba "Pessoa" tinha (oculta pra
                          captador/terceiro; a aba inteira era escondida
                          desses papéis antes da fusão). */}
                      {canSeeCertBlocks && (
                        <div className="flex flex-col gap-2 border border-sky-900/30 bg-sky-950/10 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[11px] font-bold text-sky-400 uppercase tracking-wide">🆔 BIRD ID/SYNC — e-CPF</h5>
                            {isBirdDone
                              ? <span className="text-[10px] font-bold text-emerald-400">✓ concluído{selectedOS.bird_id_done_por ? ` por ${selectedOS.bird_id_done_por}` : ''}{selectedOS.bird_id_done_em ? ` — ${new Date(selectedOS.bird_id_done_em).toLocaleDateString('pt-BR')}` : ''}</span>
                              : <span className="text-[10px] text-slate-500">pendente</span>
                            }
                          </div>
                          <Field label="Sistema" value={selectedOS.cert_sistema_usado} />
                          {/* Campo aposentado do formulário — só aparece em OS
                              antigas que já têm o valor gravado. */}
                          {selectedOS.cert_certificadora && <Field label="Certificadora" value={selectedOS.cert_certificadora} />}
                          <Field label="Aparelho" value={selectedOS.cert_aparelho} />
                          <Field label="E-mail do certificado" value={selectedOS.cert_email} />
                          {canRevealBirdSenha && selectedOS.has_cert_email_senha && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-500 w-28 shrink-0">Senha e-mail</span>
                              {certEmailSenhaRevealed ? (
                                <span className="text-emerald-400 font-mono font-bold flex-1 break-all">{revealedCertEmailSenha || '(vazia)'}</span>
                              ) : (
                                <button type="button" onClick={() => handleRevealCertField('cert_email_senha')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-1.5 rounded">👁️ Revelar</button>
                              )}
                            </div>
                          )}
                          {canRevealBirdSenha && selectedOS.has_cert_senha_acesso && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-500 w-28 shrink-0">Senha do app</span>
                              {certSenhaAcessoRevealed ? (
                                <span className="text-emerald-400 font-mono font-bold flex-1 break-all">{revealedCertSenhaAcesso || '(vazia)'}</span>
                              ) : (
                                <button type="button" onClick={() => handleRevealCertField('cert_senha_acesso')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-1.5 rounded">👁️ Revelar</button>
                              )}
                            </div>
                          )}
                          {!selectedOS.cert_sistema_usado && !isBirdDone && (
                            <p className="text-[11px] text-slate-500 italic">Ainda sem dados de acesso preenchidos.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {pessoaViewTab === 'juridica' && (
                    <div className="flex flex-col gap-5">
                      <div className="flex flex-col gap-2 border border-slate-800 bg-slate-900/40 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-1">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Dados da Empresa</h5>
                          <EditarButton />
                        </div>
                        <Field label="CNPJ" value={selectedOS.cnpj_number} />
                        <Field label="Razão Social" value={selectedOS.empresa_nome} />
                        <Field label="Nome Fantasia" value={selectedOS.nome_fantasia} />
                        {!isCertLimited && (
                          <>
                            <Field label="Endereço" value={selectedOS.empresa_endereco} />
                            <Field label="CNAE" value={selectedOS.cnae} />
                            <Field label="Capital Social" value={selectedOS.capital_social} />
                            <Field label="Regime Tributário" value={selectedOS.regime_tributario} />
                            <Field label="Porte da Empresa" value={selectedOS.porte_empresa} />
                            <Field label="Forma de Atuação" value={selectedOS.forma_atuacao} />
                            <Field label="Quadro Societário" value={selectedOS.quadro_societario} />
                          </>
                        )}
                        {!selectedOS.cnpj_number && !selectedOS.empresa_nome && (
                          <p className="text-[11px] text-slate-500 italic">Aguardando CNPJ gerado na Abertura.</p>
                        )}
                      </div>

                      {/* Dados de vínculo e-commerce: 3º ajuste do mesmo pedido
                          (21/07/2026) — o certificador precisa de Chip/E-mail
                          pra executar a certificação, mas NÃO de Aparelho nem
                          da senha do e-mail (pedido explícito de
                          acompanhamento). Rótulo neutro "Dados" (não
                          "Vínculo E-commerce"). */}
                      <div className="flex flex-col gap-2 border border-slate-800 bg-slate-900/40 rounded-lg p-4">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">Dados</h5>
                          <Field label="Chip" value={selectedOS.t2_new_phone} />
                          <Field label="E-mail" value={selectedOS.t2_new_email} />
                          {/* Projeto do PRÓPRIO parceiro (controle dele, texto livre) —
                              não confundir com o badge "📁 Projeto" da Contex mostrado no
                              cabeçalho da OS (esse é o classificado pelo gestor). */}
                          {selectedOS.projeto_parceiro && <Field label="Projeto (parceiro)" value={selectedOS.projeto_parceiro} />}
                          {!isCertLimited && <Field label="Aparelho" value={selectedOS.cert_aparelho} />}
                          {selectedOS.t2_new_email && !isCertLimited && (currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_abertura') && (
                            <div className="flex flex-col gap-1 mt-0.5">
                              <span className="text-slate-500 text-xs font-medium">Senha e-mail</span>
                              {t2EmailSenhaRevealed ? (
                                <div className="flex items-center gap-2 bg-slate-950 border border-slate-850 rounded px-2.5 py-2">
                                  <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedT2EmailSenha || '(vazia)'}</span>
                                  <CopyButton value={revealedT2EmailSenha} />
                                </div>
                              ) : selectedOS.has_t2_new_email_senha ? (
                                <button type="button" onClick={() => handleRevealCertField('t2_new_email_senha')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-2 rounded self-start">👁️ Revelar</button>
                              ) : (
                                <span className="text-[10px] text-slate-600 italic">Ainda não cadastrada pelo terceiro.</span>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <input
                                  type="password" autoComplete="new-password" value={t2EmailSenhaEdit}
                                  onChange={(e) => setT2EmailSenhaEdit(e.target.value)}
                                  placeholder={selectedOS.has_t2_new_email_senha ? '•••••••• (corrigir)' : 'Definir senha'}
                                  className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                                />
                                <button type="button" onClick={handleSaveT2EmailSenha} disabled={!t2EmailSenhaEdit.trim()} className="text-xs font-bold bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg transition-colors">Salvar</button>
                              </div>
                              <p className="text-[9px] text-rose-400/80 font-semibold">⚠️ Revelação/alteração é auditada.</p>
                            </div>
                          )}
                          {!selectedOS.t2_new_phone && !selectedOS.t2_new_email && (
                            <p className="text-[11px] text-slate-500 italic">Vínculo ainda não definido pelo terceiro.</p>
                          )}
                        </div>

                      {/* Documentos do Processo — upload/visualização (mesmos
                          FileAttach de antes, só reorganizados aqui dentro).
                          Certificador: só os 2 documentos que ele de fato
                          precisa pro A1 (Cartão CNPJ + Certidão de Inteiro
                          Teor), em modo só-leitura — quem anexa/substitui
                          continua sendo a equipe de abertura. */}
                      {canSeeProcessDocs && isCertLimited && (
                        <div className="flex flex-col gap-3 border border-slate-800 bg-slate-900/30 p-4 rounded-lg">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">📎 Documentos do Processo</h5>
                          <DocLink label="Cartão" url={selectedOS.cnpj_comprovante_url} />
                          <DocLink label="Certidão" url={selectedOS.certidao_inteiro_teor_url} />
                        </div>
                      )}
                      {canSeeProcessDocs && !isCertLimited && (
                        <div className="flex flex-col gap-3 border border-slate-800 bg-slate-900/30 p-4 rounded-lg">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">📎 Documentos do Processo</h5>
                          <FileAttach dossierId={selectedOS.id} field="cnpj_comprovante_url" label="Cartão" currentUrl={selectedOS.cnpj_comprovante_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="certidao_inteiro_teor_url" label="Certidão" currentUrl={selectedOS.certidao_inteiro_teor_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="inscricao_municipal_url" label="Inscrição Municipal" currentUrl={selectedOS.inscricao_municipal_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="inscricao_estadual_url" label="Inscrição Estadual" currentUrl={selectedOS.inscricao_estadual_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="opcao_simples_url" label="Opção do Simples Nacional" currentUrl={selectedOS.opcao_simples_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                        </div>
                      )}

                      {/* Certificação A1/e-CNPJ — mesma visibilidade que a
                          antiga aba "Pessoa" (oculta pra captador/terceiro) +
                          gate adicional canSeeA1File (exclui operador_abertura
                          de propósito — ele nunca vê dado de A1). */}
                      {canSeeCertBlocks && canSeeA1File && (
                        <div className="flex flex-col gap-2 border border-violet-900/30 bg-violet-950/10 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[11px] font-bold text-violet-400 uppercase tracking-wide">📜 Certificado A1 — e-CNPJ</h5>
                            {isA1Done
                              ? <span className="text-[10px] font-bold text-emerald-400">✓ concluído{selectedOS.a1_done_por ? ` por ${selectedOS.a1_done_por}` : ''}{selectedOS.a1_done_em ? ` — ${new Date(selectedOS.a1_done_em).toLocaleDateString('pt-BR')}` : ''}</span>
                              : <span className="text-[10px] text-slate-500">pendente</span>
                            }
                          </div>
                          <DocLink label="Arquivo do certificado (.zip com pfx + senha)" url={selectedOS.certificado_a1_url} downloadName={certificadoA1FileName(selectedOS.empresa_nome, selectedOS.certificado_a1_nome, selectedOS.certificado_a1_url)} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TAB 2: TRABALHO DO SETOR (Esteira Operacional) */}
            {activeTab === 'trabalho' && (
              <div className="flex flex-col gap-5">

                {/* Controles de gestão — Contador, Assumir OS, Cobrar Setor, Mover Etapa, Nota do Gestor */}
                <div className="flex flex-col gap-2">

                  {/* Atribuição de operador T1/T2 — só gestor/admin podem atribuir. Sem
                      operador_abertura na lista: ele não enxerga nem age em E1/E2
                      (só a partir da E3), então listá-lo aqui seria uma atribuição
                      que nunca aparece pra ele fazer nada. */}
                  {['t1', 't2'].includes(selectedOS.current_step) && (
                    <div className="flex flex-col gap-1.5">
                      {isManager ? (
                        <ResponsibleSelect
                          label="Operador responsável (E1/E2)"
                          value={assignedTo}
                          options={operatorsList.filter(u => u.active && ['gestor', 'admin'].includes(u.role)).map(u => u.name)}
                          onSelect={(name) => { setAssignedTo(name); updateDossierStatus(selectedOS!.id, { assigned_to: name, operator_name: currentOperator }); }}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          {selectedOS.assigned_to
                            ? <span className="text-[10px] text-indigo-400 font-semibold">👤 Em atendimento: <span className="text-white">{selectedOS.assigned_to}</span></span>
                            : <span className="text-[10px] text-slate-500 italic">OS sem operador atribuído</span>
                          }
                        </div>
                      )}
                    </div>
                  )}

                  {/* Atribuição de Projeto (gestor/admin, qualquer etapa) */}
                  {isManager && (
                    <div className="flex flex-col gap-1.5 border border-emerald-900/30 bg-emerald-950/10 rounded-lg p-2.5">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">📁 Projeto</span>
                      <div className="flex flex-wrap gap-1.5">
                        {projectsList.map((p) => {
                          const lotado = p.capacidade > 0 && p.usados >= p.capacidade;
                          const isSelected = selectedOSProject === p.nome;
                          return (
                            <button
                              key={p.nome}
                              type="button"
                              disabled={lotado && !isSelected}
                              onClick={() => assignProjeto(p)}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${isSelected ? 'bg-emerald-600 border-emerald-500 text-white' : lotado ? 'bg-slate-900 border-rose-900/50 text-rose-400/60 cursor-not-allowed' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
                              title={p.capacidade > 0 ? `${p.usados}/${p.capacidade} empresas` : 'Ilimitado'}
                            >
                              {p.nome}{p.capacidade > 0 ? ` (${p.usados}/${p.capacidade})` : ''}
                            </button>
                          );
                        })}
                        {selectedOSProject && (
                          <button type="button" onClick={() => { setSelectedOSProject(''); updateDossierStatus(selectedOS!.id, { projeto: '' }); }} className="text-[10px] text-rose-400 hover:text-rose-300 px-2 py-0.5 border border-rose-900/30 rounded">✕</button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Responsável do vínculo e-commerce (gestor/admin, qualquer
                      etapa) — "primeira conta terceiro que grava dados na OS
                      fica dona dela" é permanente por padrão (ver
                      /terceiro-update); este seletor é a única forma de
                      corrigir isso manualmente, por exemplo quando uma OS foi
                      vinculada por um parceiro antes de existir a conta certa
                      pro projeto dela. */}
                  {isManager && (
                    <div className="flex flex-col gap-1.5">
                      <ResponsibleSelect
                        label="🤝 Responsável Terceiro (vínculo e-commerce)"
                        value={respTerceiro}
                        options={operatorsList.filter(u => u.active && u.role === 'terceiro').map(u => u.name)}
                        onSelect={(name) => {
                          const atual = selectedOS!.terceiro_responsavel || '';
                          if (atual && name !== atual) {
                            const ok = window.confirm(
                              `Esta OS já está vinculada a "${atual}" (com e-mail/telefone já preenchidos, se houver). Reatribuir para "${name || '(livre)'}" faz "${atual}" parar de enxergar esta OS no portal do parceiro — os dados já preenchidos NÃO são apagados, só a visibilidade muda. Confirmar?`
                            );
                            if (!ok) return;
                          }
                          setRespTerceiro(name);
                          updateDossierStatus(selectedOS!.id, { terceiro_responsavel: name });
                        }}
                      />
                    </div>
                  )}

                  {/* Contador responsável pela abertura (gestor/admin definem) */}
                  {(currentRole === 'gestor' || currentRole === 'admin') && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide shrink-0">Contador:</span>
                      {CONTADORES.map((nome) => (
                        <button
                          key={nome}
                          type="button"
                          onClick={() => { setContadorAbertura(nome); updateDossierStatus(selectedOS.id, { contador_abertura: nome }); }}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${contadorAbertura === nome ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
                        >
                          {nome}
                        </button>
                      ))}
                      {contadorAbertura && (
                        <button
                          type="button"
                          onClick={() => { setContadorAbertura(''); updateDossierStatus(selectedOS.id, { contador_abertura: '' }); }}
                          className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                          title="Remover contador"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}

                  {/* Cobrar Setor (Alerta SLA) — gestor/admin */}
                  {(currentRole === 'gestor' || currentRole === 'admin') && (
                    <div>
                      <button
                        onClick={handleCobrarSetor}
                        className="text-[10px] bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/20 text-amber-400 font-bold px-2 py-1 rounded transition-colors active:scale-95"
                      >
                        🔔 Cobrar Setor (Alerta SLA)
                      </button>
                    </div>
                  )}

                  {/* Mover Etapa (Gestor) — seletor com todas as etapas, não só
                      anterior/posterior, pra mover pra qualquer ponto do fluxo. */}
                  {(currentRole === 'gestor' || currentRole === 'admin') && (() => {
                    const currentStep: Step = selectedOS.status === 'captado' ? 'captacao' : (selectedOS.current_step as Step);
                    return (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide shrink-0">Mover Etapa:</span>
                        <select
                          value=""
                          onChange={(e) => {
                            const targetStep = e.target.value as Step;
                            if (targetStep) setGestorMoveModal({ targetStep, justification: '' });
                          }}
                          className="text-[11px] bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-200 outline-none focus:border-sky-500"
                        >
                          <option value="">Selecionar etapa...</option>
                          {STEP_ORDER.filter((s) => s !== currentStep).map((s) => (
                            <option key={s} value={s}>{STEP_LABELS_NAV[s]}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}

                  {/* Nota do Gestor — visível para toda a equipe */}
                  {(gestorNote || currentRole === 'gestor' || currentRole === 'admin') && (
                    <div className="border border-amber-700/30 rounded-lg p-3 bg-amber-950/10">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">📌 Nota do Gestor</span>
                        {gestorNote && <span className="text-[10px] text-slate-500 italic">visível para toda a equipe</span>}
                      </div>
                      {(currentRole === 'gestor' || currentRole === 'admin') ? (
                        <div className="flex flex-col gap-1.5">
                          <textarea
                            rows={2}
                            className="w-full bg-amber-950/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-100 placeholder-amber-700/60 resize-none focus:outline-none focus:border-amber-500/60"
                            placeholder="Orientação, observação ou instrução para a equipe..."
                            value={gestorNote}
                            onChange={e => setGestorNote(e.target.value)}
                          />
                          <button
                            onClick={() => updateDossierStatus(selectedOS.id, { gestor_note: gestorNote, operator_name: currentOperator })}
                            className="self-end text-[10px] bg-amber-600/80 hover:bg-amber-500 text-white font-bold px-3 py-1 rounded transition-colors active:scale-95"
                          >
                            💾 Salvar nota
                          </button>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-200 whitespace-pre-wrap">{gestorNote}</div>
                      )}
                    </div>
                  )}

                </div>

                {/* BIRD ID antecipado: OS ainda em T2 já libera o certificador, em
                    paralelo ao cadastro — vale pros dois níveis (Prata e Ouro),
                    já que os dois entram na fila do certificador desde a E2
                    (ver getCertColumnDossiers/vinculoReady). BUG REAL (corrigido):
                    esta checagem ficou restrita a `gov_level === 'prata'` quando a
                    fila foi ampliada pra Ouro também — resultado: OS Ouro com
                    vínculo já definido aparecia disponível na fila do certificador,
                    mas ao abrir a OS ele só via "🔒 Somente leitura" (sem conseguir
                    marcar o BIRD ID como feito) até a Abertura empurrar a OS pra T3.
                    Relatado como "cadastro com e-mail/número já atribuídos que não
                    avança pro certificador". */}
                {(() => {
                  // BUG REAL (corrigido): o painel inteiro (status + dados de
                  // acesso à certificação) só existia enquanto `!bird_id_done`
                  // — assim que o certificador concluía o BIRD ID ainda em T2,
                  // o bloco inteiro sumia (inclusive os dados já preenchidos:
                  // certificadora, sistema usado, aparelho, e-mail) até a OS
                  // avançar pra T3. Resultado relatado: "não aparecem as
                  // informações do BIRD após anexados/preenchidos" — o dado
                  // tinha sido salvo certinho, só não tinha onde ser exibido
                  // de volta enquanto a OS ficasse em T2. Agora a janela
                  // (`isEarlyBirdWindow`) não depende mais de bird_id_done —
                  // controla só se MOSTRA o formulário de edição ou o status
                  // já concluído.
                  const t2CertRoles = currentRole === 'gestor' || currentRole === 'admin' || currentRole === 'operador_certificacao';
                  const isEarlyBirdWindow = selectedOS.current_step === 't2' && t2CertRoles;
                  const isEarlyBirdEligible = isEarlyBirdWindow && !selectedOS.bird_id_done;
                  return (
                    <>
                      {/* RBAC: bloqueia a execução se o papel não for do setor atual */}
                      {selectedOS.current_step !== 'finalizado' && !canWorkStep(selectedOS.current_step) && !isEarlyBirdWindow && (
                        <div className="border border-slate-800 bg-slate-900/40 p-4 rounded-lg flex flex-col gap-1.5">
                          <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide">🔒 Somente leitura</h4>
                          <p className="text-xs text-slate-400">
                            Esta OS está no setor <b className="text-slate-200">{selectedOS.current_step.toUpperCase()}</b>. Seu perfil ({ROLE_LABELS[currentRole]}) não tem permissão para executar esta etapa — apenas o operador do setor, Gestor ou Administrador podem agir aqui.
                          </p>
                        </div>
                      )}

                      {isEarlyBirdWindow && (
                        <div className="flex flex-col gap-2 border border-sky-900/40 bg-sky-950/10 rounded-lg p-3.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-200">🆔 BIRD ID (elevar Gov) — antecipado</span>
                            {selectedOS.bird_id_done
                              ? <span className="text-[10px] font-bold text-emerald-400">✓ concluído{selectedOS.bird_id_done_por ? ` por ${selectedOS.bird_id_done_por}` : ''}</span>
                              : <span className="text-[10px] text-slate-500">resp.: {selectedOS.resp_certificacao || '—'}</span>
                            }
                          </div>
                          {isEarlyBirdEligible && (
                            <>
                              <p className="text-[10px] text-slate-500">
                                Cliente ainda em Complemento Cadastral (E2). Você já pode iniciar a certificação BIRD ID em paralelo — não é preciso esperar o E2 terminar.
                              </p>
                              {/* Mesmos campos do pfQuickCard (T3) — vínculo e-commerce,
                                  NUNCA telefone/e-mail pessoal do cliente (16º achado da
                                  skill: o e-CPF usa o que o terceiro atribui, não o que o
                                  captador cadastrou). Este painel antecipado (T2) tem seu
                                  próprio bloco JSX, em outra closure — não dava pra
                                  reaproveitar a constante `pfQuickCard` (definida só no
                                  bloco T3, mais abaixo), por isso replicado aqui. */}
                              <div className="flex flex-col gap-1.5 border border-slate-800 rounded-lg p-2.5 bg-slate-950/40">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">👤 Pessoa Física</span>
                                <div className="text-[11px] flex flex-col gap-1">
                                  <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Nome</span><span className="text-slate-200 flex-1 break-all">{selectedOS.client_name}</span><CopyButton value={selectedOS.client_name} keepSpaces /></div>
                                  <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">CPF</span><span className="text-slate-200 flex-1">{selectedOS.cpf}</span><CopyButton value={selectedOS.cpf} /></div>
                                  <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Gov.br</span><GovChip level={selectedOS.gov_level} /></div>
                                  <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">E-mail Emp.</span><span className="text-slate-200 flex-1 break-all">{selectedOS.t2_new_email || '—'}</span>{selectedOS.t2_new_email && <CopyButton value={selectedOS.t2_new_email} />}</div>
                                  <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Chip</span><span className="text-slate-200 flex-1">{selectedOS.t2_new_phone || '—'}</span>{selectedOS.t2_new_phone && <CopyButton value={selectedOS.t2_new_phone} />}</div>
                                  <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Aparelho</span><span className="text-slate-200 flex-1">{selectedOS.cert_aparelho || '—'}</span>{selectedOS.cert_aparelho && <CopyButton value={selectedOS.cert_aparelho} />}</div>
                                </div>
                              </div>
                              <button type="button" onClick={() => completeSubStep('bird')} className="bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs py-2 rounded-lg">Concluir BIRD ID</button>
                            </>
                          )}
                          {/* Dados de acesso à certificação — mesmo formulário do painel de
                              T3, disponível já em T2 (era invisível até a OS avançar). */}
                          <div className="flex flex-col gap-2.5 border-t border-slate-800/60 pt-2.5 mt-1">
                            <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">🔐 Dados de Acesso à Certificação</h5>
                            {/* "Certificadora" (texto livre) saiu do formulário: o
                                seletor Sistema usado ao lado já identifica quem
                                está certificando, e o campo duplicado confundia
                                quem preenche. O dado continua existindo e sendo
                                exibido só-leitura onde OS antigas já o têm. */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div className="flex gap-1.5">
                                {(['BIRD ID', 'Syngular'] as const).map((sistema) => (
                                  <button
                                    key={sistema}
                                    type="button"
                                    onClick={() => setCertForm((f) => ({ ...f, cert_sistema_usado: sistema }))}
                                    className={`flex-1 text-xs font-bold rounded-lg p-2.5 border transition-colors ${certForm.cert_sistema_usado === sistema ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}
                                  >
                                    {sistema}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <input
                              type="text" value={certForm.cert_aparelho}
                              onChange={(e) => setCertForm((f) => ({ ...f, cert_aparelho: e.target.value }))}
                              placeholder="Aparelho/celular utilizado (ex.: Aparelho 50)"
                              className="text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                            />
                            <input
                              type="email" value={certForm.cert_email}
                              onChange={(e) => setCertForm((f) => ({ ...f, cert_email: e.target.value }))}
                              placeholder="E-mail do certificado (interno, diferente do e-mail pessoal do cliente)"
                              className="text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                            />

                            {/* Senha do e-mail do certificado — mesmo bloco do
                                painel T3 (24/07/2026, gap real: esta cópia
                                antecipada nunca teve os 2 campos de senha nem
                                o botão "Usar do vínculo", só existiam no
                                painel de T3). */}
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-semibold text-slate-500">Senha do e-mail do certificado</span>
                              {certEmailSenhaRevealed ? (
                                <div className="flex items-center gap-2 bg-slate-950 border border-slate-850 rounded px-2.5 py-2">
                                  <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedCertEmailSenha || '(vazia)'}</span>
                                  <CopyButton value={revealedCertEmailSenha} />
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <input
                                    type={showTypedCertEmailSenha ? 'text' : 'password'} autoComplete="new-password" value={certForm.cert_email_senha}
                                    onChange={(e) => setCertForm((f) => ({ ...f, cert_email_senha: e.target.value }))}
                                    placeholder={selectedOS.has_cert_email_senha ? '•••••••• (definir nova)' : 'Definir senha'}
                                    className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                                  />
                                  <button type="button" onClick={() => setShowTypedCertEmailSenha((v) => !v)} title={showTypedCertEmailSenha ? 'Esconder digitação' : 'Mostrar digitação'} className="text-[10px] text-slate-400 hover:text-slate-200 font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-2 rounded whitespace-nowrap">{showTypedCertEmailSenha ? '🙈' : '👁'}</button>
                                  {selectedOS.has_cert_email_senha && (
                                    <button type="button" onClick={() => handleRevealCertField('cert_email_senha')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-2 rounded whitespace-nowrap">👁️ Revelar</button>
                                  )}
                                  {!selectedOS.has_cert_email_senha && selectedOS.has_t2_new_email_senha && (
                                    <button type="button" onClick={handleUseSenhaVinculo} title="Copia a senha já cadastrada pelo terceiro no vínculo e-commerce" className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold bg-emerald-950/30 hover:bg-emerald-950/60 border border-emerald-900/30 px-2.5 py-2 rounded whitespace-nowrap">🔗 Usar do vínculo</button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Senha de acesso ao certificado (app) */}
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] font-semibold text-slate-500">Senha de acesso ao certificado (app)</span>
                              {certSenhaAcessoRevealed ? (
                                <div className="flex items-center gap-2 bg-slate-950 border border-slate-850 rounded px-2.5 py-2">
                                  <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedCertSenhaAcesso || '(vazia)'}</span>
                                  <CopyButton value={revealedCertSenhaAcesso} />
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <input
                                    type={showTypedCertSenhaAcesso ? 'text' : 'password'} autoComplete="new-password" value={certForm.cert_senha_acesso}
                                    onChange={(e) => setCertForm((f) => ({ ...f, cert_senha_acesso: e.target.value }))}
                                    placeholder={selectedOS.has_cert_senha_acesso ? '•••••••• (definir nova)' : 'Definir senha'}
                                    className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                                  />
                                  <button type="button" onClick={() => setShowTypedCertSenhaAcesso((v) => !v)} title={showTypedCertSenhaAcesso ? 'Esconder digitação' : 'Mostrar digitação'} className="text-[10px] text-slate-400 hover:text-slate-200 font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-2 rounded whitespace-nowrap">{showTypedCertSenhaAcesso ? '🙈' : '👁'}</button>
                                  {selectedOS.has_cert_senha_acesso && (
                                    <button type="button" onClick={() => handleRevealCertField('cert_senha_acesso')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-2 rounded whitespace-nowrap">👁️ Revelar</button>
                                  )}
                                </div>
                              )}
                            </div>

                            <button type="button" onClick={handleSaveCertAccess} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs py-2 rounded-lg">Salvar Dados de Acesso</button>
                            <p className="text-[9px] text-rose-400/80 font-semibold">⚠️ Visualizações de senha são auditadas e gravadas na trilha de segurança.</p>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* 0. SE ESTÁ EM CAPTADOS (triagem inicial) */}
                {selectedOS.current_step === 'captacao' && canWorkStep('captacao') && (
                  <div className="flex flex-col gap-4">
                    <div className="border border-slate-700/50 bg-slate-900/40 p-4 rounded-lg">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">Caixa de Entrada — Triagem</h4>
                      <p className="text-xs text-slate-400">
                        Captação registrada por <b className="text-slate-200">{selectedOS.captured_by || '—'}</b>. Revise os documentos e envie para a análise de risco (E1) iniciar a tratativa.
                      </p>
                    </div>
                    <button
                      onClick={handleEnviarParaT1}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-3 rounded-lg transition-transform active:scale-[0.98]"
                    >
                      🛡️ Iniciar Análise de Risco (enviar para E1)
                    </button>
                  </div>
                )}

                {/* 1. SE SETOR FOR T1 (RISCO) */}
                {selectedOS.current_step === 't1' && canWorkStep('t1') && (
                  <div className="flex flex-col gap-4">
                    <div className="border border-rose-900/30 bg-rose-950/10 p-4 rounded-lg">
                      <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wide mb-2">Painel de Validação de Risco</h4>
                      <p className="text-xs text-slate-400">Verifique os documentos do cliente. Esta decisão definirá se a OS segue para o cadastro.</p>
                    </div>

                    <div className="flex flex-col gap-3 text-xs bg-slate-900 p-4 border border-slate-800 rounded-lg">
                      <h5 className="font-semibold text-slate-300">Checklist Risco Padrão</h5>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={t1Checklist.processos} 
                          onChange={(e) => setT1Checklist({ ...t1Checklist, processos: e.target.checked })}
                          className="rounded border-slate-800 text-sky-600 focus:ring-sky-500 bg-slate-950 w-4 h-4"
                        />
                        <span>Isento de Processos Criminais/Fraude</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={t1Checklist.beneficios} 
                          onChange={(e) => setT1Checklist({ ...t1Checklist, beneficios: e.target.checked })}
                          className="rounded border-slate-800 text-sky-600 focus:ring-sky-500 bg-slate-950 w-4 h-4"
                        />
                        <span>Checagem de Benefícios Governamentais Conflitantes</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={t1Checklist.financeiro} 
                          onChange={(e) => setT1Checklist({ ...t1Checklist, financeiro: e.target.checked })}
                          className="rounded border-slate-800 text-sky-600 focus:ring-sky-500 bg-slate-950 w-4 h-4"
                        />
                        <span>Restrições Financeiras Impeditivas Controladas</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={t1Checklist.redes} 
                          onChange={(e) => setT1Checklist({ ...t1Checklist, redes: e.target.checked })}
                          className="rounded border-slate-800 text-sky-600 focus:ring-sky-500 bg-slate-950 w-4 h-4"
                        />
                        <span>Redes Sociais sem atos nocivos de imagem</span>
                      </label>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-slate-400">Evidência / Justificativa</label>
                      <textarea 
                        value={t1Justification} 
                        onChange={(e) => setT1Justification(e.target.value)}
                        placeholder="Insira as observações sobre a análise de risco criminais/sociais..."
                        className="w-full text-xs bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-200 h-20 outline-none focus:border-sky-500 resize-none" 
                      />
                    </div>

                    {/* Projeto obrigatório antes de aprovar (03/08/2026, pedido do
                        gestor): o seletor "📁 Projeto" já aparece acima nesta
                        mesma aba (bloco isManager) — aqui só avisa/trava. Sem
                        projeto definido, a OS nasceria invisível pra qualquer
                        conta terceiro com isolamento por projeto. */}
                    {!selectedOS.projeto && (
                      <p className="text-[10px] text-amber-400 font-semibold -mt-1">
                        ⚠️ Defina o projeto da OS (seção "📁 Projeto" acima) antes de aprovar — sem isso ela não fica visível para o parceiro terceiro.
                      </p>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                      <button
                        onClick={() => handleT1Decision('vermelho')}
                        disabled={!t1Justification.trim()}
                        title={!t1Justification.trim() ? 'Preencha a justificativa acima antes de recusar' : undefined}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-2.5 rounded-lg transition-transform active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        🔴 Recusar (E1 Vermelho)
                      </button>
                      <button
                        onClick={() => handleT1Decision('verde')}
                        disabled={!selectedOS.projeto}
                        title={!selectedOS.projeto ? 'Defina o projeto da OS antes de aprovar' : undefined}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg transition-transform active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                      >
                        🟢 Aprovar (E1 Verde)
                      </button>
                    </div>
                  </div>
                )}

                {/* 2. SE SETOR FOR T2 (COMPLEMENTO CADASTRO) */}
                {selectedOS.current_step === 't2' && canWorkStep('t2') && (
                  <form onSubmit={handleT2Submit} className="flex flex-col gap-4">
                    <div className="border border-amber-900/30 bg-amber-950/10 p-4 rounded-lg">
                      <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-2">Complemento Cadastral Operacional</h4>
                      <p className="text-xs text-slate-400">Preencha o e-mail, chip e endereço onde a empresa será aberta para prosseguirmos.</p>
                    </div>

                    {/* Endereço de abertura da empresa fica no bloco "Dados da Abertura
                        (Ordem de Serviço)" abaixo (campo empresa_endereco) — são campos
                        distintos (pessoa física ≠ endereço de abertura da empresa). Só
                        pede o endereço pessoal do cliente aqui quando ele ainda não
                        existe E é obrigatório (nível Prata, usado no Bird ID). Removido
                        o bloco de referência com "Usar este endereço" que existia antes:
                        gerava confusão real (operador achava que era o campo pra
                        preencher o endereço da empresa). */}
                    {!selectedOS.address && selectedOS.gov_level === 'prata' && (
                      <div className="flex flex-col gap-1.5 border border-amber-900/30 bg-amber-950/10 rounded-lg p-2.5">
                        <label className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
                          Endereço do cliente — obrigatório no nível Prata (usado no Bird ID)
                        </label>
                        <input
                          type="text"
                          value={t2ClientAddress}
                          onChange={(e) => setT2ClientAddress(e.target.value)}
                          placeholder="Rua, Número, Bairro, Cidade - UF"
                          className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-amber-500"
                        />
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-400">Novo E-mail da Empresa (Provisório/Chip)</label>
                      <input 
                        type="email" 
                        value={t2Email} 
                        onChange={(e) => setT2Email(e.target.value)}
                        required
                        placeholder="contato.empresa@provedor.com"
                        className="w-full text-xs bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-200 outline-none focus:border-sky-500" 
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-slate-400">Novo Número/Chip para Empresa</label>
                      <input 
                        type="tel" 
                        value={t2Phone} 
                        onChange={(e) => setT2Phone(e.target.value)}
                        required
                        placeholder="(00) 90000-0000"
                        className="w-full text-xs bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-200 outline-none focus:border-sky-500" 
                      />
                    </div>

                    <EmpresaAberturaFields empresa={empresa} setEmpresa={setEmpresa} checklist={aberturaChecklist} setChecklist={setAberturaChecklist} />

                    <button
                      type="submit"
                      className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs py-3 rounded-lg mt-2 transition-transform active:scale-[0.98]"
                    >
                      {selectedOS.gov_level === 'prata' ? '🚀 Salvar e Avançar para BIRD ID' : '🚀 Salvar e Avançar para Abertura'}
                    </button>
                  </form>
                )}

                {/* 3. SE SETOR FOR T3/T4 (CERTIFICAÇÃO E ABERTURA MANUAL) — também
                    renderiza com a OS já 'finalizado'. BUG REAL (corrigido):
                    esse bloco é o ÚNICO lugar do sistema que mostra os dados de
                    acesso ao BIRD ID/SYNC (e-CPF) e o arquivo do Certificado A1
                    (e-CNPJ) — ao restringir a condição só a current_step==='t3',
                    TODA empresa aberta perdia esse dado permanentemente assim que
                    era finalizada (current_step vira 'finalizado'), pra qualquer
                    papel, em qualquer dispositivo. canWorkStep('t3') é chamado
                    com a string fixa 't3' (não olha o step real da OS), então
                    liberar aqui não muda quem pode AGIR — os botões de concluir
                    já ficam escondidos sozinhos porque birdDone/aberturaDone/
                    a1Done já são true numa OS finalizada de verdade. */}
                {(selectedOS.current_step === 't3' || selectedOS.current_step === 'finalizado') && canWorkStep('t3') && (() => {
                  const isPrata = selectedOS.gov_level === 'prata';
                  const birdDone = !!selectedOS.bird_id_done;
                  const aberturaDone = !!selectedOS.abertura_done;
                  const a1Done = !!selectedOS.a1_done;
                  // A1 libera com o produto da abertura que o certificador precisa:
                  // cartão CNPJ + Certidão de Inteiro Teor anexados (não o checklist).
                  const a1Ready = a1ReadyOf(selectedOS);
                  const mineT3 = (assignedField?: string) => !assignedField || assignedField === currentOperator;
                  const canDoCert = isManager || ((currentRole === 'operador_certificacao') && mineT3(selectedOS.resp_certificacao));
                  const canDoAbertura = isManager || ((currentRole === 'operador_abertura') && mineT3(selectedOS.resp_abertura));
                  const stepBox = (active: boolean, done: boolean) =>
                    `flex flex-col gap-2 border rounded-lg p-3 ${done ? 'border-emerald-900/50 bg-emerald-950/10' : active ? 'border-sky-900/40 bg-sky-950/10' : 'border-slate-800 bg-slate-900/30 opacity-60'}`;
                  const doneBadge = <span className="text-[10px] font-bold text-emerald-400">✓ concluído</span>;
                  // Referência rápida de dados, contextual por sub-etapa — evita o
                  // operador ter que sair pra aba Documentos no meio do trabalho.
                  // BIRD ID (e-CPF) trabalha com a PESSOA; A1 (e-CNPJ) trabalha com a
                  // EMPRESA; Abertura lida com as duas (precisa do CPF do sócio pra
                  // registrar a empresa, e vai construindo os dados da PJ).
                  // isCertLimited segue existindo só pro pjQuickCard (endereço da
                  // empresa oculto pro certificador, ver mais abaixo).
                  const isCertLimited = currentRole === 'operador_certificacao';
                  // pfQuickCard — pedido explícito do gestor (18/07/2026, caso real:
                  // prints mostrando e-mail pessoal do cliente, tipo
                  // "eduardocristianralston06@gmail.com", ao lado do botão "Concluir
                  // BIRD ID"): nem o BIRD ID/SYNC (e-CPF) nem a Abertura usam
                  // e-mail/telefone PESSOAL do cliente (cadastrado pelo captador) —
                  // o e-CPF usa o vínculo e-commerce (e-mail/chip atribuídos pelo
                  // terceiro), e mostrar o pessoal ali induzia o operador a usar o
                  // dado errado. Antes só o certificador (isCertLimited) via o
                  // vínculo aqui; os outros papéis (inclusive operador_abertura, que
                  // usa o MESMO pfQuickCard no card "Abertura da Empresa" logo
                  // abaixo) continuavam vendo Tel./E-mail pessoal. Unificado: agora
                  // TODO mundo que abre BIRD ID ou Abertura vê Nome/CPF/Gov.br +
                  // vínculo e-commerce (e-mail/chip/aparelho) — não tem mais ramo
                  // condicional por papel. Se o vínculo ainda não foi definido pelo
                  // terceiro, os campos mostram "—" (auto-preenchem sozinhos assim
                  // que o terceiro salvar, sem precisar de lógica nova — o card só
                  // lê o valor já salvo no dossiê).
                  const pfQuickCard = (
                    <div className="flex flex-col gap-1.5 border border-slate-800 rounded-lg p-2.5 bg-slate-950/40">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">👤 Pessoa Física</span>
                      <div className="text-[11px] flex flex-col gap-1">
                        <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Nome</span><span className="text-slate-200 flex-1 break-all">{selectedOS.client_name}</span><CopyButton value={selectedOS.client_name} keepSpaces /></div>
                        <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">CPF</span><span className="text-slate-200 flex-1">{selectedOS.cpf}</span><CopyButton value={selectedOS.cpf} /></div>
                        <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Gov.br</span><GovChip level={selectedOS.gov_level} /></div>
                        <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">E-mail Emp.</span><span className="text-slate-200 flex-1 break-all">{selectedOS.t2_new_email || '—'}</span>{selectedOS.t2_new_email && <CopyButton value={selectedOS.t2_new_email} />}</div>
                        <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Chip</span><span className="text-slate-200 flex-1">{selectedOS.t2_new_phone || '—'}</span>{selectedOS.t2_new_phone && <CopyButton value={selectedOS.t2_new_phone} />}</div>
                        <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Aparelho</span><span className="text-slate-200 flex-1">{selectedOS.cert_aparelho || '—'}</span>{selectedOS.cert_aparelho && <CopyButton value={selectedOS.cert_aparelho} />}</div>
                      </div>
                    </div>
                  );
                  const pjQuickCard = (
                    <div className="flex flex-col gap-1.5 border border-slate-800 rounded-lg p-2.5 bg-slate-950/40">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">🏢 Pessoa Jurídica</span>
                      {(selectedOS.cnpj_number || selectedOS.empresa_nome) ? (
                        <div className="text-[11px] flex flex-col gap-1">
                          {selectedOS.cnpj_number && (
                            <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">CNPJ</span><span className="text-slate-200 flex-1 font-mono">{selectedOS.cnpj_number}</span><CopyButton value={selectedOS.cnpj_number} /></div>
                          )}
                          {selectedOS.empresa_nome && (
                            <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Razão</span><span className="text-slate-200 flex-1">{selectedOS.empresa_nome}</span><CopyButton value={selectedOS.empresa_nome} keepSpaces /></div>
                          )}
                          {selectedOS.nome_fantasia && (
                            <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Fantasia</span><span className="text-slate-200 flex-1">{selectedOS.nome_fantasia}</span><CopyButton value={selectedOS.nome_fantasia} keepSpaces /></div>
                          )}
                          {!isCertLimited && selectedOS.empresa_endereco && (
                            <div className="flex items-center gap-2"><span className="text-slate-500 w-16 shrink-0">Endereço</span><span className="text-slate-200 flex-1">{selectedOS.empresa_endereco}</span><CopyButton value={selectedOS.empresa_endereco} keepSpaces /></div>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">Aguardando CNPJ gerado na Abertura.</p>
                      )}
                    </div>
                  );
                  // Abertura não tinha indicador de QUEM concluiu (só o check genérico) —
                  // diferente de BIRD/A1, que já registram *_done_por/_done_em.
                  const aberturaDoneBadge = (
                    <span
                      className="text-[10px] font-bold text-emerald-400"
                      title={selectedOS.abertura_done_em ? `Concluído em ${new Date(selectedOS.abertura_done_em).toLocaleString('pt-BR')}` : undefined}
                    >
                      ✓ concluído{selectedOS.abertura_done_por ? ` por ${selectedOS.abertura_done_por}` : ''}
                    </span>
                  );

                  const aberturaStep = (active: boolean) => (
                    <div className={stepBox(active, aberturaDone)}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">🏢 Abertura da Empresa</span>
                        {aberturaDone ? aberturaDoneBadge : <span className="text-[10px] text-slate-500">resp.: {selectedOS.resp_abertura || '—'}</span>}
                      </div>
                      {!aberturaDone && active && !canDoAbertura && (
                        <p className="text-[10px] text-slate-500 italic">Aguardando equipe de abertura.</p>
                      )}
                      {!aberturaDone && active && canDoAbertura && (
                        <>
                          {pfQuickCard}
                          {pjQuickCard}
                          <div className="flex items-center gap-2">
                            <input
                              type="text" value={t3Cnpj}
                              onChange={(e) => setT3Cnpj(formatCNPJ(e.target.value))}
                              onBlur={() => autoFillFromCnpj(t3Cnpj)}
                              placeholder="Nº do CNPJ gerado (00.000.000/0001-00)"
                              className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                            />
                            {cnpjFetching && <span className="text-[10px] text-sky-400 shrink-0">Buscando...</span>}
                          </div>
                          {/* Trava de ordem (24/07/2026, pedido explícito —
                              caso real: "empresas abertas com cartão CNPJ
                              anexado mas o campo CNPJ vazio"): antes dava
                              pra anexar o Cartão CNPJ (upload independente,
                              sem tocar em nenhum outro campo) sem nunca ter
                              digitado o número — a OS ficava presa sem
                              ninguém perceber o motivo. Anexar fica
                              bloqueado até `t3Cnpj` (o campo acima) estar
                              preenchido — reduz falha humana, não depende
                              de lembrar de clicar "Salvar Dados" antes. */}
                          <FileAttach
                            dossierId={selectedOS.id}
                            field="cnpj_comprovante_url"
                            label="Cartão"
                            currentUrl={selectedOS.cnpj_comprovante_url}
                            operator={currentOperator}
                            onUploaded={() => { handleSelectOS(selectedOS, { keepView: true }); autoFillFromCnpj(t3Cnpj); }}
                            disabled={!t3Cnpj.trim()}
                            disabledMessage="Preencha o número do CNPJ acima antes de anexar o cartão."
                          />
                          <FileAttach dossierId={selectedOS.id} field="inscricao_municipal_url" label="Inscrição Municipal" currentUrl={selectedOS.inscricao_municipal_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="inscricao_estadual_url" label="Inscrição Estadual" currentUrl={selectedOS.inscricao_estadual_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="opcao_simples_url" label="Opção do Simples Nacional" currentUrl={selectedOS.opcao_simples_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          <FileAttach dossierId={selectedOS.id} field="certidao_inteiro_teor_url" label="Certidão" currentUrl={selectedOS.certidao_inteiro_teor_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} />
                          {!t3Cnpj.trim() && (
                            <p className="text-[10px] text-amber-500 italic">Preencha o número do CNPJ acima antes de concluir — o certificador precisa dele pra emitir o A1.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => completeSubStep('abertura')}
                            disabled={!t3Cnpj.trim()}
                            className="bg-sky-600 hover:bg-sky-700 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-bold text-xs py-2 rounded-lg"
                          >
                            Concluir Abertura
                          </button>
                        </>
                      )}
                    </div>
                  );

                  const a1Step = (active: boolean) => (
                    <div className={stepBox(active, a1Done)}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">📜 Certificado A1</span>
                        {a1Done ? doneBadge : <span className="text-[10px] text-slate-500">resp.: {selectedOS.resp_certificacao || '—'}</span>}
                      </div>
                      {!a1Done && !active && (
                        <p className="text-[10px] text-slate-500 italic">⏸ Aguardando: BIRD ID/SYNC (e-CPF) concluído + cartão CNPJ e Certidão de Inteiro Teor anexados.</p>
                      )}
                      {!a1Done && active && !canDoCert && (
                        <p className="text-[10px] text-slate-500 italic">Aguardando equipe de certificação.</p>
                      )}
                      {/* O anexo do A1 fica disponível pra corrigir mesmo DEPOIS de
                          concluído (não só antes) — caso real: OS marcada como A1
                          concluído sem o arquivo (bug antigo de outra sessão), sem
                          nenhum jeito de corrigir porque o FileAttach só existia
                          gated por !a1Done. Mesmo padrão já usado em "Dados de
                          Acesso à Certificação" (BIRD), que nunca teve essa trava.
                          `a1Done || active` (não só `active`): se os pré-requisitos
                          de liberação (a1ReadyOf) não computam mais como prontos —
                          ex.: cnpj_comprovante_url/certidao_inteiro_teor_url também
                          ausentes pelo mesmo bug antigo — um A1 JÁ concluído não
                          pode voltar a ficar bloqueado pra edição; a checagem de
                          "pronto pra começar" só faz sentido antes de concluir. */}
                      {(a1Done || active) && canDoCert && (
                        <>
                          {pjQuickCard}
                          <FileAttach dossierId={selectedOS.id} field="certificado_a1_url" label="Certificado A1 — e-CNPJ (.zip com pfx + senha)" currentUrl={selectedOS.certificado_a1_url} operator={currentOperator} onUploaded={() => handleSelectOS(selectedOS, { keepView: true })} sendOriginalName downloadName={certificadoA1FileName(selectedOS.empresa_nome, selectedOS.certificado_a1_nome, selectedOS.certificado_a1_url)} accept="" />
                          {/* Botão de correção pontual (24/07/2026): só
                              aparece quando o arquivo já anexado tem
                              extensão suspeita (.bin/.pfx, sintoma do bug
                              de mime já corrigido) — renomeia sem reenviar,
                              baseado na assinatura real do arquivo. */}
                          {(currentRole === 'gestor' || currentRole === 'admin') &&
                            /\.(bin|pfx)$/i.test(selectedOS.certificado_a1_url || '') && (
                            <button
                              type="button"
                              onClick={handleFixA1Extension}
                              title="O arquivo já anexado pode ter sido salvo com a extensão errada (bug antigo). Isso verifica o conteúdo real e corrige só o nome, sem precisar reenviar."
                              className="text-xs font-bold text-amber-400 hover:text-amber-300 bg-amber-950/20 hover:bg-amber-950/40 border border-amber-900/40 py-2 rounded-lg"
                            >
                              🔧 Corrigir extensão do arquivo (.{selectedOS.certificado_a1_url?.split('.').pop()} → real)
                            </button>
                          )}
                          {!a1Done && <button type="button" onClick={() => completeSubStep('a1')} className="bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs py-2 rounded-lg">Concluir A1</button>}
                        </>
                      )}
                    </div>
                  );

                  const birdStep = (active: boolean) => (
                    <div className={stepBox(active, birdDone)}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">🆔 BIRD ID (elevar Gov)</span>
                        {birdDone ? doneBadge : <span className="text-[10px] text-slate-500">resp.: {selectedOS.resp_certificacao || '—'}</span>}
                      </div>
                      {!birdDone && active && !canDoCert && (
                        <p className="text-[10px] text-slate-500 italic">Aguardando equipe de certificação.</p>
                      )}
                      {!birdDone && active && canDoCert && (
                        <>
                          {pfQuickCard}
                          <button type="button" onClick={() => completeSubStep('bird')} className="bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs py-2 rounded-lg">Concluir BIRD ID</button>
                        </>
                      )}
                    </div>
                  );

                  return (
                    <div className="flex flex-col gap-4">
                      <div className="border border-sky-900/30 bg-sky-950/10 p-4 rounded-lg">
                        <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wide mb-2">Certificação & Abertura</h4>
                        <p className="text-xs text-slate-400">
                          {isPrata
                            ? '👉 Prata: sequência BIRD ID/SYNC (e-CPF) → Abertura → A1 (e-CNPJ).'
                            : '👉 Ouro: BIRD ID/SYNC (e-CPF) e Abertura em paralelo — o A1 (e-CNPJ) libera só depois dos dois concluídos.'}
                        </p>
                      </div>

                      {/* Pedido do usuário: dados de PF/PJ contextuais por sub-etapa
                          (pfQuickCard/pjQuickCard acima) — agora aparecem direto aqui,
                          dentro de cada box, pra não obrigar o operador a sair pra
                          aba Documentos no meio do trabalho. */}

                      {/* Diretório de Contadores Contex.
                          • Certificador (operador_certificacao): NÃO vê — não atua na abertura.
                          • Operador de abertura: vê SÓ o contador responsável por esta OS,
                            recolhido por padrão e expansível ao clicar.
                          • Gestor/admin/T3-T4: diretório completo. */}
                      {currentRole !== 'operador_certificacao' && (() => {
                        const isAbertura = currentRole === 'operador_abertura';
                        const lista = isAbertura
                          ? CONTADORES_INFO.filter((c) => c.label === selectedOS.contador_abertura)
                          : CONTADORES_INFO;

                        const card = (c: typeof CONTADORES_INFO[number]) => (
                          <div key={c.key} className="flex flex-col gap-1 border border-slate-800 rounded-lg p-2.5 bg-slate-900/50">
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-100 flex-1">{c.nome}</span><CopyButton value={c.nome} keepSpaces /></div>
                            <div className="flex items-center gap-2 text-[11px]"><span className="text-slate-500 w-14 shrink-0">CRC</span><span className="text-slate-300 flex-1 font-mono">{c.crc}</span><CopyButton value={c.crc} /></div>
                            <div className="flex items-center gap-2 text-[11px]"><span className="text-slate-500 w-14 shrink-0">CPF</span><span className="text-slate-300 flex-1 font-mono">{c.cpf}</span><CopyButton value={c.cpf} /></div>
                            <div className="flex items-center gap-2 text-[11px]"><span className="text-slate-500 w-14 shrink-0">E-mail</span><span className="text-slate-300 flex-1 break-all">{c.email}</span><CopyButton value={c.email} /></div>
                            <div className="flex items-center gap-2 text-[11px]"><span className="text-slate-500 w-14 shrink-0">Telefone</span><span className="text-slate-300 flex-1">{c.telefone}</span><CopyButton value={c.telefone} /></div>
                            <div className="flex items-center gap-2 text-[11px]"><span className="text-slate-500 w-14 shrink-0">Endereço</span><span className="text-slate-300 flex-1">{c.endereco}</span><CopyButton value={c.endereco} /></div>
                          </div>
                        );

                        // Operador de abertura sem contador definido pelo gestor.
                        if (isAbertura && lista.length === 0) {
                          return (
                            <div className="border border-amber-900/30 bg-amber-950/10 rounded-lg p-3">
                              <h5 className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">🧾 Contador Responsável</h5>
                              <p className="text-[11px] text-slate-500 italic mt-1">Aguardando o gestor definir o contador responsável por esta abertura.</p>
                            </div>
                          );
                        }

                        // Operador de abertura: recolhido, expande ao clicar — só o contador da OS.
                        if (isAbertura) {
                          return (
                            <div className="border border-amber-900/30 bg-amber-950/10 rounded-lg p-3 flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => setContadorAbertOpen((o) => !o)}
                                className="flex items-center justify-between w-full text-left"
                              >
                                <h5 className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">🧾 Contador Responsável: {lista[0].nome}</h5>
                                <span className="text-[10px] text-amber-400/70 shrink-0">{contadorAbertOpen ? '▲ ocultar' : '▼ ver dados'}</span>
                              </button>
                              {contadorAbertOpen && <div className="flex flex-col gap-2.5">{lista.map(card)}</div>}
                            </div>
                          );
                        }

                        // Gestor/admin/T3-T4: colapsível; mostra só o contador desta OS
                        // (se atribuído) ou a lista completa caso não haja nenhum.
                        const listaGestor = selectedOS.contador_abertura
                          ? CONTADORES_INFO.filter((c) => c.label === selectedOS.contador_abertura)
                          : CONTADORES_INFO;
                        const headerLabel = selectedOS.contador_abertura && listaGestor.length > 0
                          ? `🧾 Contador: ${listaGestor[0].nome}`
                          : '🧾 Contadores Responsáveis (Contex)';
                        return (
                          <div className="flex flex-col gap-2 border border-amber-900/30 bg-amber-950/10 rounded-lg p-3">
                            <button
                              type="button"
                              onClick={() => setContadorAbertOpen((o) => !o)}
                              className="flex items-center justify-between w-full text-left"
                            >
                              <h5 className="text-[11px] font-bold text-amber-400 uppercase tracking-wide">{headerLabel}</h5>
                              <span className="text-[10px] text-amber-400/70 shrink-0">{contadorAbertOpen ? '▲ ocultar' : '▼ ver dados'}</span>
                            </button>
                            {contadorAbertOpen && <div className="flex flex-col gap-2.5">{listaGestor.map(card)}</div>}
                          </div>
                        );
                      })()}

                      {/* Atribuição de responsáveis (gestor/admin) — clique na lista, salva imediatamente */}
                      {(currentRole === 'gestor' || currentRole === 'admin') && (
                        <div className="flex flex-col gap-3 border border-slate-800 bg-slate-900/40 rounded-lg p-3">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Atribuir Responsáveis</h5>
                          <ResponsibleSelect
                            label="Responsável Certificação (BIRD/A1)"
                            value={respCert}
                            options={operatorsList.filter(u => u.active && ['operador_certificacao', 'gestor', 'admin'].includes(u.role)).map(u => u.name)}
                            onSelect={(name) => { setRespCert(name); updateDossierStatus(selectedOS!.id, { resp_certificacao: name }); }}
                          />
                          <ResponsibleSelect
                            label="Responsável Abertura"
                            value={respAbertura}
                            options={operatorsList.filter(u => u.active && ['operador_abertura', 'gestor', 'admin'].includes(u.role)).map(u => u.name)}
                            onSelect={(name) => { setRespAbertura(name); updateDossierStatus(selectedOS!.id, { resp_abertura: name }); }}
                          />
                        </div>
                      )}

                      {/* Classificação de Projeto pra gestor/admin já existe no topo da
                          aba Trabalho (bloco "📁 Projeto", fora deste IIFE de T3/T4) —
                          removida a duplicata que existia aqui (pedido do gestor: só
                          selecionar projeto já criado dentro da OS; criar/gerenciar
                          projeto agora é só na tela dedicada "📁 Projetos"). */}
                      {/* Exibe projeto para outros papéis (read-only) */}
                      {!(currentRole === 'gestor' || currentRole === 'admin') && selectedOS.projeto && (
                        <div className="flex items-center gap-2 border border-emerald-900/30 bg-emerald-950/10 rounded-lg p-3">
                          <span className="text-[11px] font-bold text-emerald-400">📁 Projeto:</span>
                          <span className="text-xs font-semibold text-emerald-300">{selectedOS.projeto}</span>
                        </div>
                      )}

                      {/* Agendamento de certificação (gestor/admin definem; certificador vê).
                          Não faz sentido oferecer reagendar uma OS já finalizada. */}
                      {(currentRole === 'gestor' || currentRole === 'admin') && selectedOS.current_step !== 'finalizado' && (
                        <div className="flex flex-col gap-2 border border-sky-900/30 bg-sky-950/10 rounded-lg p-3">
                          <h5 className="text-[11px] font-bold text-sky-400 uppercase tracking-wide">📅 Agendar Certificação</h5>
                          <DateTimePicker value={agendamentoCert} onChange={setAgendamentoCert} />
                          <button type="button" onClick={handleSaveAgendamento} className="bg-sky-700 hover:bg-sky-600 text-white font-bold text-xs py-2 rounded-lg">Salvar Agendamento</button>
                          {selectedOS.agendamento_cert && (
                            <p className="text-[10px] text-emerald-400">✓ Agendado: {new Date(selectedOS.agendamento_cert).toLocaleString('pt-BR')}</p>
                          )}
                        </div>
                      )}
                      {currentRole === 'operador_certificacao' && selectedOS.agendamento_cert && (
                        <div className="border border-sky-900/30 bg-sky-950/10 rounded-lg p-3">
                          <p className="text-xs text-sky-300 font-semibold">📅 Agendamento: {new Date(selectedOS.agendamento_cert).toLocaleString('pt-BR')}</p>
                        </div>
                      )}

                      {/* Pedido do gestor: operador de abertura deve enxergar os dados do
                          BIRD ID/SYNC (e-CPF) — NUNCA os do A1 (e-CNPJ), que continua
                          restrito à equipe de certificação. Somente leitura (não edita os
                          campos), mas PODE revelar as senhas (estendido a pedido do
                          gestor — cada revelação continua gerando log de auditoria, mesmo
                          endpoint /reveal usado por certificador/gestor/terceiro). */}
                      {!canDoCert && currentRole === 'operador_abertura' && (selectedOS.cert_certificadora || selectedOS.cert_sistema_usado || selectedOS.cert_aparelho || selectedOS.cert_email || selectedOS.has_cert_email_senha || selectedOS.has_cert_senha_acesso || birdDone) && (
                        <div className="flex flex-col gap-2 border border-slate-800 bg-slate-900/40 rounded-lg p-3.5">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">🆔 Dados do BIRD ID/SYNC (e-CPF) — somente leitura</h5>
                          <div className="text-[11px] flex flex-col gap-1">
                            {birdDone && <div className="flex items-center gap-2"><span className="text-slate-500 w-24 shrink-0">Status</span><span className="text-emerald-400 font-bold flex-1">✓ concluído{selectedOS.bird_id_done_por ? ` por ${selectedOS.bird_id_done_por}` : ''}</span></div>}
                            {selectedOS.cert_sistema_usado && <div className="flex items-center gap-2"><span className="text-slate-500 w-24 shrink-0">Sistema</span><span className="text-slate-200 flex-1">{selectedOS.cert_sistema_usado}</span></div>}
                            {selectedOS.cert_certificadora && <div className="flex items-center gap-2"><span className="text-slate-500 w-24 shrink-0">Certificadora</span><span className="text-slate-200 flex-1">{selectedOS.cert_certificadora}</span></div>}
                            {selectedOS.cert_aparelho && <div className="flex items-center gap-2"><span className="text-slate-500 w-24 shrink-0">Aparelho</span><span className="text-slate-200 flex-1">{selectedOS.cert_aparelho}</span></div>}
                            {selectedOS.cert_email && <div className="flex items-center gap-2"><span className="text-slate-500 w-24 shrink-0">E-mail</span><span className="text-slate-200 flex-1 break-all">{selectedOS.cert_email}</span></div>}
                          </div>
                          {selectedOS.has_cert_email_senha && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 w-24 shrink-0 text-[11px]">Senha e-mail</span>
                              {certEmailSenhaRevealed ? (
                                <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedCertEmailSenha || '(vazia)'}</span>
                              ) : (
                                <button type="button" onClick={() => handleRevealCertField('cert_email_senha')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-1.5 rounded">👁️ Revelar</button>
                              )}
                            </div>
                          )}
                          {selectedOS.has_cert_senha_acesso && (
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 w-24 shrink-0 text-[11px]">Senha do app</span>
                              {certSenhaAcessoRevealed ? (
                                <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedCertSenhaAcesso || '(vazia)'}</span>
                              ) : (
                                <button type="button" onClick={() => handleRevealCertField('cert_senha_acesso')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-1.5 rounded">👁️ Revelar</button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Dados de acesso à certificação — centraliza o que hoje fica na planilha do certificador */}
                      {canDoCert && (
                        <div className="flex flex-col gap-2.5 border border-slate-800 bg-slate-900/40 rounded-lg p-3.5">
                          <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">🔐 Dados de Acesso à Certificação</h5>

                          {/* "Certificadora" (texto livre) saiu do formulário — o
                              seletor Sistema usado ao lado já identifica quem
                              está certificando. Ver o mesmo comentário no painel
                              BIRD antecipado (T2), que tem sua própria cópia. */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="flex gap-1.5">
                              {(['BIRD ID', 'Syngular'] as const).map((sistema) => (
                                <button
                                  key={sistema}
                                  type="button"
                                  onClick={() => setCertForm((f) => ({ ...f, cert_sistema_usado: sistema }))}
                                  className={`flex-1 text-xs font-bold rounded-lg p-2.5 border transition-colors ${certForm.cert_sistema_usado === sistema ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}
                                >
                                  {sistema}
                                </button>
                              ))}
                            </div>
                          </div>

                          <input
                            type="text" value={certForm.cert_aparelho}
                            onChange={(e) => setCertForm((f) => ({ ...f, cert_aparelho: e.target.value }))}
                            placeholder="Aparelho/celular utilizado (ex.: Aparelho 50)"
                            className="text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                          />

                          <input
                            type="email" value={certForm.cert_email}
                            onChange={(e) => setCertForm((f) => ({ ...f, cert_email: e.target.value }))}
                            placeholder="E-mail do certificado (interno, diferente do e-mail pessoal do cliente)"
                            className="text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                          />

                          {/* Senha do e-mail do certificado */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-slate-500">Senha do e-mail do certificado</span>
                            {certEmailSenhaRevealed ? (
                              <div className="flex items-center gap-2 bg-slate-950 border border-slate-850 rounded px-2.5 py-2">
                                <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedCertEmailSenha || '(vazia)'}</span>
                                <CopyButton value={revealedCertEmailSenha} />
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type={showTypedCertEmailSenha ? 'text' : 'password'} autoComplete="new-password" value={certForm.cert_email_senha}
                                  onChange={(e) => setCertForm((f) => ({ ...f, cert_email_senha: e.target.value }))}
                                  placeholder={selectedOS.has_cert_email_senha ? '•••••••• (definir nova)' : 'Definir senha'}
                                  className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                                />
                                <button type="button" onClick={() => setShowTypedCertEmailSenha((v) => !v)} title={showTypedCertEmailSenha ? 'Esconder digitação' : 'Mostrar digitação'} className="text-[10px] text-slate-400 hover:text-slate-200 font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-2 rounded whitespace-nowrap">{showTypedCertEmailSenha ? '🙈' : '👁'}</button>
                                {selectedOS.has_cert_email_senha && (
                                  <button type="button" onClick={() => handleRevealCertField('cert_email_senha')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-2 rounded whitespace-nowrap">👁️ Revelar</button>
                                )}
                                {!selectedOS.has_cert_email_senha && selectedOS.has_t2_new_email_senha && (
                                  <button type="button" onClick={handleUseSenhaVinculo} title="Copia a senha já cadastrada pelo terceiro no vínculo e-commerce" className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold bg-emerald-950/30 hover:bg-emerald-950/60 border border-emerald-900/30 px-2.5 py-2 rounded whitespace-nowrap">🔗 Usar do vínculo</button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Senha de acesso ao certificado (app) */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold text-slate-500">Senha de acesso ao certificado (app)</span>
                            {certSenhaAcessoRevealed ? (
                              <div className="flex items-center gap-2 bg-slate-950 border border-slate-850 rounded px-2.5 py-2">
                                <span className="text-emerald-400 font-mono text-xs font-bold flex-1 break-all">{revealedCertSenhaAcesso || '(vazia)'}</span>
                                <CopyButton value={revealedCertSenhaAcesso} />
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  type={showTypedCertSenhaAcesso ? 'text' : 'password'} autoComplete="new-password" value={certForm.cert_senha_acesso}
                                  onChange={(e) => setCertForm((f) => ({ ...f, cert_senha_acesso: e.target.value }))}
                                  placeholder={selectedOS.has_cert_senha_acesso ? '•••••••• (definir nova)' : 'Definir senha'}
                                  className="flex-1 text-xs bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
                                />
                                <button type="button" onClick={() => setShowTypedCertSenhaAcesso((v) => !v)} title={showTypedCertSenhaAcesso ? 'Esconder digitação' : 'Mostrar digitação'} className="text-[10px] text-slate-400 hover:text-slate-200 font-bold bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2.5 py-2 rounded whitespace-nowrap">{showTypedCertSenhaAcesso ? '🙈' : '👁'}</button>
                                {selectedOS.has_cert_senha_acesso && (
                                  <button type="button" onClick={() => handleRevealCertField('cert_senha_acesso')} className="text-[10px] text-sky-400 hover:text-sky-300 font-bold bg-sky-950/30 hover:bg-sky-950/60 border border-sky-900/30 px-2.5 py-2 rounded whitespace-nowrap">👁️ Revelar</button>
                                )}
                              </div>
                            )}
                          </div>

                          <button type="button" onClick={handleSaveCertAccess} className="bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs py-2 rounded-lg mt-1">💾 Salvar Dados de Acesso</button>
                          <p className="text-[9px] text-rose-400/80 font-semibold">⚠️ Visualizações de senha são auditadas e gravadas na trilha de segurança.</p>
                        </div>
                      )}

                      {/* Recusar documentos — certificador pode rejeitar e criar tarefa de correção */}
                      {(currentRole === 'operador_certificacao') && (
                        <button
                          type="button"
                          onClick={() => setCertRejectModal({ open: true, reason: '' })}
                          className="bg-rose-950/40 hover:bg-rose-900/50 border border-rose-700/40 text-rose-400 font-bold text-xs py-2.5 rounded-lg transition-colors"
                        >
                          🚫 Recusar Documentos
                        </button>
                      )}

                      {/* Sub-etapas — filtradas por papel */}
                      {currentRole === 'operador_abertura' ? (
                        <div className="flex flex-col gap-2">
                          {aberturaStep(true)}
                        </div>
                      ) : currentRole === 'operador_certificacao' ? (
                        <div className="flex flex-col gap-2">
                          {birdStep(true)}
                          {a1Step(a1Ready)}
                        </div>
                      ) : isPrata ? (
                        <div className="flex flex-col gap-2">
                          {birdStep(true)}
                          {aberturaStep(birdDone)}
                          {a1Step(a1Ready)}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {birdStep(true)}
                          {aberturaStep(true)}
                          {a1Step(a1Ready)}
                        </div>
                      )}

                      {canDoAbertura && (
                        <EmpresaAberturaFields empresa={empresa} setEmpresa={setEmpresa} checklist={aberturaChecklist} setChecklist={setAberturaChecklist} readOnly={!isManager} />
                      )}

                      {canDoAbertura && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button type="button" onClick={handleSaveEmpresa} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs py-2.5 rounded-lg">💾 Salvar Dados</button>
                          <a href={`/api/dossiers/${selectedOS.id}/os-abertura?by=${encodeURIComponent(currentOperator)}`} className="flex items-center justify-center gap-1.5 bg-emerald-700/80 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg">📄 Baixar OS (.docx)</a>
                        </div>
                      )}
                      <a href={`/api/dossiers/${selectedOS.id}/files-zip?by=${encodeURIComponent(currentOperator)}`} className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs py-2.5 rounded-lg">🗜️ Baixar todos os anexos (.zip)</a>
                    </div>
                  );
                })()}

                {/* 4. SE PROCESSO ESTÁ FINALIZADO */}
                {selectedOS.current_step === 'finalizado' && (
                  <div className="flex flex-col gap-4 text-center py-6">
                    <span className="text-5xl">🏆</span>
                    <h4 className="font-bold text-emerald-400 text-lg">Processo Concluído!</h4>
                    <p className="text-xs text-slate-400 px-6">Esta OS foi devidamente homologada, o CNPJ foi vinculado e o dossiê da empresa está fechado e pronto para a contabilidade mensal.</p>
                    <div className="text-xs bg-slate-900/60 p-3 border border-slate-800 rounded-md text-left mt-2 flex flex-col gap-1.5">
                      {selectedOS.protocolo && (
                        <div className="flex items-center gap-2"><span className="text-slate-500 font-medium flex-1">Protocolo:</span> <b className="text-emerald-400 font-mono">{selectedOS.protocolo}</b><CopyButton value={selectedOS.protocolo} /></div>
                      )}
                      <div className="flex items-center gap-2"><span className="text-slate-500 font-medium flex-1">CNPJ:</span> <span className="text-slate-200">{selectedOS.cnpj_number}</span><CopyButton value={selectedOS.cnpj_number} /></div>
                      <div className="flex items-center gap-2"><span className="text-slate-500 font-medium flex-1">Email Empresa:</span> <span className="text-slate-200 break-all">{selectedOS.t2_new_email}</span><CopyButton value={selectedOS.t2_new_email} /></div>
                      <div className="flex items-center gap-2"><span className="text-slate-500 font-medium flex-1">Número (vínculo e-commerce):</span> <span className="text-slate-200">{selectedOS.t2_new_phone}</span><CopyButton value={selectedOS.t2_new_phone} /></div>
                    </div>
                    <a
                      href={`/api/dossiers/${selectedOS.id}/os-abertura?by=${encodeURIComponent(currentOperator)}`}
                      className="flex items-center justify-center gap-1.5 bg-emerald-700/80 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 rounded-lg mt-2 transition-transform active:scale-[0.98]"
                    >
                      📄 Baixar Ordem de Serviço de Abertura (.docx)
                    </a>
                    <a
                      href={`/api/dossiers/${selectedOS.id}/files-zip?by=${encodeURIComponent(currentOperator)}`}
                      className="flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold text-xs py-2.5 rounded-lg mt-2"
                    >
                      🗜️ Baixar todos os anexos (.zip)
                    </a>
                  </div>
                )}

              </div>
            )}

            {/* TAB 4: TRILHA DE AUDITORIA IMUTÁVEL */}
            {activeTab === 'auditoria' && (
              <div className="flex flex-col gap-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Linha do Tempo de Atividades</h4>
                
                {selectedOSLogs.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-4">Sem registros ainda.</p>
                ) : (
                  <div className="flex flex-col gap-3 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-800">
                    {selectedOSLogs.map(log => (
                      <div key={log.id} className="text-xs flex gap-3 relative pl-6">
                        {/* Dot */}
                        <span className={`absolute left-1.5 top-1.5 w-1.5 h-1.5 rounded-full ${
                          log.action_type === 'GOV_PASSWORD_REVEALED' 
                            ? 'bg-rose-500 ring-4 ring-rose-950/40' 
                            : log.action_type === 'COMPANY_OPENED' 
                            ? 'bg-emerald-500 ring-4 ring-emerald-950/40' 
                            : 'bg-slate-500'
                        }`} />
                        
                        <div className="flex flex-col">
                          <p className="text-[10px] text-slate-500 font-bold">
                            {new Date(log.created_at).toLocaleString('pt-BR')}
                          </p>
                          <span className="font-semibold text-slate-300 mt-0.5">{log.details}</span>
                          <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Executor: {log.user_name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            )}

            {/* TAB 5: TAREFAS INTERNAS */}
            {activeTab === 'tarefas' && (
              <div className="flex flex-col gap-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Tarefas desta OS</h4>

                {/* Formulário nova tarefa */}
                {currentRole !== 'captador' && currentRole !== 'terceiro' && (
                  <div className="flex flex-col gap-2 border border-violet-900/30 bg-violet-950/10 rounded-lg p-3">
                    <h5 className="text-[11px] font-bold text-violet-400 uppercase tracking-wide">Nova Tarefa</h5>
                    <div className="flex flex-col gap-2">
                      <select
                        value={newTaskTo}
                        onChange={(e) => setNewTaskTo(e.target.value)}
                        className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-violet-500"
                      >
                        <option value="">Enviar para...</option>
                        {/* Captador desta OS aparece destacado no topo — caso real
                            reportado: tarefa foi enviada pro captador errado porque
                            a lista misturava todo mundo sem indicar quem é o dono
                            desta OS especificamente. */}
                        {selectedOS?.captured_by && operatorsList.some(u => u.active && u.name === selectedOS.captured_by) && (
                          <option value={selectedOS.captured_by}>📸 {selectedOS.captured_by} — Captador desta OS</option>
                        )}
                        {operatorsList.filter(u => u.active && u.name !== currentOperator && u.name !== selectedOS?.captured_by).map(u => (
                          <option key={u.name} value={u.name}>{u.name} — {ROLE_LABELS[u.role] ?? u.role}</option>
                        ))}
                      </select>
                      <textarea
                        value={newTaskText}
                        onChange={(e) => setNewTaskText(e.target.value)}
                        placeholder="Descreva a tarefa..."
                        rows={3}
                        className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-violet-500 resize-none"
                      />
                      <button
                        type="button"
                        disabled={!newTaskTo || !newTaskText.trim()}
                        onClick={async () => {
                          if (!selectedOS || !newTaskTo || !newTaskText.trim()) return;
                          const res = await fetch(`/api/dossiers/${selectedOS.id}/tasks`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ to_user: newTaskTo, text: newTaskText }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setOsTasks(prev => [data.task, ...prev]);
                            setNewTaskText('');
                            setNewTaskTo('');
                          }
                        }}
                        className="text-xs font-bold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
                      >
                        Enviar Tarefa
                      </button>
                    </div>
                  </div>
                )}

                {/* Lista de tarefas */}
                {osTasks.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">Nenhuma tarefa registrada.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {osTasks.map((task) => (
                      <div key={task.id} className={`border rounded-lg p-3 flex flex-col gap-1.5 ${task.done ? 'border-slate-800 bg-slate-900/20 opacity-60' : 'border-violet-800/40 bg-violet-950/10'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-col gap-0.5 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold text-violet-400">{task.from_user}</span>
                              {operatorsList.find(u => u.name === task.from_user)?.role && (
                                <span className="text-[9px] text-violet-600 bg-violet-950/30 px-1 rounded">{ROLE_LABELS[operatorsList.find(u => u.name === task.from_user)!.role]?.replace(/^[^\s]+\s/, '') ?? ''}</span>
                              )}
                              <span className="text-[10px] text-slate-500">→</span>
                              <span className="text-[10px] font-bold text-sky-400">{task.to_user}</span>
                              {operatorsList.find(u => u.name === task.to_user)?.role && (
                                <span className="text-[9px] text-sky-600 bg-sky-950/30 px-1 rounded">{ROLE_LABELS[operatorsList.find(u => u.name === task.to_user)!.role]?.replace(/^[^\s]+\s/, '') ?? ''}</span>
                              )}
                              <span className="text-[10px] text-slate-600">• {new Date(task.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="text-xs text-slate-200 leading-snug">{task.text}</p>
                            {task.done && task.done_by && (
                              <p className="text-[10px] text-emerald-400">✓ Concluído por {task.done_by}</p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            {!task.done && task.to_user === currentOperator && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!selectedOS) return;
                                  const res = await fetch(`/api/dossiers/${selectedOS.id}/tasks/${task.id}`, { method: 'PATCH' });
                                  if (res.ok) setOsTasks(prev => prev.map(t => t.id === task.id ? { ...t, done: true, done_by: currentOperator } : t));
                                }}
                                className="text-[10px] font-bold bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-600/30 text-emerald-400 px-2 py-1 rounded transition-colors"
                              >
                                ✓ Concluir
                              </button>
                            )}
                            {!task.done && task.to_user !== currentOperator && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!selectedOS) return;
                                  const mensagem = prompt(`Cobrar ${task.to_user} sobre esta tarefa. Mensagem (opcional):`) || '';
                                  const res = await fetch(`/api/dossiers/${selectedOS.id}/tasks/${task.id}/cobrar`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ mensagem }),
                                  });
                                  if (res.ok) alert(`${task.to_user} foi cobrado(a) sobre esta tarefa.`);
                                }}
                                className="text-[10px] font-bold bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/20 text-amber-400 px-2 py-1 rounded transition-colors"
                              >
                                🔔 Cobrar
                              </button>
                            )}
                            {/* Pedido do gestor: apagar tarefa criada por engano — só
                                gestor/admin, funciona pra tarefa pendente ou já concluída. */}
                            {(currentRole === 'gestor' || currentRole === 'admin') && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!selectedOS) return;
                                  if (!confirm('Apagar esta tarefa? Não pode ser desfeito.')) return;
                                  const res = await fetch(`/api/dossiers/${selectedOS.id}/tasks/${task.id}`, { method: 'DELETE' });
                                  if (res.ok) setOsTasks(prev => prev.filter(t => t.id !== task.id));
                                }}
                                className="text-[10px] font-bold bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/20 text-rose-400 px-2 py-1 rounded transition-colors"
                              >
                                🗑️ Apagar
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 6: EDIÇÃO RÁPIDA (gestor/admin) */}
            {activeTab === 'editar' && (currentRole === 'gestor' || currentRole === 'admin') && (() => {
              const EDIT_LABELS: Record<string, string> = {
                client_name: 'Nome', cpf: 'CPF', phone: 'WhatsApp', email: 'E-mail', address: 'Endereço',
                gov_level: 'Nível Gov.br', empresa_nome: 'Razão Social', nome_fantasia: 'Nome Fantasia',
                empresa_endereco: 'Endereço da Empresa', cnpj_number: 'CNPJ', cnae: 'CNAE', capital_social: 'Capital Social',
                t2_new_email: 'E-mail Empresa (T2)', t2_new_phone: 'Chip/Número E-commerce (T2)',
                cert_aparelho: 'Cód. Aparelho', regime_tributario: 'Regime Tributário',
                status: 'Status', current_step: 'Etapa',
                assigned_to: 'Responsável OS', captured_by: 'Captador', protocolo: 'Protocolo',
                resp_certificacao: 'Resp. Certificação', resp_abertura: 'Resp. Abertura',
              };
              const handleSave = async () => {
                if (!selectedOS) return;
                const payload: Record<string, string> = {};
                const changed: string[] = [];
                const allFields = Object.keys(EDIT_LABELS);
                for (const k of allFields) {
                  const newVal = gestorEdit[k]?.trim() ?? '';
                  const oldVal = ((selectedOS as unknown as Record<string, unknown>)[k] as string | undefined) ?? '';
                  if (newVal && newVal !== oldVal) {
                    payload[k] = newVal;
                    changed.push(`${EDIT_LABELS[k]}: "${oldVal || '—'}" → "${newVal}"`);
                  }
                }
                // Sem esta mensagem, "Salvar Alterações" sem nenhum campo mudado
                // ficava mudo — parecia que o clique não tinha feito nada.
                if (Object.keys(payload).length === 0) {
                  alert('Nenhuma alteração para salvar — os campos já estão com os valores atuais.');
                  return;
                }
                const summary = `[EDIÇÃO DIRETA] ${changed.join(' | ')}`;
                // updateDossierStatus já alerta sozinha em caso de falha — esta tela
                // nunca dava nenhuma confirmação de SUCESSO (relato real do gestor:
                // editava e salvava sem nenhuma mensagem, achando que tinha travado).
                const ok = await updateDossierStatus(selectedOS.id, { ...payload, field_edit_summary: summary });
                if (ok) alert('Alterações salvas com sucesso.');
              };

              return (
                <div className="flex flex-col gap-5">
                  <div className="border border-amber-900/30 bg-amber-950/10 p-3 rounded-lg">
                    <p className="text-xs text-amber-400">Edição direta auditada. Toda alteração é registrada na trilha da OS. Campos não alterados podem ser deixados com o valor atual.</p>
                  </div>

                  {/* Pessoa Física */}
                  <div className="border border-slate-800 bg-slate-900/30 p-4 rounded-lg flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">👤 Pessoa Física</h4>
                    {(['client_name','cpf','phone','email','address'] as const).map((key) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{EDIT_LABELS[key]}</label>
                        <input
                          type="text"
                          value={gestorEdit[key] ?? ''}
                          onChange={e => {
                            const v = key === 'cpf' ? formatCPF(e.target.value) : key === 'phone' ? formatPhoneBR(e.target.value) : e.target.value;
                            setGestorEdit(prev => ({ ...prev, [key]: v }));
                          }}
                          className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500"
                        />
                      </div>
                    ))}
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Nível Gov.br</label>
                      <select
                        value={gestorEdit.gov_level ?? 'prata'}
                        onChange={e => setGestorEdit(prev => ({ ...prev, gov_level: e.target.value }))}
                        className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500"
                      >
                        <option value="prata">🥈 Prata (Requer Bird ID)</option>
                        <option value="ouro">🥇 Ouro (Abertura Direta)</option>
                      </select>
                    </div>
                  </div>

                  {/* Pessoa Jurídica */}
                  <div className="border border-slate-800 bg-slate-900/30 p-4 rounded-lg flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">🏢 Pessoa Jurídica</h4>
                    {(['empresa_nome','nome_fantasia','empresa_endereco','cnpj_number','cnae','capital_social','regime_tributario'] as const).map((key) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{EDIT_LABELS[key]}</label>
                        <input
                          type="text"
                          value={gestorEdit[key] ?? ''}
                          onChange={e => {
                            const v = key === 'cnpj_number' ? formatCNPJ(e.target.value) : key === 'capital_social' ? formatCurrencyBRL(e.target.value) : e.target.value;
                            setGestorEdit(prev => ({ ...prev, [key]: v }));
                          }}
                          className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Dados T2 (e-commerce) */}
                  <div className="border border-slate-800 bg-slate-900/30 p-4 rounded-lg flex flex-col gap-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">🔗 Vínculo E-commerce (E2)</h4>
                    {(['t2_new_email','t2_new_phone','cert_aparelho'] as const).map((key) => (
                      <div key={key} className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{EDIT_LABELS[key]}</label>
                        <input
                          type="text"
                          value={gestorEdit[key] ?? ''}
                          onChange={e => {
                            const v = key === 't2_new_phone' ? formatPhoneBR(e.target.value) : e.target.value;
                            setGestorEdit(prev => ({ ...prev, [key]: v }));
                          }}
                          className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-amber-500"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Operacional — somente admin */}
                  {currentRole === 'admin' && (
                    <div className="border border-rose-900/30 bg-rose-950/10 p-4 rounded-lg flex flex-col gap-3">
                      <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wide">⚙️ Operacional (Admin)</h4>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Status</label>
                        <select
                          value={gestorEdit.status ?? ''}
                          onChange={e => setGestorEdit(prev => ({ ...prev, status: e.target.value }))}
                          className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-rose-500"
                        >
                          {['captado','t1_pendente','t1_amarelo','t1_verde','t1_vermelho','t2_pendente','t3_abertura','t3_bird_id','t4_a1','finalizado','cancelado'].map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Etapa</label>
                        <select
                          value={gestorEdit.current_step ?? ''}
                          onChange={e => setGestorEdit(prev => ({ ...prev, current_step: e.target.value }))}
                          className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-rose-500"
                        >
                          {['captacao','t1','t2','t3','t4','finalizado'].map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      {(['assigned_to','resp_certificacao','resp_abertura','protocolo'] as const).map((key) => (
                        <div key={key} className="flex flex-col gap-1">
                          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{EDIT_LABELS[key]}</label>
                          <input
                            type="text"
                            value={gestorEdit[key] ?? ''}
                            onChange={e => setGestorEdit(prev => ({ ...prev, [key]: e.target.value }))}
                            className="text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-rose-500"
                          />
                        </div>
                      ))}
                      {/* Captador via select, não texto livre (bug real: duas
                          variantes do mesmo nome — ex. espaço/maiúscula
                          diferente — viravam DOIS captadores distintos na
                          tela "📸 Captadores", que agrupa por igualdade
                          exata de string). Opções = captadores cadastrados
                          (para atribuir corretamente) + qualquer valor de
                          captured_by já em uso hoje (cobre nomes de OS
                          antigas/anteriores ao sistema que não têm login) —
                          nunca perde a opção de setar um nome legado, só
                          evita digitar um novo variante por engano. */}
                      <ResponsibleSelect
                        label={EDIT_LABELS.captured_by}
                        value={gestorEdit.captured_by ?? ''}
                        options={Array.from(new Set([
                          ...operatorsList.filter(u => u.active && u.role === 'captador').map(u => u.name),
                          ...dossiers.filter(d => d.captured_by).map(d => d.captured_by as string),
                        ])).sort((a, b) => a.localeCompare(b))}
                        onSelect={(name) => setGestorEdit(prev => ({ ...prev, captured_by: name }))}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSave}
                    className="text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-lg transition-colors active:scale-[0.98]"
                  >
                    💾 Salvar Alterações
                  </button>
                </div>
              );
            })()}

          </div>

          </aside>
        </>
      )}

    {/* Modal de intervenção do gestor: justificativa para mover etapa */}
    {gestorMoveModal && (
      <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">Intervenção do Gestor</h3>
            <button onClick={() => setGestorMoveModal(null)} className="text-slate-500 hover:text-slate-300 text-lg font-bold">✕</button>
          </div>
          <p className="text-xs text-slate-400">
            Você está movendo a OS de <span className="font-semibold text-slate-200">{selectedOS?.client_name}</span> para a etapa{' '}
            <span className="font-semibold text-sky-400">{STEP_LABELS_NAV[gestorMoveModal.targetStep]}</span>.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Justificativa obrigatória</label>
            <textarea
              autoFocus
              rows={4}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-sky-500"
              placeholder="Descreva o motivo da intervenção..."
              value={gestorMoveModal.justification}
              onChange={e => setGestorMoveModal(prev => prev ? { ...prev, justification: e.target.value } : null)}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setGestorMoveModal(null)}
              className="text-xs px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              disabled={!gestorMoveModal.justification.trim()}
              onClick={() => handleGestorMoveStep(gestorMoveModal.targetStep, gestorMoveModal.justification)}
              className="text-xs px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition-colors"
            >
              Confirmar Mudança de Etapa
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal de recusa de documentos pelo certificador */}
    {certRejectModal.open && (
      <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-rose-400">🚫 Recusar Documentos</h3>
            <button onClick={() => setCertRejectModal({ open: false, reason: '' })} className="text-slate-500 hover:text-slate-300 text-lg font-bold">✕</button>
          </div>
          <div className="bg-rose-950/30 border border-rose-700/30 rounded-lg p-3 flex flex-col gap-1">
            <p className="text-[11px] font-bold text-rose-300 uppercase tracking-wide">Padrão exigido (Decreto 10.278/2020)</p>
            <ul className="text-[11px] text-slate-300 flex flex-col gap-0.5 mt-1 list-none">
              <li>• Formatos aceitos: PDF, JPEG ou PNG</li>
              <li>• Tamanho máximo: 10 MB por arquivo</li>
              <li>• Resolução mínima: 300 DPI</li>
              <li>• RG: frente e verso separados, alinhados, sem cortes</li>
              <li>• CNH: aberta completamente, frente visível, sem dobras</li>
              <li>• Sem borrões, reflexos ou partes cortadas</li>
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Motivo específico da recusa</label>
            <textarea
              autoFocus
              rows={3}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:border-rose-500"
              placeholder="Ex.: RG com brilho/reflexo, documento cortado, resolução baixa..."
              value={certRejectModal.reason}
              onChange={e => setCertRejectModal(prev => ({ ...prev, reason: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setCertRejectModal({ open: false, reason: '' })}
              className="text-xs px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              disabled={!certRejectModal.reason.trim()}
              onClick={handleCertRejectDoc}
              className="text-xs px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition-colors"
            >
              Enviar Recusa ao Captador
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Ajuste de SLA em lote — gestor/admin selecionam várias OS e aplicam
        de uma vez (soma horas ao prazo atual de cada uma, ou define um
        prazo absoluto igual pra todas). */}
    {slaBulkOpen && (
      <SlaBulkModal dossiers={dossiers} onClose={() => setSlaBulkOpen(false)} onApplied={fetchDossiers} />
    )}

    {/* Lixeira — cadastros excluídos (soft-delete), restauráveis por gestor/admin. */}
    {lixeiraOpen && (
      <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200">🗑️ Lixeira — Cadastros Excluídos</h3>
            <button onClick={() => setLixeiraOpen(false)} className="text-slate-500 hover:text-slate-300 text-lg font-bold">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll flex flex-col gap-2">
            {lixeiraLoading ? (
              <p className="text-xs text-slate-500 italic">Carregando...</p>
            ) : lixeiraList.length === 0 ? (
              <p className="text-xs text-slate-500 italic">Nenhum cadastro excluído.</p>
            ) : (
              lixeiraList.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-semibold text-slate-200 truncate">{d.client_name} <span className="text-slate-500 font-normal">— OS #{d.id}</span></span>
                    <span className="text-[11px] text-slate-500">CPF {d.cpf || '—'} · excluído em {d.deleted_at ? new Date(d.deleted_at).toLocaleString('pt-BR') : '—'}</span>
                  </div>
                  <button
                    onClick={() => handleRestoreOS(d.id)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold transition-colors"
                  >
                    ↩️ Restaurar
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )}

    </div>
  );
}

// Converte a chave pública VAPID (base64url) pro formato que PushManager.subscribe
// espera (Uint8Array) — conversão padrão da Web Push API, sem lib externa.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Linha de ativar/desativar notificação push real, dentro do dropdown do
// sino (não é um segundo ícone de sino na barra — isso confundia o usuário
// final, dois "sinos" lado a lado). Diferente do sino in-app: aqui é o
// navegador/SO que mostra a notificação e o badge no ícone com o app
// fechado. Requer o service worker do dashboard (public/sw-dashboard.js) —
// NUNCA intercepta fetch/cache (só push + clique), pra não repetir o
// incidente de cache do public/sw.js do captador.
function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setSupported(true);
    navigator.serviceWorker.register('/sw-dashboard.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    }).catch(() => {});
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register('/sw-dashboard.js');
      const existing = await reg.pushManager.getSubscription();
      if (subscribed && existing) {
        await existing.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        setSubscribed(false);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Permissão de notificação negada. Ative nas configurações do navegador pra usar.');
        return;
      }
      const keyRes = await fetch('/api/push/vapid-public-key');
      if (!keyRes.ok) {
        alert('Notificação push ainda não está configurada no servidor.');
        return;
      }
      const { publicKey } = await keyRes.json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      setSubscribed(true);
    } catch (e) {
      console.error('[push] Falha ao (des)ativar:', e);
      alert('Não foi possível ativar a notificação push agora.');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="w-full flex items-center justify-between px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-400 hover:bg-slate-900/60 transition-colors disabled:opacity-50"
    >
      <span>{subscribed ? 'Notificação push ativada' : 'Ativar notificação push'}</span>
      <span className={`font-bold ${subscribed ? 'text-emerald-400' : 'text-slate-500'}`}>
        {busy ? '...' : subscribed ? 'Desativar' : 'Ativar'}
      </span>
    </button>
  );
}

// Modal de ajuste de SLA em lote (gestor/admin) — seleciona várias OS ativas
// e aplica de uma vez: soma N horas ao prazo atual de cada uma (ou usa "agora"
// se a OS não tiver prazo), ou define um prazo absoluto igual pra todas.
function SlaBulkModal({ dossiers, onClose, onApplied }: { dossiers: Dossier[]; onClose: () => void; onApplied: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'add' | 'absolute'>('add');
  const [hours, setHours] = useState('24');
  const [absolute, setAbsolute] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const q = normalizeSearch(query.trim());
  const candidates = dossiers
    .filter(d => d.current_step !== 'finalizado' && !d.empresa_aberta)
    .filter(d => !q || normalizeSearch(d.client_name).includes(q) || normalizeSearch(d.empresa_nome).includes(q))
    .sort((a, b) => a.client_name.localeCompare(b.client_name));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => setSelected(new Set(candidates.map(d => d.id)));
  const clearSelection = () => setSelected(new Set());

  const apply = async () => {
    if (selected.size === 0) { setMsg('Selecione ao menos uma OS.'); return; }
    if (mode === 'add' && (!hours.trim() || isNaN(Number(hours)))) { setMsg('Informe um número válido de horas.'); return; }
    if (mode === 'absolute' && !absolute) { setMsg('Informe o novo prazo.'); return; }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/dossiers/sla-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selected),
          ...(mode === 'add' ? { add_hours: Number(hours) } : { sla_deadline: absolute }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onApplied();
        onClose();
      } else {
        setMsg(data.error || 'Falha ao aplicar.');
      }
    } catch {
      setMsg('Erro de conexão.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-sky-400">⏱️ Ajuste de SLA em Lote</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg font-bold">✕</button>
        </div>

        <div className="p-6 flex flex-col gap-4 overflow-y-auto thin-scroll">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar OS por nome do cliente ou empresa..."
              className="flex-1 text-sm bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 outline-none focus:border-sky-500"
            />
            <button type="button" onClick={selectAllFiltered} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-2 rounded whitespace-nowrap">Selecionar filtradas</button>
            <button type="button" onClick={clearSelection} className="text-[10px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-2 rounded whitespace-nowrap">Limpar</button>
          </div>

          <div className="border border-slate-800 rounded-lg max-h-64 overflow-y-auto thin-scroll">
            {candidates.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">Nenhuma OS ativa encontrada.</p>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {candidates.map(d => {
                  const sla = computeSla(d);
                  return (
                    <label key={d.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-800/40 cursor-pointer">
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="accent-sky-500" />
                      <span className="text-xs text-slate-200 flex-1 truncate">{d.client_name}{d.empresa_nome ? ` — ${d.empresa_nome}` : ''}</span>
                      <span className={`text-[10px] font-bold ${sla.tone === 'rose' ? 'text-rose-400' : sla.tone === 'amber' ? 'text-amber-400' : 'text-slate-500'}`}>{sla.remainingLabel}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-500">{selected.size} OS selecionada{selected.size === 1 ? '' : 's'}.</p>

          <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode('add')} className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-colors ${mode === 'add' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>Somar horas</button>
              <button type="button" onClick={() => setMode('absolute')} className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-colors ${mode === 'absolute' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>Definir prazo fixo</button>
            </div>
            {mode === 'add' ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="w-24 text-sm bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 outline-none focus:border-sky-500"
                />
                <span className="text-xs text-slate-400">horas adicionadas ao prazo atual de cada OS selecionada (use negativo pra reduzir).</span>
              </div>
            ) : (
              <DateTimePicker value={absolute} onChange={setAbsolute} />
            )}
          </div>

          {msg && <p className="text-xs font-semibold text-rose-400">{msg}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose} className="text-sm font-semibold text-slate-400 hover:text-slate-200 px-4 py-2">Cancelar</button>
          <button
            onClick={apply}
            disabled={busy || selected.size === 0}
            className="bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-sm px-5 py-2 rounded-lg"
          >
            {busy ? 'Aplicando...' : `Aplicar a ${selected.size} OS`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Tela "Log de Acessos" (gestor/admin) — responde "quem acessou, quando, de
// que IP" (SessionLog: login/logout) e "o que essa pessoa fez" (ActivityLog
// global, filtrado por usuário) sem precisar abrir OS por OS. IP e o log de
// sessão só existem a partir da introdução desse recurso — não é retroativo.
function AccessLogView() {
  const [sessionLogs, setSessionLogs] = useState<{ id: string; user_name: string; role: string; action: 'login' | 'logout'; ip_address?: string; created_at: string }[]>([]);
  const [activityLogs, setActivityLogs] = useState<{ id: string; dossier_id: string; user_name: string; action_type: string; details: string; ip_address?: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/session-logs', { cache: 'no-store' }).then(r => r.ok ? r.json() : { logs: [] }),
      fetch('/api/activity-logs', { cache: 'no-store' }).then(r => r.ok ? r.json() : { logs: [] }),
    ]).then(([s, a]) => {
      setSessionLogs(s.logs || []);
      setActivityLogs(a.logs || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const q = normalizeSearch(userFilter.trim());
  const filteredSessions = q ? sessionLogs.filter(l => normalizeSearch(l.user_name).includes(q)) : sessionLogs;
  const filteredActivity = q ? activityLogs.filter(l => normalizeSearch(l.user_name).includes(q)) : activityLogs;

  return (
    <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 bg-slate-900/30 thin-scroll">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">🛡️ Log de Acessos</h2>
          <p className="text-xs text-slate-500">Sessões (login/logout + IP) e ações por usuário — complementa a auditoria por OS.</p>
        </div>
        <input
          type="text"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          placeholder="Filtrar por nome do usuário..."
          className="text-sm bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 outline-none focus:border-sky-500 w-64"
        />
      </div>

      {loading ? (
        <p className="text-xs text-slate-500">Carregando...</p>
      ) : (
        <>
          <div className="bg-slate-900/40 border border-slate-800 rounded-lg overflow-hidden">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3 border-b border-slate-800">Sessões (login/logout)</h3>
            <div className="max-h-80 overflow-y-auto overflow-x-auto thin-scroll">
              {filteredSessions.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Nenhum registro{q ? ' pra esse filtro' : ' ainda — só existe a partir de agora'}.</p>
              ) : (
                <table className="w-full text-xs min-w-[560px]">
                  <thead className="sticky top-0 bg-slate-900/90 backdrop-blur">
                    <tr className="text-left text-slate-500">
                      <th className="px-4 py-2 font-semibold">Usuário</th>
                      <th className="px-4 py-2 font-semibold">Papel</th>
                      <th className="px-4 py-2 font-semibold">Ação</th>
                      <th className="px-4 py-2 font-semibold">IP</th>
                      <th className="px-4 py-2 font-semibold">Quando</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredSessions.map(l => (
                      <tr key={l.id}>
                        <td className="px-4 py-2 text-slate-200 font-semibold">{l.user_name}</td>
                        <td className="px-4 py-2 text-slate-400">{ROLE_LABELS[l.role] ?? l.role}</td>
                        <td className="px-4 py-2">
                          <span className={`font-bold ${l.action === 'login' ? 'text-emerald-400' : 'text-slate-500'}`}>
                            {l.action === 'login' ? '🔓 login' : '🔒 logout'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-slate-300 font-mono">{l.ip_address || '—'}</td>
                        <td className="px-4 py-2 text-slate-500">{new Date(l.created_at).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-lg overflow-hidden">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide px-4 py-3 border-b border-slate-800">Ações (todas as OS)</h3>
            <div className="max-h-[32rem] overflow-y-auto overflow-x-auto thin-scroll">
              {filteredActivity.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Nenhum registro{q ? ' pra esse filtro' : ''}.</p>
              ) : (
                <table className="w-full text-xs min-w-[560px]">
                  <thead className="sticky top-0 bg-slate-900/90 backdrop-blur">
                    <tr className="text-left text-slate-500">
                      <th className="px-4 py-2 font-semibold">Usuário</th>
                      <th className="px-4 py-2 font-semibold">Ação</th>
                      <th className="px-4 py-2 font-semibold">Detalhes</th>
                      <th className="px-4 py-2 font-semibold">OS</th>
                      <th className="px-4 py-2 font-semibold">IP</th>
                      <th className="px-4 py-2 font-semibold">Quando</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredActivity.map(l => (
                      <tr key={l.id}>
                        <td className="px-4 py-2 text-slate-200 font-semibold whitespace-nowrap">{l.user_name}</td>
                        <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{l.action_type}</td>
                        <td className="px-4 py-2 text-slate-300 max-w-md break-words">{l.details}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono">{l.dossier_id || '—'}</td>
                        <td className="px-4 py-2 text-slate-300 font-mono whitespace-nowrap">{l.ip_address || '—'}</td>
                        <td className="px-4 py-2 text-slate-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
