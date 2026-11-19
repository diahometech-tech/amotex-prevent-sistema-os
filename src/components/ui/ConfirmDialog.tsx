'use client';

import React, { useState } from 'react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Form';

// Confirmação dentro do sistema — substitui window.confirm(), que trava a
// página (e qualquer automação) até alguém clicar no aviso do navegador e não
// segue o visual do sistema.
//
// - `motivoLabel`: pede um texto obrigatório (ex.: motivo do cancelamento),
//   entregue em onConfirm.
// - `digitarParaConfirmar`: só libera o botão depois de digitar esse texto
//   (ex.: o nome do condomínio), pra ações sem volta.
type ConfirmDialogProps = {
  open: boolean;
  titulo: string;
  children?: React.ReactNode;
  confirmarLabel: string;
  perigo?: boolean;
  motivoLabel?: string;
  digitarParaConfirmar?: string;
  onConfirm: (motivo: string) => Promise<string | void> | string | void;
  onClose: () => void;
};

// O conteúdo só existe enquanto aberto: cada abertura começa com o
// formulário limpo, sem efeito pra zerar o estado.
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmDialogAberto {...props} />;
}

function ConfirmDialogAberto({
  open,
  titulo,
  children,
  confirmarLabel,
  perigo = false,
  motivoLabel,
  digitarParaConfirmar,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [motivo, setMotivo] = useState('');
  const [digitado, setDigitado] = useState('');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const faltaMotivo = !!motivoLabel && motivo.trim().length < 3;
  const faltaDigitar =
    !!digitarParaConfirmar && digitado.trim().toLowerCase() !== digitarParaConfirmar.trim().toLowerCase();

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (faltaMotivo || faltaDigitar || busy) return;
    setBusy(true);
    setErro('');
    try {
      // onConfirm devolve uma mensagem de erro (string) quando falha; o
      // diálogo fica aberto mostrando o erro. Sem retorno = deu certo.
      const resultado = await onConfirm(motivo.trim());
      if (typeof resultado === 'string' && resultado) setErro(resultado);
    } catch {
      setErro('Erro de conexão. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} maxWidth="max-w-md">
      <ModalHeader title={titulo} onClose={busy ? () => {} : onClose} />
      <form onSubmit={confirmar} className="p-5 flex flex-col gap-4">
        {children && <div className="text-[13px] text-amx-muted flex flex-col gap-2">{children}</div>}
        {motivoLabel && (
          <Field label={motivoLabel} required>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus />
          </Field>
        )}
        {digitarParaConfirmar && (
          <Field label="Para confirmar, digite o nome" hint={digitarParaConfirmar}>
            <Input value={digitado} onChange={(e) => setDigitado(e.target.value)} autoFocus={!motivoLabel} />
          </Field>
        )}
        {erro && <p className="text-xs font-semibold text-amx-red-hover bg-amx-red/10 rounded-lg px-3 py-2">{erro}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button
            type="submit"
            size="sm"
            variant={perigo ? 'danger' : 'primary'}
            disabled={busy || faltaMotivo || faltaDigitar}
          >
            {busy ? 'Aguarde…' : confirmarLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
