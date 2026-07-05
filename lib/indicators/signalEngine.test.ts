import { describe, it, expect } from 'vitest';
import { computeStopLoss, DEFAULT_SIGNAL_CONFIG, computeTargets, computeConfidence } from './signalEngine';
import type { ScoredZone } from './signalTypes';

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
