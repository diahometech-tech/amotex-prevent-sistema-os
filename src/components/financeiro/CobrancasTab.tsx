'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import type { Cobranca } from '@/lib/db';
import { formatarCnpj } from '@/lib/financeiro/cnpj';
import { formatarReais } from '@/lib/financeiro/dinheiro';
import {
  FORMAS_PAGAMENTO, rotuloCompetencia, somarMeses, statusEfetivo, STATUS_LABEL,
  type ResumoMes, type StatusEfetivo,
} from '@/lib/financeiro/cobranca';
import { normalizeSearch } from '@/lib/text';
import { STATUS_TONE } from './ContratoCondominio';
import { CopiarTexto } from './CopiarTexto';

interface CondLite {
  id: string;
  nome: string;
  cnpj?: string;
  emails_cobranca?: string;
  responsavel_nome?: string;
}

interface Dados {
  competencia: string;
  hoje: string;
  cobrancas: Cobranca[];
  resumo: ResumoMes;
  aGerar: number;
  semValor: { id: string; nome: string }[];
  condominios: CondLite[];
}

type Filtro = 'abertas' | 'atrasada' | 'paga' | 'isenta' | 'todas';

/** "2026-11-10" → "10/11" (o ano é o da competência na tela). */
function dataBR(iso?: string) {
  if (!iso) return '—';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Aba "Cobranças": o equivalente da aba mensal da planilha — um mês por vez,
// com o resumo no topo e a rotina: gerar o mês, marcar enviada, registrar
// pagamento com comprovante, isentar.
export function CobrancasTab({ competenciaInicial }: { competenciaInicial: string }) {
  const [competencia, setCompetencia] = useState(competenciaInicial);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [busca, setBusca] = useState('');
  const [pagando, setPagando] = useState<Cobranca | null>(null);
  const [editando, setEditando] = useState<Cobranca | null>(null);

  const carregar = useCallback(async (c: string) => {
    setErro('');
    try {
      const res = await fetch(`/api/financeiro/cobrancas?competencia=${c}`, { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setDados(d);
      else setErro(d.error || 'Não foi possível carregar as cobranças.');
    } catch {
      setErro('Erro de conexão.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar só faz setState depois do fetch
    carregar(competencia);
  }, [competencia, carregar]);

  const condPorId = useMemo(() => new Map((dados?.condominios ?? []).map((c) => [c.id, c])), [dados]);

  const linhas = useMemo(() => {
    if (!dados) return [];
    const termo = normalizeSearch(busca.trim());
    return dados.cobrancas
      .map((c) => ({ c, st: statusEfetivo(c, dados.hoje), cond: condPorId.get(c.condominio_id) }))
      .filter(({ st, cond }) => {
        if (filtro === 'abertas' && !['pendente', 'enviada', 'atrasada'].includes(st)) return false;
        if (filtro !== 'abertas' && filtro !== 'todas' && st !== filtro) return false;
        if (termo && !normalizeSearch(`${cond?.nome ?? ''} ${cond?.cnpj ?? ''}`).includes(termo)) return false;
        return true;
      })
      .sort((a, b) => {
        const peso = (s: StatusEfetivo) => ({ atrasada: 0, pendente: 1, enviada: 2, paga: 3, isenta: 4 })[s];
        return peso(a.st) - peso(b.st) || (a.cond?.nome ?? '').localeCompare(b.cond?.nome ?? '', 'pt-BR');
      });
  }, [dados, filtro, busca, condPorId]);

  const gerar = async () => {
    setBusy(true);
    setMsg('');
    setErro('');
    try {
      const res = await fetch('/api/financeiro/cobrancas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competencia }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`${d.criadas} cobrança${d.criadas !== 1 ? 's' : ''} gerada${d.criadas !== 1 ? 's' : ''} para ${rotuloCompetencia(competencia, true)}.`);
        await carregar(competencia);
      } else setErro(d.error || 'Falha ao gerar.');
    } finally {
      setBusy(false);
    }
  };

  const acao = async (id: string, body: Record<string, unknown>) => {
    setErro('');
    const res = await fetch(`/api/financeiro/cobrancas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(d.error || 'Falha ao atualizar a cobrança.');
      return false;
    }
    await carregar(competencia);
    return true;
  };

  const r = dados?.resumo;
  const chips: [Filtro, string, number | undefined][] = [
    ['abertas', 'Em aberto', r ? r.pendentes + r.atrasadas : undefined],
    ['atrasada', 'Atrasadas', r?.atrasadas],
    ['paga', 'Pagas', r?.pagas],
    ['isenta', 'Isentas', r?.isentas],
    ['todas', 'Todas', r?.total],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="secondary" onClick={() => setCompetencia(somarMeses(competencia, -1))} aria-label="Mês anterior">‹</Button>
        <Input id="fin-competencia" type="month" value={competencia} onChange={(e) => e.target.value && setCompetencia(e.target.value)} className="w-auto py-1.5 text-xs" />
        <Button size="sm" variant="secondary" onClick={() => setCompetencia(somarMeses(competencia, 1))} aria-label="Próximo mês">›</Button>
        <h2 className="text-white text-base normal-case tracking-normal font-semibold ml-1">{rotuloCompetencia(competencia, true)}</h2>
        {dados && dados.aGerar > 0 && (
          <Button size="sm" onClick={gerar} disabled={busy} className="sm:ml-auto">
            {busy ? 'Gerando...' : dados.cobrancas.length ? `Gerar ${dados.aGerar} cobrança${dados.aGerar > 1 ? 's' : ''} que falta${dados.aGerar > 1 ? 'm' : ''}` : `Gerar cobranças do mês (${dados.aGerar})`}
          </Button>
        )}
      </div>

      {erro && <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{erro}</p>}
      {msg && <p className="text-xs font-semibold text-amx-green bg-amx-green/10 rounded-lg px-3 py-2">{msg}</p>}
      {dados && dados.semValor.length > 0 && (
        <p className="text-xs font-semibold text-amx-amber bg-amx-amber/10 rounded-lg px-3 py-2">
          {dados.semValor.length} condomínio{dados.semValor.length > 1 ? 's' : ''} ativo{dados.semValor.length > 1 ? 's' : ''} sem valor mensal (não entra{dados.semValor.length > 1 ? 'm' : ''} na cobrança): {dados.semValor.slice(0, 4).map((s) => s.nome).join(', ')}
          {dados.semValor.length > 4 ? '…' : ''}
        </p>
      )}

      {!dados ? (
        <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Previsto" valor={formatarReais(r!.previsto)} />
            <Kpi titulo="Recebido" valor={formatarReais(r!.recebido)} detalhe={`${Math.round(r!.percentualRecebido * 100)}% do previsto`} />
            <Kpi titulo="Em aberto" valor={formatarReais(r!.emAberto)} />
            <Kpi titulo="Atrasado" valor={formatarReais(r!.atrasadoValor)} detalhe={`${r!.atrasadas} cobrança${r!.atrasadas !== 1 ? 's' : ''}`} alerta={r!.atrasadas > 0} />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {chips.map(([v, l, n]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFiltro(v)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  filtro === v ? 'bg-amx-red text-white' : 'border border-amx-line text-amx-muted hover:text-white'
                }`}
              >
                {l}{n !== undefined ? ` · ${n}` : ''}
              </button>
            ))}
            <Input id="fin-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar condomínio ou CNPJ" className="w-full sm:w-64 sm:ml-auto py-1.5 text-xs" />
          </div>

          {dados.cobrancas.length === 0 ? (
            <EmptyState
              title={`Nenhuma cobrança em ${rotuloCompetencia(competencia, true)}`}
              description={dados.aGerar ? 'Toque em "Gerar cobranças do mês" para criar uma por condomínio ativo, com o valor do contrato.' : 'Cadastre o valor mensal dos condomínios para gerar as cobranças.'}
            />
          ) : linhas.length === 0 ? (
            <p className="text-xs text-amx-muted py-6 text-center">Nada neste filtro.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {linhas.map(({ c, st, cond }) => (
                <div key={c.id} className="flex items-center gap-x-4 gap-y-2 flex-wrap bg-amx-panel border border-amx-line rounded-[10px] px-4 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-semibold text-white truncate">{cond?.nome ?? 'Condomínio'}</p>
                    <p className="text-[11px] text-amx-muted truncate">
                      {cond?.cnpj ? formatarCnpj(cond.cnpj) : 'sem CNPJ'}
                      {c.observacao ? ` · ${c.observacao}` : ''}
                    </p>
                  </div>
                  <div className="text-right w-28">
                    <p className="text-sm font-semibold text-white tabular-nums">{formatarReais(c.valor_previsto_centavos)}</p>
                    <p className="text-[11px] text-amx-muted">vence {dataBR(c.vencimento)}</p>
                  </div>
                  <div className="w-36 flex flex-col items-start gap-0.5">
                    <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
                    {st === 'paga' && (
                      <span className="text-[11px] text-amx-muted">
                        {dataBR(c.pago_em)} · {FORMAS_PAGAMENTO.find(([v]) => v === c.forma_pagamento)?.[1]}
                        {c.valor_recebido_centavos !== c.valor_previsto_centavos ? ` · ${formatarReais(c.valor_recebido_centavos)}` : ''}
                      </span>
                    )}
                    {st !== 'paga' && c.enviada_em && <span className="text-[11px] text-amx-muted">enviada {dataBR(c.enviada_em)}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.comprovante_url && (
                      <a href={encodeURI(c.comprovante_url)} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-amx-blue-light hover:text-white px-2">
                        Comprovante
                      </a>
                    )}
                    {cond?.emails_cobranca && st !== 'paga' && st !== 'isenta' && <CopiarTexto texto={cond.emails_cobranca} rotulo="E-mails" />}
                    {(st === 'pendente' || st === 'atrasada') && !c.enviada_em && (
                      <Button size="sm" variant="secondary" onClick={() => acao(c.id, { acao: 'marcar_enviada' })}>Marcar enviada</Button>
                    )}
                    {st !== 'paga' && st !== 'isenta' && <Button size="sm" onClick={() => setPagando(c)}>Registrar pagamento</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEditando(c)}>Mais</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!pagando} onClose={() => setPagando(null)} maxWidth="max-w-md">
        {pagando && (
          <PagamentoForm
            cobranca={pagando}
            nome={condPorId.get(pagando.condominio_id)?.nome ?? ''}
            hoje={dados?.hoje ?? ''}
            onClose={() => setPagando(null)}
            onSalvar={async (body) => {
              const ok = await acao(pagando.id, { acao: 'registrar_pagamento', ...body });
              if (ok) setPagando(null);
              return ok;
            }}
          />
        )}
      </Modal>

      <Modal open={!!editando} onClose={() => setEditando(null)} maxWidth="max-w-md">
        {editando && (
          <EditarCobranca
            cobranca={editando}
            nome={condPorId.get(editando.condominio_id)?.nome ?? ''}
            status={statusEfetivo(editando, dados?.hoje ?? '')}
            onClose={() => setEditando(null)}
            onAcao={async (body) => {
              const ok = await acao(editando.id, body);
              if (ok) setEditando(null);
              return ok;
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function Kpi({ titulo, valor, detalhe, alerta }: { titulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <Card className="p-4 flex flex-col gap-1">
      <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider">{titulo}</p>
      <p className={`text-xl font-bold tabular-nums ${alerta ? 'text-amx-red-hover' : 'text-white'}`}>{valor}</p>
      {detalhe && <p className="text-[11px] text-amx-muted">{detalhe}</p>}
    </Card>
  );
}

function PagamentoForm({
  cobranca, nome, hoje, onClose, onSalvar,
}: {
  cobranca: Cobranca;
  nome: string;
  hoje: string;
  onClose: () => void;
  onSalvar: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [pagoEm, setPagoEm] = useState(hoje);
  const [valor, setValor] = useState((cobranca.valor_previsto_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  const [forma, setForma] = useState<string>('boleto');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const comprovante = arquivo ? await fileToDataUrl(arquivo) : undefined;
    await onSalvar({ pago_em: pagoEm, valor_recebido: valor, forma_pagamento: forma, comprovante });
    setBusy(false);
  };

  return (
    <>
      <ModalHeader title="Registrar pagamento" subtitle={`${nome} · ${rotuloCompetencia(cobranca.competencia, true)}`} onClose={onClose} />
      <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data do pagamento" required>
            <Input id="pag-data" type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} required />
          </Field>
          <Field label="Valor recebido (R$)" required>
            <Input id="pag-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required />
          </Field>
        </div>
        <Field label="Forma de pagamento" required>
          <Select id="pag-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
            {FORMAS_PAGAMENTO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Comprovante" hint="PDF ou foto, até 10 MB. Fica salvo junto da cobrança.">
          <input id="pag-comprovante" type="file" accept="application/pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-xs text-amx-muted file:mr-3 file:rounded-md file:border-0 file:bg-amx-panel-2 file:px-3 file:py-1.5 file:text-white" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Confirmar pagamento'}</Button>
        </div>
      </form>
    </>
  );
}

function EditarCobranca({
  cobranca, nome, status, onClose, onAcao,
}: {
  cobranca: Cobranca;
  nome: string;
  status: StatusEfetivo;
  onClose: () => void;
  onAcao: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [valor, setValor] = useState((cobranca.valor_previsto_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
  const [vencimento, setVencimento] = useState(cobranca.vencimento);
  const [obs, setObs] = useState(cobranca.observacao ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const encerrada = status === 'paga' || status === 'isenta';

  return (
    <>
      <ModalHeader title="Cobrança" subtitle={`${nome} · ${rotuloCompetencia(cobranca.competencia, true)}`} onClose={onClose} />
      <div className="p-5 flex flex-col gap-4">
        {!encerrada && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor previsto (R$)"><Input id="ed-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
              <Field label="Vencimento"><Input id="ed-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></Field>
            </div>
            <Field label="Observação"><Textarea id="ed-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onAcao({ acao: 'editar', valor_previsto: valor, vencimento, observacao: obs })}>Salvar alterações</Button>
            </div>
          </>
        )}
        {status === 'paga' && (
          <Field label="Anexar/trocar comprovante">
            <div className="flex items-center gap-2 flex-wrap">
              <input id="ed-comprovante" type="file" accept="application/pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-xs text-amx-muted file:mr-3 file:rounded-md file:border-0 file:bg-amx-panel-2 file:px-3 file:py-1.5 file:text-white" />
              <Button size="sm" disabled={!arquivo} onClick={async () => arquivo && onAcao({ acao: 'anexar_comprovante', comprovante: await fileToDataUrl(arquivo) })}>Enviar</Button>
            </div>
          </Field>
        )}
        <div className="border-t border-amx-line pt-4 flex flex-wrap gap-2">
          {!encerrada && (
            <Button size="sm" variant="secondary" onClick={() => onAcao({ acao: 'isentar', observacao: obs })}>Isentar este mês</Button>
          )}
          {encerrada && (
            <Button size="sm" variant="danger" onClick={() => onAcao({ acao: 'reabrir' })}>
              Reabrir (desfazer {status === 'paga' ? 'pagamento' : 'isenção'})
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
