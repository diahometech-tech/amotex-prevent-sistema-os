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

// Ícones extraídos literalmente do protótipo visual (mesmo stroke-width,
// mesmo viewBox) — ver PR de referência.
const ICON_OS = (
  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18M3 9v10a2 2 0 0 0 2 2h4M21 9v10a2 2 0 0 1-2 2H9" />
);
const ICON_CONDOMINIO = <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1" />;
const ICON_PAINEL = <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />;
const ICON_GEAR = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
);
const ICON_LOGOUT = <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />;

const NAV_ITEMS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: '/', label: 'Ordens de Serviço', icon: ICON_OS },
  { href: '/condominios', label: 'Condomínios', icon: ICON_CONDOMINIO },
  { href: '/painel', label: 'Painel do Síndico', icon: ICON_PAINEL },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

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
      <div className="min-h-screen shrink-0 flex items-center justify-center bg-amx-bg">
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
      <div className="min-h-screen shrink-0 flex bg-amx-bg">
        <aside className="w-[76px] shrink-0 bg-amx-panel-2 border-r border-amx-line flex flex-col items-center py-5 gap-7">
          <div
            className="w-10 h-10 rounded-lg bg-amx-red flex items-center justify-center font-heading font-bold text-[15px]"
            aria-hidden
          >
            AP
          </div>

          <nav className="flex flex-col gap-[22px] items-center flex-1">
            {NAV_ITEMS.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={`w-11 h-11 rounded-[10px] flex items-center justify-center border transition-colors ${
                    active
                      ? 'bg-amx-red/14 border-amx-red/40'
                      : 'border-transparent hover:bg-amx-panel hover:border-amx-line'
                  }`}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={active ? 'var(--color-amx-red)' : 'var(--color-amx-muted)'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {item.icon}
                  </svg>
                </a>
              );
            })}
            {canManageUsersNav(user.role) && (
              <a
                href="/admin/usuarios"
                title="Usuários"
                className={`w-11 h-11 rounded-[10px] flex items-center justify-center border transition-colors ${
                  pathname.startsWith('/admin')
                    ? 'bg-amx-red/14 border-amx-red/40'
                    : 'border-transparent hover:bg-amx-panel hover:border-amx-line'
                }`}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={pathname.startsWith('/admin') ? 'var(--color-amx-red)' : 'var(--color-amx-muted)'}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICON_GEAR}
                </svg>
              </a>
            )}
          </nav>

          <div className="flex flex-col items-center gap-3">
            <div
              className="w-8 h-8 rounded-full bg-amx-blue flex items-center justify-center text-[11px] font-semibold text-white"
              title={`${user.name} · ${ROLE_LABELS[user.role]}`}
            >
              {initials(user.name)}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Sair"
              aria-label="Sair"
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-amx-muted hover:text-white hover:bg-amx-panel transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICON_LOGOUT}
              </svg>
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
      </div>
    </UserContext.Provider>
  );
}
