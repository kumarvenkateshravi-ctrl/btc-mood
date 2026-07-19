import { describe, expect, it } from 'vitest';
import type { LayerAgreement } from './agreementTypes';
import { combine } from './dominance';

const BLEND = { indicator: 0.4, category: 0.6 };
const layer = (bullFrac: number, bearFrac: number, neutralFrac: number, total = 1): LayerAgreement => ({
  agreement: 0, conflict: 0, dominantBias: 'neutral',
  bull: 0, bear: 0, neutral: 0, total, bullFrac, bearFrac, neutralFrac, contributors: [],
});

describe('combine', () => {
  it('aligned layers → dominant side, high dominantShare', () => {
    const r = combine(layer(1, 0, 0), layer(1, 0, 0), BLEND);
    expect(r.dominantBias).toBe('bullish');
    expect(r.dominantShare).toBe(1);
    expect(r.minorityShare).toBe(0);
  });

  it('cross-layer split resolves from combined mass (not forced neutral)', () => {
    // indicators bull, categories bear, blend 0.4/0.6 → bear 0.6 > bull 0.4
    const r = combine(layer(1, 0, 0), layer(0, 1, 0), BLEND);
    expect(r.dominantBias).toBe('bearish');
    expect(r.dominantShare).toBe(0.6);
    expect(r.minorityShare).toBe(0.4);
  });

  it('empty category layer → indicators take full weight', () => {
    const r = combine(layer(1, 0, 0), layer(0, 0, 0, 0), BLEND);
    expect(r.dominantBias).toBe('bullish');
    expect(r.dominantShare).toBe(1);
  });

  it('both empty → neutral, zero shares', () => {
    const r = combine(layer(0, 0, 0, 0), layer(0, 0, 0, 0), BLEND);
    expect(r.dominantBias).toBe('neutral');
    expect(r.dominantShare).toBe(0);
    expect(r.minorityShare).toBe(0);
  });
});
