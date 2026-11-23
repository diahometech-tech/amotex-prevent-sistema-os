'use client';

// Painel do Condomínio: "Abrir chamado", o que está em andamento (linha do
// tempo) e o cancelamento do próprio chamado dentro da regra de
// src/lib/os-cancelamento.ts. O servidor decide; aqui só se espelha a regra.
import React, { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field, Input, Textarea } from '@/components/ui/Form';
import { Icon } from '@/components/ui/Icon';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { LinhaDoTempoOS } from '@/components/os/LinhaDoTempoOS';
import { useTick } from '@/lib/useTick';
import type { OS } from '@/lib/db';
import { permissaoCancelarChamado } from '@/lib/os-cancelamento';
import { ROTULO_SITUACAO, quandoCurto, situacaoDaOS } from '@/lib/os-linha-do-tempo';

const TOM_SITUACAO = {
  aguardando: 'warning',
  a_caminho: 'info',
  no_local: 'info',
  finalizada: 'success',
  cancelada: 'neutral',
} as const;

const DIAS_RECENTES = 30;

// ===== Abrir chamado =====

export function AbrirChamado({ nomePadrao, onAberto }: { nomePadrao: string; onAberto: (os: OS) => void }) {
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [nome, setNome] = useState(nomePadrao);
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const abrir = () => {
    setDescricao('');
    setNome(nomePadrao);
    setTelefone('');
    setErro('');
    setAberto(true);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (descricao.trim().length < 3) {
      setErro('Conte o que está acontecendo.');
      return;
    }
    setEnviando(true);
    setErro('');
    try {
      const res = await fetch('/api/os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descricao_problema: descricao.trim(),
          solicitante_nome: nome.trim(),
          solicitante_telefone: telefone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.os) {
        onAberto(data.os);
        setAberto(false);
      } else {
        setErro(data.error || 'Não foi possível abrir o chamado. Tente de novo.');
      }
    } catch {
      setErro('Sem conexão. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Button onClick={abrir} className="w-full sm:w-auto min-h-[44px]">
        <Icon name="mais" size={16} />
        Abrir chamado
      </Button>
      <Modal open={aberto} onClose={enviando ? () => {} : () => setAberto(false)} maxWidth="max-w-md">
        <ModalHeader title="Abrir chamado" subtitle="A Amotex é avisada na hora." onClose={() => !enviando && setAberto(false)} />
        <form onSubmit={enviar} className="p-5 flex flex-col gap-4">
          <Field label="O que está acontecendo?" required>
            <Textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Ex.: a bomba do barrilete está fazendo barulho e a água não sobe."
              autoFocus
            />
          </Field>
          <Field label="Seu nome">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Telefone para contato" hint="Com DDD. É para o técnico ligar, se precisar.">
            <Input type="tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={40} placeholder="(11) 99999-9999" />
          </Field>
          {erro && <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{erro}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setAberto(false)} disabled={enviando}>
              Voltar
            </Button>
            <Button type="submit" size="sm" disabled={enviando || descricao.trim().length < 3}>
              {enviando ? 'Enviando...' : 'Enviar chamado'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ===== Em andamento + recentes =====

function minutosRestantes(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return min === 1 ? 'menos de 1 minuto' : `${min} minutos`;
}

function CartaoEmAndamento({
  os,
  podeCancelar,
  onCancelar,
}: {
  os: OS;
  podeCancelar: boolean;
  onCancelar: (os: OS) => void;
}) {
  const sit = situacaoDaOS(os);
  const regra = permissaoCancelarChamado(os);
  const delaCondominio = os.canal_abertura === 'condominio';
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={os.tipo === 'corretiva' ? 'red' : 'info'}>{os.tipo === 'corretiva' ? 'Corretiva' : 'Preventiva'}</Badge>
        <Badge tone={TOM_SITUACAO[sit]}>{ROTULO_SITUACAO[sit]}</Badge>
        {delaCondominio && <span className="text-[11px] text-amx-muted">Chamado do condomínio</span>}
      </div>
      {os.descricao_problema && <p className="text-[13px] text-white">{os.descricao_problema}</p>}
      <LinhaDoTempoOS os={os} />
      {podeCancelar && os.tipo === 'corretiva' && (
        <div className="border-t border-amx-line pt-3 flex flex-col gap-2">
          {regra.pode ? (
            <>
              <Button variant="danger" size="sm" onClick={() => onCancelar(os)} className="w-full sm:w-auto min-h-[44px]">
                Cancelar chamado
              </Button>
              {regra.restanteMs !== undefined && (
                <p className="text-[11px] text-amx-muted">
                  O técnico saiu para o atendimento. Você ainda pode cancelar por {minutosRestantes(regra.restanteMs)}.
                </p>
              )}
            </>
          ) : (
            regra.motivo !== 'encerrada' && <p className="text-xs text-amx-amber">{regra.mensagem}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function ChamadosDoCondominio({
  oss,
  podeCancelar,
  onAlterada,
  onRecarregar,
}: {
  oss: OS[];
  /** Síndico (acesso do condomínio): pode cancelar corretiva dentro da regra. */
  podeCancelar: boolean;
  onAlterada: (os: OS) => void;
  onRecarregar: () => void;
}) {
  const agora = useTick(30_000);
  const [paraCancelar, setParaCancelar] = useState<OS | null>(null);

  const emAndamento = oss
    .filter((o) => o.status === 'aberta' || o.status === 'em_andamento')
    .sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
  const corte = agora - DIAS_RECENTES * 86_400_000;
  const recentes = oss
    .filter(
      (o) =>
        o.canal_abertura === 'condominio' &&
        (o.status === 'finalizada' || o.status === 'cancelada') &&
        new Date(o.saida_em || o.criado_em).getTime() >= corte
    )
    .sort((a, b) => new Date(b.saida_em || b.criado_em).getTime() - new Date(a.saida_em || a.criado_em).getTime());

  const cancelar = async (motivo: string): Promise<string | void> => {
    if (!paraCancelar) return;
    const res = await fetch(`/api/os/${paraCancelar.id}/cancelar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.os) {
      onAlterada(data.os);
      setParaCancelar(null);
      return;
    }
    // Regra mudou enquanto a tela estava aberta (ex.: o técnico chegou): mostra o motivo e atualiza.
    if (res.status === 409) onRecarregar();
    return data.error || 'Não foi possível cancelar o chamado.';
  };

  return (
    <div className="flex flex-col gap-4 mb-6">
      <div>
        <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-3">Em andamento</p>
        {emAndamento.length === 0 ? (
          <Card className="p-4">
            <p className="text-xs text-amx-muted">Nenhum atendimento em andamento neste momento.</p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {emAndamento.map((os) => (
              <CartaoEmAndamento key={os.id} os={os} podeCancelar={podeCancelar} onCancelar={setParaCancelar} />
            ))}
          </div>
        )}
      </div>

      {recentes.length > 0 && (
        <div>
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider mb-3">Chamados recentes</p>
          <Card className="flex flex-col divide-y divide-amx-line">
            {recentes.map((os) => {
              const sit = situacaoDaOS(os);
              return (
                <div key={os.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                  <Badge tone={TOM_SITUACAO[sit]}>{ROTULO_SITUACAO[sit]}</Badge>
                  <span className="text-xs text-amx-muted">{quandoCurto(os.saida_em || os.criado_em)}</span>
                  <span className="text-[13px] text-white min-w-0 flex-1 basis-40 truncate">{os.descricao_problema}</span>
                  {sit === 'finalizada' && os.pdf_url && (
                    <a
                      href={os.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-amx-blue-light hover:text-white transition-colors min-h-[44px] inline-flex items-center gap-1"
                    >
                      <Icon name="documento" size={14} />
                      PDF
                    </a>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!paraCancelar}
        titulo="Cancelar chamado"
        confirmarLabel="Cancelar chamado"
        perigo
        motivoLabel="Por que está cancelando?"
        onConfirm={cancelar}
        onClose={() => setParaCancelar(null)}
      >
        <p>O técnico será avisado de que o chamado foi cancelado.</p>
      </ConfirmDialog>
    </div>
  );
}
