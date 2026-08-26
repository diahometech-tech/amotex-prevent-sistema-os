'use client';

import React, { useEffect, useState } from 'react';
import { useIdleLogout } from '@/lib/useIdleLogout';

type Role = 'captador' | 'operador_certificacao' | 'operador_abertura' | 'gestor' | 'admin' | 'terceiro' | 'certificador';

interface UserRow {
  id: string;
  name: string;
  username: string;
  role: Role;
  active: boolean;
  created_at: string;
  terceiro_projeto?: string;
  gestor_projetos?: string;
}

interface ProjectRow {
  nome: string;
  capacidade?: number;
  usados?: number;
}

// terceiro_projeto e gestor_projetos guardam, os dois, uma lista de nomes de
// projeto separada por vírgula (mesmo formato — ver src/lib/gestor-scope.ts).
// Viram o mesmo array aqui pro seletor não precisar saber qual campo é.
function parseEscopo(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const ROLE_LABELS: Record<Role, string> = {
  captador: '📸 Captador',
  operador_certificacao: '📜 Certificação (BIRD/A1)',
  operador_abertura: '🏢 Abertura de Empresa',
  gestor: '💼 Gestor',
  admin: '💻 Administrador',
  terceiro: '🤝 Terceiro',
  // Acesso restrito: só o Modo Consulta (/consulta), nunca a esteira/kanban
  // interno — pra usar na máquina de emissão, com o cliente por perto.
  certificador: '🖥️ Certificador (emissão)',
};

// Seletor de projeto(s) do isolamento por acesso — usado tanto por 'terceiro'
// quanto por 'gestor', os dois com múltipla seleção (10/08/2026: terceiro
// aceitava só um projeto até um pedido real de acesso que responde por mais
// de um; ver User.terceiro_projeto em src/lib/db.ts).
//
// Era um window.prompt de texto livre e isso causou um bug real (mesmo dia):
// o nome digitado é comparado com `d.projeto` por igualdade EXATA de string
// (src/lib/gestor-scope.ts e api/terceiro/dossiers) — qualquer divergência de
// caixa/espaço ("PJ 10 ALEX" vs "PJ 10 Alex") faz a conta não enxergar NENHUMA
// OS, e como vazio = sem restrição, o sintoma é "as OS sumiram" sem erro
// nenhum. Escolher de uma lista elimina a classe inteira do problema; a
// contagem de OS ao lado de cada projeto deixa visível, ANTES de salvar, se
// aquele projeto tem OS classificadas de verdade.
function ProjetoPicker({
  projects,
  selected,
  onChange,
}: {
  projects: ProjectRow[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [filtro, setFiltro] = useState('');
  // Valores gravados que não existem no catálogo de projetos: quase sempre são
  // exatamente o erro de digitação que motivou esta tela. Continuam listados
  // (e marcados) pra não sumirem silenciosamente ao salvar, mas sinalizados.
  const desconhecidos = selected.filter((s) => !projects.some((p) => p.nome === s));
  const linhas: ProjectRow[] = [
    ...desconhecidos.map((nome) => ({ nome, usados: undefined })),
    ...projects,
  ];
  const visiveis = filtro.trim()
    ? linhas.filter((p) => p.nome.toLowerCase().includes(filtro.trim().toLowerCase()))
    : linhas;

  const toggle = (nome: string) => {
    onChange(selected.includes(nome) ? selected.filter((s) => s !== nome) : [...selected, nome]);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onChange([])}
        className={`text-left text-xs rounded-lg border px-3 py-2 ${
          selected.length === 0
            ? 'border-sky-500 bg-sky-950/40 text-sky-300 font-semibold'
            : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700'
        }`}
      >
        🌐 Sem restrição — enxerga todas as OS&apos;s
      </button>

      {linhas.length > 8 && (
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar projeto..."
          className="text-xs bg-slate-900 border border-slate-800 rounded-lg p-2 outline-none focus:border-sky-500"
        />
      )}

      <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-1">
        {visiveis.length === 0 && (
          <p className="text-[11px] text-slate-500 px-1 py-2">
            Nenhum projeto cadastrado. Crie na tela 📁 Projetos antes de restringir este acesso.
          </p>
        )}
        {visiveis.map((p) => {
          const marcado = selected.includes(p.nome);
          const naoCadastrado = p.usados === undefined;
          return (
            <label
              key={p.nome}
              className={`flex items-center gap-2 text-xs rounded-lg border px-3 py-2 cursor-pointer ${
                marcado ? 'border-emerald-600 bg-emerald-950/30' : 'border-slate-800 bg-slate-900 hover:border-slate-700'
              }`}
            >
              <input
                type="checkbox"
                checked={marcado}
                onChange={() => toggle(p.nome)}
                className="accent-emerald-500"
              />
              <span className="flex-1 text-slate-200">{p.nome}</span>
              {naoCadastrado ? (
                <span className="text-[10px] font-bold text-amber-400">⚠️ não cadastrado</span>
              ) : (
                <span className={`text-[10px] font-bold ${p.usados ? 'text-slate-500' : 'text-amber-400'}`}>
                  {p.usados} OS
                </span>
              )}
            </label>
          );
        })}
      </div>

      {desconhecidos.length > 0 && (
        <p className="text-[10px] text-amber-400 leading-relaxed">
          ⚠️ {desconhecidos.map((d) => `"${d}"`).join(', ')} não existe na lista de projetos (provavelmente
          digitado à mão com grafia diferente) — {desconhecidos.length === selected.length
            ? 'enquanto ficar assim, este acesso não enxerga nenhuma OS'
            : 'esse nome é ignorado, não bate com nenhuma OS'}. Desmarque e escolha o projeto certo abaixo.
        </p>
      )}
      {selected.some((s) => projects.find((p) => p.nome === s)?.usados === 0) && (
        <p className="text-[10px] text-amber-400 leading-relaxed">
          ⚠️ Projeto selecionado sem nenhuma OS classificada. O acesso vai abrir vazio até o gestor
          atribuir esse projeto às OS (📁 Projeto, dentro da OS).
        </p>
      )}
      <p className="text-[10px] text-slate-500 leading-relaxed">
        OS ainda <strong>sem projeto atribuído</strong> não aparecem para acessos restritos — só as já
        classificadas no(s) projeto(s) marcado(s) acima.
      </p>
    </div>
  );
}

export default function UsuariosAdmin() {
  // Desloga automaticamente após 10min sem atividade (todo acesso exceto captador).
  useIdleLogout(10);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'captador' as Role, terceiro_projeto: '', gestor_projetos: '' });
  const [msg, setMsg] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  // Escopo em edição (modal). `selected` é sempre array — vira lista separada
  // por vírgula (terceiro_projeto ou gestor_projetos, mesmo formato) só na
  // hora de salvar.
  const [escopoModal, setEscopoModal] = useState<{ user: UserRow; selected: string[] } | null>(null);
  const [savingEscopo, setSavingEscopo] = useState(false);
  const [usersPage, setUsersPage] = useState(0);

  const load = async () => {
    const res = await fetch('/api/users', { cache: 'no-store' });
    if (res.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
    setLoading(false);
  };

  // Catálogo de projetos + quantas OS cada um tem (campo `usados`, calculado ao
  // vivo por GET /api/projects). É o que alimenta o seletor.
  const loadProjects = async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch {}
  };

  useEffect(() => {
    // Garante que há sessão; se não, manda pro login.
    fetch('/api/auth/me', { cache: 'no-store' }).then((r) => {
      if (r.status === 401) window.location.href = '/login';
      else {
        load();
        loadProjects();
      }
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`✅ Usuário "${form.username}" criado.`);
      setForm({ name: '', username: '', password: '', role: 'captador', terceiro_projeto: '', gestor_projetos: '' });
      load();
    } else {
      setMsg(`⚠️ ${data.error || 'Falha ao criar usuário.'}`);
    }
  };

  const handleResetPassword = async (u: UserRow) => {
    const novaSenha = window.prompt(`Nova senha para "${u.username}":`);
    if (!novaSenha) return;
    setMsg('');
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: novaSenha }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`✅ Senha de "${u.username}" redefinida.`);
    } else {
      setMsg(`⚠️ ${data.error || 'Falha ao redefinir senha.'}`);
    }
  };

  // Abre o modal de escopo. Serve pros dois papéis restringíveis: 'terceiro'
  // (User.terceiro_projeto) e 'gestor' (User.gestor_projetos) — os dois
  // aceitam mais de um projeto (lista separada por vírgula, ver
  // src/lib/gestor-scope.ts; caso real que motivou isso pro terceiro:
  // acesso que responde por mais de um projeto ao mesmo tempo).
  const openEscopo = (u: UserRow) => {
    // Recarrega o catálogo ao abrir — projeto criado depois que a tela subiu
    // precisa aparecer sem exigir F5.
    loadProjects();
    setEscopoModal({
      user: u,
      selected: parseEscopo(u.role === 'gestor' ? u.gestor_projetos : u.terceiro_projeto),
    });
  };

  const handleSaveEscopo = async () => {
    if (!escopoModal) return;
    const { user: u, selected } = escopoModal;
    const isGestor = u.role === 'gestor';
    setSavingEscopo(true);
    setMsg('');
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isGestor ? { gestor_projetos: selected.join(', ') } : { terceiro_projeto: selected.join(', ') }
      ),
    });
    const data = await res.json().catch(() => ({}));
    setSavingEscopo(false);
    if (res.ok) {
      setMsg(
        selected.length === 0
          ? `✅ Restrição de projeto removida de "${u.username}" (volta a ver tudo).`
          : `✅ "${u.username}" agora enxerga só: ${selected.join(', ')}.`
      );
      setEscopoModal(null);
      load();
    } else {
      setMsg(`⚠️ ${data.error || 'Falha ao atualizar projeto(s).'}`);
    }
  };

  const handleToggleActive = async (u: UserRow) => {
    setMsg('');
    const res = await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !u.active }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`✅ "${u.username}" ${u.active ? 'desativado' : 'ativado'}.`);
      load();
    } else {
      setMsg(`⚠️ ${data.error || 'Falha ao atualizar status.'}`);
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (!window.confirm(`Excluir definitivamente o acesso de "${u.name}" (${u.username})?\n\nEsta ação não pode ser desfeita.`)) return;
    setMsg('');
    const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`✅ Acesso de "${u.username}" excluído.`);
      load();
    } else {
      setMsg(`⚠️ ${data.error || 'Falha ao excluir usuário.'}`);
    }
  };

  if (loading) return <div className="min-h-screen shrink-0 bg-slate-900 text-slate-400 p-8 text-sm">Carregando...</div>;
  if (denied) {
    return (
      <div className="min-h-screen shrink-0 bg-slate-900 text-slate-100 p-8 flex flex-col gap-3 items-start">
        <p className="text-sm text-rose-400 font-semibold">Acesso negado. Apenas Gestor e Administrador podem gerenciar usuários.</p>
        <a href="/" className="text-xs text-sky-400 hover:underline">← Voltar ao painel</a>
      </div>
    );
  }

  return (
    // shrink-0: este componente é montado direto como filho de <body
    // className="flex flex-col">  (src/app/layout.tsx) — sem isso, o
    // flexbox ENCOLHE esta div pra caber exatamente numa tela (a div fica
    // travada em 100vh mesmo com `min-h-screen`, porque flex-shrink:1 é o
    // padrão), e o conteúdo que ultrapassa a primeira tela (lista longa de
    // usuários) continua sendo renderizado — só que por baixo, contra o
    // fundo branco do <body>/<html> em vez do bg-slate-900 desta div. Bug
    // real reportado (10/08/2026): "a cor de fundo da tela ta metade azul e
    // a outra metade branca". Confirmado com Playwright: sem shrink-0,
    // offsetHeight fica preso em 900px mesmo com scrollHeight de 2826px;
    // com shrink-0, a div cresce corretamente até o conteúdo real. Não
    // acontece nas outras páginas fora do dashboard principal (login,
    // consulta) porque o conteúdo delas nunca ultrapassa uma tela.
    <div className="min-h-screen shrink-0 bg-slate-900 text-slate-100 p-6 md:p-10">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Gestão de Usuários</h1>
            <p className="text-xs text-slate-400">Crie acessos por hierarquia. As permissões refletem na esteira de tratativas.</p>
          </div>
          <a href="/" className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-2 rounded-lg">← Painel</a>
        </div>

        {/* Formulário de criação */}
        <form onSubmit={handleCreate} className="bg-slate-950 border border-slate-800 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400">Nome</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
              className="text-sm bg-slate-900 border border-slate-800 rounded-lg p-2.5 outline-none focus:border-sky-500" placeholder="Nome completo" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400">Usuário (login)</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required
              className="text-sm bg-slate-900 border border-slate-800 rounded-lg p-2.5 outline-none focus:border-sky-500" placeholder="ex.: maria.t2" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400">Senha</label>
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required
              className="text-sm bg-slate-900 border border-slate-800 rounded-lg p-2.5 outline-none focus:border-sky-500" placeholder="senha inicial" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400">Hierarquia / Papel</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              className="text-sm bg-slate-900 border border-slate-800 rounded-lg p-2.5 outline-none focus:border-sky-500">
              {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {form.role === 'terceiro' && (
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-slate-400">Projeto(s) (isolamento entre parceiros)</label>
              <ProjetoPicker
                projects={projects}
                selected={parseEscopo(form.terceiro_projeto)}
                onChange={(next) => setForm({ ...form, terceiro_projeto: next.join(', ') })}
              />
            </div>
          )}
          {form.role === 'gestor' && (
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-slate-400">Projeto(s) (isolamento entre gestores)</label>
              <ProjetoPicker
                projects={projects}
                selected={parseEscopo(form.gestor_projetos)}
                onChange={(next) => setForm({ ...form, gestor_projetos: next.join(', ') })}
              />
            </div>
          )}
          <div className="md:col-span-2 flex items-center justify-between gap-4">
            {msg && <span className="text-xs font-semibold text-slate-300">{msg}</span>}
            <button type="submit" className="ml-auto bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs px-5 py-2.5 rounded-lg">
              + Criar Acesso
            </button>
          </div>
        </form>

        {/* Lista — paginada (pedido explícito: lista de usuários crescia sem
            limite, ficava difícil de navegar). Mesmo padrão numerado (±2
            páginas ao redor da atual, com "…" nas pontas) já usado na tela
            Certificação/Projetos. */}
        {(() => {
          const USERS_PAGE_SIZE = 10;
          const totalUsersPages = Math.max(1, Math.ceil(users.length / USERS_PAGE_SIZE));
          const page = Math.min(usersPage, totalUsersPages - 1);
          const pageUsers = users.slice(page * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE + USERS_PAGE_SIZE);
          const WINDOW = 2;
          const pageNums: (number | '…')[] = [];
          for (let i = 0; i < totalUsersPages; i++) {
            if (i === 0 || i === totalUsersPages - 1 || Math.abs(i - page) <= WINDOW) {
              pageNums.push(i);
            } else if (pageNums[pageNums.length - 1] !== '…') {
              pageNums.push('…');
            }
          }
          return (
        <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-900/60 text-slate-400">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Nome</th>
                <th className="text-left font-semibold px-4 py-3">Usuário</th>
                <th className="text-left font-semibold px-4 py-3">Hierarquia</th>
                <th className="text-left font-semibold px-4 py-3">Status</th>
                <th className="text-right font-semibold px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pageUsers.map((u) => (
                <tr key={u.id} className="border-t border-slate-800/60">
                  <td className="px-4 py-3 font-semibold text-slate-200">{u.name}</td>
                  <td className="px-4 py-3 text-slate-400">{u.username}</td>
                  <td className="px-4 py-3">
                    {ROLE_LABELS[u.role]}
                    {(u.role === 'terceiro' || u.role === 'gestor') && (() => {
                      const escopo = parseEscopo(u.role === 'gestor' ? u.gestor_projetos : u.terceiro_projeto);
                      if (escopo.length === 0) {
                        return (
                          <span className="block text-[10px] text-slate-500 mt-0.5">
                            📁 sem restrição de projeto (vê tudo)
                          </span>
                        );
                      }
                      // Nome de escopo apontando pra projeto inexistente é sempre
                      // digitação/renomeação divergente — sinalizado aqui pra não
                      // precisar abrir o modal pra descobrir por que "as OS
                      // sumiram". Só quando TODOS os nomes estão quebrados é que o
                      // acesso enxerga zero OS; se sobrar pelo menos um válido, o
                      // acesso ainda funciona (só não vê o(s) projeto(s) errado(s)).
                      const quebrados = projects.length > 0 ? escopo.filter((n) => !projects.some((p) => p.nome === n)) : [];
                      const semNenhumValido = quebrados.length === escopo.length;
                      return (
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          📁 {escopo.join(', ')}
                          {quebrados.length > 0 && (
                            <span className="block text-amber-400 font-semibold">
                              ⚠️ {quebrados.join(', ')} não é um projeto cadastrado
                              {semNenhumValido ? ' — este acesso não vê nenhuma OS' : ' — ignorado, não bate com nada'}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.active ? 'bg-emerald-950/40 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      {u.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {(u.role === 'terceiro' || u.role === 'gestor') && (
                        <button type="button" onClick={() => openEscopo(u)}
                          className="text-[10px] font-bold bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 px-2.5 py-1.5 rounded-md">
                          📁 Projeto(s)
                        </button>
                      )}
                      <button type="button" onClick={() => handleResetPassword(u)}
                        className="text-[10px] font-bold bg-sky-950/40 hover:bg-sky-900/50 text-sky-400 px-2.5 py-1.5 rounded-md">
                        🔑 Resetar senha
                      </button>
                      <button type="button" onClick={() => handleToggleActive(u)}
                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-md ${u.active ? 'bg-amber-950/40 hover:bg-amber-900/50 text-amber-400' : 'bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400'}`}>
                        {u.active ? '⏸ Desativar' : '▶ Ativar'}
                      </button>
                      <button type="button" onClick={() => handleDelete(u)}
                        className="text-[10px] font-bold bg-rose-950/40 hover:bg-rose-900/50 text-rose-400 px-2.5 py-1.5 rounded-md">
                        🗑️ Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalUsersPages > 1 && (
            <div className="flex flex-col items-center gap-2 py-4 border-t border-slate-800/60">
              <span className="text-[11px] text-slate-500">Página {page + 1} de {totalUsersPages} · {users.length} usuários</span>
              <div className="flex items-center gap-1 flex-wrap justify-center">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setUsersPage(page - 1)}
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
                    onClick={() => setUsersPage(p)}
                    className={`text-[11px] font-bold w-7 h-7 rounded transition-colors ${p === page ? 'bg-sky-600 text-white' : 'border border-slate-800 text-slate-300 hover:border-slate-600'}`}
                  >
                    {p + 1}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={page >= totalUsersPages - 1}
                  onClick={() => setUsersPage(page + 1)}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded border border-slate-800 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:border-slate-600"
                >
                  Próxima →
                </button>
              </div>
            </div>
          )}
        </div>
          );
        })()}
      </div>

      {/* Modal de escopo por projeto. Padrão responsivo do projeto:
          wrapper fixed inset-0 + p-4 (nunca top-1/2/translate, que encosta
          na borda em tela estreita) e stopPropagation no card interno. */}
      {escopoModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setEscopoModal(null)}
        >
          <div
            className="bg-slate-950 border border-slate-800 rounded-xl p-5 w-full max-w-md flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {escopoModal.user.role === 'gestor' ? 'Projetos do gestor' : 'Projeto(s) do parceiro'} &quot;{escopoModal.user.username}&quot;
              </h2>
              <p className="text-[11px] text-slate-400 mt-1">
                Marque um ou mais projetos — o acesso só enxerga{escopoModal.user.role === 'terceiro' ? '' : '/edita'} OS classificadas
                neles, nem a fila livre de outros projetos.
              </p>
            </div>

            <ProjetoPicker
              projects={projects}
              selected={escopoModal.selected}
              onChange={(next) => setEscopoModal({ ...escopoModal, selected: next })}
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEscopoModal(null)}
                className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEscopo}
                disabled={savingEscopo}
                className="text-xs font-bold bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
              >
                {savingEscopo ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
