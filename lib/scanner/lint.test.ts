import { describe, it, expect } from 'vitest';
import { lintStrategy, estimateCadencePerWeek, styleCadencePerWeek, DEFAULT_RISK, resolveRisk } from './lint';
import type { Condition, GroupNode } from './types';
import type { Candle } from '@/lib/types';

const cond = (source: string, op: Condition['op'], right: number, tf: Condition['tf'] = '15m', output = 'value'): Condition =>
  ({ left: { source, output, params: { length: 14 } }, op, right, tf });

const tree = (...children: Array<GroupNode | Condition>): GroupNode => ({ logic: 'AND', children });

describe('lintStrategy', () => {
  it('clean multi-TF strategy with volume grades high', () => {
    const r = lintStrategy({
      tree: tree(cond('ema', 'gt', 50, '15m'), cond('volume', 'gt', 1, '15m'), cond('ema', 'gt', 200, '1d')),
      style: 'intraday',
    });
    expect(r.findings.filter((f) => f.severity === 'warn')).toEqual([]);
    expect(r.grade).toBeGreaterThanOrEqual(88);
  });

  it('flags exact duplicates', () => {
    const r = lintStrategy({ tree: tree(cond('rsi', 'gt', 55), cond('rsi', 'gt', 55)) });
    expect(r.findings.some((f) => f.id === 'duplicate')).toBe(true);
  });

  it('flags contradictions within an AND scope', () => {
    const r = lintStrategy({ tree: tree(cond('rsi', 'gt', 60), cond('rsi', 'lt', 40)) });
    expect(r.findings.some((f) => f.id === 'conflict' && f.severity === 'warn')).toBe(true);
    expect(r.grade).toBeLessThan(100);
  });

  it('does NOT flag the same bounds in an OR scope', () => {
    const or: GroupNode = { logic: 'OR', children: [cond('rsi', 'gt', 60), cond('rsi', 'lt', 40)] };
    const r = lintStrategy({ tree: { logic: 'AND', children: [or] } });
    expect(r.findings.some((f) => f.id === 'conflict')).toBe(false);
  });

  it('nudges toward volume + higher-TF gates', () => {
    const r = lintStrategy({ tree: tree(cond('rsi', 'gt', 55), cond('ema', 'gt', 0)) });
    expect(r.findings.some((f) => f.id === 'no-volume')).toBe(true);
    expect(r.findings.some((f) => f.id === 'no-higher-tf')).toBe(true);
  });

  it('flags style/timeframe mismatches both ways', () => {
    const scalperDaily = lintStrategy({ tree: tree(cond('ema', 'gt', 0, '1d')), style: 'scalper' });
    expect(scalperDaily.findings.some((f) => f.id === 'style-tf')).toBe(true);
    const swing5m = lintStrategy({ tree: tree(cond('ema', 'gt', 0, '5m')), style: 'swing' });
    expect(swing5m.findings.some((f) => f.id === 'style-tf')).toBe(true);
  });

  it('warns on rare triggers vs the style cadence', () => {
    const r = lintStrategy({
      tree: tree(cond('rsi', 'gt', 55)),
      style: 'scalper', // expects 105-210/week
      cadencePerWeek: 2,
    });
    expect(r.findings.some((f) => f.id === 'rare-trigger' && f.severity === 'warn')).toBe(true);
  });

  it('flags live-only sources as info', () => {
    const r = lintStrategy({ tree: tree({ left: { source: 'smc_state', output: 'institutional', params: {} }, op: 'gte', right: 75, tf: '15m' }) });
    expect(r.findings.some((f) => f.id === 'live-only' && f.severity === 'info')).toBe(true);
  });
});

describe('cadence', () => {
  const candles = (n: number): Candle[] =>
    Array.from({ length: n }, (_, i) => ({ time: i * 900, open: 1, high: 1, low: 1, close: 1, volume: 1 }));

  it('counts rising edges per week', () => {
    const n = 4 * 24 * 7; // one week of 15m bars
    const matches = new Array(n).fill(false);
    matches[100] = matches[101] = true; // one signal (edge), two bars long
    matches[500] = true; // second signal
    expect(estimateCadencePerWeek(matches, candles(n))).toBeCloseTo(2, 0);
  });

  it('returns null on tiny history', () => {
    expect(estimateCadencePerWeek([true, false], candles(2))).toBeNull();
  });

  it('normalizes style cadence to per-week', () => {
    expect(styleCadencePerWeek('scalper')).toEqual({ min: 105, max: 210 });
    expect(styleCadencePerWeek('swing')).toEqual({ min: 2, max: 6 });
    expect(styleCadencePerWeek('custom')).toBeNull();
  });
});

describe('risk defaults', () => {
  it('resolveRisk merges partials over defaults', () => {
    expect(resolveRisk(null)).toEqual(DEFAULT_RISK);
    expect(resolveRisk({ breakEven: true }).maxTradesPerDay).toBe(4);
  });
});
