import React from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-amx-red hover:bg-amx-red-hover text-white',
  secondary: 'bg-transparent border border-amx-line text-amx-muted hover:text-white hover:border-amx-muted',
  danger: 'bg-transparent border border-amx-red text-amx-red hover:bg-amx-red/10',
  ghost: 'bg-transparent hover:bg-amx-panel-2 text-amx-muted hover:text-white',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 rounded-md gap-1.5',
  md: 'text-sm px-4 py-2.5 rounded-lg gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
}
