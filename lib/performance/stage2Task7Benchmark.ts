import { buildDaySeparatorIndex, selectVisibleDaySeparators } from '../daySeparatorIndex';
import type { Candle } from '../types';
import { createBaselineCandles } from './stage2Fixtures';

export interface Task7BenchmarkRow {
  bars: number;
  beforeP50: number;
  afterP50: number;
  visibleSeparators: number;
}

function oldPanScan(source: readonly Candle[], from: number, to: number): number {
  let count = 0;
  const seen = new Set<number>();
  for (let index = 1; index < source.length; index++) {
    const current = source[index];
    const previous = source[index - 1];
    const day = Math.floor(current.time / 86_400);
    const previousDay = Math.floor(previous.time / 86_400);
    if (day !== previousDay && !seen.has(day) && index >= from && index <= to) {
      seen.add(day);
      count++;
    }
  }
  return count;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function runStage2Task7Benchmark(samples = 20): Task7BenchmarkRow[] {
  const rows: Task7BenchmarkRow[] = [];
  for (const bars of [2_000, 20_000, 50_000, 100_000]) {
    const source = createBaselineCandles(bars);
    const boundaries = buildDaySeparatorIndex(source);
    const from = Math.max(0, bars - 150);
    const to = bars + 10;
    const before: number[] = [];
    const after: number[] = [];
    let beforeCount = 0;
    let afterCount = 0;
    for (let sample = 0; sample < samples; sample++) {
      const beforeStart = performance.now();
      beforeCount = oldPanScan(source, from, to);
      before.push(performance.now() - beforeStart);
      const afterStart = performance.now();
      afterCount = selectVisibleDaySeparators(boundaries, { from, to }).length;
      after.push(performance.now() - afterStart);
    }
    if (beforeCount !== afterCount) throw new Error(`separator mismatch at ${bars}: ${beforeCount} !== ${afterCount}`);
    rows.push({ bars, beforeP50: median(before), afterP50: median(after), visibleSeparators: afterCount });
  }
  return rows;
}
