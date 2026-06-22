'use client';

import { useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';
import { backtest, type BacktestResult } from '@/lib/backtest';
import type { Candle, Timeframe } from '@/lib/types';

interface BacktestPanelProps {
  tf: Timeframe;
  candles: Candle[];
}

const BULL = '#22d39a';
const BEAR = '#fb5168';

function formatPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatSigned(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function Stat({
  label,
  value,
  positive,
  muted,
}: {
  label: string;
  value: string;
  positive?: boolean;
  muted?: boolean;
}) {
  const color = muted
    ? 'text-ink-muted'
    : positive === undefined
      ? 'text-ink'
      : positive
        ? 'text-bull-bright'
        : 'text-bear-bright';
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`mt-0.5 font-mono text-sm tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function PanelHeading({ tf, trailing }: { tf: Timeframe; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <LineChart className="h-4 w-4 text-accent" />
        Backtest
        <span className="font-mono text-xs text-ink-faint">· {tf}</span>
      </h2>
      {trailing}
    </div>
  );
}

// backtest() is O(n²); cap its input so deep lazy-loaded history never freezes
// the page. The most recent window is what matters for a quick read.
const BACKTEST_MAX_BARS = 2000;

export default function BacktestPanel({ tf, candles }: BacktestPanelProps) {
  // Cost config — surfaced as inputs so the trader can match their
  // venue. Defaults are a reasonable Binance-spot assumption: 5 bps
  // taker fee + 2 bps slippage = 7 bps round trip.
  const [feeBps, setFeeBps] = useState(5);
  const [slippageBps, setSlippageBps] = useState(2);

  const result: BacktestResult = useMemo(
    () =>
      backtest(tf, candles.length > BACKTEST_MAX_BARS ? candles.slice(-BACKTEST_MAX_BARS) : candles, {
        feeBps,
        slippageBps,
      }),
    [tf, candles, feeBps, slippageBps],
  );

  if (candles.length < 60) {
    return (
      <section className="panel rounded-2xl p-3 sm:p-4">
        <PanelHeading tf={tf} />
        <p className="mt-2 text-xs text-ink-faint">Need at least 60 bars to backtest.</p>
      </section>
    );
  }

  const positive = result.totalReturnPct >= 0;
  const pf =
    !Number.isFinite(result.profitFactor) ? '∞' : result.profitFactor.toFixed(2);
  const sharpe =
    result.sharpeRatio === null ? '—' : result.sharpeRatio.toFixed(2);

  return (
    <section className="panel rounded-2xl p-3 sm:p-4">
      <PanelHeading
        tf={tf}
        trailing={
          <span className="text-[10px] text-ink-faint">
            {result.tradeCount} trades · long-only
          </span>
        }
      />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total return" value={formatPct(result.totalReturnPct)} positive={positive} />
        <Stat
          label="Win rate"
          value={`${result.winRatePct.toFixed(0)}%`}
          positive={result.winRatePct >= 50}
        />
        <Stat label="Avg P&L" value={formatPct(result.avgPnlPct)} positive={result.avgPnlPct >= 0} />
        <Stat
          label="Max drawdown"
          value={formatPct(-result.maxDrawdownPct)}
          positive={false}
        />
        <Stat
          label="Avg win"
          value={result.avgWinPct === null ? '—' : formatPct(result.avgWinPct)}
          positive
        />
        <Stat
          label="Avg loss"
          value={result.avgLossPct === null ? '—' : formatPct(result.avgLossPct)}
          positive={false}
        />
        <Stat
          label="Profit factor"
          value={pf}
          positive={result.profitFactor >= 1}
        />
        <Stat
          label="Expectancy"
          value={formatPct(result.expectancyPct)}
          positive={result.expectancyPct >= 0}
        />
        <Stat
          label="Best trade"
          value={
            result.bestTradePct === null ? '—' : formatPct(result.bestTradePct)
          }
          positive
        />
        <Stat
          label="Worst trade"
          value={
            result.worstTradePct === null ? '—' : formatPct(result.worstTradePct)
          }
          positive={false}
        />
        <Stat
          label="Sharpe (ann.)"
          value={sharpe}
          positive={
            result.sharpeRatio !== null ? result.sharpeRatio >= 1 : undefined
          }
        />
        <Stat label="Trade count" value={String(result.tradeCount)} muted />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
        <CostInput
          label="Fee"
          value={feeBps}
          onChange={setFeeBps}
          suffix="bps"
        />
        <CostInput
          label="Slippage"
          value={slippageBps}
          onChange={setSlippageBps}
          suffix="bps"
        />
        <span className="text-ink-faint">
          Round-trip cost: {((feeBps + slippageBps) * 2 / 100).toFixed(3)}%
        </span>
      </div>

      <Sparkline points={result.equityCurvePct} positive={positive} />
    </section>
  );
}

function CostInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-ink-faint">{label}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(Math.round(n));
        }}
        className="w-14 rounded border border-line bg-base px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums text-ink outline-none focus:border-line-strong"
      />
      <span className="text-ink-faint">{suffix}</span>
    </label>
  );
}

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  if (points.length < 2) return null;
  const w = 600;
  const h = 84;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const range = max - min || 1;
  const stepX = w / (points.length - 1);
  const xy = points.map((v, i) => [i * stepX, h - ((v - min) / range) * h] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const zeroY = h - ((0 - min) / range) * h;
  const stroke = positive ? BULL : BEAR;
  const gid = `bt-fill-${positive ? 'up' : 'dn'}`;

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-20 w-full"
        preserveAspectRatio="none"
        aria-label={`Equity curve, ${formatPct(points[points.length - 1])} total`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={0}
          x2={w}
          y1={zeroY}
          y2={zeroY}
          stroke="oklch(0.40 0.034 264)"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        <path d={area} fill={`url(#${gid})`} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}