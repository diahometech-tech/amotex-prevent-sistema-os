import React from 'react';

export function Card({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-amx-panel border border-amx-line rounded-[var(--radius-amx)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
