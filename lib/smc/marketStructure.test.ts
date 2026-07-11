import { describe, it, expect } from 'vitest';
import { createStructureEngine } from './marketStructure';
import { resolveSmcConfig } from './types';
import type { Candle } from '@/lib/types';
import type { SmcEvent } from './types';

/**
 * Three rising stairs (+10 then −4 each), a 20-bar macro decline, then a
 * 25-bar rise. The 4-bar pullbacks flip the size-3 internal tracker but not
 * the size-12 swing tracker, so internal pivots land on stair peaks/troughs
 * at levels DISTINCT from the swing pivots (the LuxAlgo coincidence filter,
 * SDD.md:565, suppresses internal breaks when levels coincide).
 */
function stairs(): Candle[] {
  const closes = [100];
  const push = (d: number) => closes.push(closes[closes.length - 1] + d);
  for (let s = 0; s < 3; s++) {
    for (let k = 0; k < 10; k++) push(1);
    for (let k = 0; k < 4; k++) push(-1);
  }
  for (let k = 0; k < 20; k++) push(-1);
  for (let k = 0; k < 25; k++) push(1);
  return closes.map((c, i) => ({ time: i * 60, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
}

const CFG = { swingsLength: 12, internalLength: 3 };

function run() {
  const candles = stairs();
  const events: SmcEvent[] = [];
  const eng = createStructureEngine(candles, resolveSmcConfig(CFG), events);
  const breaks = [];
  for (let i = 0; i < candles.length; i++) breaks.push(...eng.onBar(i));
  return { candles, events, eng, breaks };
}

describe('createStructureEngine', () => {
  it('emits internal structure events, flips trends, tracks trailing extremes', () => {
    const { candles, events, eng } = run();

    const internalBull = events.filter(
      (e) => (e.type === 'BOS' || e.type === 'CHOCH') && e.scope === 'internal' && e.direction === 'bullish',
    );
    expect(internalBull.length).toBeGreaterThan(0);

    // Final rise crosses the swing level; the coincident internal cross is
    // suppressed, so internal trend stays bearish while swing flips bullish.
    expect(eng.swingTrend).toBe(1);
    expect(eng.internalTrend).toBe(-1);

    // Trailing extremes end at the running max/min of the whole series.
    expect(eng.trailing.top).toBeCloseTo(Math.max(...candles.map((c) => c.high)));
    expect(eng.trailing.bottom).toBeCloseTo(Math.min(...candles.map((c) => c.low)));

    const broken = eng.structureLevels.filter((l) => l.state === 'mitigated');
    expect(broken.length).toBeGreaterThan(0);

    const swingFormed = events.filter((e) => e.type === 'SWING_FORMED');
    expect(swingFormed.length).toBeGreaterThan(0);
    expect(swingFormed.every((e) => e.objectId)).toBe(true);
  });

  it('tags the first break against the prior trend as CHoCH', () => {
    const { events } = run();
    const internal = events.filter((e) => (e.type === 'BOS' || e.type === 'CHOCH') && e.scope === 'internal');
    const firstBear = internal.find((e) => e.direction === 'bearish');
    expect(firstBear).toBeDefined();
    // Internal trend was bullish (stair BOS events) before the decline.
    const bullishBefore = internal.some((e) => e.direction === 'bullish' && e.barIndex < firstBear!.barIndex);
    expect(bullishBefore).toBe(true);
    expect(firstBear!.type).toBe('CHOCH');
    // Stair breakouts in an untrended/bullish state are BOS.
    expect(internal[0].type).toBe('BOS');
  });

  it('onBar returns break info on the break bar for order-block consumption', () => {
    const { breaks } = run();
    expect(breaks.length).toBeGreaterThan(0);
    const b = breaks[0];
    expect(b.scope).toBe('internal');
    expect(b.direction).toBe('bullish');
    expect(b.tag).toBe('BOS');
    expect(Number.isFinite(b.pivot.level)).toBe(true);
    expect(b.pivot.barIndex).toBeGreaterThanOrEqual(0);
  });
});
