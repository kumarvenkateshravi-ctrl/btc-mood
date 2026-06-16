'use client';

import { useEffect, useRef, useState } from 'react';
import { COMPARE_SYMBOLS, type CompareSymbol } from '@/lib/compare';
import type { MoodVerdict, TFSnapshot } from '@/lib/signals';
import type { Timeframe } from '@/lib/types';

type Status = 'live' | 'demo' | 'loading';
type Side = 'bullish' | 'bearish' | 'neutral';

interface MoodStripProps {
  symbol: CompareSymbol;
  onSymbolChange: (s: CompareSymbol) => void;
  status: Status;
  price: number | null;
  change: number | null;
  mood: MoodVerdict;
  snapshots: Record<Timeframe, TFSnapshot | null>;
  timeframes: Timeframe[];
}

function deriveDisplay(mood: MoodVerdict): {
  side: Side;
  leaning: boolean;
  headline: string;
  count: number;
} {
  if (mood.side === 'bullish') {
    return { side: 'bullish', leaning: false, headline: 'Bullish', count: mood.bullishCount };
  }
  if (mood.side === 'bearish') {
    return { side: 'bearish', leaning: false, headline: 'Bearish', count: mood.bearishCount };
  }
  if (mood.bearishCount > mood.bullishCount) {
    return { side: 'bearish', leaning: true, headline: 'Bearish lean', count: mood.bearishCount };
  }
  if (mood.bullishCount > mood.bearishCount) {
    return { side: 'bullish', leaning: true, headline: 'Bullish lean', count: mood.bullishCount };
  }
  return { side: 'neutral', leaning: false, headline: 'Balanced', count: mood.neutralCount };
}

const SIDE_INK: Record<Side, string> = {
  bullish: 'text-bull-bright',
  bearish: 'text-bear-bright',
  neutral: 'text-neutral',
};

const SIDE_FLIP: Record<Side, string> = {
  bullish: 'oklch(0.86 0.175 162 / 0.55)',
  bearish: 'oklch(0.76 0.215 18 / 0.55)',
  neutral: 'oklch(0.72 0.030 264 / 0.4)',
};

const SEG_BG: Record<'buy' | 'sell' | 'neutral', string> = {
  buy: 'bg-bull',
  sell: 'bg-bear',
  neutral: 'bg-neutral-dim',
};

export default function MoodStrip({
  symbol,
  onSymbolChange,
  status,
  price,
  change,
  mood,
  snapshots,
  timeframes,
}: MoodStripProps) {
  const display = deriveDisplay(mood);

  // Flip detection: sweep light across the strip when the verdict's
  // committed side changes (and not on the initial load from neutral).
  const prevSide = useRef<Side | null>(null);
  const [flipKey, setFlipKey] = useState(0);
  useEffect(() => {
    const prev = prevSide.current;
    if (prev !== null && prev !== display.side && status !== 'loading') {
      setFlipKey((k) => k + 1);
    }
    prevSide.current = display.side;
  }, [display.side, status]);

  return (
    <section
      aria-label="Market mood"
      className="panel relative overflow-hidden rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4"
    >
      {/* Flip sweep — a single graze of light, then gone. */}
      {flipKey > 0 && (
        <span
          key={flipKey}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-12deg]"
          style={{
            background: `linear-gradient(90deg, transparent, ${SIDE_FLIP[display.side]}, transparent)`,
            animation: 'verdict-sweep 900ms var(--ease-expo) forwards',
          }}
        />
      )}

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: instrument identity + price */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <SymbolSwitch value={symbol} onChange={onSymbolChange} />
            <StatusPill status={status} />
          </div>
          <div className="flex items-end gap-3">
            <span className="font-mono text-2xl leading-none tracking-tight text-ink tabular-nums sm:text-3xl">
              {price != null
                ? price.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : '—'}
            </span>
            {change != null && (
              <span
                className={[
                  'mb-1 inline-flex items-center gap-1 font-mono text-sm tabular-nums',
                  change >= 0 ? 'text-bull-bright' : 'text-bear-bright',
                ].join(' ')}
              >
                <span aria-hidden>{change >= 0 ? '▲' : '▼'}</span>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {/* Right: the verdict (most emphasized). */}
        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex items-center gap-5">
            <ConfluenceMeter
              snapshots={snapshots}
              timeframes={timeframes}
              side={display.side}
              flipKey={flipKey}
            />
            <div className="flex flex-col items-end text-right">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-ink-faint">
                Multi-timeframe mood
              </span>
              <span
                className={[
                  'text-2xl font-semibold leading-tight tracking-tight sm:text-3xl',
                  SIDE_INK[display.side],
                ].join(' ')}
              >
                {display.headline}
              </span>
              <span className="mt-0.5 font-mono text-xs text-ink-muted tabular-nums">
                {display.count} of {mood.totalCount} timeframes
                <span className="text-ink-faint"> · higher TFs weighted</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SymbolSwitch({
  value,
  onChange,
}: {
  value: CompareSymbol;
  onChange: (s: CompareSymbol) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Trading pair"
      className="inline-flex items-center gap-0.5 rounded-xl border border-line bg-base/60 p-1"
    >
      {COMPARE_SYMBOLS.map((c) => {
        const active = c.symbol === value;
        return (
          <button
            key={c.symbol}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(c.symbol)}
            className={[
              'focus-ring rounded-lg px-2.5 py-1 text-sm font-semibold transition-colors duration-150',
              active
                ? 'bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--line-strong)]'
                : 'text-ink-faint hover:text-ink',
            ].join(' ')}
          >
            {c.symbol.replace('USDT', '')}
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map = {
    live: { label: 'Live', dot: 'bg-bull', text: 'text-bull-bright', live: true },
    demo: { label: 'Demo', dot: 'bg-regime-hot', text: 'text-regime-hot', live: false },
    loading: { label: 'Syncing', dot: 'bg-neutral', text: 'text-ink-muted', live: false },
  }[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-base/50 px-2 py-1 text-[11px] font-semibold ${map.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${map.dot}`}
        style={map.live ? { animation: 'live-pulse 2.4s var(--ease-quart) infinite' } : undefined}
      />
      {map.label}
    </span>
  );
}

function ConfluenceMeter({
  snapshots,
  timeframes,
  side,
  flipKey,
}: {
  snapshots: Record<Timeframe, TFSnapshot | null>;
  timeframes: Timeframe[];
  side: Side;
  flipKey: number;
}) {
  // Higher timeframes draw taller, making the weighting legible at a
  // glance. Direction is color AND height position, never hue alone.
  return (
    <div
      className="relative flex items-end gap-1"
      role="img"
      aria-label={`Per-timeframe signals: ${timeframes
        .map((tf) => `${tf} ${snapshots[tf]?.signal.side ?? 'neutral'}`)
        .join(', ')}`}
    >
      {flipKey > 0 && (
        <span
          key={flipKey}
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-xl"
          style={{ animation: 'flip-ring 700ms var(--ease-expo) forwards', ['--flip-color' as string]: SIDE_FLIP[side] }}
        />
      )}
      {timeframes.map((tf, i) => {
        const s = snapshots[tf]?.signal.side ?? 'neutral';
        const fresh = snapshots[tf]?.signal.fresh === true;
        const h = 14 + i * 4; // 14..34px, taller = higher timeframe
        return (
          <span key={tf} className="flex flex-col items-center gap-1" title={`${tf}: ${s}`}>
            <span
              className={`w-1.5 rounded-full ${SEG_BG[s]} ${fresh ? '' : 'opacity-55'}`}
              style={{ height: h }}
            />
            <span className="text-[8px] font-mono uppercase text-ink-faint">{tf}</span>
          </span>
        );
      })}
    </div>
  );
}
