import { describe, expect, it } from 'vitest';
import { runStage2Task6Benchmark } from './stage2Task6Benchmark';

describe('Stage 2 Task 6 chart-series benchmark', () => {
  it('uses shared 2k/20k/50k fixtures and records tail versus full writes', () => {
    const rows = runStage2Task6Benchmark(1);
    expect(rows).toHaveLength(24);
    expect(rows.filter((row) => row.path === 'before-full').every((row) => row.fullWrites > 0)).toBe(true);
    expect(rows.filter((row) => row.path === 'after-tail').some((row) => row.tailWrites > 0)).toBe(true);
  }, 30_000);
});
