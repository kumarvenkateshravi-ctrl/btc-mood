'use client';

// MDS Phase C — Button primitive.
// The single canonical interactive element for all actions in the product.
// Every raw <button> in the codebase should migrate to this component.
//
// Variants:
//   ghost   — no background; used for icon toolbar actions and low-emphasis row actions
//   outline — border at rest; used for secondary/cancel actions
//   solid   — accent-filled; used for primary CTA (Submit, Confirm)
//   danger  — bear-colored; used for destructive actions (Close Position)
//
// Sizes: sm (28px) | md (32px, default) | lg (40px)
// Loading: replaces icon with a spinner; keeps label visible.
// Icon: optional leading icon slot (any ReactNode).

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './util';

export type ButtonVariant = 'ghost' | 'outline' | 'solid' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  ghost:
    'border-transparent bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink',
  outline:
    'border-line bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink',
  solid:
    'border-transparent bg-accent text-white hover:bg-accent-bright',
  danger:
    'border-transparent bg-bear text-white hover:opacity-90',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7  px-2   text-[11px] gap-1   rounded-md',
  md: 'h-8  px-3   text-xs     gap-1.5 rounded-lg',
  lg: 'h-10 px-4   text-sm     gap-2   rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'outline',
      size = 'md',
      icon,
      loading = false,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={cx(
          'focus-ring inline-flex items-center justify-center border font-medium transition-colors',
          'disabled:pointer-events-none disabled:opacity-40',
          VARIANT[variant],
          SIZE[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          icon && <span aria-hidden className="shrink-0">{icon}</span>
        )}
        {children && <span>{children}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';
