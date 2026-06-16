import type { Candle, Signal, Timeframe } from './types';
import { computeSignal } from './signals';

/**
 * Backtester: replays a per-bar signal on a candle series and computes
 * a long-only P&L curve from BUY→next-SELL/neutral-exit.
 *
 * Rules (intentionally simple, deliberately honest about the limits):
 *   - Enter on a BUY signal that follows a non-BUY state.
 *   - Exit on a SELL signal OR on the final bar.
 *   - No leverage, no fees, no shorts.
 *
 * Returns per-trade P&L, total return, win rate, max drawdown, and the
 * equity curve points so the UI can render it.
 */
export interface BacktestTrade {
  entryIndex: number;
  entryPrice: number;
  exitIndex: number;
  exitPrice: number;
  pnlPct: number; // (exit - entry) / entry * 100
  holdingBars: number;
}

export interface BacktestResult {
  tf: Timeframe;
  startTime: number;
  endTime: number;
  trades: BacktestTrade[];
  totalReturnPct: number; // compounded, %
  winRatePct: number;
  avgPnlPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  equityCurvePct: number[]; // running total return, aligned with input
}

const MIN_BARS_FOR_BACKTEST = 60;

export function backtest(tf: Timeframe, candles: Candle[]): BacktestResult {
  const equityCurvePct: number[] = new Array(candles.length).fill(0);
  const trades: BacktestTrade[] = [];

  if (candles.length < MIN_BARS_FOR_BACKTEST) {
    return {
      tf,
      startTime: candles[0]?.time ?? 0,
      endTime: candles[candles.length - 1]?.time ?? 0,
      trades,
      totalReturnPct: 0,
      winRatePct: 0,
      avgPnlPct: 0,
      maxDrawdownPct: 0,
      tradeCount: 0,
      equityCurvePct,
    };
  }

  let inPosition = false;
  let entryIndex = -1;
  let entryPrice = 0;
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
      entryPrice = candles[i].close;
    } else if (inPosition) {
      const exitOnSignal = side === 'sell';
      const exitOnEnd = i === candles.length - 1;
      if (exitOnSignal || exitOnEnd) {
        const exitPrice = candles[i].close;
        const pnl = (exitPrice - entryPrice) / entryPrice;
        compounded *= 1 + pnl;
        trades.push({
          entryIndex,
          entryPrice,
          exitIndex: i,
          exitPrice,
          pnlPct: pnl * 100,
          holdingBars: i - entryIndex,
        });
        inPosition = false;
        entryIndex = -1;
        entryPrice = 0;
      }
    }
    equityCurvePct[i] = (compounded - 1) * 100;
  }

  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const totalReturnPct = (compounded - 1) * 100;
  const winRatePct = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgPnlPct =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length
      : 0;

  // Max drawdown on the equity curve (peak-to-trough %).
  let peak = 0;
  let maxDd = 0;
  for (const v of equityCurvePct) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    tf,
    startTime: candles[0].time,
    endTime: candles[candles.length - 1].time,
    trades,
    totalReturnPct,
    winRatePct,
    avgPnlPct,
    maxDrawdownPct: maxDd,
    tradeCount: trades.length,
    equityCurvePct,
  };
}
