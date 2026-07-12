'use client';

// Visual backtest (Strategy Studio M5) — the grand plan's "instead of only
// numbers, show every signal": a cumulative-R equity curve with its underwater
// drawdown, an R-outcome distribution, and the excursion summary. All geometry
// comes from buildBacktestSeries (pure); this file only maps R → pixels.

import { useMemo } from 'react';
import type { VdTrade } from '@/lib/indicators/vdEngine';
import type { ScannerSignal } from '@/lib/scanner/signals';
import type { StrategyVersionStats } from '@/lib/scanner/analytics';
import { buildBacktestSeries } from '@/lib/scanner/backtestSeries';
import { Num } from '@/components/ui';

const CURVE_W = 640;
const CURVE_H = 150;
const PAD = { l: 34, r: 10, t: 10, b: 18 };

function EquityCurve({ series }: { series: ReturnType<typeof buildBacktestSeries> }) {
  const { equity } = series;
  if (equity.length < 2) {
    return <p className="py-8 text-center text-[12px] text-ink-faint">Not enough resolved trades to chart an equity curve.</p>;
  }
  const iw = CURVE_W - PAD.l - PAD.r;
  const ih = CURVE_H - PAD.t - PAD.b;
  const maxE = Math.max(0, ...equity.map((p) => p.peakR));
  const minE = Math.min(0, ...equity.map((p) => p.equityR));
  const range = maxE - minE || 1;
  const x = (n: number) => PAD.l + (iw * (n - 1)) / Math.max(1, equity.length - 1);
  const y = (v: number) => PAD.t + ih * (1 - (v - minE) / range);

  const eqPath = equity.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.equityR).toFixed(1)}`).join(' ');
  const peakPath = equity.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.peakR).toFixed(1)}`).join(' ');
  // Underwater = area between peak (top) and equity (bottom) — the drawdown.
  const uwPath =
    peakPath +
    ' ' +
    equity
      .slice()
      .reverse()
      .map((p) => `L${x(p.n).toFixed(1)},${y(p.equityR).toFixed(1)}`)
      .join(' ') +
    ' Z';
  const zeroY = y(0);
  const finalUp = series.finalEquityR >= 0;

  return (
    <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} className="w-full" role="img" aria-label="Equity curve in R">
      {/* zero baseline */}
      <line x1={PAD.l} y1={zeroY} x2={CURVE_W - PAD.r} y2={zeroY} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />
      <text x={PAD.l - 4} y={zeroY + 3} textAnchor="end" fontSize={9} fill="var(--ink-faint)">0R</text>
      <text x={PAD.l - 4} y={y(maxE) + 3} textAnchor="end" fontSize={9} fill="var(--ink-faint)">{maxE.toFixed(1)}</text>
      {minE < 0 && <text x={PAD.l - 4} y={y(minE) + 3} textAnchor="end" fontSize={9} fill="var(--ink-faint)">{minE.toFixed(1)}</text>}
      {/* drawdown envelope */}
      <path d={uwPath} fill="var(--bear)" fillOpacity={0.12} stroke="none" />
      <path d={peakPath} fill="none" stroke="var(--ink-faint)" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="2 3" />
      {/* equity */}
      <path d={eqPath} fill="none" stroke={finalUp ? 'var(--bull-bright)' : 'var(--bear-bright)'} strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}

function Distribution({ series }: { series: ReturnType<typeof buildBacktestSeries> }) {
  const { buckets } = series;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((a, b) => a + b.count, 0);
  if (total === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Outcome distribution (R)</p>
      <div className="flex h-[90px] items-end gap-0.5">
        {buckets.map((b, i) => {
          const mid = (b.from + b.to) / 2;
          const color = mid > 0.05 ? 'var(--bull)' : mid < -0.05 ? 'var(--bear)' : 'var(--ink-faint)';
          return (
            <div key={i} className="group relative flex flex-1 flex-col items-center justify-end" title={`${b.from.toFixed(1)}R…${b.to.toFixed(1)}R: ${b.count}`}>
              <span className="mb-0.5 text-[9px] tabular-nums text-ink-faint opacity-0 group-hover:opacity-100">{b.count || ''}</span>
              <div className="w-full rounded-t-[2px]" style={{ height: `${(b.count / max) * 70}px`, background: color, opacity: b.count ? 0.85 : 0.15, minHeight: b.count ? 2 : 0 }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] tabular-nums text-ink-faint">
        <span>{series.worstR.toFixed(1)}R</span>
        <span>0</span>
        <span>+{series.bestR.toFixed(1)}R</span>
      </div>
    </div>
  );
}

export default function BacktestVisual({
  trades,
  stat,
}: {
  trades: Array<VdTrade<ScannerSignal>>;
  stat: StrategyVersionStats;
}) {
  const series = useMemo(() => buildBacktestSeries(trades), [trades]);

  if (stat.signals === 0) {
    return <p className="py-4 text-center text-[12px] text-ink-faint">No signals over the loaded history — loosen a condition or load more candles.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Signals" value={<Num.Compact value={stat.signals} />} />
        <Tile label="Resolved" value={<Num.Compact value={stat.resolved} />} />
        <Tile label="Win rate" value={<Num.Pct value={stat.winRate} signed={false} precision={0} />} />
        <Tile label="Net R" value={<Num value={series.finalEquityR} precision={1} tone />} />
        <Tile label="Profit factor" value={<Num value={stat.profitFactor} precision={2} />} />
        <Tile label="Max DD" value={<span className="text-bear-bright"><Num value={series.maxDrawdownR} precision={1} />R</span>} />
        <Tile label="Avg MFE" value={<span className="text-bull-bright"><Num value={stat.avgMfeR} precision={1} />R</span>} />
        <Tile label="Avg MAE" value={<span className="text-bear-bright"><Num value={stat.avgMaeR} precision={1} />R</span>} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-lg border border-line bg-surface-1 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Equity curve · cumulative R (peak dashed, drawdown shaded)</p>
          <EquityCurve series={series} />
        </div>
        <div className="rounded-lg border border-line bg-surface-1 p-3">
          <Distribution series={series} />
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
