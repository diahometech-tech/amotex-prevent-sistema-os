'use client';

import React, { useEffect, useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [idleNotice, setIdleNotice] = useState(false);

  useEffect(() => {
    // Só dá pra ler window.location depois do mount no cliente (esta página é
    // renderizada no servidor primeiro) — por isso o aviso não pode nascer
    // direto do valor inicial do useState sem arriscar mismatch de hidratação.
    if (new URLSearchParams(window.location.search).get('motivo') === 'inatividade') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        // admin, técnico e síndico caem no mesmo painel — o que cada um
        // enxerga dentro dele é decidido por papel (ver src/lib/permissions.ts
        // e isScopedToOwnCondominio em src/lib/auth.ts para o síndico).
        window.location.href = '/';
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
    <div className="min-h-screen w-full flex items-center justify-center bg-amx-navy-900 text-white p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-amx-navy-800 border border-amx-navy-700 rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-amx-red-600 rounded-xl flex items-center justify-center text-2xl shrink-0" aria-hidden>
            🤖
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-white">Amotex Prevent</h1>
            <p className="text-[10px] text-amx-navy-100 font-bold uppercase tracking-wider">Sistema de OS</p>
          </div>
        </div>

        {idleNotice && (
          <p className="text-xs text-amx-warning-600 bg-amx-warning-50 rounded-lg px-3 py-2">
            Sua sessão foi encerrada por inatividade. Faça login novamente.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-amx-navy-100">Usuário</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            className="w-full text-sm bg-amx-navy-900 border border-amx-navy-700 rounded-lg p-3 text-white outline-none focus:border-amx-red-500"
            placeholder="ex.: tecnico"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-amx-navy-100">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm bg-amx-navy-900 border border-amx-navy-700 rounded-lg p-3 text-white outline-none focus:border-amx-red-500"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-xs text-amx-red-500 font-semibold">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="bg-amx-red-600 hover:bg-amx-red-700 disabled:opacity-60 text-white font-bold text-sm py-3 rounded-lg transition-transform active:scale-[0.98]"
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
