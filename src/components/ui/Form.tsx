import React from 'react';

const FIELD_CLASSES =
  'text-sm bg-white border border-amx-border rounded-lg p-2.5 outline-none focus:border-amx-navy-600 focus:ring-1 focus:ring-amx-navy-600 disabled:bg-amx-canvas disabled:text-amx-muted';

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  // <div>, não <label>: alguns usos colocam um <label> próprio dentro
  // (ex.: checkbox com texto ao lado) — aninhar <label> em <label> é HTML
  // inválido e alguns navegadores disparam o clique duas vezes.
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span className="text-xs font-semibold text-amx-ink">
          {label}
          {required && <span className="text-amx-red-600"> *</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="text-[11px] text-amx-muted">{hint}</span>}
      {error && <span className="text-[11px] font-semibold text-amx-red-600">{error}</span>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`${FIELD_CLASSES} ${className}`} {...props} />
  )
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...props }, ref) => (
    <select ref={ref} className={`${FIELD_CLASSES} ${className}`} {...props}>
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...props }, ref) => (
    <textarea ref={ref} className={`${FIELD_CLASSES} resize-none ${className}`} {...props} />
  )
);
Textarea.displayName = 'Textarea';
