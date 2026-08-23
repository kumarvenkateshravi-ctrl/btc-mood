import { describe, expect, it } from 'vitest';
import {
  BASELINE_DATASET_SIZES,
  BASELINE_SCENARIOS,
  createBaselineCandles,
  percentile,
  runStage2Baseline,
  summarizeDurations,
} from './stage2Baseline';
import {
  createPerformanceRecorder,
  isPerformanceInstrumentationEnabled,
  measurePerformance,
} from './stage2Instrumentation';

describe('Stage 2 performance baseline contracts', () => {
  it('uses deterministic candles for every required dataset scale', () => {
    for (const size of Object.values(BASELINE_DATASET_SIZES)) {
      const first = createBaselineCandles(size, 0x5eed);
      const second = createBaselineCandles(size, 0x5eed);
      expect(first).toEqual(second);
      expect(first).toHaveLength(size);
      expect(first[0].time).toBeLessThan(first[first.length - 1].time);
    }
  });

  it('calculates p50/p95/p99 with deterministic percentile rules', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(percentile([], 0.99)).toBe(0);
    expect(summarizeDurations([4, 1, 3, 2])).toEqual({
      p50: 2.5,
      p95: 4,
      p99: 4,
      min: 1,
      max: 4,
    });
  });

  it('covers every approved Stage 2 baseline scenario', () => {
    const report = runStage2Baseline({
      samples: 1,
      scales: ['small'],
      stacks: ['light'],
    });
    expect(new Set(report.rows.map((row) => row.scenario))).toEqual(new Set(BASELINE_SCENARIOS));
    expect(report.rows.every((row) => row.scale === 'small' && row.stack === 'light')).toBe(true);
  });

  it('runs both stacks across small, medium, and deep-history fixtures', () => {
    const report = runStage2Baseline({ samples: 1 });
    expect(new Set(report.rows.map((row) => row.stack))).toEqual(new Set(['light', 'heavy']));
    expect(new Set(report.rows.map((row) => row.scale))).toEqual(new Set(['small', 'medium', 'deep']));
    expect(report.rows.every((row) => row.samples.length === 1)).toBe(true);
  }, 30_000);

  it('records development measurements without changing the measured result', () => {
    const recorder = createPerformanceRecorder();
    const result = measurePerformance('test.measure', () => 42, recorder);
    expect(result).toBe(42);
    expect(recorder.samples('test.measure')).toHaveLength(1);
    expect(recorder.samples('test.measure')[0]).toBeGreaterThanOrEqual(0);
  });

  it('is disabled in production builds', () => {
    // The test runner is not production, but the public guard must remain explicit
    // so the same code path is a no-op in a production bundle.
    expect(isPerformanceInstrumentationEnabled('production')).toBe(false);
    expect(isPerformanceInstrumentationEnabled('development')).toBe(true);
  });
});
