import { describe, it, expect } from 'vitest';
import { IndicatorRegistry, createDefaultRegistry } from './registry';
import { verdictOf } from './types';
import type { IndicatorDefinition } from './types';
import { computeTfCells } from '../alignment';
import type { Candle } from '../types';

function series(n: number, base: number, step: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = base + i * step;
    const o = close - step;
    return {
      time: i * 300,
      open: o,
      high: Math.max(o, close) + 1,
      low: Math.min(o, close) - 1,
      close,
      volume: 1000 + (i % 5) * 80,
    };
  });
}

const ROSTER = ['ema', 'supertrend', 'rsi', 'macd', 'adx', 'obv', 'volume'];

const stubDef = (id: string, score = 100): IndicatorDefinition => ({
  id,
  label: id.toUpperCase(),
  sub: 'stub',
  kind: 'label',
  category: 'trend',
  defaultWeight: 1,
  evaluate: () => ({ score, display: 'Stub' }),
});

describe('createDefaultRegistry', () => {
  it('registers the seven-indicator roster in row order', () => {
    const ids = createDefaultRegistry().list().map((d) => d.id);
    expect(ids).toEqual(ROSTER);
  });

  it('every definition declares a category and a positive finite weight', () => {
    for (const d of createDefaultRegistry().list()) {
      expect(['trend', 'momentum', 'volume', 'strength']).toContain(d.category);
      expect(d.defaultWeight).toBeGreaterThan(0);
      expect(Number.isFinite(d.defaultWeight)).toBe(true);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });

  it('returns independent instances (registering into one does not leak)', () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    a.register(stubDef('vwap'));
    expect(a.has('vwap')).toBe(true);
    expect(b.has('vwap')).toBe(false);
  });
});

describe('IndicatorRegistry.register', () => {
  it('rejects duplicate ids', () => {
    const r = createDefaultRegistry();
    expect(() => r.register(stubDef('rsi'))).toThrow(/rsi/);
  });

  it('rejects non-positive or non-finite weights', () => {
    const r = new IndicatorRegistry();
    expect(() => r.register({ ...stubDef('a'), defaultWeight: 0 })).toThrow();
    expect(() => r.register({ ...stubDef('b'), defaultWeight: -1 })).toThrow();
    expect(() => r.register({ ...stubDef('c'), defaultWeight: NaN })).toThrow();
  });

  it('get returns the definition; unknown ids return undefined', () => {
    const r = createDefaultRegistry();
    expect(r.get('macd')?.label).toBe('MACD');
    expect(r.get('nope')).toBeUndefined();
  });
});

describe('IndicatorRegistry.evaluate', () => {
  const r = createDefaultRegistry();
  const up = series(260, 100, 0.5);

  it('returns one result per indicator with scores in [0,100] and matching verdicts', () => {
    const results = r.evaluate(up);
    expect(results.map((x) => x.id)).toEqual(ROSTER);
    for (const x of results) {
      expect(x.score).toBeGreaterThanOrEqual(0);
      expect(x.score).toBeLessThanOrEqual(100);
      expect(x.verdict).toBe(verdictOf(x.score));
      expect(x.display.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic: same candles produce identical results', () => {
    expect(r.evaluate(up)).toEqual(r.evaluate(up));
  });

  it('does not throw on short series and stays in range', () => {
    for (const x of r.evaluate(series(5, 100, 0.5))) {
      expect(x.score).toBeGreaterThanOrEqual(0);
      expect(x.score).toBeLessThanOrEqual(100);
    }
  });

  it('returns all-neutral results for empty candles', () => {
    for (const x of r.evaluate([])) {
      expect(x.score).toBe(50);
      expect(x.verdict).toBe('neutral');
    }
  });

  it('matches the legacy computeTfCells sub-scores exactly (behavior parity)', () => {
    for (const candles of [up, series(260, 300, -0.5), series(60, 100, 0)]) {
      const { cells, score } = computeTfCells(candles);
      const results = r.evaluate(candles);
      for (const x of results) {
        const cell = cells[x.id as keyof typeof cells];
        expect(x.score).toBe(cell.score);
        expect(x.verdict).toBe(cell.verdict);
        expect(x.display).toBe(cell.display);
      }
      expect(r.compositeScore(results)).toBe(score);
    }
  });
});

describe('IndicatorRegistry.compositeScore', () => {
  const r = createDefaultRegistry();
  const up = series(260, 100, 0.5);

  it('equals the rounded mean under default (equal) weights', () => {
    const results = r.evaluate(up);
    const mean = Math.round(results.reduce((s, x) => s + x.score, 0) / results.length);
    expect(r.compositeScore(results)).toBe(mean);
  });

  it('is invariant under uniform weight scaling (weights are normalized)', () => {
    const results = r.evaluate(up);
    const scaled = Object.fromEntries(ROSTER.map((id) => [id, 3]));
    expect(r.compositeScore(results, scaled)).toBe(r.compositeScore(results));
  });

  it('honors custom weights (all weight on one indicator → its score)', () => {
    const results = r.evaluate(up);
    const ema = results.find((x) => x.id === 'ema')!;
    const emaOnly = Object.fromEntries(ROSTER.map((id) => [id, id === 'ema' ? 1 : 1e-9]));
    expect(r.compositeScore(results, emaOnly)).toBe(Math.round(ema.score));
  });

  it('rejects weight overrides for unregistered indicators or invalid values', () => {
    const results = r.evaluate(up);
    expect(() => r.compositeScore(results, { nope: 1 })).toThrow(/nope/);
    expect(() => r.compositeScore(results, { ema: -1 })).toThrow();
  });
});

describe('IndicatorRegistry.evaluate with custom settings', () => {
  const r = createDefaultRegistry();
  // Wavy series (mixed up/down moves) so oscillator lengths actually matter.
  const wavy: Candle[] = Array.from({ length: 260 }, (_, i) => {
    const close = 100 + 10 * Math.sin(i / 5) + i * 0.05;
    const o = 100 + 10 * Math.sin((i - 1) / 5) + (i - 1) * 0.05;
    return {
      time: i * 300,
      open: o,
      high: Math.max(o, close) + 1,
      low: Math.min(o, close) - 1,
      close,
      volume: 1000 + (i % 5) * 80,
    };
  });

  const mkSettings = (inputs: Record<string, number | string | boolean>) => ({
    inputs, styles: {}, visibility: {},
  });

  it('custom RSI length changes the rsi score', () => {
    const base = r.evaluate(wavy).find((x) => x.id === 'rsi')!;
    const custom = r
      .evaluate(wavy, { settings: { rsi: mkSettings({ length: 5 }) } })
      .find((x) => x.id === 'rsi')!;
    expect(custom.score).not.toBe(base.score);
  });

  it('omitted and empty settings keep exact parity with defaults', () => {
    expect(r.evaluate(wavy, { settings: {} })).toEqual(r.evaluate(wavy));
  });

  it('settings for ids without inputs (obv/volume) and unknown ids are ignored', () => {
    const noisy = {
      obv: mkSettings({ bogus: 1 }),
      volume: mkSettings({ bogus: 1 }),
      nope: mkSettings({ x: 1 }),
    };
    expect(r.evaluate(wavy, { settings: noisy })).toEqual(r.evaluate(wavy));
  });

  it('subFor reflects live parameters for the configurable indicators', () => {
    expect(r.get('supertrend')!.subFor!(mkSettings({ atrPeriod: 12, mult: 4 }))).toBe('12,4');
    expect(r.get('rsi')!.subFor!(mkSettings({ length: 21 }))).toBe('21');
    expect(r.get('macd')!.subFor!(mkSettings({ fast: 8, slow: 21, signal: 5 }))).toBe('8,21,5');
    expect(r.get('adx')!.subFor!(mkSettings({ diLength: 20 }))).toBe('20');
    // Missing inputs fall back to the defaults shown today.
    expect(r.get('supertrend')!.subFor!(mkSettings({}))).toBe('10,3');
  });
});

describe('extensibility', () => {
  it('a newly registered indicator participates in evaluate and compositeScore', () => {
    const r = createDefaultRegistry();
    r.register(stubDef('funding', 100));
    const results = r.evaluate(series(60, 100, 0));
    expect(results.map((x) => x.id)).toContain('funding');
    const funding = results.find((x) => x.id === 'funding')!;
    expect(funding.score).toBe(100);
    expect(funding.verdict).toBe('bullish');
  });
});

describe('M1.0 intelligence contract', () => {
  const r = createDefaultRegistry();
  const up = series(260, 100, 0.5);

  it('every result carries the intelligence fields with placeholder values', () => {
    for (const x of r.evaluate(up).filter((y) => y.id !== 'ema')) {   // EMA is rich as of M1.1
      expect(['trend', 'momentum', 'volume', 'strength']).toContain(x.category);
      expect(x.confidence).toBe(x.score);
      expect(x.strength).toBe(x.score);
      expect(x.diagnostics).toEqual({});
      expect(x.signals).toEqual([]);
      expect(x.warnings).toEqual([]);
    }
  });

  it('EMA produces populated intelligence while score/display/verdict stay frozen', () => {
    const ema = r.evaluate(up).find((x) => x.id === 'ema')!;
    expect(ema.score).toBe(100);          // frozen bucket for the steadily rising series
    expect(ema.display).toBe('Bullish');
    expect(ema.verdict).toBe('bullish');
    expect(Object.keys(ema.diagnostics).sort()).toEqual(
      ['alignment', 'freshness', 'pricePosition', 'separation', 'slope']);
    expect(ema.signals.length).toBeGreaterThan(0);
    expect(ema.confidence).toBeGreaterThanOrEqual(0);
    expect(ema.confidence).toBeLessThanOrEqual(100);
    expect(ema.strength).toBeGreaterThanOrEqual(0);
    expect(ema.strength).toBeLessThanOrEqual(100);
  });

  it('a rich evaluation passes through instead of placeholders', () => {
    const r2 = new IndicatorRegistry();
    r2.register({
      ...stubDef('rich'),
      evaluate: () => ({
        score: 80, display: 'Rich', confidence: 61, strength: 42,
        diagnostics: { a: 1 },
        signals: [{ code: 'X', message: 'x', severity: 'info' as const }],
        warnings: [{ code: 'Y', message: 'y', severity: 'warning' as const }],
      }),
    });
    const [x] = r2.evaluate(series(10, 100, 0.5));
    expect(x.confidence).toBe(61);
    expect(x.strength).toBe(42);
    expect(x.diagnostics).toEqual({ a: 1 });
    expect(x.signals[0].code).toBe('X');
    expect(x.warnings[0].severity).toBe('warning');
  });

  it('empty candles produce neutral intelligence placeholders', () => {
    for (const x of r.evaluate([])) {
      expect(x.confidence).toBe(50);
      expect(x.strength).toBe(50);
      expect(x.diagnostics).toEqual({});
    }
  });
});
