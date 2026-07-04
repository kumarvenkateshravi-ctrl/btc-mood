import { describe, it, expect } from 'vitest';
import { scoreZone, countRetests, DEFAULT_ZONE_STRENGTH_WEIGHTS, type Zone } from './zoneStrength';
import type { HtfBucketOHLC } from './htf';
import type { Candle } from '../types';

const bar = (o: number, h: number, l: number, cl: number, v = 1): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: cl, volume: v });

const ohlc = (v: number): HtfBucketOHLC =>
  ({ open: 100, high: 110, low: 90, close: 105, volume: v, startTime: 0 });

// A demand zone [90..95] formed at index 2 from a period of volume 100.
const demandZone = (over: Partial<Zone> = {}): Zone => ({
  kind: 'demand', tf: 'D', upper: 95, lower: 90, formedAtIndex: 2, formedOHLC: ohlc(100), ...over,
});

const ctx = { avgPeriodVolume: 100, atrAtFormation: 10 };

describe('countRetests', () => {
  it('counts distinct in-zone runs after formation (not the formation bar)', () => {
    // formedAtIndex 2; bars 3-4 in zone (one touch), 5 out, 6 in (second touch)
    const candles = [
      bar(100, 110, 90, 105), bar(100, 110, 90, 105), bar(100, 110, 90, 105), // 0,1,2
      bar(96, 96, 92, 93),  // 3 in [90..95]
      bar(94, 95, 91, 92),  // 4 in
      bar(120, 122, 118, 121), // 5 out
      bar(96, 97, 93, 94),  // 6 in (2nd touch)
    ];
    expect(countRetests(demandZone(), candles)).toBe(2);
  });
});

describe('scoreZone', () => {
  it('returns factors in 0..1 and score in 0..100', () => {
    const candles = Array.from({ length: 10 }, () => bar(100, 110, 90, 105));
    const s = scoreZone(demandZone(), candles, [], ctx);
    Object.values(s.factors).forEach((f) => {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    });
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(['weak', 'medium', 'strong']).toContain(s.tier);
  });

  it('high formation volume raises formationVolume factor', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const low = scoreZone(demandZone({ formedOHLC: ohlc(50) }), candles, [], ctx).factors.formationVolume;
    const high = scoreZone(demandZone({ formedOHLC: ohlc(200) }), candles, [], ctx).factors.formationVolume;
    expect(high).toBeGreaterThan(low);
  });

  it('a tighter zone scores higher on zoneWidth', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const tight = scoreZone(demandZone({ upper: 91 }), candles, [], ctx).factors.zoneWidth; // height 1
    const wide = scoreZone(demandZone({ upper: 120 }), candles, [], ctx).factors.zoneWidth; // height 30
    expect(tight).toBeGreaterThan(wide);
  });

  it('an overlapping same-type zone on another TF raises confluence', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const other: Zone = demandZone({ tf: 'W', upper: 96, lower: 93 }); // overlaps [90..95]
    const alone = scoreZone(demandZone(), candles, [], ctx).factors.confluence;
    const withConf = scoreZone(demandZone(), candles, [other], ctx).factors.confluence;
    expect(alone).toBe(0);
    expect(withConf).toBeGreaterThan(0);
  });

  it('custom weights change the score', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const a = scoreZone(demandZone(), candles, [], ctx, DEFAULT_ZONE_STRENGTH_WEIGHTS).score;
    const b = scoreZone(demandZone(), candles, [], ctx, { zoneWidth: 10, confluence: 0 }).score;
    expect(b).not.toBe(a);
  });
});
