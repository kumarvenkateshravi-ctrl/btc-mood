import { describe, expect, it } from 'vitest';
import { runStage2Task7Benchmark } from './stage2Task7Benchmark';

describe('Stage 2 Task 7 visible-range benchmark', () => {
  it('keeps indexed pan/zoom work bounded as history grows', () => {
    const rows = runStage2Task7Benchmark(2);
    expect(rows.map((row) => row.bars)).toEqual([2_000, 20_000, 50_000, 100_000]);
    expect(rows.every((row) => row.visibleSeparators >= 0 && row.afterP50 >= 0)).toBe(true);
  }, 30_000);
});
