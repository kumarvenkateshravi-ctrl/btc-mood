'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Narration } from '@/lib/narrate';

type Side = Narration['side'];

const SIDE_ICON = { bullish: TrendingUp, bearish: TrendingDown, neutral: Minus } as const;
const SIDE_INK: Record<Side, string> = {
  bullish: 'text-bull-bright',
  bearish: 'text-bear-bright',
  neutral: 'text-neutral',
};
const SIDE_GLOW: Record<Side, string> = {
  bullish: 'oklch(0.78 0.165 162 / 0.16)',
  bearish: 'oklch(0.685 0.205 18 / 0.16)',
  neutral: 'oklch(0.72 0.030 264 / 0.12)',
};

interface MoodNarrativeProps {
  narration: Narration;
  variant: 'casual' | 'analyst';
}

export default function MoodNarrative({ narration, variant }: MoodNarrativeProps) {
  const Icon = SIDE_ICON[narration.side];

  if (variant === 'casual') {
    return (
      <section
        aria-label="What Bitcoin is doing"
        className="panel relative overflow-hidden rounded-2xl p-5 sm:p-7"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full blur-3xl"
          style={{ background: SIDE_GLOW[narration.side] }}
        />
        <div className="relative flex items-start gap-4">
          <span
            className={`mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-line ${SIDE_INK[narration.side]}`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className={`text-xl font-semibold tracking-tight sm:text-2xl ${SIDE_INK[narration.side]}`}>
              {narration.headline}
            </h2>
            <p className="mt-1.5 max-w-2xl text-pretty text-sm leading-relaxed text-ink-muted sm:text-base">
              {narration.summary}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Analyst: a slim, denser band with the analytic detail line.
  return (
    <section
      aria-label="Mood explanation"
      className="panel flex items-start gap-3 rounded-2xl px-4 py-3 sm:px-5"
    >
      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-line ${SIDE_INK[narration.side]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">
          {narration.headline}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{narration.detail}</p>
      </div>
    </section>
  );
}
