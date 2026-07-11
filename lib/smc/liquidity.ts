// Liquidity engine — EQH/EQL detection faithful to the LuxAlgo equal-high/low
// check inside getCurrentStructure (SDD.md:419, 440): when a new eq-scope
// pivot forms within eqThreshold × ATR(200) of the previous same-side pivot,
// an equal high/low exists. The pool object and sweep/invalidations are the
// intelligence layer on top (spec §5): a wick through the pool that closes
// back inside within sweepConfirmBars is a sweep; a close that holds beyond
// the level is a true break (invalidated).

import type { Candle } from '@/lib/types';
import {
  type SmcConfig,
  type SmcEvent,
  type SmcObject,
  smcObjectId,
} from './types';
import { createSwingTracker } from './swings';

export interface LiquidityEngine {
  /** direction 'bearish' = EQH (buy-side liquidity above), 'bullish' = EQL. */
  pools: SmcObject[];
  onBar(i: number): void;
}

interface PendingPierce {
  barIndex: number;
}

export function createLiquidityEngine(
  candles: Candle[],
  cfg: SmcConfig,
  atr200: number[],
  events: SmcEvent[],
): LiquidityEngine {
  const tracker = createSwingTracker(candles, cfg.eqLength);
  const pools: SmcObject[] = [];
  const pending = new Map<string, PendingPierce>();

  function pushEvent(type: SmcEvent['type'], i: number, direction: SmcObject['direction'], price: number, objectId: string): void {
    events.push({
      id: `${type}_${i}`,
      type,
      barIndex: i,
      time: candles[i].time,
      direction,
      objectId,
      price,
    });
  }

  function detectEqual(i: number): void {
    const u = tracker.onBar(i);
    if (!u) return;
    const thr = cfg.eqThreshold * atr200[i];
    // tracker.onBar already promoted currentLevel; the PREVIOUS pivot is lastLevel.
    const pivot = u.kind === 'high' ? tracker.high : tracker.low;
    if (!Number.isFinite(pivot.lastLevel)) return;
    if (Math.abs(pivot.lastLevel - u.level) >= thr) return;

    const direction = u.kind === 'high' ? 'bearish' : 'bullish';
    const pool: SmcObject = {
      id: smcObjectId('liquidityPool', undefined, direction, u.barIndex),
      kind: 'liquidityPool',
      direction,
      top: Math.max(pivot.lastLevel, u.level),
      bottom: Math.min(pivot.lastLevel, u.level),
      createdAtBar: u.barIndex,
      createdAtTime: u.barTime,
      updatedAtBar: i,
      state: 'active',
      touches: 0,
      strength: 0,
      quality: 0,
      confidence: 0,
    };
    pools.push(pool);
    pushEvent(u.kind === 'high' ? 'EQH_FORMED' : 'EQL_FORMED', i, direction, u.level, pool.id);
  }

  function trackSweeps(i: number): void {
    const c = candles[i];
    for (const pool of pools) {
      if (pool.state !== 'active') continue;
      const isEqh = pool.direction === 'bearish';
      const pierced = isEqh ? c.high > pool.top : c.low < pool.bottom;
      const closedBackInside = isEqh ? c.close <= pool.top : c.close >= pool.bottom;
      const p = pending.get(pool.id);

      if (pierced) {
        pool.touches += 1;
        pool.updatedAtBar = i;
        if (!p) pending.set(pool.id, { barIndex: i });
      }

      if ((pierced || p) && closedBackInside) {
        // Wick beyond the pool, close back inside — liquidity swept.
        pool.state = 'mitigated';
        pool.updatedAtBar = i;
        pending.delete(pool.id);
        // Sweeping buy-side (EQH) is a bearish signal, sell-side bullish.
        pushEvent('LIQUIDITY_SWEEP', i, pool.direction, isEqh ? pool.top : pool.bottom, pool.id);
        continue;
      }

      if (p && i - p.barIndex >= cfg.sweepConfirmBars && !closedBackInside) {
        // Held beyond the level for the whole confirmation window: true break.
        pool.state = 'invalidated';
        pool.updatedAtBar = i;
        pending.delete(pool.id);
      }
    }
  }

  function onBar(i: number): void {
    detectEqual(i);
    trackSweeps(i);
  }

  return { pools, onBar };
}
