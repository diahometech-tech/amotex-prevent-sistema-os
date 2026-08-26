import React from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-amx-navy-800 hover:bg-amx-navy-700 text-white',
  secondary: 'bg-white hover:bg-amx-navy-50 text-amx-navy-800 border border-amx-border',
  danger: 'bg-amx-red-600 hover:bg-amx-red-700 text-white',
  ghost: 'bg-transparent hover:bg-amx-navy-50 text-amx-navy-800',
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
