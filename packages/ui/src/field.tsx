import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

export const inputBase =
  'w-full rounded-md bg-surface-2 px-3 text-sm text-text placeholder:text-subtle ring-1 ring-inset ring-transparent transition-[box-shadow,background] duration-150 hover:bg-surface-3/70 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:ring-danger/70';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputBase, 'h-9', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputBase, 'min-h-20 resize-y py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

const CHEVRON =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%238a86a0%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
}

/** Select nativo estilizado — para listas curtas e fixas (use AsyncCombobox para listas grandes). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ options, placeholder, className, style, ...props }, ref) => (
  <select
    ref={ref}
    {...props}
    className={cn(inputBase, 'h-9 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8', className)}
    style={{ backgroundImage: CHEVRON, ...style }}
  >
    {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
));
Select.displayName = 'Select';

export interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  /** Recebe o id e props ARIA a aplicar no controle. */
  children: (control: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + controle + dica/erro com associação ARIA. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
