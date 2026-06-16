'use client';

import { useMemo } from 'react';
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

function Stat({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const color =
    positive === undefined
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

export default function BacktestPanel({ tf, candles }: BacktestPanelProps) {
  const result: BacktestResult = useMemo(() => backtest(tf, candles), [tf, candles]);

  if (candles.length < 60) {
    return (
      <section className="panel rounded-2xl p-3 sm:p-4">
        <PanelHeading tf={tf} />
        <p className="mt-2 text-xs text-ink-faint">Need at least 60 bars to backtest.</p>
      </section>
    );
  }

  const positive = result.totalReturnPct >= 0;
  return (
    <section className="panel rounded-2xl p-3 sm:p-4">
      <PanelHeading
        tf={tf}
        trailing={
          <span className="text-[10px] text-ink-faint">
            {result.tradeCount} trades · long-only · no fees
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
      </div>

      <Sparkline points={result.equityCurvePct} positive={positive} />
    </section>
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
