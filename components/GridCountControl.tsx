'use client';

import { GRID_COUNTS, type GridCount } from '@/lib/gridLayout';

interface GridCountControlProps {
  value: GridCount;
  onChange: (n: GridCount) => void;
}

/**
 * Segmented control for picking the multi-pane grid count (1/2/4/6).
 * Lives in the chart toolbar above the grid; clicking a button
 * immediately switches the layout. ARIA radiogroup semantics.
 */
export default function GridCountControl({ value, onChange }: GridCountControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Number of charts"
      className="inline-flex items-center rounded-md border border-line bg-surface-1 p-0.5 font-mono text-[12px]"
    >
      {GRID_COUNTS.map((n) => {
        const active = n === value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(n)}
            className={[
              'focus-ring min-w-[26px] rounded px-2 py-1 transition',
              active
                ? 'bg-surface-3 text-ink'
                : 'text-ink-faint hover:bg-surface-2 hover:text-ink',
            ].join(' ')}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}