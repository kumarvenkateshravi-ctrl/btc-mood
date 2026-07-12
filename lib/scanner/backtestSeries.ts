// Visual-backtest geometry (Strategy Studio M5) — turns resolved trades into
// the shapes a trader reads instead of a table of numbers: a cumulative-R
// equity curve with its drawdown envelope, and an R-outcome distribution.
// Pure and deterministic; the SVG panel just maps these to pixels.

import type { VdTrade } from '../indicators/vdEngine';
import type { ScannerSignal } from './signals';

export interface EquityPoint {
  /** 1-based trade number in resolution order. */
  n: number;
  time: number;
  /** Cumulative realized R after this trade. */
  equityR: number;
  /** Running peak of equityR. */
  peakR: number;
  /** peakR - equityR (>= 0). */
  drawdownR: number;
  win: boolean;
}

export interface RBucket {
  /** Inclusive-left edge in R. */
  from: number;
  to: number;
  count: number;
}

export interface BacktestSeries {
  equity: EquityPoint[];
  buckets: RBucket[];
  maxDrawdownR: number;
  finalEquityR: number;
  bestR: number;
  worstR: number;
}

/** Resolved trades in chronological (resolution) order → equity + histogram. */
export function buildBacktestSeries(trades: Array<VdTrade<ScannerSignal>>, bucketCount = 9): BacktestSeries {
  const resolved = trades
    .filter((t): t is VdTrade<ScannerSignal> & { realizedR: number } => t.realizedR != null)
    .slice()
    .sort((a, b) => (a.resolvedTime ?? 0) - (b.resolvedTime ?? 0));

  const equity: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  const rs = resolved.map((t) => t.realizedR);
  for (let i = 0; i < resolved.length; i++) {
    const r = rs[i];
    cum += r;
    peak = Math.max(peak, cum);
    const dd = peak - cum;
    maxDd = Math.max(maxDd, dd);
    equity.push({
      n: i + 1,
      time: resolved[i].resolvedTime ?? resolved[i].entryTime,
      equityR: cum,
      peakR: peak,
      drawdownR: dd,
      win: r > 0,
    });
  }

  // Histogram of realized R, symmetric around zero on the widest tail so wins
  // and losses are visually comparable.
  const bestR = rs.length ? Math.max(...rs) : 0;
  const worstR = rs.length ? Math.min(...rs) : 0;
  const span = Math.max(Math.abs(bestR), Math.abs(worstR), 0.5);
  const edge = Math.ceil(span * 2) / 2; // round up to nearest 0.5R
  const n = Math.max(3, bucketCount % 2 === 0 ? bucketCount + 1 : bucketCount); // odd → a centered zero bucket
  const width = (2 * edge) / n;
  const buckets: RBucket[] = Array.from({ length: n }, (_, i) => ({
    from: -edge + i * width,
    to: -edge + (i + 1) * width,
    count: 0,
  }));
  for (const r of rs) {
    let idx = Math.floor((r + edge) / width);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    buckets[idx].count++;
  }

  return { equity, buckets, maxDrawdownR: maxDd, finalEquityR: cum, bestR, worstR };
}
