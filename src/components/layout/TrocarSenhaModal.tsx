'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { Modal, ModalHeader } from '@/components/ui/Modal';

// A própria pessoa troca a senha (POST /api/auth/senha). Aberto pelas
// iniciais no menu lateral.
export function TrocarSenhaModal({ open, onClose, nome }: { open: boolean; onClose: () => void; nome: string }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);

  const fechar = () => {
    setAtual('');
    setNova('');
    setConfirma('');
    setErro('');
    setOk(false);
    onClose();
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (nova !== confirma) return setErro('A confirmação não bate com a nova senha.');
    setSalvando(true);
    const res = await fetch('/api/auth/senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atual, nova }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setSalvando(false);
    if (!res?.ok) return setErro(data.error || 'Erro de conexão.');
    setOk(true);
  };

  return (
    <Modal open={open} onClose={fechar} maxWidth="max-w-sm">
      <ModalHeader title="Trocar minha senha" onClose={fechar} />
      <div className="p-5">
        {ok ? (
          <div className="space-y-4">
            <p className="text-sm text-white">Senha trocada, {nome.split(' ')[0]}. Use a nova no próximo acesso.</p>
            <Button onClick={fechar}>Fechar</Button>
          </div>
        ) : (
          <form onSubmit={salvar} className="space-y-4">
            <Field label="Senha atual" required>
              <Input type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required />
            </Field>
            <Field label="Nova senha" hint="Pelo menos 8 caracteres." required>
              <Input type="password" autoComplete="new-password" minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} required />
            </Field>
            <Field label="Repita a nova senha" required>
              <Input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} required />
            </Field>
            {erro && <p className="text-xs font-semibold text-amx-red-hover">{erro}</p>}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={fechar} disabled={salvando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Trocar senha'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
