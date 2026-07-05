import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSignals, DEFAULT_SIGNAL_CONFIG } from './signalEngine';
import type { ScoredZone } from './signalTypes';
import type { Candle } from '../types';

const c = (i: number, o: number, h: number, l: number, cl: number): Candle =>
  ({ time: 1000 + i * 60, open: o, high: h, low: l, close: cl, volume: 100 } as Candle);

const zone = (over: Partial<ScoredZone>): ScoredZone => ({
  kind: 'demand', zoneType: 'demand', tf: 'D', upper: 105, lower: 100, mid: 102.5,
  formedAtIndex: 0, formedTime: 1000, isConfluence: false, retestCount: 0,
  strength: { score: 80, tier: 'strong', factors: { formationVolume: 0.7, rejectionStrength: 0.7, retests: 0, freshness: 0.9, confluence: 0, zoneWidth: 0.5 } },
  ...over,
});

const bars: Candle[] = [
  c(0, 110, 112, 108, 111), c(1, 111, 112, 106, 107), c(2, 107, 108, 101, 103),
  c(3, 103, 109, 102, 108), c(4, 108, 122, 107, 120), c(5, 120, 131, 119, 130),
];
const zones = [zone({}), zone({ kind: 'supply', zoneType: 'supply', lower: 130, upper: 135 })];
const atr = bars.map(() => 4);
const ctx = { symbol: 'BTCUSDT', timeframe: '1h' };

const GOLDEN = join(__dirname, '..', 'testing', 'fixtures', 'signalEngine.golden.json');

describe('signalEngine golden', () => {
  it('matches the frozen SdSignal snapshot', () => {
    const sigs = generateSignals(bars, zones, atr, DEFAULT_SIGNAL_CONFIG, ctx);
    const expected = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    // Compare serialized form: the golden file is JSON, so un-set NaN levels on
    // never-triggered signals normalize to null on both sides.
    expect(JSON.parse(JSON.stringify(sigs))).toEqual(expected);
  });

  it('does not repaint: a triggered signal is identical when computed over a prefix', () => {
    const full = generateSignals(bars, zones, atr, DEFAULT_SIGNAL_CONFIG, ctx).find((e) => e.triggeredIndex === 3)!;
    const prefix = generateSignals(bars.slice(0, 5), zones, atr.slice(0, 5), DEFAULT_SIGNAL_CONFIG, ctx).find((e) => e.triggeredIndex === 3)!;
    expect(prefix.entry).toBe(full.entry);
    expect(prefix.stopLoss).toBe(full.stopLoss);
    expect(prefix.takeProfit1).toBe(full.takeProfit1);
    expect(prefix.takeProfit2).toBe(full.takeProfit2);
  });
});
