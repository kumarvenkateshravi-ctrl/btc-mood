import type { Candle, Signal, Timeframe } from './types';
import { computeSignal } from './signals';

/**
 * Backtester: replays a per-bar signal on a candle series and computes
 * a long-only P&L curve from BUY→next-SELL/neutral-exit.
 *
 * Rules (intentionally simple, deliberately honest about the limits):
 *   - Enter on a BUY signal that follows a non-BUY state.
 *   - Exit on a SELL signal OR on the final bar.
 *   - No leverage, no shorts.
 *
 * Optional per-trade costs (vardhan's pattern): `feeBps` + `slippageBps`
 * are deducted from the fill price on entry and exit. With the default
 * of 0/0 bps the behavior is identical to a no-cost backtest.
 *
 * Stats surface the metrics a pro expects: total return, win rate,
 * avg win / avg loss, largest win / loss, profit factor, expectancy
 * (avg per-trade P&L), annualized Sharpe ratio, and max drawdown.
 */
export interface BacktestTrade {
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  /** Per-trade return, post-cost, as a percentage. */
  pnlPct: number;
  holdingBars: number;
}

export interface BacktestOptions {
  /** Fee in basis points (1 bp = 0.01%). Applied to both entry and exit. */
  feeBps?: number;
  /** Slippage in basis points. Applied to both entry and exit. */
  slippageBps?: number;
}

export interface BacktestResult {
  tf: Timeframe;
  startTime: number;
  endTime: number;
  trades: BacktestTrade[];
  /** Compounded total return, %. */
  totalReturnPct: number;
  /** Wins / (wins + losses), in percent. */
  winRatePct: number;
  /** Arithmetic mean of per-trade pnlPct (post-cost). */
  avgPnlPct: number;
  /** Mean of winning trades' pnlPct. Null when no wins. */
  avgWinPct: number | null;
  /** Mean of losing trades' pnlPct. Null when no losses. */
  avgLossPct: number | null;
  /** Best trade pnlPct. Null when no trades. */
  bestTradePct: number | null;
  /** Worst trade pnlPct. Null when no trades. */
  worstTradePct: number | null;
  /** Gross profit / gross loss. Infinity when there are no losses. */
  profitFactor: number;
  /** Sum of per-trade PnL / count. The "edge" in percent per trade. */
  expectancyPct: number;
  /** Annualized Sharpe. Null when stddev is 0 or fewer than 2 trades. */
  sharpeRatio: number | null;
  /** Peak-to-trough drawdown on the equity curve (post-cost, %). */
  maxDrawdownPct: number;
  tradeCount: number;
  /** Running total return (%), one entry per input bar. */
  equityCurvePct: number[];
  /** Cost config actually used. Surfaced for UI transparency. */
  feeBps: number;
  slippageBps: number;
}

const MIN_BARS_FOR_BACKTEST = 60;

// Crypto trades 24/7; bars-per-year for each timeframe.
const BARS_PER_YEAR: Record<Timeframe, number> = {
  '5m': 365 * 24 * 12,
  '15m': 365 * 24 * 4,
  '30m': 365 * 24 * 2,
  '1h': 365 * 24,
  '4h': 365 * 6,
  '1d': 365,
};

function emptyResult(
  tf: Timeframe,
  candles: Candle[],
  feeBps: number,
  slippageBps: number,
): BacktestResult {
  return {
    tf,
    startTime: candles[0]?.time ?? 0,
    endTime: candles[candles.length - 1]?.time ?? 0,
    trades: [],
    totalReturnPct: 0,
    winRatePct: 0,
    avgPnlPct: 0,
    avgWinPct: null,
    avgLossPct: null,
    bestTradePct: null,
    worstTradePct: null,
    profitFactor: 0,
    expectancyPct: 0,
    sharpeRatio: null,
    maxDrawdownPct: 0,
    tradeCount: 0,
    equityCurvePct: new Array(candles.length).fill(0),
    feeBps,
    slippageBps,
  };
}

export function backtest(
  tf: Timeframe,
  candles: Candle[],
  options: BacktestOptions = {},
): BacktestResult {
  const feeBps = Math.max(0, options.feeBps ?? 0);
  const slippageBps = Math.max(0, options.slippageBps ?? 0);
  // Both sides pay cost → entry price is marked up for buys, exit
  // price marked down. The compounded return math handles sign via
  // (entryFill / exitFill) vs the raw ratio.
  const costRate = (feeBps + slippageBps) / 10_000;

  if (candles.length < MIN_BARS_FOR_BACKTEST) {
    return emptyResult(tf, candles, feeBps, slippageBps);
  }

  const trades: BacktestTrade[] = [];
  const equityCurvePct: number[] = new Array(candles.length).fill(0);

  let inPosition = false;
  let entryIndex = -1;
  let entryRawPrice = 0; // raw close at the signal bar
  let compounded = 1; // 1.0 = no change

  for (let i = 0; i < candles.length; i++) {
    // computeSignal needs the *history up to and including* bar i so
    // the indicator has enough data to warm up. We pass a sliced view.
    const history = candles.slice(0, i + 1);
    if (history.length < 30) {
      equityCurvePct[i] = (compounded - 1) * 100;
      continue;
    }
    const side: Signal['side'] = computeSignal(tf, history).signal.side;

    if (!inPosition && side === 'buy') {
      inPosition = true;
      entryIndex = i;
      entryRawPrice = candles[i].close;
    } else if (inPosition) {
      const exitOnSignal = side === 'sell';
      const exitOnEnd = i === candles.length - 1;
      if (exitOnSignal || exitOnEnd) {
        const exitRawPrice = candles[i].close;
        // Apply costs symmetrically. long-only here, so we always
        // buy high (entry *= 1 + cost) and sell low (exit *= 1 - cost).
        const entryFill = entryRawPrice * (1 + costRate);
        const exitFill = exitRawPrice * (1 - costRate);
        const pnl = (exitFill - entryFill) / entryFill;
        compounded *= 1 + pnl;
        trades.push({
          entryIndex,
          entryPrice: entryRawPrice,
          exitIndex: i,
          exitPrice: exitRawPrice,
          pnlPct: pnl * 100,
          holdingBars: i - entryIndex,
        });
        inPosition = false;
        entryIndex = -1;
        entryRawPrice = 0;
      }
    }
    equityCurvePct[i] = (compounded - 1) * 100;
  }

  return computeStats(tf, candles, trades, equityCurvePct, compounded, feeBps, slippageBps);
}

function computeStats(
  tf: Timeframe,
  candles: Candle[],
  trades: BacktestTrade[],
  equityCurvePct: number[],
  compounded: number,
  feeBps: number,
  slippageBps: number,
): BacktestResult {
  const count = trades.length;
  let wins = 0;
  let losses = 0;
  let grossProfitPct = 0; // sum of positive pnlPct values
  let grossLossPct = 0; // sum of |negative pnlPct| values
  let bestTradePct: number | null = null;
  let worstTradePct: number | null = null;
  let sumPnlPct = 0;

  for (const t of trades) {
    sumPnlPct += t.pnlPct;
    if (t.pnlPct > 0) {
      wins += 1;
      grossProfitPct += t.pnlPct;
      if (bestTradePct == null || t.pnlPct > bestTradePct) bestTradePct = t.pnlPct;
    } else if (t.pnlPct < 0) {
      losses += 1;
      grossLossPct += -t.pnlPct;
      if (worstTradePct == null || t.pnlPct < worstTradePct) worstTradePct = t.pnlPct;
    }
  }

  const deciding = wins + losses;
  const winRatePct = deciding > 0 ? (wins / deciding) * 100 : 0;
  const avgPnlPct = count > 0 ? sumPnlPct / count : 0;
  const avgWinPct = wins > 0 ? grossProfitPct / wins : null;
  const avgLossPct = losses > 0 ? -(grossLossPct / losses) : null;
  const profitFactor =
    count === 0
      ? 0
      : grossLossPct > 0
        ? grossProfitPct / grossLossPct
        : Number.POSITIVE_INFINITY;
  const expectancyPct = count > 0 ? sumPnlPct / count : 0;

  // Max drawdown on the equity curve (peak-to-trough %).
  let peak = 0;
  let maxDd = 0;
  for (const v of equityCurvePct) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  }

  // Annualized Sharpe on per-trade returns. We use per-trade returns
  // (not per-bar) so the result isn't dominated by the holding
  // period. Annualization factor is `trades per year` estimated from
  // mean holding period in bars × bars-per-year.
  let sharpeRatio: number | null = null;
  if (count >= 2) {
    const mean = sumPnlPct / count;
    let variance = 0;
    for (const t of trades) {
      const d = t.pnlPct - mean;
      variance += d * d;
    }
    variance /= count - 1; // sample variance (Bessel's correction)
    const stddev = Math.sqrt(variance);
    if (stddev > 0) {
      // Estimate trades-per-year from average holding period.
      const totalHoldingBars = trades.reduce((s, t) => s + t.holdingBars, 0);
      const avgHoldingBars = totalHoldingBars / count;
      const barsPerYear = BARS_PER_YEAR[tf];
      const tradesPerYear = avgHoldingBars > 0 ? barsPerYear / avgHoldingBars : barsPerYear;
      const annualizationFactor = Math.sqrt(Math.max(1, tradesPerYear));
      // Sharpe is per-trade units; annualize by sqrt(trades-per-year).
      // Multiply by 100 to convert percent units to a typical quote.
      sharpeRatio = (mean / stddev) * annualizationFactor;
    }
  }

  return {
    tf,
    startTime: candles[0].time,
    endTime: candles[candles.length - 1].time,
    trades,
    totalReturnPct: (compounded - 1) * 100,
    winRatePct,
    avgPnlPct,
    avgWinPct,
    avgLossPct,
    bestTradePct,
    worstTradePct,
    profitFactor,
    expectancyPct,
    sharpeRatio,
    maxDrawdownPct: maxDd,
    tradeCount: count,
    equityCurvePct,
    feeBps,
    slippageBps,
  };
}