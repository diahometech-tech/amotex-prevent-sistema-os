import React from 'react';

export function Card({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-amx-surface border border-amx-border rounded-[var(--radius-amx)] shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
