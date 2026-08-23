import type { Candle, Timeframe } from '../types';
import { createBaselineCandles } from './stage2Fixtures';
import { IncrementalIndicatorEngine } from '../incrementalIndicatorEngine';
import { incrementalSma } from '../indicators/incremental';
import { computeSma } from '../indicators/sma';
import { computeMacd } from '../indicators/macd';
import { SessionVolumeProfileCache } from '../indicators/sessionVolumeProfileIncremental';
import { IncrementalHeikinAshi, IncrementalRenko } from '../incrementalCandleTransforms';
import { buildDaySeparatorIndex, selectVisibleDaySeparators, updateDaySeparatorIndex } from '../daySeparatorIndex';
import { writeIndicatorSeries, type IndicatorSeriesSnapshot } from '../../components/chart/indicatorSeriesWrites';
import {
  __getReplayDatasetListenerCountForTest,
  __subscribeReplayDatasetForTest,
  captureReplayDataset,
  clearReplayDataset,
  getReplayDataset,
} from '../replay/replayDataset';
import { __resetForTest, reconcileLiveTick, subscribeForTest } from '../paperStore';

export type SoakDuration = '30m' | '2h' | '8h' | '24h';

export interface SoakReport {
  duration: SoakDuration;
  simulatedBars: number;
  formingTicks: number;
  closedBars: number;
  indicatorToggles: number;
  timeframeSwitches: number;
  replayCycles: number;
  prepends: number;
  panZoomEvents: number;
  seriesFullWrites: number;
  seriesTailWrites: number;
  svpCompletedBuilds: number;
  svpCacheHits: number;
  svpCachedBeforeClear: number;
  svpCachedAfterClear: number;
  replayActiveBeforeClear: boolean;
  replayActiveAfterClear: boolean;
  replayListenersBeforeClear: number;
  replayListenersAfterClear: number;
  transformResetLengths: { heikinAshi: number; renko: number };
  noOpNotifications: number;
  heapSamples: number[];
  heapSlope: number;
  durationMs: number;
}

const BAR_COUNTS: Record<SoakDuration, number> = { '30m': 6, '2h': 24, '8h': 96, '24h': 288 };
const INITIAL_BARS = 2_000;

function heapUsed(): number {
  const memory = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process?.memoryUsage;
  return typeof memory === 'function' ? memory().heapUsed : Number.NaN;
}

function soakConfig(id: string): import("../indicatorFramework").CustomIndicatorConfig {
  return { id, settings: { inputs: { length: 20, source: 'close' }, styles: {}, visibility: {} } };
}

function lastSma(raw: unknown, index: number): { time: number; value: number } | null {
  const value = typeof raw === 'number' ? raw : null;
  return value != null && Number.isFinite(value) ? { time: index, value } : null;
}

/**
 * Deterministic accelerated soak. It intentionally calls the same public
 * incremental/reset APIs as the chart, while compressing wall-clock time to
 * a bounded number of reproducible bars.
 */
export function runStage2Soak(duration: SoakDuration, seed = 0x5eed): SoakReport {
  const started = Date.now();
  const barsToRun = BAR_COUNTS[duration];
  const stream = createBaselineCandles(INITIAL_BARS + barsToRun + 2, seed);
  let history = stream.slice(0, INITIAL_BARS);
  let indicatorIdentity = 'BTCUSDT|5m|light';
  const config = soakConfig('stage2-soak-sma');
  const indicator = new IncrementalIndicatorEngine({ compute: computeSma, incremental: incrementalSma });
  let indicatorResult = indicator.update(history, { config, identity: indicatorIdentity });
  const ha = new IncrementalHeikinAshi();
  const renko = new IncrementalRenko();
  ha.update(history);
  renko.update(history, { method: 'traditional', brickSize: 100 });

  const cache = new SessionVolumeProfileCache('stage2-soak-BTCUSDT');
  const profile = { rowsLayout: 'rows' as const, rowSize: 24, valueAreaVolume: 70 };
  const modes = [
    { session: { mode: 'daily' as const }, profile, pocOnly: true },
    { session: { mode: 'weekly' as const }, profile, pocOnly: true },
    { session: { mode: '4h' as const }, profile, pocOnly: true },
  ];
  for (const mode of modes) cache.provider(history, mode.session, mode.profile, mode.pocOnly);

  let boundaries = buildDaySeparatorIndex(history);
  let indexedSource = history;
  const series = {
    setData: (_data: Array<{ time: number; value: number }>) => { fullWrites += 1; },
    update: (_point: { time: number; value: number }) => { tailWrites += 1; },
  };
  let fullWrites = 0;
  let tailWrites = 0;
  let snapshot: IndicatorSeriesSnapshot | undefined;
  const write = (raw: readonly unknown[], candles: readonly Candle[], structural: boolean) => {
    const result = writeIndicatorSeries({
      series,
      raw,
      candles,
      structural,
      format: lastSma,
      timeOf: (point) => point.time,
    }, snapshot);
    snapshot = result.snapshot;
  };
  write(indicatorResult.plots[0]?.data ?? [], history, true);

  let formingTicks = 0;
  let closedBars = 0;
  let indicatorToggles = 0;
  let timeframeSwitches = 0;
  let replayCycles = 0;
  let prepends = 0;
  let panZoomEvents = 0;
  const heapSamples: number[] = [];
  heapSamples.push(heapUsed());

  __resetForTest();
  let noOpNotifications = 0;
  const unsubscribeNoOp = subscribeForTest(() => { noOpNotifications += 1; });
  reconcileLiveTick('BTCUSDT', history.at(-1)?.close ?? 50_000, history.at(-1)?.time ?? 0);
  for (let index = 0; index < barsToRun; index += 1) {
    const forming = { ...history.at(-1)!, close: history.at(-1)!.close + (index % 2 === 0 ? 0.25 : -0.25) };
    history = [...history.slice(0, -1), forming];
    indicatorResult = indicator.update(history, { config, identity: indicatorIdentity });
    ha.update(history);
    renko.update(history, { method: 'traditional', brickSize: 100 });
    write(indicatorResult.plots[0]?.data ?? [], history, false);
    formingTicks += 1;

    const next = stream[INITIAL_BARS + index];
    history = [...history, next];
    indicatorResult = indicator.update(history, { config, identity: indicatorIdentity });
    ha.update(history);
    renko.update(history, { method: 'traditional', brickSize: 100 });
    write(indicatorResult.plots[0]?.data ?? [], history, false);
    for (const mode of modes) cache.provider(history, mode.session, mode.profile, mode.pocOnly);
    boundaries = updateDaySeparatorIndex(indexedSource, history, boundaries);
    indexedSource = history;
    closedBars += 1;

    const visibleFrom = Math.max(0, history.length - 160 - (index % 17));
    selectVisibleDaySeparators(boundaries, { from: visibleFrom, to: history.length - 1 });
    panZoomEvents += 1;

    if (index % 24 === 0) {
      const older = { ...history[0], time: history[0].time - 300 };
      const prepended = [older, ...history];
      history = prepended;
      indicatorResult = indicator.update(history, { config, identity: indicatorIdentity });
      ha.rebuild(history);
      renko.rebuild(history, { method: 'traditional', brickSize: 100 });
      boundaries = updateDaySeparatorIndex(indexedSource, history, boundaries);
      indexedSource = history;
      write(indicatorResult.plots[0]?.data ?? [], history, true);
      prepends += 1;
    }
    if (index % 32 === 0) {
      indicatorToggles += 1;
      indicator.reset();
      indicatorResult = indicator.update(history, { config, identity: indicatorIdentity });
      write(indicatorResult.plots[0]?.data ?? [], history, true);
    }
    if (index % 48 === 0) {
      timeframeSwitches += 1;
      indicatorIdentity = indicatorIdentity.includes('|5m|') ? 'BTCUSDT|15m|light' : 'BTCUSDT|5m|light';
      indicatorResult = indicator.update(history, { config, identity: indicatorIdentity });
      ha.rebuild(history);
      renko.rebuild(history, { method: 'traditional', brickSize: 100 });
      write(indicatorResult.plots[0]?.data ?? [], history, true);
      computeMacd(history, soakConfig('stage2-soak-macd'));
    }
    if (index % 40 === 0) {
      captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m' as Timeframe, candlesByTf: { '5m': history, '15m': history.slice(0, Math.max(1, history.length - 2)) } });
      replayCycles += 1;
      clearReplayDataset();
    }
    reconcileLiveTick('BTCUSDT', history.at(-1)!.close, history.at(-1)!.time);
    if (index % 16 === 0) heapSamples.push(heapUsed());
  }
  unsubscribeNoOp();

  const replayListener = () => undefined;
  const unsubscribeReplay = __subscribeReplayDatasetForTest(replayListener);
  const replayListenersBeforeClear = __getReplayDatasetListenerCountForTest();
  captureReplayDataset({ symbol: 'BTCUSDT', executionTf: '5m' as Timeframe, candlesByTf: { '5m': history } });
  const replayActiveBeforeClear = getReplayDataset().active;
  clearReplayDataset();
  const replayActiveAfterClear = getReplayDataset().active;
  unsubscribeReplay();
  const replayListenersAfterClear = __getReplayDatasetListenerCountForTest();

  const svpStats = cache.stats();
  const svpCachedBeforeClear = svpStats.cachedSessions;
  cache.clear();
  const svpCachedAfterClear = cache.stats().cachedSessions;
  const heikinAshiReset = ha.update([]).length;
  const renkoReset = renko.update([], { method: 'traditional', brickSize: 100 }).length;
  const finiteHeap = heapSamples.filter(Number.isFinite);
  const firstHeap = finiteHeap[0] ?? 0;
  const lastHeap = finiteHeap.at(-1) ?? firstHeap;

  return {
    duration,
    simulatedBars: barsToRun,
    formingTicks,
    closedBars,
    indicatorToggles,
    timeframeSwitches,
    replayCycles,
    prepends,
    panZoomEvents,
    seriesFullWrites: fullWrites,
    seriesTailWrites: tailWrites,
    svpCompletedBuilds: svpStats.completedBuilds,
    svpCacheHits: svpStats.cacheHits,
    svpCachedBeforeClear,
    svpCachedAfterClear,
    replayActiveBeforeClear,
    replayActiveAfterClear,
    replayListenersBeforeClear,
    replayListenersAfterClear,
    transformResetLengths: { heikinAshi: heikinAshiReset, renko: renkoReset },
    noOpNotifications,
    heapSamples,
    heapSlope: firstHeap > 0 ? (lastHeap - firstHeap) / firstHeap : 0,
    durationMs: Date.now() - started,
  };
}
