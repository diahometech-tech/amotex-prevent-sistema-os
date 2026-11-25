'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useIdleLogout } from '@/lib/useIdleLogout';
import type { UserRole } from '@/lib/db';
import { ROLE_LABELS } from '@/lib/permissions';
import { podeVerModulo, moduloDaRota, telaInicial, type Modulo } from '@/lib/roles';
import { Spinner } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { TrocarSenhaModal } from './TrocarSenhaModal';
import { FilaEnvioAviso } from './FilaEnvioAviso';
import { AppCelularMenu } from './AppCelularMenu';
import { AppCelularContext, useAppCelularEstado, type AppCelular } from '@/lib/useAppCelular';

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

// Cada item aponta pro módulo de roles.ts; quem não pode ver o módulo não
// recebe o item (esconder, não desabilitar). Não é a barreira de segurança —
// a API recusa também.
interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  modulo: Modulo;
}

const GRUPOS: { titulo: string; itens: NavItem[] }[] = [
  {
    titulo: 'Operação',
    itens: [
      { href: '/', label: 'Ordens de Serviço', icon: 'os', modulo: 'os' },
      { href: '/rotas', label: 'Rotas', icon: 'rotas', modulo: 'rotas' },
      { href: '/mapa', label: 'Mapa ao vivo', icon: 'mapa', modulo: 'mapa' },
      { href: '/plantao', label: 'Escala de plantão', icon: 'relogio', modulo: 'plantao' },
      { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', modulo: 'dashboard' },
    ],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { href: '/condominios', label: 'Condomínios', icon: 'condominio', modulo: 'condominios' },
      { href: '/painel', label: 'Painel do Síndico', icon: 'painel', modulo: 'painel' },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [{ href: '/financeiro', label: 'Financeiro', icon: 'financeiro', modulo: 'financeiro' }],
  },
  {
    titulo: 'Administração',
    itens: [{ href: '/admin/usuarios', label: 'Usuários', icon: 'usuarios', modulo: 'usuarios' }],
  },
];

// Manual de uso: todo papel vê, mas só o conteúdo do próprio papel (ver
// manuaisVisiveis em src/lib/manual.ts). Fica separado, perto do rodapé.
const ITEM_AJUDA: NavItem = { href: '/ajuda', label: 'Ajuda', icon: 'ajuda', modulo: 'ajuda' };

// O síndico enxerga só o condomínio dele, então pra ele o painel tem outro nome.
function rotuloDoItem(item: { label: string; modulo: Modulo }, role: UserRole): string {
  if (item.modulo === 'painel' && role === 'sindico') return 'Painel do Condomínio';
  return item.label;
}

function itemAtivo(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

const CHAVE_RECOLHIDO = 'amx-menu-recolhido';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amx-blue-light';

function LinkDoMenu({
  item,
  role,
  pathname,
  compacto,
}: {
  item: NavItem;
  role: UserRole;
  pathname: string;
  compacto: boolean;
}) {
  const ativo = itemAtivo(item.href, pathname);
  const rotulo = rotuloDoItem(item, role);
  return (
    <a
      href={item.href}
      title={compacto ? rotulo : undefined}
      aria-label={compacto ? rotulo : undefined}
      aria-current={ativo ? 'page' : undefined}
      className={`flex items-center min-h-[44px] rounded-[10px] border text-sm font-medium transition-colors ${FOCO} ${
        compacto ? 'w-11 justify-center mx-auto' : 'gap-3 px-3'
      } ${
        ativo
          ? 'bg-amx-red/14 border-amx-red/40 text-white'
          : 'border-transparent text-amx-muted hover:text-white hover:bg-amx-panel hover:border-amx-line'
      }`}
    >
      <Icon name={item.icon} size={20} className="shrink-0" />
      {!compacto && <span className="truncate">{rotulo}</span>}
    </a>
  );
}

// Conteúdo do menu, igual na barra lateral e na gaveta do celular.
function MenuConteudo({
  user,
  pathname,
  compacto,
  app,
  onTrocarSenha,
  onSair,
}: {
  user: AmxUser;
  pathname: string;
  compacto: boolean;
  app: AppCelular;
  onTrocarSenha: () => void;
  onSair: () => void;
}) {
  const grupos = GRUPOS.map((g) => ({
    titulo: g.titulo,
    itens: g.itens.filter((i) => podeVerModulo(user.role, i.modulo)),
  })).filter((g) => g.itens.length > 0);
  const ajuda = podeVerModulo(user.role, ITEM_AJUDA.modulo) ? ITEM_AJUDA : null;
  // Com poucos itens (ex.: síndico) os títulos de grupo só atrapalham.
  const total = grupos.reduce((n, g) => n + g.itens.length, 0) + (ajuda ? 1 : 0);
  const comTitulos = total > 3;

  const botaoRodape = `flex items-center min-h-[44px] rounded-[10px] text-sm font-medium text-amx-muted hover:text-white hover:bg-amx-panel transition-colors ${FOCO} ${
    compacto ? 'w-11 justify-center mx-auto' : 'gap-3 px-3 w-full text-left'
  }`;

  return (
    <>
      <nav aria-label="Menu principal" className="flex-1 flex flex-col gap-1">
        {grupos.map((g, idx) => (
          <div key={g.titulo} className={idx > 0 ? 'mt-3' : ''}>
            {comTitulos &&
              (compacto ? (
                idx > 0 && <div className="mx-3 mb-2 border-t border-amx-line" aria-hidden />
              ) : (
                <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-amx-muted/80">
                  {g.titulo}
                </div>
              ))}
            <div className="flex flex-col gap-1">
              {g.itens.map((item) => (
                <LinkDoMenu
                  key={item.href}
                  item={item}
                  role={user.role}
                  pathname={pathname}
                  compacto={compacto}
                />
              ))}
            </div>
          </div>
        ))}
        {ajuda && (
          <div className="mt-auto pt-3">
            <LinkDoMenu item={ajuda} role={user.role} pathname={pathname} compacto={compacto} />
          </div>
        )}
      </nav>

      <div className="mt-3 pt-3 border-t border-amx-line flex flex-col gap-1">
        {!compacto && (
          <div className="px-3 pb-2 min-w-0">
            <div className="text-sm font-semibold text-white truncate">{user.name}</div>
            <div className="text-xs text-amx-muted">{ROLE_LABELS[user.role]}</div>
          </div>
        )}
        <AppCelularMenu app={app} compacto={compacto} mostrarAvisos botaoClasse={botaoRodape} />
        <button
          type="button"
          onClick={onTrocarSenha}
          title={compacto ? 'Trocar senha' : undefined}
          aria-label={compacto ? 'Trocar senha' : undefined}
          className={botaoRodape}
        >
          <Icon name="senha" size={20} className="shrink-0" />
          {!compacto && 'Trocar senha'}
        </button>
        <button
          type="button"
          onClick={onSair}
          title={compacto ? 'Sair' : undefined}
          aria-label={compacto ? 'Sair' : undefined}
          className={botaoRodape}
        >
          <Icon name="sair" size={20} className="shrink-0" />
          {!compacto && 'Sair'}
        </button>
      </div>
    </>
  );
}

function Marca({ comNome }: { comNome: boolean }) {
  // Selo 670x180: expandido ~36 px de altura (134 px de largura) com a legenda
  // embaixo; recolhido (menu de 76 px) cabe em ~56 px de largura.
  return (
    <div className={`flex min-w-0 ${comNome ? 'flex-col items-start gap-1' : 'items-center justify-center'}`}>
      <Image
        src="/brand/logo-amotex-selo.png"
        alt="Amotex"
        width={670}
        height={180}
        priority
        className={comNome ? 'h-9 w-auto shrink-0' : 'w-14 h-auto shrink-0'}
      />
      {comNome && (
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amx-muted truncate">Prevent · Sistema de OS</span>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  // Mesmo timeout de inatividade herdado do NexusFlow em todas as telas
  // autenticadas (ver src/lib/useIdleLogout.ts).
  useIdleLogout(10);

  const pathname = usePathname();
  const app = useAppCelularEstado();
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

  const [trocarSenha, setTrocarSenha] = useState(false);

  // Barra lateral (desktop): aberta por padrão; a preferência de recolher
  // fica no navegador. Sem storage (aba privada etc.) segue aberta.
  const [recolhido, setRecolhido] = useState(false);
  useEffect(() => {
    try {
      // Lê o storage só depois de montar (evita divergir do HTML do servidor).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(CHAVE_RECOLHIDO) === '1') setRecolhido(true);
    } catch {
      /* sem storage: fica aberta */
    }
  }, []);
  const alternarRecolhido = () => {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      localStorage.setItem(CHAVE_RECOLHIDO, novo ? '1' : '0');
    } catch {
      /* sem storage: vale só nesta sessão */
    }
  };

  // Gaveta do celular: fecha ao navegar e com Esc; o foco vai pra ela ao abrir
  // e volta pro botão "Menu" ao fechar.
  // Guarda a rota em que abriu: ao navegar, a gaveta deixa de valer sozinha.
  const [gavetaEm, setGavetaEm] = useState<string | null>(null);
  const gaveta = gavetaEm === pathname;
  const setGaveta = (aberta: boolean) => setGavetaEm(aberta ? pathname : null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const gavetaRef = useRef<HTMLDivElement>(null);
  // Falso quando a gaveta fecha para abrir outra camada (Trocar senha): o foco
  // fica com ela, não volta pro botão "Menu" que está atrás.
  const devolverFoco = useRef(true);
  useEffect(() => {
    if (!gaveta) return;
    const botao = botaoMenuRef.current;
    gavetaRef.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGavetaEm(null);
        return;
      }
      // Prende o Tab dentro da gaveta (aria-modal não faz isso sozinho).
      if (e.key === 'Tab' && gavetaRef.current) {
        const focaveis = gavetaRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (focaveis.length === 0) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        const ativo = document.activeElement;
        if (e.shiftKey && (ativo === primeiro || ativo === gavetaRef.current)) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && ativo === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    };
    document.addEventListener('keydown', aoTeclar);
    // Ao alargar a tela a gaveta some por CSS: fecha, senão a rolagem fica travada.
    const larga = window.matchMedia('(min-width: 1024px)');
    const aoMudarLargura = () => {
      if (larga.matches) setGavetaEm(null);
    };
    larga.addEventListener('change', aoMudarLargura);
    // Voltar do navegador pode restaurar a página (bfcache) com a gaveta aberta.
    const aoVoltar = (e: PageTransitionEvent) => {
      if (e.persisted) setGavetaEm(null);
    };
    window.addEventListener('pageshow', aoVoltar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      larga.removeEventListener('change', aoMudarLargura);
      window.removeEventListener('pageshow', aoVoltar);
      document.body.style.overflow = overflowAnterior;
      if (devolverFoco.current) botao?.focus();
      devolverFoco.current = true;
    };
  }, [gaveta]);

  // Guard central: quem abre pela URL uma tela que não é do seu papel é
  // levado pra tela inicial dele, sem renderizar o conteúdo.
  const moduloAtual = moduloDaRota(pathname);
  const semAcesso = !!user && !!moduloAtual && !podeVerModulo(user.role, moduloAtual);
  useEffect(() => {
    if (user && semAcesso) window.location.replace(telaInicial(user.role));
  }, [user, semAcesso]);

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

  if (semAcesso) {
    return (
      <div className="min-h-screen shrink-0 flex items-center justify-center bg-amx-bg">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  // Nome da tela atual pra barra do celular.
  const itemAtual = [...GRUPOS.flatMap((g) => g.itens), ITEM_AJUDA].find(
    (i) => podeVerModulo(user.role, i.modulo) && itemAtivo(i.href, pathname),
  );
  const telaAtual = itemAtual ? rotuloDoItem(itemAtual, user.role) : 'Amotex Prevent';

  return (
    <UserContext.Provider value={user}>
      <AppCelularContext.Provider value={app}>
      {/* shrink-0: evita o mesmo bug de fundo cortado do admin/usuarios
          original (ver comentário lá) — este componente é montado direto
          como filho de <body className="flex flex-col"> em layout.tsx. */}
      <div className="min-h-screen shrink-0 flex flex-col lg:flex-row bg-amx-bg">
        {/* Celular: barra no topo com o nome da tela e o botão Menu */}
        <header className="lg:hidden sticky top-0 z-30 h-14 shrink-0 print:hidden bg-amx-panel-2 border-b border-amx-line flex items-center gap-3 px-3">
          <div
            className="w-9 h-9 shrink-0 rounded-lg bg-amx-red flex items-center justify-center font-heading font-bold text-[14px]"
            aria-hidden
          >
            AP
          </div>
          <div className="flex-1 min-w-0 font-heading font-semibold text-[15px] truncate">
            {telaAtual}
          </div>
          <button
            ref={botaoMenuRef}
            type="button"
            onClick={() => setGaveta(true)}
            aria-haspopup="dialog"
            aria-controls="menu-gaveta"
            aria-expanded={gaveta}
            className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-[10px] border border-amx-line text-sm font-medium text-white hover:bg-amx-panel ${FOCO}`}
          >
            <Icon name="menu" size={20} />
            Menu
          </button>
        </header>

        {/* Desktop: barra lateral fixa */}
        <aside
          className={`hidden lg:flex sticky top-0 h-screen shrink-0 print:hidden bg-amx-panel-2 border-r border-amx-line flex-col py-5 px-3 gap-5 overflow-y-auto ${
            recolhido ? 'w-[76px]' : 'w-[232px]'
          }`}
        >
          <div className={recolhido ? 'flex justify-center' : 'px-1'}>
            <Marca comNome={!recolhido} />
          </div>
          <MenuConteudo
            user={user}
            pathname={pathname}
            compacto={recolhido}
            app={app}
            onTrocarSenha={() => setTrocarSenha(true)}
            onSair={handleLogout}
          />
          <button
            type="button"
            onClick={alternarRecolhido}
            title={recolhido ? 'Expandir menu' : undefined}
            aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!recolhido}
            className={`flex items-center min-h-[44px] rounded-[10px] text-sm font-medium text-amx-muted hover:text-white hover:bg-amx-panel transition-colors ${FOCO} ${
              recolhido ? 'w-11 justify-center mx-auto' : 'gap-3 px-3'
            }`}
          >
            <Icon name={recolhido ? 'chevronDireita' : 'voltar'} size={20} className="shrink-0" />
            {!recolhido && 'Recolher'}
          </button>
        </aside>

        {/* Celular: gaveta da esquerda */}
        {gaveta && (
          <div className="lg:hidden fixed inset-0 z-40 print:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setGaveta(false)}
              aria-hidden
            />
            <div
              ref={gavetaRef}
              id="menu-gaveta"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              tabIndex={-1}
              className="absolute inset-y-0 left-0 w-[85%] max-w-[340px] bg-amx-panel-2 border-r border-amx-line flex flex-col p-4 overflow-y-auto outline-none"
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <Marca comNome />
                <button
                  type="button"
                  onClick={() => setGaveta(false)}
                  className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-[10px] border border-amx-line text-sm font-medium text-white hover:bg-amx-panel ${FOCO}`}
                >
                  <Icon name="fechar" size={20} />
                  Fechar
                </button>
              </div>
              <MenuConteudo
                user={user}
                pathname={pathname}
                compacto={false}
                app={app}
                onTrocarSenha={() => {
                  devolverFoco.current = false;
                  setGaveta(false);
                  setTrocarSenha(true);
                }}
                onSair={handleLogout}
              />
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 flex flex-col">
          <FilaEnvioAviso />
          {children}
        </main>
      </div>
      <TrocarSenhaModal open={trocarSenha} onClose={() => setTrocarSenha(false)} nome={user.name} />
      </AppCelularContext.Provider>
    </UserContext.Provider>
  );
}
