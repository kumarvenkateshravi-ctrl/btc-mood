import type { Candle } from '../types';
import type { CustomIndicatorConfig } from '../indicatorFramework';
import { computeMacd } from '../indicators/macd';
import { computeRegressionGChannel } from '../indicators/regressionGChannel';
import { computeRsi } from '../indicators/rsi';
import { computeSessionVolumeProfile } from '../indicators/sessionVolumeProfile';
import { computeSma } from '../indicators/sma';
import { toHeikinAshi } from '../heikinAshi';
import { toRenko } from '../renko';
import { reconcileBar } from '../paperStore';
import { createPerformanceRecorder, measurePerformance } from './stage2Instrumentation';
import {
  BASELINE_DATASET_SIZES,
  BASELINE_SCENARIOS,
  createBaselineCandles,
  type BaselineScale,
  type BaselineScenario,
  type BaselineStack,
} from './stage2Fixtures';

export { BASELINE_DATASET_SIZES, BASELINE_SCENARIOS, createBaselineCandles } from './stage2Fixtures';
export type { BaselineScale, BaselineScenario, BaselineStack } from './stage2Fixtures';

export interface BaselineSummary {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface BaselineRow extends BaselineSummary {
  scenario: BaselineScenario;
  scale: BaselineScale;
  stack: BaselineStack;
  samples: number[];
}

export interface BaselineReport {
  rows: BaselineRow[];
}

export interface BaselineOptions {
  samples?: number;
  warmup?: number;
  scales?: BaselineScale[];
  stacks?: BaselineStack[];
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (p >= 0.95) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function summarizeDurations(values: number[]): BaselineSummary {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const LIGHT_SMA = { id: 'sma', settings: { inputs: { length: 20, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const LIGHT_RSI = { id: 'rsi', settings: { inputs: { length: 14, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const HEAVY_MACD = { id: 'macd', settings: { inputs: { fast: 12, slow: 26, signal: 9, source: 'close' }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const HEAVY_REGRESSION = { id: 'regression-g-channel', settings: { inputs: { length: 200, gcLength: 100 }, styles: {}, visibility: {} } } as CustomIndicatorConfig;
const PROFILE_CONFIG = {
  id: 'session-volume-profile-hd',
  settings: {
    inputs: {
      sessions: 'Daily', rowsLayout: 'Number of Rows', rowSize: 24,
      valueAreaVolume: 70, showProfileBoxes: false, showWeeklyPocs: true,
      showDailyPocs: true, show4hPocs: true,
    },
    styles: {
      poc: { color: '#facc15', display: true },
      weeklyPoc: { color: '#a855f7', display: true },
      dailyPoc: { color: '#facc15', display: true },
      fourHourPoc: { color: '#22d3ee', display: true },
    },
    visibility: {},
  },
} as unknown as CustomIndicatorConfig;

function computeIndicatorStack(candles: Candle[], stack: BaselineStack): void {
  computeSma(candles, LIGHT_SMA);
  computeRsi(candles, LIGHT_RSI);
  if (stack === 'heavy') {
    computeMacd(candles, HEAVY_MACD);
    computeRegressionGChannel(candles, HEAVY_REGRESSION);
  }
}

function formatIndicatorSetData(candles: Candle[], stack: BaselineStack): number {
  const results = stack === 'heavy'
    ? [computeSma(candles, LIGHT_SMA), computeRsi(candles, LIGHT_RSI), computeMacd(candles, HEAVY_MACD), computeRegressionGChannel(candles, HEAVY_REGRESSION)]
    : [computeSma(candles, LIGHT_SMA), computeRsi(candles, LIGHT_RSI)];
  let writes = 0;
  const series = { setData(data: unknown[]) { writes += data.length; } };
  for (const result of results) {
    for (const plot of result.plots) {
      const formatted: { time: number; value: number }[] = [];
      let lastTime = -1;
      plot.data.forEach((point, i) => {
        const value = typeof point === 'object' && point !== null && 'value' in point ? point.value : point;
        const time = candles[i]?.time;
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(time) || time <= lastTime) return;
        lastTime = time;
        formatted.push({ time, value });
      });
      series.setData(formatted);
    }
  }
  return writes;
}

function scanDaySeparators(candles: Candle[]): number {
  const days = new Set<number>();
  let previousDay = -1;
  for (const candle of candles) {
    const day = Math.floor(candle.time / 86_400);
    if (day !== previousDay) {
      days.add(day);
      previousDay = day;
    }
  }
  return days.size;
}

function runScenario(scenario: BaselineScenario, candles: Candle[], stack: BaselineStack): void {
  const last = candles[candles.length - 1];
  switch (scenario) {
    case 'forming-live-tick': {
      const updated = candles.slice();
      updated[updated.length - 1] = { ...last, close: last.close + 1, high: last.high + 1 };
      computeIndicatorStack(updated, stack);
      return;
    }
    case 'closed-bar-update':
      computeIndicatorStack([...candles, { ...last, time: last.time + 300, open: last.close, close: last.close + 1, high: last.close + 2, low: last.close - 1 }], stack);
      return;
    case 'history-prepend':
      computeIndicatorStack([{ ...candles[0], time: candles[0].time - 300 }, ...candles], stack);
      return;
    case 'replay-step':
      computeIndicatorStack(candles.slice(0, Math.max(1, Math.floor(candles.length * 0.7))), stack);
      return;
    case 'indicator-toggle':
    case 'indicator-computation':
      computeIndicatorStack(candles, stack);
      return;
    case 'timeframe-switch':
      computeIndicatorStack(createBaselineCandles(candles.length, candles.length + (stack === 'heavy' ? 101 : 7)), stack);
      return;
    case 'indicator-setData':
      formatIndicatorSetData(candles, stack);
      return;
    case 'svp-poc':
      computeSessionVolumeProfile(candles, PROFILE_CONFIG);
      return;
    case 'heikin-ashi':
      toHeikinAshi(candles);
      return;
    case 'renko':
      toRenko(candles, { method: 'traditional', brickSize: 100 });
      return;
    case 'paper-noop-reconciliation':
      reconcileBar('STAGE2_NOOP', last);
      return;
    case 'visible-range-pan':
    case 'day-separator-pan':
      scanDaySeparators(candles);
      return;
  }
}

export function runStage2Baseline(options: BaselineOptions = {}): BaselineReport {
  const samples = Math.max(1, Math.floor(options.samples ?? 3));
  const warmup = Math.max(0, Math.floor(options.warmup ?? 1));
  const scales = options.scales ?? (Object.keys(BASELINE_DATASET_SIZES) as BaselineScale[]);
  const stacks = options.stacks ?? ['light', 'heavy'];
  const rows: BaselineRow[] = [];
  for (const scale of scales) {
    const candles = createBaselineCandles(BASELINE_DATASET_SIZES[scale]);
    for (const stack of stacks) {
      for (const scenario of BASELINE_SCENARIOS) {
        for (let i = 0; i < warmup; i++) runScenario(scenario, candles, stack);
        const durations: number[] = [];
        const recorder = createPerformanceRecorder();
        for (let i = 0; i < samples; i++) {
          measurePerformance(`stage2.${scenario}`, () => runScenario(scenario, candles, stack), recorder);
        }
        durations.push(...recorder.samples(`stage2.${scenario}`));
        rows.push({ scenario, scale, stack, samples: durations, ...summarizeDurations(durations) });
      }
    }
  }
  return { rows };
}

export function renderBaselineReport(report: BaselineReport): string {
  const lines = ['| Scale | Stack | Scenario | p50 ms | p95 ms | p99 ms |', '|---|---|---|---:|---:|---:|'];
  for (const row of report.rows) {
    lines.push(`| ${row.scale} | ${row.stack} | ${row.scenario} | ${row.p50.toFixed(3)} | ${row.p95.toFixed(3)} | ${row.p99.toFixed(3)} |`);
  }
  return lines.join('\n');
}
