import { describe, it, expect } from 'vitest';
import {
  TRADING_STYLES, STYLE_BY_ID, WORKFLOW_STEPS, qualifyMarket, generateSetup, iqScore,
  SAMPLE_QUALIFICATION,
} from './myStackIqEngine';
import type { Candle } from './types';

function synth(n: number, up: boolean): Candle[] {
  const out: Candle[] = [];
  let p = 60000;
  for (let i = 0; i < n; i++) {
    p += (up ? 1 : -1) * 20 + Math.sin(i * 0.5) * 30;
    out.push({ time: i * 300, open: p - 5, high: p + 15, low: p - 15, close: p, volume: 100 + (i % 10) * 5 });
  }
  return out;
}

describe('trading styles', () => {
  it('exposes eight styles and a seven-step workflow', () => {
    expect(TRADING_STYLES).toHaveLength(8);
    expect(WORKFLOW_STEPS).toHaveLength(7);
    expect(STYLE_BY_ID['scalping'].recommendedTf).toBe('5m');
  });
  it('each style carries a complete decision profile', () => {
    for (const s of TRADING_STYLES) {
      expect(s.keyRules.length).toBeGreaterThan(0);
      expect(s.indicators.length).toBeGreaterThan(0);
      expect(s.recent).toHaveLength(6);
      expect(s.performance.winRate).toBeGreaterThan(0);
      expect(s.performance.winRate).toBeLessThanOrEqual(100);
      expect(['LONG ONLY', 'SHORT ONLY', 'BOTH']).toContain(s.bias);
    }
  });
});

describe('qualifyMarket (live)', () => {
  it('returns null without enough candles', () => {
    expect(qualifyMarket(synth(10, true))).toBeNull();
  });
  it('flags Long Only in an uptrend and Short Only in a downtrend', () => {
    const up = qualifyMarket(synth(220, true))!;
    expect(up.trendBias).toBe('Long Only');
    expect(up.readiness).toBeGreaterThanOrEqual(0);
    expect(up.readiness).toBeLessThanOrEqual(100);
    const down = qualifyMarket(synth(220, false))!;
    expect(down.trendBias).toBe('Short Only');
  });
});

describe('setup + score', () => {
  it('generates an ordered long setup around price', () => {
    const s = generateSetup(STYLE_BY_ID['scalping'], 62764.8);
    expect(s.entryLo).toBeLessThan(s.entryHi);
    expect(s.sl).toBeLessThan(s.entryLo);
    expect(s.tp2).toBeGreaterThan(s.tp1);
    expect(s.tp1).toBeGreaterThan(s.entryHi);
  });
  it('produces a bounded IQ score', () => {
    const r = iqScore(STYLE_BY_ID['scalping'], SAMPLE_QUALIFICATION);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['Elite', 'Strong', 'Stable', 'Weak']).toContain(r.label);
  });
});
