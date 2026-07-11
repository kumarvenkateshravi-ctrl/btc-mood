import { describe, it, expect } from 'vitest';
import { createLiquidityEngine } from './liquidity';
import { computeVolatility } from './volatility';
import { resolveSmcConfig } from './types';
import type { Candle } from '@/lib/types';
import type { SmcEvent } from './types';

const flat = (i: number): Candle => ({ time: i * 60, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1 });

/**
 * Flat tape with two equal-high spikes (105 and 105.05) at i=10 and i=16,
 * separated by a dip at i=13 so the eq-tracker's leg flips low→high and the
 * second pivot high actually forms (pivots alternate).
 */
function eqhScene(tail: (i: number) => Candle, length = 30): Candle[] {
  return Array.from({ length }, (_, i) => {
    // dip at i=5 flips the leg bullish so the i=10 spike can pivot at all
    if (i === 5) return { time: i * 60, open: 100, high: 100.5, low: 98, close: 99, volume: 1 };
    if (i === 10) return { time: i * 60, open: 100, high: 105, low: 99.5, close: 100.5, volume: 1 };
    if (i === 13) return { time: i * 60, open: 100, high: 100.5, low: 98, close: 99, volume: 1 };
    if (i === 16) return { time: i * 60, open: 100, high: 105.05, low: 99.5, close: 100.5, volume: 1 };
    if (i >= 22) return tail(i);
    return flat(i);
  });
}

function run(candles: Candle[]) {
  const cfg = resolveSmcConfig({ eqLength: 3 });
  const vol = computeVolatility(candles, cfg.obFilter);
  const events: SmcEvent[] = [];
  const eng = createLiquidityEngine(candles, cfg, vol.atr200, events);
  for (let i = 0; i < candles.length; i++) eng.onBar(i);
  return { eng, events };
}

describe('createLiquidityEngine', () => {
  it('detects an EQH pool from two equal highs', () => {
    const { eng, events } = run(eqhScene(flat));
    const eqh = eng.pools.filter((p) => p.direction === 'bearish');
    expect(eqh.length).toBe(1);
    expect(eqh[0].top).toBeCloseTo(105.05);
    expect(eqh[0].bottom).toBeCloseTo(105);
    expect(eqh[0].state).toBe('active');
    expect(events.some((e) => e.type === 'EQH_FORMED')).toBe(true);
  });

  it('wick through the pool + close back inside = sweep (mitigated)', () => {
    const sweepBar = (i: number): Candle =>
      i === 24 ? { time: i * 60, open: 100, high: 105.6, low: 99.5, close: 103, volume: 1 } : flat(i);
    const { eng, events } = run(eqhScene(sweepBar));
    const pool = eng.pools.find((p) => p.direction === 'bearish')!;
    expect(pool.state).toBe('mitigated');
    expect(pool.touches).toBeGreaterThan(0);
    const sweep = events.find((e) => e.type === 'LIQUIDITY_SWEEP');
    expect(sweep).toBeDefined();
    expect(sweep!.direction).toBe('bearish'); // swept buy-side => bearish signal
    expect(sweep!.objectId).toBe(pool.id);
  });

  it('close through and hold = invalidated (true break, not a sweep)', () => {
    const breakBar = (i: number): Candle => {
      if (i >= 24) return { time: i * 60, open: 106, high: 106.8, low: 105.4, close: 106.5, volume: 1 };
      return flat(i);
    };
    const { eng, events } = run(eqhScene(breakBar, 32));
    const pool = eng.pools.find((p) => p.direction === 'bearish')!;
    expect(pool.state).toBe('invalidated');
    expect(events.some((e) => e.type === 'LIQUIDITY_SWEEP')).toBe(false);
  });
});
