import type { ChartType } from '../components/chart/types';
import type { ChartSettingsState } from '../components/chart/useChartSettings';
import type { ChartTradingCommands } from './chartTradingCommands';
import type { IndicatorEvaluationContext } from './indicatorEvaluation';
import { isPriceExecutionTrusted, type MarketDataIntegrity } from './marketDataIntegrity';
import type { TradePresentation } from './trade/presentation';
import type { Candle, Timeframe } from './types';

export type ChartSessionMode = 'live' | 'replay';

export interface ChartSessionReplayIdentity {
  sessionId: string;
  cutTime: number | null;
  executionTimeframe: Timeframe;
}

/**
 * The already-selected source for the active chart session. The owner of this
 * source remains useMarketData or the immutable replay dataset; this model
 * only exposes it as readonly data and never stores a second candle cache.
 */
export interface ChartSessionSource {
  readonly rawCandles: readonly Candle[];
  readonly displayCandles: readonly Candle[];
  readonly visibleCandles: readonly Candle[];
  readonly markPrice: number | null;
  readonly marketDataIntegrity: MarketDataIntegrity;
  readonly indicatorContext: IndicatorEvaluationContext;
}

export interface ChartSessionInput {
  symbol: string;
  visualTimeframe: Timeframe;
  transform: ChartType;
  mode: ChartSessionMode;
  source: ChartSessionSource;
  replay?: ChartSessionReplayIdentity | null;
  tradePresentation: TradePresentation;
  tradingCommands: ChartTradingCommands | null;
  drawingScopeIdentity: string;
  chartSettings: ChartSettingsState;
}

export interface ChartSession {
  readonly identity: string;
  /** Identity of analytical raw data; deliberately excludes display transform. */
  readonly rawSourceIdentity: string;
  readonly chart: Readonly<{
    symbol: string;
    visualTimeframe: Timeframe;
    transform: ChartType;
  }>;
  readonly execution: Readonly<{
    mode: ChartSessionMode;
    replay: ChartSessionReplayIdentity | null;
  }>;
  readonly data: Readonly<{
    rawCandles: readonly Candle[];
    displayCandles: readonly Candle[];
    visibleCandles: readonly Candle[];
    currentCandles: readonly Candle[];
    trustedMarkPrice: number | null;
    marketDataIntegrity: MarketDataIntegrity;
  }>;
  readonly trading: Readonly<{
    tradePresentation: TradePresentation;
    commands: ChartTradingCommands | null;
  }>;
  readonly indicators: Readonly<{
    context: IndicatorEvaluationContext;
  }>;
  readonly settings: Readonly<{
    drawingScopeIdentity: string;
    chartSettings: ChartSettingsState;
    chartSettingsIdentity: string;
  }>;
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`);
  return `{${entries.join(',')}}`;
}

function finitePrice(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function trustedMarkPrice(
  mode: ChartSessionMode,
  integrity: MarketDataIntegrity,
  markPrice: number | null,
): number | null {
  const price = finitePrice(markPrice);
  if (price == null) return null;
  // Replay uses the frozen snapshot's causal mark. Live execution remains
  // gated exclusively by MarketDataIntegrity === 'live'.
  if (mode === 'replay') return integrity === 'replay' ? price : null;
  return isPriceExecutionTrusted(integrity) ? price : null;
}

function replayIdentityFor(mode: ChartSessionMode, replay?: ChartSessionReplayIdentity | null): ChartSessionReplayIdentity | null {
  return mode === 'replay' && replay ? { ...replay } : null;
}


function modeSafePresentation(input: ChartSessionInput): TradePresentation {
  if (
    input.tradePresentation.mode === input.mode
    && input.tradePresentation.symbol === input.symbol
  ) {
    return input.tradePresentation;
  }
  return {
    mode: input.mode,
    symbol: input.symbol,
    position: null,
    trades: [],
    balance: 0,
    initialBalance: 0,
  };
}/**
 * Derive the active chart session from existing authoritative owners.
 *
 * This is intentionally a pure function. It is safe to call from a hook or
 * component memo and does not subscribe to, persist, or mutate any store.
 */
export function deriveChartSession(input: ChartSessionInput): ChartSession {
  const replay = replayIdentityFor(input.mode, input.replay);
  const { source } = input;
  const indicator = source.indicatorContext;
  const chartSettingsIdentity = stableValue(input.chartSettings);
  const replayIdentity = replay
    ? `replay:${replay.sessionId}:${replay.cutTime ?? 'none'}:${replay.executionTimeframe}`
    : 'live';
  const rawSourceIdentity = [
    input.mode,
    replayIdentity,
    input.symbol,
    input.visualTimeframe,
    indicator.sourceRevision,
    indicator.provenance.raw,
  ].join('|');
  const identity = [
    rawSourceIdentity,
    input.transform,
    indicator.hasFormingBar ? 'forming' : 'closed',
    input.drawingScopeIdentity,
    chartSettingsIdentity,
  ].join('|');

  const chart = Object.freeze({
    symbol: input.symbol,
    visualTimeframe: input.visualTimeframe,
    transform: input.transform,
  });
  const execution = Object.freeze({ mode: input.mode, replay });
  const data = Object.freeze({
    rawCandles: source.rawCandles,
    displayCandles: source.displayCandles,
    visibleCandles: source.visibleCandles,
    currentCandles: source.visibleCandles,
    trustedMarkPrice: trustedMarkPrice(input.mode, source.marketDataIntegrity, source.markPrice),
    marketDataIntegrity: source.marketDataIntegrity,
  });
  const trading = Object.freeze({
    tradePresentation: modeSafePresentation(input),
    commands: input.tradingCommands,
  });
  const indicators = Object.freeze({ context: indicator });
  const settings = Object.freeze({
    drawingScopeIdentity: input.drawingScopeIdentity,
    chartSettings: input.chartSettings,
    chartSettingsIdentity,
  });

  return Object.freeze({
    identity,
    rawSourceIdentity,
    chart,
    execution,
    data,
    trading,
    indicators,
    settings,
  });
}
