import { describe, expect, it } from 'vitest';
import type { IndicatorResult } from '../intelligence';
import { toMap } from './shared';
import {
  evaluateVolatilityCategory, buildVolatilityConfidence, buildVolatilityStrength,
  type VolatilityCategoryDiagnostics,
} from './volatility';

const ind = (id: string, diagnostics: object): IndicatorResult => ({
  id, category: 'trend', score: 50, verdict: 'neutral', confidence: 50, strength: 50,
  display: '—', diagnostics, signals: [], warnings: [], weight: 1,
});
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe('evaluateVolatilityCategory', () => {
  it('is non-directional: score always 50', () => {
    const r = evaluateVolatilityCategory(toMap([ind('supertrend', { distance: 80 }), ind('macd', { separation: 90 })]));
    expect(r.score).toBe(50);
    expect(r.verdict).toBe('neutral');
  });

  it('expanding + impulse + high-volatility warning', () => {
    const r = evaluateVolatilityCategory(toMap([ind('supertrend', { distance: 80 }), ind('macd', { separation: 90 })]));
    expect(r.state).toBe('expanding');
    expect(codes(r.signals)).toEqual(['VOLATILITY_EXPANSION', 'VOLATILITY_IMPULSE']);
    expect(codes(r.warnings)).toContain('HIGH_VOLATILITY');
  });

  it('compressed → squeeze', () => {
    const r = evaluateVolatilityCategory(toMap([ind('supertrend', { distance: 10 }), ind('macd', { separation: 5 })]));
    expect(r.state).toBe('compressed');
    expect(codes(r.signals)).toContain('VOLATILITY_SQUEEZE');
  });

  it('no evidence → normal, confidence 50, strength 0, no squeeze signal', () => {
    const r = evaluateVolatilityCategory(toMap([ind('supertrend', {}), ind('macd', {})]));
    expect(r.state).toBe('normal');
    expect(r.confidence).toBe(50);
    expect(r.strength).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('builders: exact weighted mixes', () => {
    const d: VolatilityCategoryDiagnostics = { expansion: 80, distance: 70, impulse: 90, squeeze: 20, stability: 60 };
    // 0.40·80=32 + 0.30·60=18 + 0.15·90=13.5 + 0.15·70=10.5 → 74
    expect(buildVolatilityConfidence(d)).toBe(74);
    // 0.50·80=40 + 0.25·90=22.5 + 0.25·70=17.5 → 80
    expect(buildVolatilityStrength(d)).toBe(80);
  });
});
