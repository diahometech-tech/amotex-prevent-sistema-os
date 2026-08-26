'use client';

import React, { useEffect, useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [idleNotice, setIdleNotice] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('motivo') === 'inatividade') {
      setIdleNotice(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // Captador → tela de captação; terceiro → portal do parceiro;
        // certificador → Modo Consulta (acesso restrito, nunca vê a esteira
        // interna); demais → dashboard.
        const role = data.user?.role;
        window.location.href =
          role === 'captador' ? '/captador.html' :
          role === 'terceiro' ? '/terceiro' :
          role === 'certificador' ? '/consulta' : '/';
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Falha no login.');
      }
    } catch {
      setError('Erro de conexão.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 text-slate-100 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-600 rounded-xl flex items-center justify-center font-bold text-white text-xl">NF</div>
          <div>
            <h1 className="font-semibold text-lg leading-tight bg-gradient-to-r from-sky-400 to-amber-400 bg-clip-text text-transparent">NexusFlow</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Acesso ao Sistema</p>
          </div>
        </div>

        {idleNotice && (
          <p className="text-xs text-amber-400 bg-amber-950/20 border border-amber-900/30 rounded-lg px-3 py-2">
            Sua sessão foi encerrada por inatividade. Faça login novamente.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400">Usuário</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            className="w-full text-sm bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-200 outline-none focus:border-sky-500"
            placeholder="ex.: gestor"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-400">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm bg-slate-900 border border-slate-800 rounded-lg p-3 text-slate-200 outline-none focus:border-sky-500"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-xs text-rose-400 font-semibold">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-sm py-3 rounded-lg transition-transform active:scale-[0.98]"
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>

      </form>
    </div>
  );
}
