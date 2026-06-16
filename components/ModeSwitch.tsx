'use client';

import { Gauge, Microscope, Sparkles } from 'lucide-react';
import { MODE_CONFIG, VIEW_MODES, type ViewMode } from '@/lib/viewMode';

const ICON: Record<ViewMode, typeof Gauge> = {
  trader: Gauge,
  analyst: Microscope,
  casual: Sparkles,
};

interface ModeSwitchProps {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}

export default function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-base/60 p-1"
    >
      {VIEW_MODES.map((m) => {
        const cfg = MODE_CONFIG[m];
        const Icon = ICON[m];
        const active = m === mode;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={active}
            title={cfg.blurb}
            onClick={() => onChange(m)}
            className={[
              'focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors duration-150',
              active
                ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--line-strong)]'
                : 'text-ink-faint hover:text-ink',
            ].join(' ')}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? 'text-accent' : ''}`} />
            <span className="hidden sm:inline">{cfg.label}</span>
          </button>
        );
      })}
    </div>
  );
}
