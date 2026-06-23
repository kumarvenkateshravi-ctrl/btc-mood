'use client';

import { Gauge, Radar, Waves, type LucideIcon } from 'lucide-react';

export type RightPanelId = 'mood' | 'signals' | 'orderflow';

const ITEMS: { id: RightPanelId; label: string; Icon: LucideIcon }[] = [
  { id: 'mood', label: 'Mood', Icon: Gauge },
  { id: 'signals', label: 'Signals', Icon: Radar },
  { id: 'orderflow', label: 'Order Flow', Icon: Waves },
];

/**
 * Far-right vertical icon dock (TV-style). Always visible; each icon selects
 * which panel the right rail shows. Clicking the active icon collapses the rail.
 */
export default function RightDock({
  active,
  onSelect,
}: {
  active: RightPanelId | null;
  onSelect: (id: RightPanelId) => void;
}) {
  return (
    <div className="hidden xl:flex w-20 shrink-0 flex-col items-stretch gap-2 border-l border-line-strong bg-surface-2 px-2 py-3 shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.6)]">
      {ITEMS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            className={[
              'focus-ring group relative flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 transition-all duration-150',
              isActive
                ? 'bg-accent/15 text-accent ring-1 ring-accent/40 shadow-[0_0_16px_-4px_rgba(99,102,241,0.45)]'
                : 'text-ink-muted hover:-translate-y-px hover:bg-surface-3 hover:text-ink',
            ].join(' ')}
          >
            <Icon className={['transition-transform', isActive ? 'h-6 w-6' : 'h-[22px] w-[22px] group-hover:scale-110'].join(' ')} />
            <span className="text-center text-[10px] font-semibold leading-tight tracking-tight">{label}</span>
            {isActive && (
              <span className="absolute -left-2 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_10px_rgba(99,102,241,0.8)]" />
            )}
          </button>
        );
      })}
    </div>
  );
}
