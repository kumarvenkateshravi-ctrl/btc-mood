import type { Candle } from './types';
import * as pm from './pineMath';

export function wilderAtr(candles: Candle[], length = 14): Array<number | null> {
  const trueRanges = new Array<number | null>(candles.length).fill(null);
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges[index] = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  }
  return pm.rma(trueRanges, length);
}

export type TradeStatus = 'active' | 'tp1' | 'tp2' | 'tp3' | 'stopped' | 'exit';

export interface TradePlanLike {
  side: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  index: number;
}

export interface TrackedTrade<S extends TradePlanLike> {
  signal: S;
  status: TradeStatus;
  slCurrent: number;
  entryIndex: number;
  entryTime: number;
  resolvedIndex: number | null;
  resolvedTime: number | null;
  exitPrice: number | null;
  barsHeld: number;
  mfeR: number;
  maeR: number;
  realizedR: number | null;
  tp1Index?: number;
  tp2Index?: number;
  tp3Index?: number;
}

export interface TradeExitOptions {
  beAfterTp1: boolean;
  trailAtr: number;
  contextExit: boolean;
}

export const DEFAULT_TRADE_EXIT_OPTIONS: TradeExitOptions = {
  beAfterTp1: true,
  trailAtr: 1,
  contextExit: true,
};

export function walkTrades<S extends TradePlanLike>(
  candles: Candle[],
  signals: S[],
  exits: TradeExitOptions = DEFAULT_TRADE_EXIT_OPTIONS,
): Array<TrackedTrade<S>> {
  const lastClosed = candles.length - 1;
  const trades: Array<TrackedTrade<S>> = [];
  if (signals.length === 0) return trades;

  const atr = wilderAtr(candles);
  const closes = candles.map((candle) => candle.close);
  const ema9 = exits.contextExit ? pm.ema(closes, 9) : [];
  const ema21 = exits.contextExit ? pm.ema(closes, 21) : [];

  for (const signal of signals) {
    const direction = signal.side === 'buy' ? 1 : -1;
    const risk = Math.abs(signal.entry - signal.stopLoss);
    const trade: TrackedTrade<S> = {
      signal,
      status: 'active',
      slCurrent: signal.stopLoss,
      entryIndex: signal.index,
      entryTime: candles[signal.index]?.time ?? 0,
      resolvedIndex: null,
      resolvedTime: null,
      exitPrice: null,
      barsHeld: 0,
      mfeR: 0,
      maeR: 0,
      realizedR: null,
    };
    if (risk <= 0) {
      trades.push(trade);
      continue;
    }

    let watermark: number | null = null;
    for (let index = signal.index + 1; index <= lastClosed; index += 1) {
      const candle = candles[index];
      trade.barsHeld = index - signal.index;
      const favorable = direction > 0 ? candle.high - signal.entry : signal.entry - candle.low;
      const adverse = direction > 0 ? signal.entry - candle.low : candle.high - signal.entry;
      trade.mfeR = Math.max(trade.mfeR, favorable / risk);
      trade.maeR = Math.max(trade.maeR, adverse / risk);

      const stopHit = direction > 0 ? candle.low <= trade.slCurrent : candle.high >= trade.slCurrent;
      if (stopHit) {
        trade.status = 'stopped';
        trade.resolvedIndex = index;
        trade.resolvedTime = candle.time;
        trade.exitPrice = trade.slCurrent;
        trade.realizedR = (direction * (trade.slCurrent - signal.entry)) / risk;
        break;
      }

      const targetHit = (target: number) => direction > 0 ? candle.high >= target : candle.low <= target;
      if (trade.status === 'active' && targetHit(signal.tp1)) {
        trade.tp1Index = index;
        trade.status = 'tp1';
        if (exits.beAfterTp1) {
          trade.slCurrent = direction > 0
            ? Math.max(trade.slCurrent, signal.entry)
            : Math.min(trade.slCurrent, signal.entry);
        }
      }
      if (trade.status === 'tp1' && targetHit(signal.tp2)) {
        trade.status = 'tp2';
        trade.tp2Index = index;
      }
      if (trade.status === 'tp2' && targetHit(signal.tp3)) {
        trade.status = 'tp3';
        trade.tp3Index = index;
        trade.resolvedIndex = index;
        trade.resolvedTime = candle.time;
        trade.exitPrice = signal.tp3;
        trade.realizedR = (direction * (signal.tp3 - signal.entry)) / risk;
        break;
      }

      if (exits.contextExit && index > 0) {
        const currentFast = ema9[index];
        const currentSlow = ema21[index];
        const previousFast = ema9[index - 1];
        const previousSlow = ema21[index - 1];
        if (currentFast != null && currentSlow != null && previousFast != null && previousSlow != null) {
          const crossed = direction > 0
            ? currentFast < currentSlow && previousFast >= previousSlow
            : currentFast > currentSlow && previousFast <= previousSlow;
          if (crossed) {
            trade.status = 'exit';
            trade.resolvedIndex = index;
            trade.resolvedTime = candle.time;
            trade.exitPrice = candle.close;
            trade.realizedR = (direction * (candle.close - signal.entry)) / risk;
            break;
          }
        }
      }

      if (exits.trailAtr > 0 && trade.status === 'tp2') {
        watermark = watermark == null
          ? candle.close
          : direction > 0 ? Math.max(watermark, candle.close) : Math.min(watermark, candle.close);
        const currentAtr = atr[index];
        if (currentAtr != null && currentAtr > 0) {
          const trailingStop = direction > 0
            ? watermark - exits.trailAtr * currentAtr
            : watermark + exits.trailAtr * currentAtr;
          trade.slCurrent = direction > 0
            ? Math.max(trade.slCurrent, trailingStop)
            : Math.min(trade.slCurrent, trailingStop);
        }
      }
    }
    trades.push(trade);
  }

  return trades;
}
