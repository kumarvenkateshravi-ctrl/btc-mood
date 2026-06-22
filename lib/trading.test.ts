import { describe, it, expect } from 'vitest';
import { positionSize, riskReward, formatRR } from './trading';

describe('positionSize', () => {
  it('sizes so a stop-out loses exactly risk% of balance', () => {
    // $10k, 1% risk = $100 risk; SL distance $500 → 0.2 units.
    expect(positionSize(10_000, 1, 500)).toBeCloseTo(0.2, 9);
  });
  it('scales with risk %', () => {
    expect(positionSize(10_000, 2, 500)).toBeCloseTo(0.4, 9);
  });
  it('returns 0 for invalid inputs', () => {
    expect(positionSize(0, 1, 500)).toBe(0);
    expect(positionSize(10_000, 0, 500)).toBe(0);
    expect(positionSize(10_000, 1, 0)).toBe(0);
    expect(positionSize(10_000, 1, -5)).toBe(0);
  });
});

describe('riskReward', () => {
  it('computes long reward/risk', () => {
    // entry 100, tp 120 (reward 20), sl 90 (risk 10) → 2.0
    expect(riskReward('long', 100, 120, 90)).toBeCloseTo(2, 9);
  });
  it('computes short reward/risk', () => {
    // entry 100, tp 80 (reward 20), sl 110 (risk 10) → 2.0
    expect(riskReward('short', 100, 80, 110)).toBeCloseTo(2, 9);
  });
  it('returns null when TP/SL missing', () => {
    expect(riskReward('long', 100, null, 90)).toBeNull();
    expect(riskReward('long', 100, 120, null)).toBeNull();
  });
  it('returns null for wrong-side placement', () => {
    expect(riskReward('long', 100, 90, 95)).toBeNull(); // tp below entry
    expect(riskReward('long', 100, 120, 110)).toBeNull(); // sl above entry
  });
});

describe('formatRR', () => {
  it('formats as R:1', () => {
    expect(formatRR(2.5)).toBe('2.50 : 1');
    expect(formatRR(null)).toBe('—');
  });
});
