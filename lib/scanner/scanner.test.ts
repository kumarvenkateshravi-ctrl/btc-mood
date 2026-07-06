import { describe, it, expect, beforeEach } from 'vitest';
import { OPERATORS } from './operators';
import { SCANNER_SOURCES, SCANNER_SOURCE_LIST, publishScannerLiveScores } from './registry';
import { getSeries, __clearSeriesCacheForTest } from './seriesCache';
import { evaluateCondition, evaluate, snapshotCondition } from './evaluate';
import type { Candle } from '../types';
import type { Condition } from './types';

const bar = (i: number, close: number, vol = 100): Candle =>
  ({ time: 1_600_000_000 + i * 900, open: close - 0.5, high: close + 0.6, low: close - 1.1, close, volume: vol } as Candle);

const ramp = (n: number, step: number, start = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(i, start + i * step));

beforeEach(() => __clearSeriesCacheForTest());

describe('Operator Registry', () => {
  const left = [null, 1, 2, 3, 2, 1] as (number | null)[];
  it('comparisons are null-safe', () => {
    expect(OPERATORS.gt.evaluate(left, 1.5, 2)).toBe(true);
    expect(OPERATORS.gt.evaluate(left, 1.5, 0)).toBeNull(); // warm-up
    expect(OPERATORS.lte.evaluate(left, 2, 3)).toBe(false);
    expect(OPERATORS.between.evaluate(left, [1, 2], 2)).toBe(true);
    expect(OPERATORS.between.evaluate(left, [3, 5], 2)).toBe(false);
  });
  it('cross semantics need prev AND now', () => {
    const fast = [null, 1, 3, 4] as (number | null)[];
    const slow = [null, 2, 2, 2] as (number | null)[];
    expect(OPERATORS.crossAbove.evaluate(fast, slow, 2)).toBe(true);  // 1≤2 → 3>2
    expect(OPERATORS.crossAbove.evaluate(fast, slow, 3)).toBe(false); // already above
    expect(OPERATORS.crossBelow.evaluate(slow, fast, 2)).toBe(true);
  });
  it('increasing/decreasing check strict 3-bar monotonicity', () => {
    expect(OPERATORS.increasing.evaluate(left, 0, 3)).toBe(true);  // 1<2<3
    expect(OPERATORS.increasing.evaluate(left, 0, 4)).toBe(false);
    expect(OPERATORS.decreasing.evaluate(left, 0, 5)).toBe(true);  // 3>2>1
  });
});

describe('Indicator Registry', () => {
  const candles = ramp(120, 0.5);
  it('every source produces a candle-aligned series for each output', () => {
    for (const s of SCANNER_SOURCE_LIST) {
      for (const out of s.outputs) {
        const series = s.series(candles, {}, out.id);
        expect(series.length, `${s.id}.${out.id}`).toBe(candles.length);
      }
    }
  });
  it('ema source matches pineMath directly (one source of truth)', async () => {
    const pm = await import('../pineMath');
    const viaRegistry = SCANNER_SOURCES.ema.series(candles, { length: 20 }, 'value');
    const direct = pm.ema(candles.map((c) => c.close), 20);
    expect(viaRegistry[100]).toBeCloseTo(direct[100] as number, 9);
  });
  it('intelligence scores read directional on a trend', () => {
    const up = ramp(120, 1);
    expect(SCANNER_SOURCES.trendScore.series(up, {}, 'score')[119]!).toBeGreaterThan(55);
    expect(SCANNER_SOURCES.contextScore.series(up, {}, 'score')[119]!).toBeGreaterThan(55);
    const down = ramp(120, -1, 400);
    expect(SCANNER_SOURCES.trendScore.series(down, {}, 'score')[119]!).toBeLessThan(45);
  });
  it('liveOnly sources fill only the last bar from the published store', () => {
    publishScannerLiveScores({ stackScore: 87, alignment: null });
    const s = SCANNER_SOURCES.stackScore.series(ramp(50, 0.5), {}, 'score');
    expect(s[49]).toBe(87);
    expect(s[10]).toBeNull();
    expect(SCANNER_SOURCES.stackScore.liveOnly).toBe(true);
  });
});

describe('Series Cache', () => {
  it('returns the same reference for identical closed bars (cache hit)', () => {
    const candles = ramp(80, 0.5);
    const a = getSeries({ source: 'ema', output: 'value', params: { length: 20 } }, '15m', candles);
    const b = getSeries({ source: 'ema', output: 'value', params: { length: 20 } }, '15m', candles);
    expect(b).toBe(a);
    const other = getSeries({ source: 'ema', output: 'value', params: { length: 50 } }, '15m', candles);
    expect(other).not.toBe(a);
  });
});

describe('evaluate() funnel (S1: single-group, single-TF)', () => {
  // Down for 60 bars then up for 60 → EMA20 crosses above EMA50 on the way up.
  const candles = [...ramp(60, -0.5, 200), ...ramp(60, 1.2, 170).map((c, i) => ({ ...c, time: 1_600_000_000 + (60 + i) * 900 }))];
  const cross: Condition = {
    left: { source: 'ema', output: 'value', params: { length: 20 } },
    op: 'crossAbove',
    right: { source: 'ema', output: 'value', params: { length: 50 } },
    tf: '15m',
  };
  it('fires the EMA cross exactly once on the reversal', () => {
    const res = evaluateCondition(cross, candles);
    const fires = res.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    expect(fires.length).toBe(1);
    expect(fires[0]).toBeGreaterThan(60);
  });
  it('AND group with RSI filter matches on the cross bar', () => {
    const tree = {
      logic: 'AND' as const,
      children: [cross, { left: { source: 'rsi', output: 'rsi' }, op: 'gt' as const, right: 50, tf: '15m' as const }],
    };
    const res = evaluate(tree, { '15m': candles });
    const fires = res.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    expect(fires.length).toBe(1);
  });
  it('snapshot explains the condition (Why?)', () => {
    const res = evaluateCondition(cross, candles);
    const at = res.findIndex((v) => v === true);
    const snap = snapshotCondition(cross, candles, at);
    expect(snap.pass).toBe(true);
    expect(snap.label).toContain('EMA');
    expect(snap.expect).toContain('crosses above');
  });
});
