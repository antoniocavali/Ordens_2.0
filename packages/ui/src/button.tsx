import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export const buttonVariants = cva(
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-fg shadow-sm shadow-primary/20 hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring',
        secondary: 'bg-surface-2 text-text hover:bg-surface-3',
        outline: 'border border-border-strong bg-surface text-text hover:bg-surface-2',
        ghost: 'text-muted hover:bg-surface-2 hover:text-text',
        danger: 'bg-danger text-white hover:opacity-90',
        soft: 'bg-primary-soft text-primary hover:bg-primary-soft/70',
      },
      size: {
        xs: 'h-7 rounded-md px-2 text-xs',
        sm: 'h-8 rounded-md px-3 text-[13px]',
        md: 'h-9 rounded-md px-3.5 text-sm',
        lg: 'h-11 rounded-lg px-5 text-[15px]',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    if (asChild) {
      // Slot exige exatamente um elemento filho.
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    const Comp = 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
