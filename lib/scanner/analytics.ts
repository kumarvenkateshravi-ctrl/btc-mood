// Technical Scanner — Strategy Analytics (Sprint 7). Because evaluation is
// deterministic over closed bars, backtesting a version = running it over the
// loaded history. Stats are computed per VERSION, enabling the comparison the
// versioning system exists for (v1 62% → v2 76%).

import type { Candle, Timeframe } from '../types';
import { walkVdTrades, type VdTrade } from '../indicators/vdEngine';
import { generateScannerSignals, type ScannerSignal } from './signals';
import type { ScannerStrategy } from './types';

export interface StrategyVersionStats {
  version: number;
  note: string;
  signals: number;
  resolved: number;
  wins: number;
  losses: number;
  winRate: number;         // 0..1 over resolved
  avgR: number;
  expectancy: number;      // == avgR (R per resolved trade)
  profitFactor: number;
  maxDrawdownR: number;    // on the cumulative-R equity curve
  avgBarsHeld: number;
  tp1Hits: number; tp2Hits: number; tp3Hits: number; stopped: number; exits: number;
  bestStreak: number;      // longest consecutive wins
  worstStreak: number;     // longest consecutive losses
  avgMfeR: number;
  avgMaeR: number;
}

/** Pure stats over walked trades (chronological). */
export function statsFromTrades(
  trades: Array<VdTrade<ScannerSignal>>,
  version: number,
  note: string,
): StrategyVersionStats {
  const resolved = trades.filter((t) => t.realizedR != null);
  const rs = resolved.map((t) => t.realizedR as number);
  const wins = rs.filter((r) => r > 0).length;
  const grossWin = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((s, r) => s + r, 0));

  let equity = 0, peak = 0, maxDd = 0;
  let streak = 0, bestStreak = 0, worstStreak = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (r > 0) streak = streak > 0 ? streak + 1 : 1;
    else if (r < 0) streak = streak < 0 ? streak - 1 : -1;
    bestStreak = Math.max(bestStreak, streak);
    worstStreak = Math.min(worstStreak, streak);
  }

  const count = (fn: (t: VdTrade<ScannerSignal>) => boolean) => trades.filter(fn).length;
  const avgR = rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 0;
  return {
    version, note,
    signals: trades.length,
    resolved: resolved.length,
    wins,
    losses: resolved.length - wins,
    winRate: rs.length ? wins / rs.length : 0,
    avgR,
    expectancy: avgR,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownR: maxDd,
    avgBarsHeld: resolved.length ? resolved.reduce((s, t) => s + t.barsHeld, 0) / resolved.length : 0,
    tp1Hits: count((t) => t.tp1Index != null),
    tp2Hits: count((t) => t.tp2Index != null),
    tp3Hits: count((t) => t.status === 'tp3'),
    stopped: count((t) => t.status === 'stopped'),
    exits: count((t) => t.status === 'exit'),
    bestStreak,
    worstStreak: Math.abs(worstStreak),
    avgMfeR: resolved.length ? resolved.reduce((s, t) => s + t.mfeR, 0) / resolved.length : 0,
    avgMaeR: resolved.length ? resolved.reduce((s, t) => s + t.maeR, 0) / resolved.length : 0,
  };
}

/** Deterministic backtest of ONE version over the loaded history. */
/**
 * The per-trade records for a version's deterministic backtest — the raw
 * material behind the aggregate stats. Powers the visual backtest (equity
 * curve, R-distribution, MFE/MAE) and, later, chart markers. Returns the
 * closed candles the trades index into so callers can place markers.
 */
export function tradesForStrategyVersion(
  strategy: ScannerStrategy,
  version: number,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): { trades: Array<VdTrade<ScannerSignal>>; candles: Candle[] } {
  const v = strategy.versions.find((x) => x.v === version);
  const candles = candlesByTf[evalTf] ?? [];
  const closed = candles.length > 1 ? candles.slice(0, candles.length - 1) : [];
  const closedByTf: Partial<Record<Timeframe, Candle[]>> = {};
  for (const [tf, arr] of Object.entries(candlesByTf) as Array<[Timeframe, Candle[]]>) {
    if (arr && arr.length > 1) closedByTf[tf] = arr.slice(0, arr.length - 1);
  }
  if (!v || closed.length === 0) return { trades: [], candles: closed };
  const sigs = generateScannerSignals({ ...strategy, activeVersion: version }, closedByTf, evalTf, 0);
  return { trades: walkVdTrades(closed, sigs), candles: closed };
}

export function backtestStrategyVersion(
  strategy: ScannerStrategy,
  version: number,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): StrategyVersionStats {
  const v = strategy.versions.find((x) => x.v === version);
  const { trades } = tradesForStrategyVersion(strategy, version, candlesByTf, evalTf);
  return statsFromTrades(trades, version, v?.note ?? '');
}

/** All versions side by side — the payoff of immutable versioning. */
export function versionComparison(
  strategy: ScannerStrategy,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
): StrategyVersionStats[] {
  return strategy.versions.map((v) => backtestStrategyVersion(strategy, v.v, candlesByTf, evalTf));
}
