'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useIdleLogout } from '@/lib/useIdleLogout';
import type { UserRole } from '@/lib/db';
import { ROLE_LABELS, canManageUsersNav } from '@/lib/permissions';
import { Spinner } from '@/components/ui/EmptyState';

export interface AmxUser {
  id: string;
  name: string;
  role: UserRole;
}

const UserContext = createContext<AmxUser | null>(null);

// Dados do usuário logado (id/nome/papel) pras telas dentro do AppShell
// decidirem o que mostrar — nunca a única barreira de segurança, ver
// src/lib/permissions.ts.
export function useAmxUser(): AmxUser | null {
  return useContext(UserContext);
}

const NAV_ITEMS: { href: string; label: string; icon: string }[] = [
  { href: '/', label: 'Ordens de Serviço', icon: '🧾' },
  { href: '/condominios', label: 'Condomínios', icon: '🏢' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  // Mesmo timeout de inatividade herdado do NexusFlow em todas as telas
  // autenticadas (ver src/lib/useIdleLogout.ts).
  useIdleLogout(10);

  const pathname = usePathname();
  const [user, setUser] = useState<AmxUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (r.ok) {
          const data = await r.json();
          if (!cancelled) setUser(data.user);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  if (loading) {
    return (
      <div className="min-h-screen shrink-0 flex items-center justify-center bg-amx-canvas">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  // Redirecionamento pro /login já está em andamento — não renderiza nada
  // do conteúdo protegido nesse meio-tempo.
  if (!user) return null;

  return (
    <UserContext.Provider value={user}>
      {/* shrink-0: evita o mesmo bug de fundo cortado do admin/usuarios
          original (ver comentário lá) — este componente é montado direto
          como filho de <body className="flex flex-col"> em layout.tsx. */}
      <div className="min-h-screen shrink-0 flex flex-col bg-amx-canvas">
        <header className="bg-amx-navy-800 text-white">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-4 md:px-6 py-3">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg bg-amx-red-600 flex items-center justify-center text-lg shrink-0"
                aria-hidden
              >
                🤖
              </div>
              <div className="leading-tight">
                <p className="text-sm font-bold">Amotex Prevent</p>
                <p className="text-[10px] text-amx-navy-100 uppercase tracking-wider font-semibold">
                  Sistema de OS
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block leading-tight">
                <p className="text-xs font-semibold">{user.name}</p>
                <p className="text-[10px] text-amx-navy-100">{ROLE_LABELS[user.role]}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-semibold bg-amx-navy-700 hover:bg-amx-navy-600 px-3 py-2 rounded-lg transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
          <nav className="max-w-6xl mx-auto px-4 md:px-6 flex items-center gap-1 overflow-x-auto thin-scroll pb-2.5">
            {NAV_ITEMS.map((item) => {
              const activeItem = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    activeItem ? 'bg-white text-amx-navy-800' : 'text-amx-navy-100 hover:bg-amx-navy-700'
                  }`}
                >
                  <span className="mr-1">{item.icon}</span>
                  {item.label}
                </a>
              );
            })}
            {canManageUsersNav(user.role) && (
              <a
                href="/admin/usuarios"
                className="text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap text-amx-navy-100 hover:bg-amx-navy-700 transition-colors"
              >
                <span className="mr-1">👤</span>
                Usuários
              </a>
            )}
          </nav>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-6">{children}</main>
      </div>
    </UserContext.Provider>
  );
}
