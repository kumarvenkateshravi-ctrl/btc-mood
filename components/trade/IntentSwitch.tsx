'use client';

import { Activity, CandlestickChart, FastForward } from 'lucide-react';

export type TradeIntent = 'trade' | 'chart' | 'replay';

export const INTENT_OPTIONS: { id: TradeIntent; label: string; icon: typeof Activity }[] = [
  { id: 'trade', label: 'Trade', icon: Activity },
  { id: 'chart', label: 'Chart', icon: CandlestickChart },
  { id: 'replay', label: 'Replay', icon: FastForward },
];

interface IntentSwitchProps {
  value: TradeIntent;
  onChange: (v: TradeIntent) => void;
}

export default function IntentSwitch({ value, onChange }: IntentSwitchProps) {
  return (
    <div
      role="tablist"
      aria-label="Workspace intent"
      className="relative inline-flex items-center rounded-lg border border-line bg-surface-2/60 p-0.5 text-xs"
    >
      {INTENT_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={[
              'focus-ring relative z-10 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition',
              active ? 'text-ink' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        );
      })}
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-md bg-accent/20 ring-1 ring-accent/40 transition-transform"
        style={indicatorStyle(value)}
      />
    </div>
  );
}

function indicatorStyle(v: TradeIntent): React.CSSProperties {
  const idx = INTENT_OPTIONS.findIndex((o) => o.id === v);
  // Each pill is ~76px wide on average; positioning uses translateX so
  // the indicator slides between tabs.
  return {
    width: 'calc((100% - 4px) / 3)',
    transform: `translateX(${idx * 100}%)`,
    transition: 'transform 240ms cubic-bezier(0.25, 1, 0.5, 1)',
  };
}
