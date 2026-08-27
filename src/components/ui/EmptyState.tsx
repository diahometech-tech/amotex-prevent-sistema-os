import React from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-14 px-6">
      <p className="text-sm font-bold text-white">{title}</p>
      {description && <p className="text-xs text-amx-muted max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-4 w-4 rounded-full border-2 border-amx-line border-t-amx-red animate-spin ${className}`}
      role="status"
      aria-label="Carregando"
    />
  );
}
