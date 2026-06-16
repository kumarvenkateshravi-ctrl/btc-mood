'use client';

import type { Timeframe } from '@/lib/types';
import type { TFSnapshot } from '@/lib/signals';

interface TimeframeStripProps {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
  prices: Record<Timeframe, number | null>;
  changes: Record<Timeframe, number | null>;
  snapshots: Record<Timeframe, TFSnapshot | null>;
  errors: Record<Timeframe, string | null>;
  timeframes: Timeframe[];
}

type Side = 'buy' | 'sell' | 'neutral';

const SIDE_LABEL: Record<Side, string> = { buy: 'BUY', sell: 'SELL', neutral: 'WAIT' };
// Direction is encoded by color, an arrow glyph, AND the word — never
// hue alone, so it reads for colorblind users.
const SIDE_GLYPH: Record<Side, string> = { buy: '▲', sell: '▼', neutral: '•' };
const SIDE_CHIP: Record<Side, string> = {
  buy: 'text-bull-bright bg-bull/12 ring-bull/30',
  sell: 'text-bear-bright bg-bear/12 ring-bear/30',
  neutral: 'text-neutral bg-neutral/10 ring-neutral/25',
};
const REGIME_COLOR: Record<'calm' | 'normal' | 'hot', string> = {
  calm: 'text-regime-calm',
  normal: 'text-ink-faint',
  hot: 'text-regime-hot',
};

function fmtPrice(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChange(n: number | null): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function TimeframeStrip({
  selected,
  onSelect,
  prices,
  changes,
  snapshots,
  errors,
  timeframes,
}: TimeframeStripProps) {
  return (
    <div className="scroll-x -mx-1 overflow-x-auto px-1">
      <div className="flex min-w-max gap-2.5">
        {timeframes.map((tf) => {
          const isActive = tf === selected;
          const change = changes[tf];
          const changeColor =
            change == null ? 'text-ink-faint' : change >= 0 ? 'text-bull-bright' : 'text-bear-bright';
          const snap = snapshots[tf] ?? null;
          const side: Side = snap?.signal.side ?? 'neutral';
          const hasError = Boolean(errors[tf]);
          const isFresh = snap?.signal.fresh === true;

          return (
            <button
              key={tf}
              onClick={() => onSelect(tf)}
              aria-pressed={isActive}
              title={hasError ? `Fetch error: ${errors[tf]}` : undefined}
              className={[
                'focus-ring group relative flex min-w-[156px] flex-col gap-2 rounded-xl border px-4 py-3 text-left transition duration-200',
                isActive
                  ? 'border-accent/50 bg-surface-2 shadow-[0_0_0_1px_var(--accent-dim),0_10px_30px_oklch(0_0_0_/0.4)]'
                  : 'border-line bg-surface-1/70 hover:border-line-strong hover:bg-surface-1',
              ].join(' ')}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={[
                    'font-mono text-xs uppercase tracking-widest',
                    isActive ? 'text-ink' : 'text-ink-faint',
                  ].join(' ')}
                >
                  {tf}
                </span>
                <div className="flex items-center gap-1.5">
                  {isFresh && (
                    <span
                      aria-label="fresh signal"
                      className="h-1.5 w-1.5 rounded-full bg-bull"
                      style={{ boxShadow: '0 0 7px var(--bull)' }}
                    />
                  )}
                  {hasError && (
                    <span aria-label="fetch error" className="h-1.5 w-1.5 rounded-full bg-bear" />
                  )}
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${SIDE_CHIP[side]}`}
                  >
                    <span aria-hidden>{SIDE_GLYPH[side]}</span>
                    {SIDE_LABEL[side]}
                  </span>
                </div>
              </div>

              <div className="font-mono text-lg tabular-nums text-ink">{fmtPrice(prices[tf])}</div>

              <div className="flex w-full items-center justify-between">
                <span className={`font-mono text-xs tabular-nums ${changeColor}`}>
                  {fmtChange(change)}
                </span>
                {snap?.regime && (
                  <span
                    className={`text-[10px] uppercase tracking-wider ${REGIME_COLOR[snap.regime.label]}`}
                    title={`ATR ${snap.regime.atrPct.toFixed(2)}% of close`}
                  >
                    {snap.regime.label}
                  </span>
                )}
              </div>

              {/* Active rail: a calm underline, not a side-stripe. */}
              <span
                aria-hidden
                className={[
                  'absolute inset-x-3 bottom-0 h-px origin-left rounded-full bg-accent transition-transform duration-300',
                  isActive ? 'scale-x-100' : 'scale-x-0',
                ].join(' ')}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
