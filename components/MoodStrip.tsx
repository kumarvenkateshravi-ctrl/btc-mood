'use client';

import { useEffect, useRef, useState } from 'react';
import { COMPARE_SYMBOLS, type CompareSymbol } from '@/lib/compare';
import type { MoodVerdict, TFSnapshot } from '@/lib/signals';
import type { Timeframe } from '@/lib/types';
import { DataStateIndicator } from '@/components/ui/DataStateIndicator';
import type { MarketLifecycleState } from '@/lib/hooks/useMarketState';

type Status = 'live' | 'demo' | 'loading';
type Side = 'bullish' | 'bearish' | 'neutral';

const fmtPrice = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const fmtSigned = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

const fmtPct = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
    : '—';

/** Compact volume, e.g. 9820 -> "9.82K", 1_200_000 -> "1.20M". */
const fmtVol = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
};

interface MoodStripProps {
  symbol: CompareSymbol;
  onSymbolChange: (s: CompareSymbol) => void;
  status: Status;
  dataState?: MarketLifecycleState;
  price: number | null;
  change: number | null;
  changeAbs?: number | null;
  volume?: number | null;
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
  dataState,
  price,
  change,
  changeAbs,
  volume,
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
      className="panel relative overflow-hidden rounded-2xl px-6 py-7 sm:px-7 sm:py-8"
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

      <div className="relative flex flex-col gap-5">
        {/* Row 1 — Symbol (left) · Section title (center) · Status (right) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <SymbolSwitch value={symbol} onChange={onSymbolChange} />
            {dataState ? <DataStateIndicator state={status === 'demo' ? 'loading' : dataState} showLabel /> : <StatusPill status={status} />}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-faint whitespace-nowrap">
            Multi-timeframe mood
          </div>
          <div className="w-[88px] shrink-0" aria-hidden />
        </div>

        {/* Row 2 — Candles (left) · Verdict (right) */}
        <div className="flex items-center justify-between gap-6 min-h-[52px]">
          <ConfluenceMeter
            snapshots={snapshots}
            timeframes={timeframes}
            side={display.side}
            flipKey={flipKey}
          />
          <span
            className={[
              'text-2xl font-bold leading-none tracking-tight sm:text-3xl whitespace-nowrap',
              SIDE_INK[display.side],
            ].join(' ')}
          >
            {display.headline}
          </span>
        </div>

        {/* Row 3 — Timeframe labels under the candles (left) · Tagline (right) */}
        <div className="flex items-center justify-between gap-4 min-h-[20px] pt-0.5">
          <div className="flex items-end gap-[12px]">
            {timeframes.map((tf) => (
              <span
                key={tf}
                className="w-[20px] text-center text-[11px] font-semibold font-mono uppercase tracking-wide text-ink-muted"
              >
                {tf}
              </span>
            ))}
          </div>
          <span className="font-mono text-sm text-ink-muted tabular-nums whitespace-nowrap leading-5">
            <span className="text-ink-muted">{display.count}/{mood.totalCount} bull</span>
            <span className="text-ink-faint"> · HTF</span>
          </span>
        </div>

        {/* Row 4 — Price · abs change · % change · 24h volume (single line) */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1 min-h-[28px]">
          <span className="font-mono text-2xl leading-tight tracking-tight text-ink tabular-nums sm:text-3xl">
            {fmtPrice(price)}
          </span>
          {changeAbs != null && (
            <span
              className={[
                'font-mono text-sm font-semibold tabular-nums leading-5',
                changeAbs >= 0 ? 'text-bull-bright' : 'text-bear-bright',
              ].join(' ')}
            >
              {fmtSigned(changeAbs)}
            </span>
          )}
          {change != null && (
            <span
              className={[
                'inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums leading-5',
                change >= 0 ? 'text-bull-bright' : 'text-bear-bright',
              ].join(' ')}
            >
              <span aria-hidden className="text-base">{change >= 0 ? '▲' : '▼'}</span>
              {fmtPct(change)}
            </span>
          )}
          {volume != null && (
            <span className="font-mono text-sm text-ink-muted tabular-nums leading-5">
              <span className="text-ink-faint">24h vol </span>
              {fmtVol(volume)}
            </span>
          )}
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
  // Bars only. Timeframe labels are rendered separately in row 3 so the
  // meter can occupy a single, predictable horizontal slot.
  return (
    <div
      className="relative flex items-end gap-[12px] shrink-0"
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
        const h = 30 + i * 4; // 30..50px, taller = higher timeframe
        return (
          <span
            key={tf}
            className={`w-2.5 rounded-full ${SEG_BG[s]} ${fresh ? '' : 'opacity-55'}`}
            style={{ height: h }}
            title={`${tf}: ${s}`}
          />
        );
      })}
    </div>
  );
}
