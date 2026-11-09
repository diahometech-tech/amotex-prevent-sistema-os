'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, Spinner } from '@/components/ui/EmptyState';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import type { IndiceReajuste, Reajuste } from '@/lib/db';
import { formatarReais } from '@/lib/financeiro/dinheiro';
import { rotuloCompetencia } from '@/lib/financeiro/cobranca';
import {
  calcularValorNovo, INDICE_LABEL, REAJUSTE_STATUS_LABEL, textoAvisoReajuste, vigenciaPadrao, type ReajustePendente,
} from '@/lib/financeiro/reajuste';
import { CopiarTexto, linkWhatsApp } from './CopiarTexto';

interface Pendente extends ReajustePendente {
  percentual_sugerido: number | null;
  valor_sugerido_centavos: number | null;
}

interface ContatoLite {
  nome: string;
  responsavel_nome?: string;
  responsavel_telefone?: string;
  emails_cobranca?: string;
  responsavel_email?: string;
}

interface Registrado extends Reajuste {
  condominio: ContatoLite | null;
}

interface Dados {
  hoje: string;
  pendentes: Pendente[];
  registrados: Registrado[];
  indices: { valores: Partial<Record<IndiceReajuste, number>>; referencia: Partial<Record<IndiceReajuste, string>>; erro?: string; fonte: string };
  emailAtivo: boolean;
  semDataInicio: number;
}

const STATUS_TONE: Record<Reajuste['status'], BadgeTone> = {
  pendente: 'warning',
  enviado: 'info',
  aceito: 'success',
  recusado: 'neutral',
  adiado: 'navy',
};

function data(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function pct(p: number) {
  return `${p.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Aba "Reajustes": o lembrete de aniversário de contrato que faltava (a
// "torneira pingando" da reunião). 1) quem precisa de reajuste agora, com o %
// sugerido; 2) acompanhamento do que foi registrado até a resposta do cliente.
export function ReajustesTab({ onIrPendencias }: { onIrPendencias: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [definindo, setDefinindo] = useState<Pendente | null>(null);
  const [aviso, setAviso] = useState<Registrado | null>(null);
  const [decidindo, setDecidindo] = useState<{ r: Registrado; acao: 'aceito' | 'recusado' | 'adiado' } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/financeiro/reajustes', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (res.ok) setDados(d);
      else setErro(d.error || 'Não foi possível carregar os reajustes.');
    } catch {
      setErro('Erro de conexão.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar só faz setState depois do fetch
    carregar();
  }, [carregar]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setErro('');
    const res = await fetch(`/api/financeiro/reajustes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(d.error || 'Falha ao atualizar o reajuste.');
      return false;
    }
    await carregar();
    return true;
  };

  if (!dados) {
    return erro ? <p className="text-xs font-semibold text-amx-red-hover">{erro}</p> : <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>;
  }

  const acompanhamento = dados.registrados.filter((r) => r.status === 'pendente' || r.status === 'enviado');
  const historico = dados.registrados.filter((r) => r.status !== 'pendente' && r.status !== 'enviado');

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="font-heading text-[10px] text-amx-muted uppercase tracking-wider w-full sm:w-auto">Índices em 12 meses</p>
        {(['igpm', 'ipca', 'inpc'] as const).map((k) => (
          <div key={k} className="flex items-baseline gap-2">
            <span className="text-xs text-amx-muted">{INDICE_LABEL[k]}</span>
            <span className="text-lg font-bold text-white tabular-nums">{dados.indices.valores[k] !== undefined ? pct(dados.indices.valores[k]!) : '—'}</span>
            {dados.indices.referencia[k] && <span className="text-[11px] text-amx-muted">até {dados.indices.referencia[k]}</span>}
          </div>
        ))}
        <p className="text-[11px] text-amx-muted w-full">{dados.indices.erro ?? `Fonte: ${dados.indices.fonte}.`}</p>
      </Card>

      {erro && <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{erro}</p>}
      {dados.semDataInicio > 0 && (
        <p className="text-xs font-semibold text-amx-amber bg-amx-amber/10 rounded-lg px-3 py-2">
          {dados.semDataInicio} contrato{dados.semDataInicio > 1 ? 's' : ''} sem data de início: não entra{dados.semDataInicio > 1 ? 'm' : ''} no aviso de reajuste.{' '}
          <button type="button" onClick={onIrPendencias} className="underline">Ver o que falta</button>
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-white text-sm normal-case tracking-normal font-semibold">Precisam de reajuste ({dados.pendentes.length})</h2>
        {dados.pendentes.length === 0 ? (
          <p className="text-xs text-amx-muted">Nenhum aniversário de contrato nos próximos 30 dias nem ciclo atrasado.</p>
        ) : (
          dados.pendentes.map((p) => (
            <div key={`${p.condominio_id}-${p.aniversario}`} className="flex items-center gap-x-4 gap-y-2 flex-wrap bg-amx-panel border border-amx-line rounded-[10px] px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-semibold text-white truncate">{p.nome}</p>
                <p className={`text-[11px] font-semibold ${p.dias < 0 ? 'text-amx-red-hover' : 'text-amx-amber'}`}>
                  {p.dias < 0 ? `Aniversário foi em ${data(p.aniversario)} (há ${-p.dias} dias) sem reajuste` : p.dias === 0 ? 'Aniversário hoje' : `Aniversário em ${data(p.aniversario)} (em ${p.dias} dias)`}
                  {' · '}{p.anosDeContrato} ano{p.anosDeContrato > 1 ? 's' : ''} de contrato
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-white tabular-nums">{formatarReais(p.valor_atual_centavos)}</p>
                <p className="text-[11px] text-amx-muted">
                  {p.indice ? INDICE_LABEL[p.indice] : 'índice não informado'}
                  {p.percentual_sugerido !== null ? ` · ${pct(p.percentual_sugerido)} → ${formatarReais(p.valor_sugerido_centavos)}` : ''}
                </p>
              </div>
              <Button size="sm" onClick={() => setDefinindo(p)}>Definir reajuste</Button>
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-white text-sm normal-case tracking-normal font-semibold">Em acompanhamento ({acompanhamento.length})</h2>
        {acompanhamento.length === 0 ? (
          <p className="text-xs text-amx-muted">Nenhum aviso aguardando envio ou resposta.</p>
        ) : (
          acompanhamento.map((r) => (
            <LinhaRegistrado key={r.id} r={r}>
              {r.status === 'pendente' && <Button size="sm" onClick={() => setAviso(r)}>Enviar aviso</Button>}
              {r.status === 'enviado' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setAviso(r)}>Ver aviso</Button>
                  <Button size="sm" onClick={() => setDecidindo({ r, acao: 'aceito' })}>Aplicar</Button>
                  <Button size="sm" variant="secondary" onClick={() => setDecidindo({ r, acao: 'adiado' })}>Adiar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDecidindo({ r, acao: 'recusado' })}>Recusado</Button>
                </>
              )}
            </LinhaRegistrado>
          ))
        )}
      </section>

      {historico.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-white text-sm normal-case tracking-normal font-semibold">Histórico</h2>
          {historico.map((r) => <LinhaRegistrado key={r.id} r={r} />)}
        </section>
      )}

      {dados.pendentes.length === 0 && dados.registrados.length === 0 && dados.semDataInicio === 0 && (
        <EmptyState title="Nada de reajuste por enquanto" description="Os contratos aparecem aqui 30 dias antes do aniversário." />
      )}

      <Modal open={!!definindo} onClose={() => setDefinindo(null)} maxWidth="max-w-md">
        {definindo && (
          <DefinirReajuste
            p={definindo}
            hoje={dados.hoje}
            onClose={() => setDefinindo(null)}
            onSalvo={async () => {
              setDefinindo(null);
              await carregar();
            }}
          />
        )}
      </Modal>

      <Modal open={!!aviso} onClose={() => setAviso(null)} maxWidth="max-w-lg">
        {aviso && (
          <AvisoModal
            r={aviso}
            emailAtivo={dados.emailAtivo}
            onClose={() => setAviso(null)}
            onAcao={async (acao) => {
              const ok = await patch(aviso.id, { acao });
              if (ok) setAviso(null);
            }}
          />
        )}
      </Modal>

      <Modal open={!!decidindo} onClose={() => setDecidindo(null)} maxWidth="max-w-md">
        {decidindo && (
          <Decidir
            r={decidindo.r}
            acao={decidindo.acao}
            onClose={() => setDecidindo(null)}
            onConfirmar={async (observacao) => {
              const ok = await patch(decidindo.r.id, { acao: decidindo.acao, observacao });
              if (ok) setDecidindo(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function LinhaRegistrado({ r, children }: { r: Registrado; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-x-4 gap-y-2 flex-wrap bg-amx-panel border border-amx-line rounded-[10px] px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold text-white truncate">{r.condominio?.nome ?? 'Condomínio'}</p>
        <p className="text-[11px] text-amx-muted">
          Ciclo {data(r.aniversario)} · {pct(r.percentual)} · {formatarReais(r.valor_atual_centavos)} → {formatarReais(r.valor_novo_centavos)} a partir de {rotuloCompetencia(r.vigencia)}
        </p>
        {r.observacao && <p className="text-[11px] text-amx-amber">{r.observacao}</p>}
      </div>
      <Badge tone={STATUS_TONE[r.status]}>{REAJUSTE_STATUS_LABEL[r.status]}</Badge>
      {children && <div className="flex items-center gap-1.5 flex-wrap">{children}</div>}
    </div>
  );
}

function DefinirReajuste({ p, hoje, onClose, onSalvo }: { p: Pendente; hoje: string; onClose: () => void; onSalvo: () => void }) {
  const [percentual, setPercentual] = useState(p.percentual_sugerido !== null ? String(p.percentual_sugerido).replace('.', ',') : '');
  const [vigencia, setVigencia] = useState(vigenciaPadrao(p.aniversario, hoje));
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const num = Number(percentual.replace(',', '.'));
  const valido = percentual.trim() !== '' && Number.isFinite(num) && num >= 0;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErro('');
    const res = await fetch('/api/financeiro/reajustes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condominio_id: p.condominio_id, aniversario: p.aniversario, percentual: num, vigencia, observacao: obs }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) onSalvo();
    else setErro(d.error || 'Falha ao registrar.');
  };

  return (
    <>
      <ModalHeader title="Definir reajuste" subtitle={`${p.nome} · ciclo ${data(p.aniversario)}`} onClose={onClose} />
      <form onSubmit={salvar} className="p-5 flex flex-col gap-4">
        <p className="text-xs text-amx-muted">
          Valor atual {formatarReais(p.valor_atual_centavos)}. {p.indice ? `Contrato pelo ${INDICE_LABEL[p.indice]}` : 'Índice não informado no cadastro'}
          {p.percentual_sugerido !== null ? `: sugestão de ${pct(p.percentual_sugerido)}.` : '.'} Você pode usar outro percentual (negociado) ou 0.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reajuste (%)" required>
            <Input id="rj-pct" inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="3,34" required />
          </Field>
          <Field label="A partir de" hint="Mês da cobrança">
            <Input id="rj-vigencia" type="month" min={hoje.slice(0, 7)} value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
          </Field>
        </div>
        {valido && (
          <p className="text-sm text-white">
            Novo valor: <b className="tabular-nums">{formatarReais(calcularValorNovo(p.valor_atual_centavos, num))}</b>
            <span className="text-amx-muted"> (+{formatarReais(calcularValorNovo(p.valor_atual_centavos, num) - p.valor_atual_centavos)}/mês)</span>
          </p>
        )}
        <Field label="Observação"><Textarea id="rj-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ex.: combinado com o síndico em reunião" /></Field>
        {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !valido}>{busy ? 'Salvando...' : 'Registrar e preparar aviso'}</Button>
        </div>
      </form>
    </>
  );
}

function AvisoModal({
  r, emailAtivo, onClose, onAcao,
}: {
  r: Registrado;
  emailAtivo: boolean;
  onClose: () => void;
  onAcao: (acao: 'enviar_email' | 'marcar_enviado') => void;
}) {
  const c = r.condominio;
  const aviso = textoAvisoReajuste({
    nomeCondominio: c?.nome ?? 'Condomínio', responsavel: c?.responsavel_nome, aniversario: r.aniversario, vigencia: r.vigencia,
    indice: r.indice, percentual: r.percentual, valorAtual: r.valor_atual_centavos, valorNovo: r.valor_novo_centavos,
  });
  const para = c?.emails_cobranca || c?.responsavel_email;
  const zap = linkWhatsApp(c?.responsavel_telefone, aviso.whatsapp);
  return (
    <>
      <ModalHeader title="Aviso de reajuste" subtitle={c?.nome} onClose={onClose} />
      <div className="p-5 flex flex-col gap-3">
        <p className="text-xs text-amx-muted">Para: {para || 'sem e-mail cadastrado'}{c?.responsavel_telefone ? ` · WhatsApp ${c.responsavel_telefone}` : ''}</p>
        <p className="text-xs text-white font-semibold">Assunto: {aviso.assunto}</p>
        <textarea id="aviso-texto" readOnly value={aviso.texto} rows={12} className="w-full text-[13px] bg-amx-panel-2 border border-amx-line rounded-lg p-3 text-white" />
        <div className="flex flex-wrap gap-2">
          <CopiarTexto texto={aviso.texto} rotulo="Copiar texto" alvoId="aviso-texto" />
          {zap && (
            <a href={zap} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-md border border-amx-line text-amx-muted hover:text-white">
              Abrir no WhatsApp
            </a>
          )}
        </div>
        {!emailAtivo && (
          <p className="text-[11px] text-amx-muted">O envio automático por e-mail ainda não está ligado. Copie, envie pelo seu e-mail ou WhatsApp e toque em &quot;Marcar como enviado&quot;.</p>
        )}
        {r.status === 'pendente' && (
          <div className="flex justify-end gap-2 border-t border-amx-line pt-3">
            <Button variant="secondary" onClick={() => onAcao('marcar_enviado')}>Marcar como enviado</Button>
            {emailAtivo && para && <Button onClick={() => onAcao('enviar_email')}>Enviar por e-mail</Button>}
          </div>
        )}
      </div>
    </>
  );
}

function Decidir({
  r, acao, onClose, onConfirmar,
}: {
  r: Registrado;
  acao: 'aceito' | 'recusado' | 'adiado';
  onClose: () => void;
  onConfirmar: (observacao: string) => void;
}) {
  const [obs, setObs] = useState('');
  const titulo = { aceito: 'Aplicar reajuste', recusado: 'Reajuste recusado', adiado: 'Adiar reajuste' }[acao];
  return (
    <>
      <ModalHeader title={titulo} subtitle={r.condominio?.nome} onClose={onClose} />
      <div className="p-5 flex flex-col gap-4">
        {acao === 'aceito' ? (
          <p className="text-sm text-white">
            O valor do contrato passa de {formatarReais(r.valor_atual_centavos)} para <b>{formatarReais(r.valor_novo_centavos)}</b>.
            As cobranças a partir de {rotuloCompetencia(r.vigencia, true)} que ainda não foram enviadas já saem com o valor novo.
          </p>
        ) : (
          <p className="text-sm text-white">O valor do contrato não muda. Registre o motivo para o histórico{acao === 'adiado' ? ' (ex.: "combinado para o próximo ano")' : ''}.</p>
        )}
        <Field label="Observação"><Textarea id="dec-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirmar(obs)}>{acao === 'aceito' ? 'Aplicar novo valor' : 'Confirmar'}</Button>
        </div>
      </div>
    </>
  );
}
