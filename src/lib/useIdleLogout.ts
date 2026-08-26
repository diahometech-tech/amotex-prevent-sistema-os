'use client';

import { useEffect, useRef } from 'react';

// Eventos que contam como "atividade" do usuário — qualquer um deles reinicia
// o contador de inatividade.
const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

// Desloga automaticamente a sessão após N minutos sem nenhuma interação do
// usuário. Usado em todas as telas autenticadas do fluxo de trabalho interno
// (kanban, admin de usuários, portal do terceiro) — o captador fica de fora
// porque `public/captador.html` é um PWA offline separado, usado em campo
// com sessões naturalmente mais longas e conectividade intermitente.
export function useIdleLogout(minutes: number = 10) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timeoutMs = minutes * 60 * 1000;

    const doLogout = () => {
      fetch('/api/auth/logout', { method: 'POST' })
        .catch(() => {})
        .finally(() => {
          window.location.href = '/login?motivo=inatividade';
        });
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(doLogout, timeoutMs);
    };

    IDLE_EVENTS.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      IDLE_EVENTS.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [minutes]);
}
