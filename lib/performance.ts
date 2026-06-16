// Performance-stats aggregator. Pure functions over the PaperTrade[]
// already stored in the paper-store. No I/O, no side effects.

import type { PaperTrade } from './paper';

export interface TradeStats {
  count: number;
  /** All-time realized P&L in USD. */
  totalPnl: number;
  /** Total fees paid across all trades. */
  totalFees: number;
  /** Number of trades with positive realized PnL. */
  wins: number;
  /** Number of trades with negative realized PnL. */
  losses: number;
  /** Breakeven trades (exactly zero PnL, or within float epsilon). */
  breakevens: number;
  /** Win rate as a percentage (wins / (wins + losses), excluding breakevens). */
  winRatePct: number;
  /** Average profit on winning trades. */
  avgWin: number | null;
  /** Average loss on losing trades. */
  avgLoss: number | null;
  /** Gross profit / gross loss. ∞ when no losses. */
  profitFactor: number;
  /** Largest single-trade gain. */
  bestTrade: number | null;
  /** Worst single-trade loss. */
  worstTrade: number | null;
  /** Worst peak-to-trough equity drawdown in USD. */
  maxDrawdown: number;
  /** Chronological equity curve (after each trade, oldest first).
   *  Used by the sparkline. */
  equityCurve: number[];
  /** Whether there are any trades to report. */
  empty: boolean;
}

/** Compute stats from the trade history. Trades are expected to be
 *  ordered newest-first (as the store keeps them). We reverse for
 *  chronological equity-curve computation. */
export function computeStats(trades: PaperTrade[]): TradeStats {
  if (trades.length === 0) {
    return {
      count: 0,
      totalPnl: 0,
      totalFees: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRatePct: 0,
      avgWin: null,
      avgLoss: null,
      profitFactor: 0,
      bestTrade: null,
      worstTrade: null,
      maxDrawdown: 0,
      equityCurve: [],
      empty: true,
    };
  }

  const count = trades.length;
  let totalPnl = 0;
  let totalFees = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let bestTrade = -Infinity;
  let worstTrade = Infinity;

  for (const t of trades) {
    const pnl = t.realizedPnl;
    totalPnl += pnl;
    totalFees += t.fee;
    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
      if (pnl > bestTrade) bestTrade = pnl;
    } else if (pnl < 0) {
      losses++;
      grossLoss += Math.abs(pnl);
      if (pnl < worstTrade) worstTrade = pnl;
    } else {
      breakevens++;
    }
  }

  const deciding = wins + losses;
  const winRatePct = deciding > 0 ? (wins / deciding) * 100 : 0;
  const avgWin = wins > 0 ? grossProfit / wins : null;
  const avgLoss = losses > 0 ? -(grossLoss / losses) : null;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Number.POSITIVE_INFINITY;

  // Equity curve for max drawdown and sparkline. Walk oldest-first,
  // accumulating PnL. Start at 0 (the baseline), then track each step.
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: number[] = [0]; // starting point
  for (let i = trades.length - 1; i >= 0; i--) {
    equity += trades[i].realizedPnl;
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    count,
    totalPnl,
    totalFees,
    wins,
    losses,
    breakevens,
    winRatePct,
    avgWin,
    avgLoss,
    profitFactor,
    bestTrade: Number.isFinite(bestTrade) ? bestTrade : null,
    worstTrade: Number.isFinite(worstTrade) ? worstTrade : null,
    maxDrawdown,
    equityCurve,
    empty: false,
  };
}
