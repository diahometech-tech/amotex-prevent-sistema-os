'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { telaInicial } from '@/lib/roles';

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
        // API espera { login, password } (src/app/api/auth/login/route.ts) — o
        // state local chama-se `username` só por herança do form, o corpo
        // enviado precisa usar o nome de campo real.
        body: JSON.stringify({ login: username, password }),
      });
      if (res.ok) {
        // Cada papel abre na própria tela inicial (síndico cai direto no
        // Painel do Condomínio; os demais, em Ordens de Serviço).
        const data = await res.json().catch(() => ({}));
        window.location.href = telaInicial(data?.user?.role);
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
    <div className="min-h-screen w-full flex items-center justify-center bg-amx-bg text-white p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-amx-panel border border-amx-line rounded-2xl p-7 flex flex-col gap-5 shadow-2xl"
      >
        <div className="flex flex-col items-center gap-2">
          <Image
            src="/brand/logo-amotex-completa.png"
            alt="Amotex"
            width={1000}
            height={554}
            priority
            className="w-[220px] h-auto"
          />
          <h1 className="sr-only">Amotex Prevent</h1>
          <p className="text-[10px] text-amx-muted font-bold uppercase tracking-wider">Sistema de OS</p>
        </div>

        {idleNotice && (
          <p className="text-xs text-amx-amber bg-amx-amber/12 rounded-lg px-3 py-2">
            Sua sessão foi encerrada por inatividade. Faça login novamente.
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="font-heading text-[11px] font-semibold text-amx-muted uppercase tracking-wider">Usuário</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            className="w-full text-sm bg-amx-panel-2 border border-amx-line rounded-lg p-3 text-white outline-none focus:border-amx-red"
            placeholder="ex.: tecnico"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-heading text-[11px] font-semibold text-amx-muted uppercase tracking-wider">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm bg-amx-panel-2 border border-amx-line rounded-lg p-3 text-white outline-none focus:border-amx-red"
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-xs text-amx-red-hover font-semibold">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="bg-amx-red hover:bg-amx-red-hover disabled:opacity-60 text-white font-bold text-sm py-3 rounded-lg transition-transform active:scale-[0.98]"
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
