import type { Candle, Timeframe } from './types';
import type { IndicatorResult } from './indicatorFramework';

/** The account/data mode that produced an indicator input. */
export type IndicatorEvaluationMode = 'live' | 'replay';

/** Which candle representation an indicator treats as analytical truth. */
export type IndicatorSourcePolicy = 'raw' | 'display' | 'mixed';

/** Whether the indicator may emit state from the currently forming bar. */
export type IndicatorFinalityPolicy = 'closed' | 'developing' | 'mixed';

export interface ReplayEvaluationIdentity {
  sessionId: string;
  cutTime: number;
  executionTimeframe: Timeframe;
}

export interface IndicatorSourceProvenance {
  raw: 'market' | 'replay-snapshot';
  display: 'raw' | 'heikinAshi' | 'renko' | 'other';
}

/**
 * Canonical context shared by indicator computation and cache identity.
 *
 * `rawCandles` and `displayCandles` deliberately remain caller-owned arrays;
 * this context is metadata plus a closed prefix, not another candle store.
 */
export interface IndicatorEvaluationContext {
  rawCandles: Candle[];
  displayCandles: Candle[];
  closedCandles: Candle[];
  hasFormingBar: boolean;
  symbol: string;
  timeframe: Timeframe;
  mode: IndicatorEvaluationMode;
  replay?: ReplayEvaluationIdentity;
  transform: 'candlestick' | 'heikinAshi' | 'renko' | 'other';
  sourceRevision: string;
  provenance: IndicatorSourceProvenance;
}

export interface CreateIndicatorEvaluationContextInput {
  rawCandles: Candle[];
  displayCandles: Candle[];
  symbol: string;
  timeframe: Timeframe;
  mode: IndicatorEvaluationMode;
  hasFormingBar?: boolean;
  replay?: ReplayEvaluationIdentity;
  transform?: IndicatorEvaluationContext['transform'];
  sourceRevision: string;
  provenance?: Partial<IndicatorSourceProvenance>;
}

export function createIndicatorEvaluationContext(
  input: CreateIndicatorEvaluationContextInput,
): IndicatorEvaluationContext {
  const hasFormingBar = input.hasFormingBar ?? false;
  return {
    rawCandles: input.rawCandles,
    displayCandles: input.displayCandles,
    closedCandles: hasFormingBar ? input.rawCandles.slice(0, -1) : input.rawCandles.slice(),
    hasFormingBar,
    symbol: input.symbol,
    timeframe: input.timeframe,
    mode: input.mode,
    replay: input.replay,
    transform: input.transform ?? 'candlestick',
    sourceRevision: input.sourceRevision,
    provenance: {
      raw: input.provenance?.raw ?? (input.mode === 'replay' ? 'replay-snapshot' : 'market'),
      display: input.provenance?.display ?? 'raw',
    },
  };
}

/** Stable identity for cache invalidation; no wall-clock or random values. */
export function selectIndicatorCandles(
  context: IndicatorEvaluationContext,
  sourcePolicy: IndicatorSourcePolicy = 'display',
  finalityPolicy: IndicatorFinalityPolicy = 'developing',
): Candle[] {
  if (sourcePolicy === 'raw') {
    return finalityPolicy === 'closed' ? context.closedCandles : context.rawCandles;
  }
  return context.displayCandles;
}
export function evaluationIdentity(context: IndicatorEvaluationContext): string {
  const replay = context.replay
    ? `replay:${context.replay.sessionId}:${context.replay.cutTime}:${context.replay.executionTimeframe}`
    : 'live';
  return [
    context.mode,
    replay,
    context.symbol,
    context.timeframe,
    context.transform,
    context.sourceRevision,
    context.hasFormingBar ? 'forming' : 'closed',
  ].join('|');
}


/**
 * Projects an analytical result back onto the display candle index. Raw
 * structural indicators can therefore remain correct when Renko changes the
 * number of rendered candles while legacy chart series still receive the
 * expected display-length arrays.
 */
export function projectIndicatorResultToDisplay(
  result: IndicatorResult,
  sourceCandles: Candle[],
  displayCandles: Candle[],
): IndicatorResult {
  if (sourceCandles.length === displayCandles.length) return result;
  if (displayCandles.length === 0) return { ...result, plots: [], signals: [] };

  const targets: number[] = [];
  let displayIndex = 0;
  for (const source of sourceCandles) {
    while (displayIndex + 1 < displayCandles.length && displayCandles[displayIndex + 1].time <= source.time) {
      displayIndex += 1;
    }
    targets.push(displayIndex);
  }

  const mapData = <T>(data: T[]): T[] => {
    const projected = new Array<T | null>(displayCandles.length).fill(null);
    data.forEach((value, index) => {
      const target = targets[index];
      if (target != null) projected[target] = value;
    });
    return projected.map((value) => value as T);
  };

  return {
    ...result,
    plots: result.plots.map((plot) =>
      plot.data.length === sourceCandles.length ? { ...plot, data: mapData(plot.data) } : plot,
    ),
    signals: result.signals.length === sourceCandles.length
      ? mapData(result.signals)
      : result.signals,
    markers: result.markers?.map((marker) => ({
      ...marker,
      index: targets[marker.index] ?? Math.min(marker.index, displayCandles.length - 1),
    })),
    candleColors: result.candleColors
      ? {
          ...result.candleColors,
          color: result.candleColors.color && result.candleColors.color.length === sourceCandles.length
            ? mapData(result.candleColors.color)
            : result.candleColors.color,
          wickColor: result.candleColors.wickColor && result.candleColors.wickColor.length === sourceCandles.length
            ? mapData(result.candleColors.wickColor)
            : result.candleColors.wickColor,
          borderColor: result.candleColors.borderColor && result.candleColors.borderColor.length === sourceCandles.length
            ? mapData(result.candleColors.borderColor)
            : result.candleColors.borderColor,
        }
      : result.candleColors,
  };
}