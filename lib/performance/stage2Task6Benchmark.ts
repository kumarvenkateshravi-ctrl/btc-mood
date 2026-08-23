import type { Candle } from '../types';
import { computeMacd } from '../indicators/macd';
import { computeRegressionGChannel } from '../indicators/regressionGChannel';
import { computeRsi } from '../indicators/rsi';
import { computeSma } from '../indicators/sma';
import type { CustomIndicatorConfig } from '../indicatorFramework';
import { writeIndicatorSeries, type IndicatorSeriesSnapshot } from '../../components/chart/indicatorSeriesWrites';
import { createPerformanceRecorder, measurePerformance } from './stage2Instrumentation';
import { summarizeDurations, type BaselineSummary } from './stage2Baseline';
import { BASELINE_DATASET_SIZES, createBaselineCandles, type BaselineScale, type BaselineStack } from './stage2Fixtures';

const SMA = { id: 'sma', settings: { inputs: { length: 20, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const RSI = { id: 'rsi', settings: { inputs: { length: 14, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const MACD = { id: 'macd', settings: { inputs: { fast: 12, slow: 26, signal: 9, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const REGRESSION = { id: 'regression-g-channel', settings: { inputs: { length: 200, gcLength: 100 }, styles: {}, visibility: {} } } as CustomIndicatorConfig;

export interface Task6BenchmarkRow extends BaselineSummary {
  scale: BaselineScale;
  stack: BaselineStack;
  operation: 'forming-update' | 'closed-bar-append';
  path: 'before-full' | 'after-tail';
  fullWrites: number;
  tailWrites: number;
}

type Point = { time: number; value: number; color?: string };
type FakeSeries = { setData(data: Point[]): void; update(data: Point): void; fullWrites: number; tailWrites: number };

function createSeries(): FakeSeries {
  return {
    fullWrites: 0,
    tailWrites: 0,
    setData(data) { this.fullWrites += data.length; },
    update() { this.tailWrites++; },
  };
}

function results(candles: Candle[], stack: BaselineStack) {
  const out = [computeSma(candles, SMA), computeRsi(candles, RSI)];
  if (stack === 'heavy') out.push(computeMacd(candles, MACD), computeRegressionGChannel(candles, REGRESSION));
  return out.flatMap((result) => result.plots.filter((plot) => plot.type === 'line' || plot.type === 'histogram'));
}

function format(value: unknown, index: number, candles: Candle[]): Point | null {
  if (value == null || !candles[index]) return null;
  const numeric = typeof value === 'object' && 'value' in value ? (value as { value: number }).value : value as number;
  if (!Number.isFinite(numeric)) return null;
  return { time: candles[index].time, value: numeric };
}

function initialSnapshots(candles: Candle[], stack: BaselineStack): { series: FakeSeries[]; snapshots: IndicatorSeriesSnapshot[] } {
  const series: FakeSeries[] = [];
  const snapshots: IndicatorSeriesSnapshot[] = [];
  for (const plot of results(candles, stack)) {
    const target = createSeries();
    series.push(target);
    snapshots.push(writeIndicatorSeries<Point>({ series: target, raw: plot.data, candles, structural: true, timeOf: (point) => point.time, format: (value, index) => format(value, index, candles) }).snapshot);
    target.fullWrites = 0;
    target.tailWrites = 0;
  }
  return { series, snapshots };
}

function nextCandles(candles: Candle[], operation: 'forming-update' | 'closed-bar-append'): Candle[] {
  const last = candles[candles.length - 1];
  if (operation === 'forming-update') return [...candles.slice(0, -1), { ...last, close: last.close + 1, high: last.high + 1 }];
  return [...candles, { ...last, time: last.time + 300, open: last.close, high: last.close + 2, low: last.close - 1, close: last.close + 1 }];
}

function fullWrite(plots: ReturnType<typeof results>, candles: Candle[]): FakeSeries[] {
  const targets: FakeSeries[] = [];
  for (const plot of plots) {
    const target = createSeries();
    const points: Point[] = [];
    for (let index = 0; index < plot.data.length; index++) {
      const point = format(plot.data[index], index, candles);
      if (point != null) points.push(point);
    }
    target.setData(points);
    targets.push(target);
  }
  return targets;
}

function tailWrite(prepared: ReturnType<typeof initialSnapshots>, plots: ReturnType<typeof results>, next: Candle[]): FakeSeries[] {
  const { series, snapshots } = prepared;
  plots.forEach((plot, index) => {
    writeIndicatorSeries<Point>({
      series: series[index], raw: plot.data, candles: next, structural: false,
      timeOf: (point) => point.time, format: (value, pointIndex) => format(value, pointIndex, next),
    }, snapshots[index]);
  });
  return series;
}

export function runStage2Task6Benchmark(samples = 12): Task6BenchmarkRow[] {
  const rows: Task6BenchmarkRow[] = [];
  for (const scale of Object.keys(BASELINE_DATASET_SIZES) as BaselineScale[]) {
    const initial = createBaselineCandles(BASELINE_DATASET_SIZES[scale]);
    for (const stack of ['light', 'heavy'] as BaselineStack[]) {
      for (const operation of ['forming-update', 'closed-bar-append'] as const) {
        const next = nextCandles(initial, operation);
        const nextPlots = results(next, stack);
        for (const path of ['before-full', 'after-tail'] as const) {
          const recorder = createPerformanceRecorder();
          let latest: FakeSeries[] = [];
          for (let sample = 0; sample < samples; sample++) {
            const prepared = path === 'after-tail' ? initialSnapshots(initial, stack) : null;
            measurePerformance(`task6.${scale}.${stack}.${operation}.${path}`, () => {
              latest = path === 'before-full' ? fullWrite(nextPlots, next) : tailWrite(prepared!, nextPlots, next);
            }, recorder);
          }
          const durations = recorder.samples(`task6.${scale}.${stack}.${operation}.${path}`);
          rows.push({
            scale, stack, operation, path,
            fullWrites: latest.reduce((sum, target) => sum + target.fullWrites, 0),
            tailWrites: latest.reduce((sum, target) => sum + target.tailWrites, 0),
            ...summarizeDurations(durations),
          });
        }
      }
    }
  }
  return rows;
}
