// Tests for the golden-master comparator itself. These prove the harness
// logic (tolerance, null/band handling, signal comparison, sparse coverage)
// so that an indicator golden test failing means the *indicator* is wrong, not
// the harness.

import { describe, it, expect } from 'vitest';
import {
  compareIndicator,
  withinTolerance,
  buildSnapshotFixture,
  formatGoldenReport,
  DEFAULT_TOLERANCE,
  type GoldenFixture,
} from './goldenMaster';
import type { Candle } from '../types';
import type { IndicatorResult } from '../indicatorFramework';

function fixtureFrom(
  expected: GoldenFixture['expected'],
  params: Record<string, unknown> = {},
): GoldenFixture {
  return {
    indicator: 'test',
    source: 'snapshot',
    capturedAt: '2026-01-01',
    params,
    tolerance: DEFAULT_TOLERANCE,
    candles: [],
    expected,
  };
}

const result: IndicatorResult = {
  plots: [
    {
      id: 'line',
      title: 'Line',
      color: '#fff',
      type: 'line',
      data: [null, 1.0, 2.0, { value: 3.0, color: '#0f0' }],
    },
    {
      id: 'bb',
      title: 'BB',
      color: '#fff',
      type: 'band',
      data: [null, { upper: 11, lower: 9 }, { upper: 12, lower: 8 }, null],
    },
  ],
  signals: ['neutral', 'buy', 'neutral', 'sell'],
};

describe('withinTolerance', () => {
  it('passes inside absolute tolerance', () => {
    expect(withinTolerance(1.0, 1.0 + 1e-7, { abs: 1e-6, rel: 0 })).toBe(true);
  });
  it('fails outside absolute and relative tolerance', () => {
    expect(withinTolerance(1.0, 1.5, { abs: 1e-6, rel: 1e-4 })).toBe(false);
  });
  it('passes inside relative tolerance for large numbers', () => {
    expect(withinTolerance(100000, 100001, { abs: 0, rel: 1e-4 })).toBe(true);
  });
});

describe('compareIndicator', () => {
  it('passes when values, bands, nulls and signals all match', () => {
    const fx = fixtureFrom({
      plots: {
        line: { '0': null, '1': 1.0, '2': 2.0, '3': 3.0 },
        bb: { '1': { upper: 11, lower: 9 }, '3': null },
      },
      signals: { '1': 'buy', '3': 'sell' },
    });
    const report = compareIndicator(result, fx);
    expect(report.ok, formatGoldenReport(report)).toBe(true);
    expect(report.checked).toBe(8);
  });

  it('reads the numeric value out of a {value,color} cell', () => {
    const fx = fixtureFrom({ plots: { line: { '3': 3.0 } } });
    expect(compareIndicator(result, fx).ok).toBe(true);
  });

  it('flags a value out of tolerance with a delta', () => {
    const fx = fixtureFrom({ plots: { line: { '2': 2.5 } } });
    const report = compareIndicator(result, fx);
    expect(report.ok).toBe(false);
    expect(report.mismatches[0].kind).toBe('plot-value');
    expect(report.mismatches[0].delta).toBeCloseTo(0.5, 6);
  });

  it('flags a missing plot', () => {
    const fx = fixtureFrom({ plots: { nope: { '1': 1 } } });
    const report = compareIndicator(result, fx);
    expect(report.mismatches[0].kind).toBe('missing-plot');
  });

  it('flags expected-null when a value is present', () => {
    const fx = fixtureFrom({ plots: { line: { '1': null } } });
    expect(compareIndicator(result, fx).ok).toBe(false);
  });

  it('flags a shape mismatch (number expected, band found)', () => {
    const fx = fixtureFrom({ plots: { bb: { '1': 11 } } });
    const report = compareIndicator(result, fx);
    expect(report.mismatches[0].kind).toBe('plot-shape');
  });

  it('flags a signal mismatch', () => {
    const fx = fixtureFrom({ plots: {}, signals: { '1': 'sell' } });
    const report = compareIndicator(result, fx);
    expect(report.mismatches[0].kind).toBe('signal');
  });

  it('only checks bars listed in the fixture (sparse coverage)', () => {
    const fx = fixtureFrom({ plots: { line: { '3': 3.0 } } });
    expect(compareIndicator(result, fx).checked).toBe(1);
  });
});

describe('buildSnapshotFixture', () => {
  const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
    time: i * 60,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));

  it('captures trailing plot bars and non-neutral signals, and round-trips', () => {
    const fx = buildSnapshotFixture({
      indicator: 'test',
      params: { length: 3 },
      candles,
      result: {
        plots: [{ id: 'line', title: 'L', color: '#fff', type: 'line', data: [null, null, 1, 2, 3] }],
        signals: ['neutral', 'buy', 'neutral', 'neutral', 'sell'],
      },
      lastN: 3,
    });

    expect(fx.source).toBe('snapshot');
    expect(Object.keys(fx.expected.plots.line)).toEqual(['2', '3', '4']);
    expect(fx.expected.signals).toEqual({ '1': 'buy', '4': 'sell' });

    // A snapshot must validate against the implementation it was built from.
    const report = compareIndicator(
      {
        plots: [{ id: 'line', title: 'L', color: '#fff', type: 'line', data: [null, null, 1, 2, 3] }],
        signals: ['neutral', 'buy', 'neutral', 'neutral', 'sell'],
      },
      fx,
    );
    expect(report.ok, formatGoldenReport(report)).toBe(true);
  });
});
