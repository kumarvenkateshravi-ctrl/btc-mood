'use client';

import { useMemo } from 'react';
import type { Candle, Timeframe } from '@/lib/types';
import type { TFSnapshot } from '@/lib/signals';
import { buildRibbonSegments, type Side } from '@/lib/confluence';
import { detectDivergence } from '@/lib/divergence';
import { TriangleAlert } from 'lucide-react';

interface ConfluenceRibbonProps {
  candlesByTf: Record<Timeframe, Candle[]>;
  timeframes: Timeframe[];
  selected: Timeframe;
  snapshots: Record<Timeframe, TFSnapshot | null>;
  onSelectTf: (tf: Timeframe) => void;
}

const MAX_RIBBON_BARS = 1500;

const SIDE_STYLE: Record<Side, { bg: string; text: string; label: string; glyph: string }> = {
  buy: { bg: 'rgba(8, 153, 129, 0.9)', text: 'text-bull-bright', label: 'Buy', glyph: '▲' },
  sell: { bg: 'rgba(242, 54, 69, 0.9)', text: 'text-bear-bright', label: 'Sell', glyph: '▼' },
  neutral: { bg: 'rgba(123, 136, 160, 0.16)', text: 'text-ink-faint', label: 'Flat', glyph: '■' },
};

/**
 * Multi-timeframe confluence ribbon: one row per timeframe, each a time-aligned
 * heatmap of that timeframe's signal over the selected chart's time window.
 * Reads "the whole market's posture" at a glance — the thing a single
 * TradingView chart can't show. Direction is encoded by color *and* a glyph +
 * label (colorblind-safe).
 */
export default function ConfluenceRibbon({
  candlesByTf,
  timeframes,
  selected,
  snapshots,
  onSelectTf,
}: ConfluenceRibbonProps) {
  // Shared time domain = the selected timeframe's recent window. Capped so deep
  // lazy-loaded history keeps the ribbon (compute + DOM) bounded.
  const domain = useMemo(() => {
    const sel = (candlesByTf[selected] ?? []).slice(-MAX_RIBBON_BARS);
    if (sel.length < 2) return null;
    const t0 = sel[0].time;
    const t1 = sel[sel.length - 1].time;
    return t1 > t0 ? { t0, t1 } : null;
  }, [candlesByTf, selected]);

  const divergence = useMemo(() => detectDivergence(snapshots), [snapshots]);

  const rows = useMemo(() => {
    if (!domain) return [];
    return timeframes.map((tf) => {
      const candles = (candlesByTf[tf] ?? []).slice(-MAX_RIBBON_BARS);
      const segments = buildRibbonSegments(candles, tf, domain.t0, domain.t1);
      const current: Side = snapshots[tf]?.signal.side ?? 'neutral';
      const fresh = snapshots[tf]?.signal.fresh ?? false;
      return { tf, segments, current, fresh };
    });
  }, [domain, timeframes, candlesByTf, snapshots]);

  return (
    <section className="panel rounded-2xl p-3 sm:p-4" aria-label="Multi-timeframe posture">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          Multi-timeframe posture
        </h2>
        <span className="hidden text-[10px] uppercase tracking-wider text-ink-faint sm:inline">
          older → now
        </span>
      </div>

      {divergence.diverging && (
        <div
          role="status"
          className={[
            'mb-2.5 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-snug',
            divergence.lower === 'bearish'
              ? 'border-bear/30 bg-bear/10 text-bear-bright'
              : 'border-bull/30 bg-bull/10 text-bull-bright',
          ].join(' ')}
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-ink-muted">
            <span className="font-semibold text-ink">Divergence — </span>
            {divergence.message}
          </span>
        </div>
      )}

      {!domain ? (
        <div className="py-6 text-center text-xs text-ink-faint">Reading the market…</div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map(({ tf, segments, current, fresh }) => {
            const style = SIDE_STYLE[current];
            const active = tf === selected;
            return (
              <button
                key={tf}
                onClick={() => onSelectTf(tf)}
                aria-label={`${tf} ${style.label}`}
                aria-pressed={active}
                className={[
                  'group flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors focus-ring',
                  active ? 'bg-surface-2/70' : 'hover:bg-surface-1/50',
                ].join(' ')}
              >
                <span
                  className={[
                    'w-9 shrink-0 font-mono text-[11px] tabular-nums',
                    active ? 'text-ink' : 'text-ink-muted',
                  ].join(' ')}
                >
                  {tf}
                </span>

                <span
                  className={[
                    'flex w-14 shrink-0 items-center gap-1 text-[11px] font-medium',
                    style.text,
                    fresh ? '' : 'opacity-50',
                  ].join(' ')}
                  title={fresh ? undefined : 'Last bar is stale'}
                >
                  <span aria-hidden>{style.glyph}</span>
                  {style.label}
                </span>

                <div className="relative h-3 flex-1 overflow-hidden rounded bg-base/80 ring-1 ring-line/60">
                  {segments.map((seg, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0"
                      style={{
                        left: `${seg.leftPct}%`,
                        width: `${seg.widthPct}%`,
                        background: SIDE_STYLE[seg.side].bg,
                      }}
                    />
                  ))}
                  {/* "now" edge marker */}
                  <div className="absolute inset-y-0 right-0 w-px bg-ink/40" aria-hidden />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
