import { describe, it, expect, beforeEach } from 'vitest';
import { OPERATORS } from './operators';
import { SCANNER_SOURCES, SCANNER_SOURCE_LIST, publishScannerLiveScores } from './registry';
import { getSeries, __clearSeriesCacheForTest } from './seriesCache';
import { evaluateCondition, evaluate, snapshotCondition, mapTfIndices, explainAt } from './evaluate';
import { validateTree, validateStrategy, DEFAULT_LIMITS } from './validate';
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

describe('S2: cross-TF mapping', () => {
  // 15m eval bars across two hours; 1h target bars. Candle time = OPEN time.
  const t0 = 1_600_000_000 - (1_600_000_000 % 3600); // hour-aligned
  const m15 = Array.from({ length: 8 }, (_, i) => bar(0, 100)).map((c, i) => ({ ...c, time: t0 + i * 900 }));
  const h1 = [{ ...bar(0, 100), time: t0 }, { ...bar(0, 101), time: t0 + 3600 }];
  it('an eval bar sees a higher-TF bar only once that bar has CLOSED', () => {
    const map = mapTfIndices(m15 as Candle[], '15m', h1 as Candle[], '1h');
    // Hour 0's 15m bars :00/:15/:30 close before hour 0 closes → no 1h bar yet.
    expect(map[0]).toBe(-1);
    expect(map[2]).toBe(-1);
    // The :45 bar closes exactly when hour 0 closes → hour 0 becomes visible.
    expect(map[3]).toBe(0);
    // Hour 1's :00/:15/:30 still see hour 0; its :45 sees hour 1.
    expect(map[4]).toBe(0);
    expect(map[6]).toBe(0);
    expect(map[7]).toBe(1);
  });
});

describe('S2: nested tree + Kleene logic', () => {
  const up = ramp(120, 1);
  const cTrue: Condition = { left: { source: 'price', output: 'close' }, op: 'gt', right: 0, tf: '15m' };
  const cFalse: Condition = { left: { source: 'price', output: 'close' }, op: 'lt', right: 0, tf: '15m' };
  const cNull: Condition = { left: { source: 'ema', output: 'value', params: { length: 200 } }, op: 'gt', right: 0, tf: '15m' }; // warm-up > data

  it('(false-group) OR (true-group) fires; nested depth works', () => {
    const tree = {
      logic: 'OR' as const,
      children: [
        { logic: 'AND' as const, children: [cTrue, cFalse] },
        { logic: 'AND' as const, children: [cTrue, { logic: 'OR' as const, children: [cTrue] }] },
      ],
    };
    const res = evaluate(tree, { '15m': up }, '15m');
    expect(res[100]).toBe(true);
  });
  it('Kleene: OR(true, null) → true; AND(false, null) → false; AND(true, null) → null', () => {
    expect(evaluate({ logic: 'OR', children: [cTrue, cNull] }, { '15m': up }, '15m')[100]).toBe(true);
    expect(evaluate({ logic: 'AND', children: [cFalse, cNull] }, { '15m': up }, '15m')[100]).toBe(false);
    expect(evaluate({ logic: 'AND', children: [cTrue, cNull] }, { '15m': up }, '15m')[100]).toBeNull();
  });
  it('a higher-TF condition gates the eval TF (cross-TF evaluation)', () => {
    // 1h RSI > 0 is true once warm; before the first 1h bar closes it's null.
    const t0 = 1_600_000_000 - (1_600_000_000 % 86400);
    const m15 = Array.from({ length: 400 }, (_, i) => ({ ...bar(0, 100 + i * 0.5), time: t0 + i * 900 }));
    const h1 = Array.from({ length: 100 }, (_, i) => ({ ...bar(0, 100 + i * 2), time: t0 + i * 3600 }));
    const tree = {
      logic: 'AND' as const,
      children: [
        { left: { source: 'price', output: 'close' }, op: 'gt' as const, right: 0, tf: '15m' as const },
        { left: { source: 'rsi', output: 'rsi' }, op: 'gt' as const, right: 50, tf: '1h' as const },
      ],
    };
    const res = evaluate(tree, { '15m': m15 as Candle[], '1h': h1 as Candle[] }, '15m');
    expect(res[3]).toBeNull();        // 1h RSI not warm yet → unknown, no trigger
    expect(res[350]).toBe(true);      // both true late in the uptrend
    const why = explainAt(tree, { '15m': m15 as Candle[], '1h': h1 as Candle[] }, '15m', 350);
    expect(why).toHaveLength(2);
    expect(why[1].label).toContain('1h');
    expect(why[1].pass).toBe(true);
  });
});

describe('S3: Validation Engine', () => {

  const ok: Condition = { left: { source: 'rsi', output: 'rsi' }, op: 'gt', right: 60, tf: '15m' };
  const g = (children: (Condition | { logic: 'AND' | 'OR'; children: never[] })[]) =>
    ({ logic: 'AND' as const, children }) as never;

  it('valid tree passes with a complexity report', () => {
    const r = validateTree({ logic: 'AND', children: [ok] });
    expect(r.ok).toBe(true);
    expect(r.complexity).toMatchObject({ depth: 1, conditions: 1, groups: 1, cost: 'low' });
    expect(r.complexity.sources).toContain('rsi');
  });
  it('catches unknown source/output/operator and unsupported values', () => {
    const bad = validateTree({ logic: 'AND', children: [
      { left: { source: 'nope', output: 'x' }, op: 'gt', right: 1, tf: '15m' },
      { left: { source: 'rsi', output: 'wrong' }, op: 'gt', right: 1, tf: '15m' },
      { left: { source: 'rsi', output: 'rsi' }, op: 'gt', right: 300, tf: '15m' },   // RSI > 300
      { left: { source: 'rsi', output: 'rsi' }, op: 'between', right: 5, tf: '15m' }, // wrong operand kind
    ] });
    const codes = bad.errors.map((e) => e.code);
    expect(codes).toContain('unknown-source');
    expect(codes).toContain('unknown-output');
    expect(codes).toContain('value-out-of-range');
    expect(codes).toContain('operand-mismatch');
    expect(bad.ok).toBe(false);
  });
  it('rejects empty groups and enforces complexity limits', () => {
    expect(validateTree({ logic: 'AND', children: [] }).errors[0].code).toBe('empty-group');
    const deep = (d: number): never => (d === 0 ? g([ok]) : ({ logic: 'AND', children: [deep(d - 1)] } as never));
    const r = validateTree(deep(10) as never, { ...DEFAULT_LIMITS, maxDepth: 4 });
    expect(r.errors.some((e) => e.code === 'max-depth')).toBe(true);
    const many = validateTree(
      { logic: 'AND', children: Array.from({ length: 5 }, () => ok) },
      { ...DEFAULT_LIMITS, maxConditions: 3 },
    );
    expect(many.errors.some((e) => e.code === 'max-conditions')).toBe(true);
  });
  it('liveOnly sources warn about missing backtest coverage', () => {
    const r = validateTree({ logic: 'AND', children: [
      { left: { source: 'stackScore', output: 'score' }, op: 'gt', right: 85, tf: '15m' },
    ] });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === 'live-only')).toBe(true);
  });
  it('cost estimation buckets by unique-series weights (cache-aware)', () => {
    // vdZone (6) + intelligence (5) → 11 units → medium; duplicate refs count once.
    const r = validateTree({ logic: 'AND', children: [
      { left: { source: 'vdZone', output: 'confidence' }, op: 'gt', right: 60, tf: '15m' },
      { left: { source: 'vdZone', output: 'confidence' }, op: 'lt', right: 100, tf: '15m' },
      { left: { source: 'contextScore', output: 'score' }, op: 'gt', right: 60, tf: '15m' },
    ] });
    expect(r.complexity.uniqueSeries).toBe(2);
    expect(r.complexity.costUnits).toBeCloseTo(11, 6);
    expect(r.complexity.cost).toBe('medium');
  });
  it('strategy-level: name, direction, exits ordering', () => {
    const s = {
      id: 's1', name: '  ', direction: 'long' as const, schemaVersion: 1 as const,
      versions: [{ v: 1, createdAt: 0, note: '', tree: { logic: 'AND' as const, children: [ok] } }],
      activeVersion: 1, enabled: false, archived: false,
      exits: { slAtr: 1, tp1R: 2, tp2R: 1.5, tp3R: 3 },
      ownerId: null, visibility: 'private' as const, createdAt: 0, updatedAt: 0,
      parentStrategy: null, forkCount: 0, likes: 0,
    };
    const r = validateStrategy(s);
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain('empty-name');
    expect(codes).toContain('bad-tps'); // tp2R < tp1R
  });
});

describe('S2: prefix invariance (non-repaint lock)', () => {
  it('truncating history never changes past evaluations', () => {
    const t0 = 1_600_000_000 - (1_600_000_000 % 86400);
    const m15 = Array.from({ length: 300 }, (_, i) => ({ ...bar(0, 100 + Math.sin(i / 9) * 10 + i * 0.2), time: t0 + i * 900 }));
    const h1 = Array.from({ length: 75 }, (_, i) => ({ ...bar(0, 100 + Math.sin(i / 5) * 8 + i * 0.8), time: t0 + i * 3600 }));
    const tree = {
      logic: 'AND' as const,
      children: [
        { left: { source: 'ema', output: 'value', params: { length: 20 } }, op: 'crossAbove' as const, right: { source: 'ema', output: 'value', params: { length: 50 } }, tf: '15m' as const },
        { left: { source: 'rsi', output: 'rsi' }, op: 'gt' as const, right: 40, tf: '1h' as const },
      ],
    };
    const full = evaluate(tree, { '15m': m15 as Candle[], '1h': h1 as Candle[] }, '15m');
    // Cut at a time boundary: keep 15m bars < T and 1h bars < T.
    const T = t0 + 200 * 900;
    const m15cut = (m15 as Candle[]).filter((c) => c.time < T);
    const h1cut = (h1 as Candle[]).filter((c) => c.time < T);
    const cut = evaluate(tree, { '15m': m15cut, '1h': h1cut }, '15m');
    for (let i = 0; i < cut.length; i++) {
      expect(cut[i], `bar ${i}`).toBe(full[i]);
    }
  });
});
