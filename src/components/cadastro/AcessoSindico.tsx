'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopiarTexto } from '@/components/financeiro/CopiarTexto';
import { normalizeSearch } from '@/lib/text';
import type { Condominio, Contato } from '@/lib/db';

interface UsuarioSindico {
  id: string;
  nome: string;
  login: string;
  papel: string;
  condominio_id?: string;
  ativo: boolean;
}

// Sem 0/O/1/l/I: a senha vai ser lida e digitada por alguém no celular.
const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function gerarSenha(tamanho = 10): string {
  const bytes = new Uint32Array(tamanho);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

/** "Residencial Jardim das Flores" → "sindico.jardimdasflores" (até 30 caracteres). */
export function loginSugerido(nomeCondominio: string): string {
  const base = normalizeSearch(nomeCondominio)
    .replace(/\b(condominio|edificio|residencial|cond|ed)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return `sindico.${base || 'condominio'}`.slice(0, 30);
}

function mensagemAcesso(nome: string, login: string, senha: string, condominio: string): string {
  const site = typeof window !== 'undefined' ? window.location.origin : '';
  return [
    `Olá, ${nome.split(' ')[0]}! Este é o seu acesso ao painel da Amotex Prevent do ${condominio}.`,
    '',
    `Site: ${site}/login`,
    `Usuário: ${login}`,
    `Senha: ${senha}`,
    '',
    'No painel você vê as visitas de cada mês, com fotos e o relatório (PDF) de cada atendimento.',
    'No primeiro acesso, troque a senha: no computador, use Trocar senha no fim do menu à esquerda; no celular, toque em Menu, no topo, e depois em Trocar senha.',
  ].join('\n');
}

// Pedido 14: o admin cria (ou refaz a senha de) o acesso do síndico a partir
// do próprio condomínio, e recebe a mensagem pronta para mandar. A senha
// aparece só nesta tela, uma vez — o sistema guarda apenas o hash.
export function AcessoSindico({ condominio, contatos }: { condominio: Condominio; contatos: Contato[] }) {
  const [sindicos, setSindicos] = useState<UsuarioSindico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  // Quem está na janela de confirmação de "Gerar nova senha".
  const [confirmando, setConfirmando] = useState<UsuarioSindico | null>(null);

  const contatoSindico = contatos.find((c) => c.papel === 'sindico' && c.ativo);
  const [form, setForm] = useState({ nome: '', login: '', senha: '' });

  useEffect(() => {
    let vivo = true;
    fetch('/api/users', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok) {
          setErro(data.error || 'Não foi possível carregar os acessos.');
          return;
        }
        const todos: UsuarioSindico[] = data.users || [];
        setSindicos(todos.filter((u) => u.papel === 'sindico' && u.condominio_id === condominio.id));
      })
      .catch(() => vivo && setErro('Erro de conexão ao carregar os acessos.'))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [condominio.id]);

  const abrirFormulario = () => {
    setForm({
      nome: condominio.responsavel_nome || contatoSindico?.nome || '',
      login: loginSugerido(condominio.nome),
      senha: gerarSenha(),
    });
    setMensagem(null);
    setErro('');
    setCriando(true);
  };

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome.trim(),
          login: form.login.trim(),
          senha: form.senha,
          papel: 'sindico',
          condominio_id: condominio.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        setSindicos((prev) => [...prev, data.user]);
        setMensagem(mensagemAcesso(form.nome.trim(), form.login.trim(), form.senha, condominio.nome));
        setCriando(false);
      } else {
        setErro(data.error || 'Não foi possível criar o acesso.');
      }
    } catch {
      setErro('Erro de conexão ao criar o acesso.');
    } finally {
      setSalvando(false);
    }
  };

  // Só roda depois do "Gerar nova senha" da janela de confirmação. Devolve o
  // erro (texto) pra janela ficar aberta mostrando-o; sem retorno = deu certo.
  const novaSenha = async (u: UsuarioSindico): Promise<string | void> => {
    const senha = gerarSenha();
    setErro('');
    setMensagem(null);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha, ...(u.ativo ? {} : { ativo: true }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || 'Não foi possível gerar a nova senha.';
      if (!u.ativo) setSindicos((prev) => prev.map((s) => (s.id === u.id ? { ...s, ativo: true } : s)));
      setMensagem(mensagemAcesso(u.nome, u.login, senha, condominio.nome));
      setConfirmando(null);
    } catch {
      return 'Erro de conexão ao gerar a nova senha.';
    }
  };

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="font-heading text-[11px] text-amx-muted uppercase tracking-wider">Acesso do síndico ao painel</p>
          <p className="text-xs text-amx-muted mt-0.5">O síndico vê as visitas de cada mês, as fotos e o PDF de cada OS. Só deste condomínio.</p>
        </div>
        {!criando && (
          <Button size="sm" onClick={abrirFormulario}>
            + Criar acesso
          </Button>
        )}
      </div>

      {carregando ? (
        <p className="text-xs text-amx-muted">Carregando…</p>
      ) : sindicos.length === 0 && !criando ? (
        <p className="text-xs text-amx-muted">Nenhum acesso de síndico criado para este condomínio.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sindicos.map((u) => (
            <li key={u.id} className="flex items-center gap-3 flex-wrap text-xs">
              <span className="text-white font-semibold">{u.nome}</span>
              <span className="text-amx-muted font-mono">{u.login}</span>
              {!u.ativo && <Badge tone="neutral">Inativo</Badge>}
              <button
                type="button"
                onClick={() => setConfirmando(u)}
                className="text-amx-blue-light hover:text-white underline underline-offset-2"
              >
                {u.ativo ? 'Gerar nova senha' : 'Reativar com nova senha'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {criando && (
        <form onSubmit={criar} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 items-end">
          <Field label="Nome do síndico">
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </Field>
          <Field label="Usuário (login)">
            <Input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
          </Field>
          <Field label="Senha inicial" hint="Gerada agora; ele troca no 1º acesso">
            <Input value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} minLength={8} required />
          </Field>
          <div className="sm:col-span-3 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={salvando || !form.nome.trim() || !form.login.trim() || form.senha.length < 8}>
              {salvando ? 'Criando…' : 'Criar acesso'}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setCriando(false)} disabled={salvando}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {erro && <p className="text-xs font-semibold text-amx-red-hover mt-3">{erro}</p>}

      <ConfirmDialog
        open={!!confirmando}
        titulo="Gerar nova senha"
        confirmarLabel="Gerar nova senha"
        cancelarLabel="Cancelar"
        perigo
        onConfirm={() => (confirmando ? novaSenha(confirmando) : undefined)}
        onClose={() => setConfirmando(null)}
      >
        <p>
          Gerar nova senha para <b className="text-white">{confirmando?.nome.split(' ')[0]}</b>? A senha atual dele para de funcionar na hora.
        </p>
        {confirmando && !confirmando.ativo && <p>O acesso também volta a ficar ativo.</p>}
      </ConfirmDialog>

      {mensagem && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-amx-green">
            Pronto. Mande esta mensagem ao síndico — a senha não aparece de novo depois que você sair desta tela.
          </p>
          <textarea
            id="msg-acesso-sindico"
            readOnly
            value={mensagem}
            rows={8}
            className="w-full rounded-lg bg-amx-panel-2 border border-amx-line text-xs text-white p-3 font-mono"
          />
          <div className="flex items-center gap-2">
            <CopiarTexto texto={mensagem} rotulo="Copiar mensagem" alvoId="msg-acesso-sindico" />
          </div>
        </div>
      )}
    </Card>
  );
}
