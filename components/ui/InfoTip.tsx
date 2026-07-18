'use client';

// MDS — InfoTip. Hover/focus tooltip for specialized terms. role="tooltip",
// keyboard-focusable trigger, dismiss on blur/Escape. Content comes from an
// explicit `content` prop or the SMC glossary keyed by `term`.

import { useId, useState, type ReactNode } from 'react';
import { cx } from './util';

export const SMC_GLOSSARY: Record<string, string> = {
  'Stacked FVG': 'Open Fair Value Gaps overlapping in the same direction. Multiple stacked gaps often indicate stronger imbalance.',
  'Order Block': 'The last opposing candle before an impulsive move — a zone institutions may defend on a retest.',
  'Liquidity Sweep': 'Price runs beyond a prior swing to trigger resting orders, then reverses back inside the range.',
  'Premium/Discount': 'Halves of the current dealing range. Discount is the lower half, premium the upper, split at equilibrium.',
  'BOS': 'Break of Structure — price closes beyond the prior swing in the direction of trend, confirming continuation.',
  'CHoCH': 'Change of Character — the first structural break against the prevailing trend, signalling a possible shift.',
};

export function InfoTip({
  term, content, children, className,
}: {
  term?: string;
  content?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = content ?? (term ? SMC_GLOSSARY[term] : undefined) ?? '';

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        className={cx(
          'cursor-help border-b border-dotted border-ink-faint/60 bg-transparent p-0 text-left',
          className,
        )}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      >
        {children}
      </button>
      {open && text && (
        <span
          role="tooltip"
          id={id}
          className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[11px] leading-snug text-ink-muted shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
