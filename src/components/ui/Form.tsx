import React from 'react';

const FIELD_CLASSES =
  'text-sm bg-amx-panel-2 border border-amx-line rounded-lg p-2.5 text-white placeholder:text-amx-muted outline-none focus:border-amx-red disabled:opacity-50';

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
        <span className="font-heading text-[11px] font-semibold text-amx-muted uppercase tracking-wider">
          {label}
          {required && <span className="text-amx-red"> *</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="text-[11px] text-amx-muted">{hint}</span>}
      {error && <span className="text-[11px] font-semibold text-amx-red-hover">{error}</span>}
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

// Toggle switch (interruptor) — usado em "Monitoramento ativo" no cadastro
// de condomínio, mesmo visual do protótipo (trilho + bolinha, vermelho
// quando ligado).
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label
      className={`flex items-center gap-3 p-3 bg-amx-panel-2 border border-amx-line rounded-lg ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${checked ? 'bg-amx-red' : 'bg-amx-line'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex flex-col">
        <span className="text-xs text-white">{label}</span>
        {hint && <span className="text-[11px] text-amx-muted">{hint}</span>}
      </div>
    </label>
  );
}
