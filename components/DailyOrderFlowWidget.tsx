'use client';

// Daily Order Flow — two accumulating columns (buy vs sell taker volume) for the
// current UTC day, plus a cumulative-delta sparkline.
//
// Answers one question at a glance: are buyers or sellers in control today?
//
// The day is reconstructed on mount from klines (taker-buy volume), then the
// live @aggTrade tape takes over — without the backfill the columns would only
// ever mean "since you opened this tab".

import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeTrades, type Trade, type WSStatus } from '@/lib/ws';
import {
  accumulateTrade,
  emptyDailyFlow,
  flowStats,
  seedFromCandles,
  sparkSeries,
  utcDay,
  type DailyFlow,
  type DailyFlowStats,
} from '@/lib/dailyOrderFlow';
import type { Candle } from '@/lib/types';

/** Render cadence. The tape can burst to hundreds of msgs/sec; never render per trade. */
const FLUSH_MS = 250;

interface FlowView {
  stats: DailyFlowStats;
  spark: number[];
}

/** Derive a plain, immutable view of the mutable accumulator for rendering. */
function snapshot(acc: DailyFlow): FlowView {
  return { stats: flowStats(acc), spark: sparkSeries(acc) };
}

/** The pre-data view. Mount state is always this, so it needn't touch the ref. */
function emptyView(): FlowView {
  return snapshot(emptyDailyFlow());
}

interface DailyOrderFlowWidgetProps {
  symbol: string;
  /** Intraday candles used to backfill today (5m or finer works best). */
  candles?: Candle[];
}

export default function DailyOrderFlowWidget({
  symbol,
  candles,
}: DailyOrderFlowWidgetProps) {
  const accRef = useRef<DailyFlow>(emptyDailyFlow());
  const seededRef = useRef<string | null>(null);
  const [status, setStatus] = useState<WSStatus>('connecting');
  const [seeded, setSeeded] = useState(false);
  // Derived snapshot of the accumulator. Held in state rather than read from the
  // ref during render — the ref mutates on every trade, which render must not see.
  const [view, setView] = useState<FlowView>(emptyView);

  // Backfill today from klines. Keyed on symbol + UTC day so it re-seeds once
  // per day rollover, and never carries flow across a symbol switch.
  const backfillKey = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    const withTaker = candles.some((c) => typeof c.takerBuyVolume === 'number');
    if (!withTaker) return null;
    return `${symbol}:${utcDay(candles[candles.length - 1].time)}`;
  }, [symbol, candles]);

  useEffect(() => {
    if (!backfillKey || !candles) return;
    if (seededRef.current === backfillKey) return;
    seedFromCandles(accRef.current, candles);
    seededRef.current = backfillKey;
    setSeeded(true);
    setView(snapshot(accRef.current)); // show the day immediately, don't wait a tick
  }, [backfillKey, candles]);

  // Live tape. Flow must never bleed across symbols; the mount site keys this
  // component on `symbol`, so a switch remounts with a fresh accumulator rather
  // than resetting state from inside an effect.
  useEffect(() => {
    const dispose = subscribeTrades(
      symbol,
      (t: Trade) => {
        accumulateTrade(accRef.current, t);
      },
      setStatus,
    );
    return dispose;
  }, [symbol]);

  // Flush to React on a fixed cadence rather than per trade.
  useEffect(() => {
    const id = setInterval(() => setView(snapshot(accRef.current)), FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  const { stats, spark } = view;

  // Shared scale: the taller column fills the track, so relative height IS the answer.
  const peak = Math.max(stats.buyVol, stats.sellVol, 1);
  const buyPct = (stats.buyVol / peak) * 100;
  const sellPct = (stats.sellVol / peak) * 100;

  const live = status === 'open';

  return (
    <section aria-label="Daily order flow" className="panel rounded-2xl p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          Order flow · today
        </h2>
        <span
          className="inline-flex items-center gap-1.5 text-[10px] text-ink-faint"
          title={
            seeded
              ? 'Day reconstructed from klines, then live'
              : 'Live only — waiting for backfill data'
          }
        >
          <span
            className={[
              'h-1.5 w-1.5 rounded-full',
              live ? 'bg-bull' : 'bg-regime-hot',
            ].join(' ')}
            style={
              live ? { animation: 'live-pulse 2.4s var(--ease-quart) infinite' } : undefined
            }
          />
          {live ? (seeded ? 'live' : 'live · partial') : status}
        </span>
      </header>

      {!stats.hasData ? (
        <p className="py-6 text-center text-xs text-ink-faint">
          Waiting for trades…
        </p>
      ) : (
        <>
          {/* Verdict */}
          <div className="mb-3 flex items-baseline justify-between">
            <span
              className={[
                'text-lg font-semibold leading-none',
                stats.dominant === 'buyers'
                  ? 'text-bull-bright'
                  : stats.dominant === 'sellers'
                    ? 'text-bear-bright'
                    : 'text-ink-muted',
              ].join(' ')}
            >
              {stats.dominant === 'buyers'
                ? 'Buyers in control'
                : stats.dominant === 'sellers'
                  ? 'Sellers in control'
                  : 'Balanced'}
            </span>
            <span className="font-mono text-xs tabular-nums text-ink-muted">
              {(stats.buyShare * 100).toFixed(1)}% buy
            </span>
          </div>

          {/* The two columns. Must stretch, not `items-end` — the columns own their
              own baseline via the track below, and end-alignment would collapse it. */}
          <div className="flex items-stretch gap-3" style={{ height: 120 }}>
            <Column
              label="BUY"
              value={stats.buyVol}
              heightPct={buyPct}
              tone="bull"
            />
            <Column
              label="SELL"
              value={stats.sellVol}
              heightPct={sellPct}
              tone="bear"
            />
          </div>

          {/* Delta */}
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-faint">
              Delta
            </span>
            <span
              className={[
                'font-mono text-sm tabular-nums',
                stats.delta >= 0 ? 'text-bull-bright' : 'text-bear-bright',
              ].join(' ')}
            >
              {stats.delta >= 0 ? '+' : ''}
              {fmt(stats.delta)}
            </span>
          </div>

          {/* Cumulative delta through the day */}
          {spark.length > 1 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">
                Cumulative delta
              </div>
              <Sparkline series={spark} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Column({
  label,
  value,
  heightPct,
  tone,
}: {
  label: string;
  value: number;
  heightPct: number;
  tone: 'bull' | 'bear';
}) {
  const bar = tone === 'bull' ? 'bg-bull' : 'bg-bear';
  const ink = tone === 'bull' ? 'text-bull-bright' : 'text-bear-bright';
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      {/* Track keeps both columns on a shared baseline and scale. */}
      <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-md bg-surface-2">
        <div
          className={[bar, 'w-full rounded-md transition-[height] duration-300'].join(' ')}
          style={{ height: `${Math.max(2, heightPct)}%` }}
        />
      </div>
      {/* Direction is carried by the label + number too, never colour alone. */}
      <span className={['text-[10px] font-bold tracking-wider', ink].join(' ')}>
        {label}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-ink-muted">
        {fmt(value)}
      </span>
    </div>
  );
}

/** Cumulative-delta line with a zero baseline: shows who has been winning, and turns. */
function Sparkline({ series }: { series: number[] }) {
  const w = 240;
  const h = 40;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;
  const stepX = w / Math.max(1, series.length - 1);
  const y = (v: number) => h - ((v - min) / range) * h;

  const line = series
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const last = series[series.length - 1];
  const stroke = last >= 0 ? 'var(--bull)' : 'var(--bear)';

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-10 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Cumulative delta today, currently ${last >= 0 ? 'positive' : 'negative'} at ${fmt(last)}`}
    >
      <line
        x1={0}
        x2={w}
        y1={y(0)}
        y2={y(0)}
        stroke="var(--line-strong)"
        strokeWidth={1}
        strokeDasharray="2 4"
      />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** 12_345 → "12.3K" so columns stay narrow in the rail. */
function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(a < 10 ? 3 : 1);
}
