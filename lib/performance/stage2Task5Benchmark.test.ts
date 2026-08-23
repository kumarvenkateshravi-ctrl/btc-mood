import { describe, expect, it } from 'vitest';
import { runStage2Task5Benchmark } from './stage2Task5Benchmark';

describe('Stage 2 Task 5 transform benchmark', () => {
  it('uses deterministic 2k, 20k, and 50k fixtures and measures only safe incremental modes', () => {
    const rows = runStage2Task5Benchmark(2);
    expect(rows).toHaveLength(36);
    expect(rows.some((row) => row.mode === 'heikin-ashi' && row.path === 'incremental')).toBe(true);
    expect(rows.some((row) => row.mode === 'renko-traditional' && row.path === 'incremental')).toBe(true);
    expect(rows.some((row) => row.mode === 'renko-atr' && row.path === 'incremental')).toBe(false);
    expect(rows.some((row) => row.mode === 'renko-percentage' && row.path === 'incremental')).toBe(false);
    expect(rows.every((row) => Number.isFinite(row.p50) && row.p50 >= 0)).toBe(true);
  }, 30_000);
});
