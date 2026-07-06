// Technical Scanner — immutable signal generation (Sprint 4). A signal is
// created on the RISING EDGE of a strategy match (false/unknown → true) at a
// CLOSED eval-TF bar, and is immutable: deterministic id, frozen Why?
// snapshot, entry/SL/TP fixed at creation. Rule 1 + Rule 4.

import type { Candle, Timeframe } from '../types';
import { vdAtr, type TradePlanLike } from '../indicators/vdEngine';
import { evaluate, explainAt, TF_SECONDS } from './evaluate';
import type { ConditionSnapshot, ScannerStrategy } from './types';

export interface ScannerSignal extends TradePlanLike {
  id: string;                 // `${strategyVersionId}@${barTime}` — deterministic
  strategyId: string;
  strategyVersionId: string;  // `${strategyId}@v${n}`
  direction: 'long' | 'short';
  tf: Timeframe;              // eval timeframe
  barTime: number;            // CLOSE time of the trigger bar (unix seconds)
  createdAt: number;          // wall-clock when first recorded
  confidence: number;         // 0-100 share of passing conditions
  why: ConditionSnapshot[];   // frozen explainability
}

export const strategyVersionId = (s: ScannerStrategy, v = s.activeVersion): string =>
  `${s.id}@v${v}`;

/**
 * Deterministic signal generation over CLOSED candles: edge-triggered matches
 * of the strategy's ACTIVE version. Same history in → identical signals out.
 */
export function generateScannerSignals(
  strategy: ScannerStrategy,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  evalTf: Timeframe,
  now: number = Date.now(),
): ScannerSignal[] {
  const version = strategy.versions.find((v) => v.v === strategy.activeVersion);
  const candles = candlesByTf[evalTf];
  if (!version || !candles || candles.length === 0) return [];

  const matches = evaluate(version.tree, candlesByTf, evalTf);
  const atr = vdAtr(candles);
  const dir = strategy.direction === 'long' ? 1 : -1;
  const out: ScannerSignal[] = [];

  for (let i = 0; i < matches.length; i++) {
    if (matches[i] !== true || (i > 0 && matches[i - 1] === true)) continue; // rising edge only
    const a = atr[i];
    if (a == null || a <= 0) continue; // exits undefined during warm-up
    const entry = candles[i].close;
    const stopLoss = entry - dir * strategy.exits.slAtr * a;
    const risk = Math.abs(entry - stopLoss);
    if (risk <= 0) continue;
    const why = explainAt(version.tree, candlesByTf, evalTf, i);
    const passing = why.filter((w) => w.pass).length;
    const barTime = candles[i].time + TF_SECONDS[evalTf];
    out.push({
      id: `${strategyVersionId(strategy)}@${barTime}`,
      strategyId: strategy.id,
      strategyVersionId: strategyVersionId(strategy),
      direction: strategy.direction,
      side: strategy.direction === 'long' ? 'buy' : 'sell',
      tf: evalTf,
      index: i,
      barTime,
      createdAt: now,
      entry,
      stopLoss,
      tp1: entry + dir * strategy.exits.tp1R * risk,
      tp2: entry + dir * strategy.exits.tp2R * risk,
      tp3: entry + dir * strategy.exits.tp3R * risk,
      confidence: why.length ? Math.round((100 * passing) / why.length) : 0,
      why,
    });
  }
  return out;
}
