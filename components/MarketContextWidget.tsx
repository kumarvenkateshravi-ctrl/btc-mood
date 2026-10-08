'use client';

// Compact Market Context widget (MTFPlan Phase 11): bias, context score,
// confidence/conflict, trend/momentum/volume strength, risk — plus the latest
// detailed MTF view. Reads the shared MarketContext.

import type { MarketContext } from '@/lib/context/types';

/** Directional strength stars: |score − 50| × 2 mapped to 0..5. */
export const strengthStars = (score: number): string => {
  const filled = Math.max(0, Math.min(5, Math.round(Math.abs(score - 50) / 10)));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
};

export const riskLabel = (ctx: MarketContext): 'Low' | 'Medium' | 'High' => {
  if (ctx.conflictScore >= 50 || ctx.confidence < 40) return 'High';
  if (ctx.conflictScore >= 30 || ctx.confidence < 60) return 'Medium';
  return 'Low';
};

const BIAS_UI = {
  bullish: { dot: 'bg-bull-bright', text: 'text-bull-bright', label: 'Bullish' },
  bearish: { dot: 'bg-bear-bright', text: 'text-bear-bright', label: 'Bearish' },
  neutral: { dot: 'bg-ink-faint', text: 'text-ink-muted', label: 'Neutral' },
} as const;

export default function MarketContextWidget({
  ctx,
  onOpenDetails,
}: {
  ctx: MarketContext;
  onOpenDetails?: () => void;
}) {
  const ui = BIAS_UI[ctx.overallBias];
  return (
    <button
      type="button"
      onClick={onOpenDetails}
      aria-label="Market context — open multi-timeframe details"
      className="focus-ring w-[172px] rounded-lg border border-line bg-surface-1 px-2.5 py-2 text-left text-[11px] shadow-sm transition hover:border-accent/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Context</span>
        <span className={`flex items-center gap-1 font-semibold ${ui.text}`}>
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
          {ui.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="font-mono text-lg tabular-nums text-ink">{Math.round(ctx.contextScore)}</span>
        <span className="font-mono text-[10px] tabular-nums text-ink-faint">
          conf {ctx.confidence} · dis {ctx.conflictScore}
        </span>
      </div>
      <dl className="mt-1 space-y-0.5 text-ink-muted">
        <div className="flex justify-between"><dt>Trend</dt><dd className="font-mono">{strengthStars(ctx.trendScore)}</dd></div>
        <div className="flex justify-between"><dt>Momentum</dt><dd className="font-mono">{strengthStars(ctx.momentumScore)}</dd></div>
        <div className="flex justify-between"><dt>Volume</dt><dd className="font-mono">{strengthStars(ctx.volumeScore)}</dd></div>
        <div className="flex justify-between"><dt>Risk</dt><dd>{riskLabel(ctx)}</dd></div>
      </dl>
    </button>
  );
}
