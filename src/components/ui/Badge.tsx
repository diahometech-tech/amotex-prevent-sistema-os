import React from 'react';

export type BadgeTone = 'navy' | 'red' | 'success' | 'warning' | 'info' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
  navy: 'bg-amx-navy-100 text-amx-navy-800',
  red: 'bg-amx-red-100 text-amx-red-700',
  success: 'bg-amx-success-50 text-amx-success-600',
  warning: 'bg-amx-warning-50 text-amx-warning-600',
  info: 'bg-amx-info-50 text-amx-info-600',
  neutral: 'bg-amx-navy-50 text-amx-muted',
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
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
