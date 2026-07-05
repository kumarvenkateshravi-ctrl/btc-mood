import { describe, it, expect } from 'vitest';
import { computeStopLoss, DEFAULT_SIGNAL_CONFIG, computeTargets, computeConfidence, generateSignals } from './signalEngine';
import type { ScoredZone } from './signalTypes';
import type { Candle } from '../types';

const CFG = DEFAULT_SIGNAL_CONFIG;

const zone = { upper: 105, lower: 100 };

const z = (over: Partial<ScoredZone>): ScoredZone => ({
  kind: 'supply', zoneType: 'supply', tf: 'D', upper: 0, lower: 0, mid: 0,
  formedAtIndex: 0, formedTime: 0, isConfluence: false, retestCount: 0,
  strength: { score: 60, tier: 'medium', factors: { formationVolume: 0.5, rejectionStrength: 0.5, retests: 0, freshness: 0.8, confluence: 0, zoneWidth: 0.5 } },
  ...over,
});

describe('computeStopLoss', () => {
  it('atr mode: buy stop is zone.lower minus slBuffer*atr', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(99, 6);
  });
  it('percent mode: buy stop uses % of entry', () => {
    const sl = computeStopLoss('buy', zone, 200, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'percent', slBuffer: 1 });
    expect(sl).toBeCloseTo(98, 6);
  });
  it('ticks mode: buy stop uses slBuffer*tickSize', () => {
    const sl = computeStopLoss('buy', zone, 106, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'ticks', slBuffer: 5, tickSize: 0.1 });
    expect(sl).toBeCloseTo(99.5, 6);
  });
  it('sell mirrors above the zone upper', () => {
    const sl = computeStopLoss('sell', zone, 104, 4, { ...DEFAULT_SIGNAL_CONFIG, slBufferMode: 'atr', slBuffer: 0.25 });
    expect(sl).toBeCloseTo(106, 6);
  });
});

describe('computeTargets (buy at demand)', () => {
  it('TP1 = nearest supply.lower above entry, TP2 = nearest supplyTarget.upper above TP1', () => {
    const zones = [
      z({ kind: 'supply', lower: 120, upper: 125, formedAtIndex: 1 }),
      z({ kind: 'supplyTarget', lower: 125, upper: 140, formedAtIndex: 1 }),
    ];
    const { tp1, tp2 } = computeTargets('buy', 100, 98, zones, 5, 1.5);
    expect(tp1).toBe(120);
    expect(tp2).toBe(140);
  });
  it('falls back to R-multiples when no opposing zone exists', () => {
    const { tp1, tp2 } = computeTargets('buy', 100, 98, [], 5, 1.5);
    expect(tp1).toBeCloseTo(103, 6);
    expect(tp2).toBeCloseTo(106, 6);
  });
  it('ignores zones formed after the trigger (no lookahead)', () => {
    const zones = [z({ kind: 'supply', lower: 120, upper: 125, formedAtIndex: 99 })];
    const { tp1 } = computeTargets('buy', 100, 98, zones, 5, 1.5);
    expect(tp1).toBeCloseTo(103, 6);
  });
});

describe('computeTargets (sell at supply)', () => {
  it('TP1 = nearest demand.upper below entry, TP2 = nearest demandTarget.lower below TP1', () => {
    const zones = [
      z({ kind: 'demand', zoneType: 'demand', lower: 75, upper: 80, formedAtIndex: 1 }),
      z({ kind: 'demandTarget', zoneType: 'demand', lower: 60, upper: 75, formedAtIndex: 1 }),
    ];
    const { tp1, tp2 } = computeTargets('sell', 100, 102, zones, 5, 1.5);
    expect(tp1).toBe(80);
    expect(tp2).toBe(60);
  });
});

describe('computeConfidence', () => {
  const strong = z({
    zoneType: 'demand', kind: 'demand', isConfluence: true, retestCount: 3,
    strength: { score: 90, tier: 'strong', factors: { formationVolume: 0.9, rejectionStrength: 0.8, retests: 0.3, freshness: 0.2, confluence: 1, zoneWidth: 0.6 } },
  });
  it('returns 0..100 and factors sorted by contribution desc', () => {
    const { confidence, explanation } = computeConfidence(strong, 2.1, 1.5, CFG);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(100);
    const contribs = explanation.factors.map((f) => f.contribution);
    expect(contribs).toEqual([...contribs].sort((a, b) => b - a));
  });
  it('surfaces counter-signals (high retests, stale zone)', () => {
    const { explanation } = computeConfidence(strong, 2.1, 1.5, CFG);
    expect(explanation.counterSignals).toContain('retested 3×');
    expect(explanation.counterSignals).toContain('stale zone');
  });
  it('summary mentions the R multiple', () => {
    const { explanation } = computeConfidence(strong, 2.1, 1.5, CFG);
    expect(explanation.summary).toMatch(/2\.1R/);
  });
});

const c = (i: number, o: number, h: number, l: number, cl: number): Candle =>
  ({ time: 1000 + i * 60, open: o, high: h, low: l, close: cl, volume: 100 } as Candle);

const demand = z({
  kind: 'demand', zoneType: 'demand', lower: 100, upper: 105, mid: 102.5,
  formedAtIndex: 0, strength: { score: 80, tier: 'strong', factors: { formationVolume: 0.7, rejectionStrength: 0.7, retests: 0, freshness: 0.9, confluence: 0, zoneWidth: 0.5 } },
});
const supply = z({ kind: 'supply', zoneType: 'supply', lower: 130, upper: 135, formedAtIndex: 0 });

const bars: Candle[] = [
  c(0, 110, 112, 108, 111),
  c(1, 111, 112, 106, 107),
  c(2, 107, 108, 101, 103),   // enters demand -> armed
  c(3, 103, 109, 102, 108),   // close 108 > 105 -> rejection confirm -> triggered
  c(4, 108, 122, 107, 120),
  c(5, 120, 131, 119, 130),   // high 131 >= supply.lower 130 -> tp1
];
const atr = bars.map(() => 4);
const ctx = { symbol: 'BTCUSDT', timeframe: '1h' };

describe('generateSignals (buy lifecycle)', () => {
  it('arms, triggers on rejection close, resolves at TP1, carries the contract fields', () => {
    const sigs = generateSignals(bars, [demand, supply], atr, { ...CFG, closedBarOnly: false }, ctx);
    const s = sigs.find((e) => e.side === 'buy')!;
    expect(s.symbol).toBe('BTCUSDT');
    expect(s.timeframe).toBe('1h');
    expect(s.zoneId).toBe('D:demand:0');
    expect(s.armedIndex).toBe(2);
    expect(s.triggeredIndex).toBe(3);
    expect(s.entry).toBeCloseTo(108, 6);
    expect(s.stopLoss).toBeCloseTo(99, 6);
    expect(s.takeProfit1).toBe(130);
    expect(s.status).toBe('tp1');
    expect(s.createdAt).toBe(bars[3].time);
  });

  it('fails the R:R gate -> invalidated, never triggered, with rejectReason', () => {
    const sigs = generateSignals(bars, [demand, supply], atr, { ...CFG, closedBarOnly: false, minRR: 100 }, ctx);
    const s = sigs.find((e) => e.side === 'buy')!;
    expect(s.status).toBe('invalidated');
    expect(s.triggeredIndex).toBeNull();
    expect(s.rejectReason).toBe('riskReward');
  });
});

describe('generateSignals closedBarOnly', () => {
  // Demand 100-105; bar 1 enters, bar 2 (the LAST bar) closes back above.
  const dz = z({
    kind: 'demand', zoneType: 'demand', lower: 100, upper: 105, formedAtIndex: 0,
    strength: { score: 80, tier: 'strong', factors: { formationVolume: 0.7, rejectionStrength: 0.7, retests: 0, freshness: 0.9, confluence: 0, zoneWidth: 0.5 } },
  });
  const sup = z({ kind: 'supply', zoneType: 'supply', lower: 130, upper: 135, formedAtIndex: 0 });
  const three: Candle[] = [c(0, 110, 112, 108, 111), c(1, 107, 108, 101, 103), c(2, 103, 109, 102, 108)];
  const atr3 = three.map(() => 4);

  it('does NOT confirm on the still-forming last bar (strict, default)', () => {
    const sigs = generateSignals(three, [dz, sup], atr3, { ...CFG }, ctx); // closedBarOnly default true
    const s = sigs.find((e) => e.side === 'buy');
    expect(s?.triggeredIndex ?? null).toBeNull(); // last-bar confirm ignored
  });

  it('DOES confirm on that same bar once treated as closed', () => {
    const sigs = generateSignals(three, [dz, sup], atr3, { ...CFG, closedBarOnly: false }, ctx);
    const s = sigs.find((e) => e.side === 'buy');
    expect(s?.triggeredIndex).toBe(2);
  });
});
