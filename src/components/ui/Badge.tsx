import React from 'react';

export type BadgeTone = 'navy' | 'red' | 'success' | 'warning' | 'info' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
  navy: 'bg-amx-panel-2 text-amx-white border border-amx-line',
  red: 'bg-amx-red/16 text-amx-red',
  success: 'bg-amx-green/18 text-amx-green',
  warning: 'bg-amx-amber/16 text-amx-amber',
  info: 'bg-amx-blue/20 text-amx-blue-light',
  neutral: 'bg-amx-panel-2 text-amx-muted border border-amx-line',
};

export function Badge({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-heading text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
