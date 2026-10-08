// Custom MTF computation boundary. It deliberately returns a Custom result and
// has no dependency on StandardMtfSnapshot or its publication machinery.

import type { CompareSymbol } from '../compare';
import { computeAlignmentMatrix, type AlignmentMatrix } from '../alignment';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { evaluateClosedDerivedIntelligence, type DerivedStructuralIntelligence, type PocStructureIntelligence } from './derivedIntelligence';
import { evaluateClosedTakerSideOrderFlow, type TakerSideOrderFlowResult } from './primitiveFoundation';
import { computeSmc } from '../smc/engine';
import type { SmcSnapshot } from '../smc/types';
import type { Candle, Timeframe } from '../types';
import {
  CUSTOM_MTF_CONFIG_SCHEMA_VERSION,
  CUSTOM_MTF_METHODOLOGY_VERSION,
  customMtfConfigFingerprint,
  type CustomMtfConfig,
  type CustomMtfMode,
} from './customMtfConfig';

export const CUSTOM_MTF_CACHE_NAMESPACE = 'custom-mtf' as const;

export interface CustomMtfReplayIdentity {
  readonly sessionId: string;
  readonly cutTime: number;
  readonly executionTimeframe: Timeframe;
}

export interface CustomMtfCacheIdentity {
  readonly namespace: typeof CUSTOM_MTF_CACHE_NAMESPACE;
  readonly schemaVersion: typeof CUSTOM_MTF_CONFIG_SCHEMA_VERSION;
  readonly methodologyVersion: typeof CUSTOM_MTF_METHODOLOGY_VERSION;
  readonly symbol: CompareSymbol;
  readonly timeframe: Timeframe;
  readonly mode: CustomMtfMode;
  readonly replay: CustomMtfReplayIdentity | null;
  readonly candleCutoff: number;
  readonly candleFingerprint: string;
  readonly configFingerprint: string;
  readonly cacheKey: string;
}

export interface CustomMtfWorkspaceInput {
  readonly symbol: CompareSymbol;
  readonly candlesByTimeframe: Partial<Record<Timeframe, readonly Candle[]>>;
  readonly config: CustomMtfConfig;
  readonly mode?: CustomMtfMode;
  readonly replay?: CustomMtfReplayIdentity;
}

export interface CustomMtfWorkspaceResult {
  readonly identity: readonly CustomMtfCacheIdentity[];
  readonly matrix: AlignmentMatrix;
}

export interface CustomMtfSmcInput {
  readonly symbol: CompareSymbol;
  readonly timeframe: Timeframe;
  readonly candles: readonly Candle[];
  readonly config: CustomMtfConfig;
  readonly mode?: CustomMtfMode;
  readonly replay?: CustomMtfReplayIdentity;
  readonly hasFormingBar?: boolean;
}

export interface CustomMtfSmcResult {
  readonly identity: CustomMtfCacheIdentity;
  readonly snapshot: SmcSnapshot;
}

export interface CustomMtfContextResult {
  readonly identity: CustomMtfCacheIdentity;
  /** Closed-bar FVG, VWAP, and POC context, isolated to this Custom workspace. */
  readonly derived: DerivedStructuralIntelligence;
  readonly poc: PocStructureIntelligence;
  readonly orderFlow: TakerSideOrderFlowResult;
}

function fingerprintCandles(candles: readonly Candle[]): string {
  const text = candles.map((candle) => [
    candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.takerBuyVolume ?? null,
  ].join(',')).join(';');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'fnv1a32:' + (hash >>> 0).toString(16).padStart(8, '0');
}

function selectedCandles(candles: readonly Candle[], mode: CustomMtfMode, replay: CustomMtfReplayIdentity | undefined): Candle[] {
  return candles
    .filter((candle) => mode !== 'replay' || !replay || candle.time <= replay.cutTime)
    .map((candle) => ({ ...candle }));
}

function evaluationContext(input: CustomMtfSmcInput, identity: CustomMtfCacheIdentity) {
  const mode = input.mode ?? 'live';
  const rawCandles = selectedCandles(input.candles, mode, input.replay);
  return createIndicatorEvaluationContext({
    rawCandles,
    displayCandles: rawCandles,
    symbol: input.symbol,
    timeframe: input.timeframe,
    mode,
    hasFormingBar: input.hasFormingBar ?? mode === 'live',
    replay: mode === 'replay' ? input.replay : undefined,
    sourceRevision: identity.candleFingerprint,
  });
}

export function createCustomMtfCacheIdentity(input: CustomMtfSmcInput): CustomMtfCacheIdentity {
  const mode = input.mode ?? 'live';
  if (mode === 'replay' && !input.replay) throw new Error('Custom replay identity requires replay metadata');
  const candles = selectedCandles(input.candles, mode, input.replay);
  const candleCutoff = candles[candles.length - 1]?.time ?? 0;
  const candleFingerprint = fingerprintCandles(candles);
  const configFingerprint = customMtfConfigFingerprint(input.config);
  const replay = mode === 'replay' ? input.replay ?? null : null;
  const cacheKey = [
    CUSTOM_MTF_CACHE_NAMESPACE,
    'schema=' + CUSTOM_MTF_CONFIG_SCHEMA_VERSION,
    'method=' + CUSTOM_MTF_METHODOLOGY_VERSION,
    'symbol=' + input.symbol,
    'timeframe=' + input.timeframe,
    'mode=' + mode,
    'replay=' + (replay ? replay.sessionId + ':' + replay.cutTime + ':' + replay.executionTimeframe : 'none'),
    'cutoff=' + candleCutoff,
    'candles=' + candleFingerprint,
    'config=' + configFingerprint,
  ].join('|');
  return {
    namespace: CUSTOM_MTF_CACHE_NAMESPACE,
    schemaVersion: CUSTOM_MTF_CONFIG_SCHEMA_VERSION,
    methodologyVersion: CUSTOM_MTF_METHODOLOGY_VERSION,
    symbol: input.symbol,
    timeframe: input.timeframe,
    mode,
    replay,
    candleCutoff,
    candleFingerprint,
    configFingerprint,
    cacheKey,
  };
}

/** Custom matrix result: configurable, non-official, and never published. */
export function buildCustomMtfWorkspace(input: CustomMtfWorkspaceInput): CustomMtfWorkspaceResult {
  const mode = input.mode ?? 'live';
  const identity = (['5m', '15m', '30m', '1h', '4h', '1d'] as const).map((timeframe) =>
    createCustomMtfCacheIdentity({
      symbol: input.symbol,
      timeframe,
      candles: input.candlesByTimeframe[timeframe] ?? [],
      config: input.config,
      mode,
      replay: input.replay,
      hasFormingBar: false,
    }),
  );
  const source = Object.fromEntries(identity.map((entry) => [
    entry.timeframe,
    selectedCandles(input.candlesByTimeframe[entry.timeframe] ?? [], mode, input.replay),
  ])) as Partial<Record<Timeframe, Candle[]>>;
  return {
    identity,
    matrix: computeAlignmentMatrix(source, ['5m', '15m', '30m', '1h', '4h', '1d'], configSettings(input.config)),
  };
}

function configSettings(config: CustomMtfConfig) {
  return config.indicatorSettings as Record<string, import('../indicatorFramework').IndicatorSettings>;
}

/** Closed-bar SMC calculation with a Custom-only identity and config copy. */
export function buildCustomMtfSmc(input: CustomMtfSmcInput): CustomMtfSmcResult {
  const identity = createCustomMtfCacheIdentity(input);
  const context = evaluationContext(input, identity);
  return { identity, snapshot: computeSmc(context.closedCandles, input.config.smc.config, context) };
}

/** Closed-bar structural context for Custom only. No result is published into Standard MTF. */
export function buildCustomMtfContext(input: CustomMtfSmcInput): CustomMtfContextResult {
  const identity = createCustomMtfCacheIdentity(input);
  const context = evaluationContext(input, identity);
  const derived = evaluateClosedDerivedIntelligence(context);
  const measured = evaluateClosedTakerSideOrderFlow(context);
  const orderFlow: TakerSideOrderFlowResult = input.symbol === 'BTCUSDT'
    ? measured
    : Object.freeze({
        ...measured,
        availability: 'unavailable' as const,
        reason: 'XAUUSD has no compatible taker-side volume source.',
        buyVolume: null,
        sellVolume: null,
        bidAskDelta: null,
        cumulativeDelta: null,
        imbalance: null,
        aggression: null,
        provenance: Object.freeze({ ...measured.provenance, metricSource: 'unavailable' as const }),
      });
  return Object.freeze({ identity, derived, poc: derived.poc, orderFlow });
}
