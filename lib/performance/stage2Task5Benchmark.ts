import { toHeikinAshi } from '../heikinAshi';
import { IncrementalHeikinAshi, IncrementalRenko } from '../incrementalCandleTransforms';
import { toRenko, type RenkoOptions } from '../renko';
import type { Candle } from '../types';
import { createPerformanceRecorder, measurePerformance } from './stage2Instrumentation';
import { createBaselineCandles, type BaselineScale } from './stage2Fixtures';
import { summarizeDurations, type BaselineSummary } from './stage2Baseline';

export type TransformBenchmarkMode = 'heikin-ashi' | 'renko-traditional' | 'renko-atr' | 'renko-percentage';
export type TransformBenchmarkOperation = 'forming-update' | 'closed-bar-append';

export interface TransformBenchmarkRow extends BaselineSummary {
  mode: TransformBenchmarkMode;
  operation: TransformBenchmarkOperation;
  scale: BaselineScale;
  path: 'full' | 'incremental';
}

const sizes: Record<BaselineScale, number> = { small: 2_048, medium: 20_000, deep: 50_000 };
const traditional: RenkoOptions = { method: 'traditional', brickSize: 100 };
const atr: RenkoOptions = { method: 'atr', atrLength: 14 };
const percentage: RenkoOptions = { method: 'percentage', percentage: 0.5 };

function forming(candles: Candle[], sample: number): Candle[] {
  const last = candles[candles.length - 1];
  const close = last.close + (sample % 2 === 0 ? 1 : -1);
  return [...candles.slice(0, -1), { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close) }];
}

function appended(candles: Candle[], sample: number): Candle[] {
  const last = candles[candles.length - 1];
  const close = last.close + (sample % 2 === 0 ? 1 : -1);
  return [...candles, {
    ...last,
    time: last.time + 300,
    open: last.close,
    high: Math.max(last.close, close) + 1,
    low: Math.min(last.close, close) - 1,
    close,
  }];
}

function fullRun(mode: TransformBenchmarkMode, candles: Candle[]): void {
  if (mode === 'heikin-ashi') return void toHeikinAshi(candles);
  if (mode === 'renko-traditional') return void toRenko(candles, traditional);
  if (mode === 'renko-atr') return void toRenko(candles, atr);
  return void toRenko(candles, percentage);
}

function createIncrementalTransform(mode: 'heikin-ashi' | 'renko-traditional', candles: Candle[]): IncrementalHeikinAshi | IncrementalRenko {
  if (mode === 'heikin-ashi') {
    const transform = new IncrementalHeikinAshi();
    transform.update(candles);
    return transform;
  }
  const transform = new IncrementalRenko();
  transform.update(candles, traditional);
  return transform;
}

function updateIncrementalTransform(transform: IncrementalHeikinAshi | IncrementalRenko, mode: 'heikin-ashi' | 'renko-traditional', candles: Candle[]): void {
  if (mode === 'heikin-ashi') transform.update(candles);
  else transform.update(candles, traditional);
}

export function runStage2Task5Benchmark(samples = 15): TransformBenchmarkRow[] {
  const rows: TransformBenchmarkRow[] = [];
  const modes: TransformBenchmarkMode[] = ['heikin-ashi', 'renko-traditional', 'renko-atr', 'renko-percentage'];
  const operations: TransformBenchmarkOperation[] = ['forming-update', 'closed-bar-append'];
  for (const scale of Object.keys(sizes) as BaselineScale[]) {
    const initial = createBaselineCandles(sizes[scale]);
    for (const operation of operations) {
      for (const mode of modes) {
        for (const path of (mode === 'heikin-ashi' || mode === 'renko-traditional' ? ['full', 'incremental'] : ['full']) as Array<'full' | 'incremental'>) {
          const recorder = createPerformanceRecorder();
          for (let sample = 0; sample < samples; sample++) {
            const next = operation === 'forming-update' ? forming(initial, sample) : appended(initial, sample);
            const transform = path === 'incremental'
              ? createIncrementalTransform(mode as 'heikin-ashi' | 'renko-traditional', initial)
              : null;
            measurePerformance(`task5.${mode}.${operation}.${path}`, () => {
              if (path === 'full') fullRun(mode, next);
              else updateIncrementalTransform(transform!, mode as 'heikin-ashi' | 'renko-traditional', next);
            }, recorder);
          }
          const durations = recorder.samples(`task5.${mode}.${operation}.${path}`);
          rows.push({ mode, operation, scale, path, ...summarizeDurations(durations) });
        }
      }
    }
  }
  return rows;
}
