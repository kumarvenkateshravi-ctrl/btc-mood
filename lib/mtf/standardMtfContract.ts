// Official Standard MTF boundary contract.
//
// This file deliberately does not replace or call either of the existing MTF
// pipelines.  It defines the immutable hand-off shape that Phase 1 can adapt
// the canonical engines into without changing today's routes or behaviour.

import type { CompareSymbol } from '../compare';
import type { DerivedStructuralIntelligence } from './derivedIntelligence';
import type { Candle, Timeframe } from '../types';
import type {
  CategoryResult,
  CategorySignal,
  MomentumState,
  TrendState,
  VolumeState,
  VolatilityState,
} from './categoryTypes';
import type { Verdict } from './types';
import type { EvidenceItem } from './market/marketTypes';
import type { OverallMarketState, TimeframeSnapshot } from './timeframe/timeframeTypes';
import type { BoardDecision } from './board/boardTypes';
import type { MarketIntelligenceResult } from './market/marketTypes';
import type { TradeDecisionResult } from './decision/decisionTypes';

export const STANDARD_MTF_SCHEMA_VERSION = 3 as const;
export const STANDARD_MTF_METHODOLOGY_VERSION = 'standard-mtf/1.2.0' as const;
export const STANDARD_MTF_TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1d'] as const satisfies readonly Timeframe[];
export const STANDARD_MTF_EVALUATION_POLICY = 'closed_bar' as const;

export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly [] ? readonly []
      : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
      : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

export type StandardMtfCategoryId =
  | 'trend'
  | 'momentum'
  | 'volume'
  | 'volatility'
  | 'marketStructure'
  | 'volumeProfile'
  | 'orderFlow'
  | 'confluence';

type StandardMtfCategorySignal<Id extends StandardMtfCategoryId> = DeepReadonly<
  Omit<CategorySignal, 'category'> & { category: Id }
>;

/**
 * Reuses the M2 CategoryResult scoring/evidence contract while widening only
 * the category identifier and state for the four cross-domain Standard MTF
 * categories that M2 does not currently own.
 */
export type StandardMtfAvailableCategoryResult<
  Id extends StandardMtfCategoryId,
  State extends string = string,
> = DeepReadonly<
  Omit<CategoryResult, 'id' | 'state' | 'signals' | 'warnings'> & {
    id: Id;
    state: State;
    signals: StandardMtfCategorySignal<Id>[];
    warnings: StandardMtfCategorySignal<Id>[];
    availability: 'available';
  }
>;

/**
 * A missing adapter is deliberately represented as missing. In particular,
 * this is not a neutral score: a consumer cannot accidentally count it as
 * evidence for a direction.
 */
export interface StandardMtfUnavailableCategoryResult<Id extends StandardMtfCategoryId> {
  readonly id: Id;
  readonly availability: 'unavailable' | 'insufficient_data';
  readonly reason: string;
  readonly score: null;
  readonly verdict: null;
  readonly confidence: null;
  readonly strength: null;
  readonly state: 'unavailable' | 'insufficient_data';
  readonly contributors: readonly [];
  readonly diagnostics: Readonly<Record<string, never>>;
  readonly signals: readonly [];
  readonly warnings: readonly [];
}

export type StandardMtfCategoryResult<
  Id extends StandardMtfCategoryId,
  State extends string = string,
> = StandardMtfAvailableCategoryResult<Id, State> | StandardMtfUnavailableCategoryResult<Id>;

export interface StandardMtfCategories {
  readonly trend: StandardMtfCategoryResult<'trend', TrendState>;
  readonly momentum: StandardMtfCategoryResult<'momentum', MomentumState>;
  readonly volume: StandardMtfCategoryResult<'volume', VolumeState>;
  readonly volatility: StandardMtfCategoryResult<'volatility', VolatilityState>;
  readonly marketStructure: StandardMtfCategoryResult<'marketStructure', 'bullish' | 'bearish' | 'ranging'>;
  readonly volumeProfile: StandardMtfCategoryResult<'volumeProfile'>;
  readonly orderFlow: StandardMtfCategoryResult<'orderFlow'>;
  readonly confluence: StandardMtfCategoryResult<'confluence'>;
}

export type StandardMtfEvidence = DeepReadonly<
  EvidenceItem & {
    code: string;
    timeframe?: Timeframe;
    category?: StandardMtfCategoryId;
  }
>;

/** One isolated timeframe result, including its own input identity. */
export interface StandardMtfTimeframeResult {
  readonly timeframe: Timeframe;
  readonly availability: 'available' | 'insufficient_data';
  readonly reason?: string;
  readonly candleCutoff: number;
  readonly candleCount: number;
  readonly candleFingerprint: string;
  /** M0-M4 result when enough closed data exists; never a fabricated value. */
  readonly snapshot: DeepReadonly<TimeframeSnapshot> | null;
  readonly categories: DeepReadonly<StandardMtfCategories>;
}

export type StandardMtfJson =
  | null
  | boolean
  | number
  | string
  | readonly StandardMtfJson[]
  | { readonly [key: string]: StandardMtfJson };

/**
 * Every setting that can affect a result belongs here. Consumers must not use
 * ambient defaults when constructing an official snapshot identity.
 */
export type StandardMtfParameters = Readonly<Record<string, StandardMtfJson>>;

export interface StandardMtfTimeframeInputIdentity {
  readonly timeframe: Timeframe;
  readonly candleCutoff: number;
  readonly firstCandleTime: number | null;
  readonly lastCandleTime: number | null;
  readonly candleCount: number;
  readonly candleFingerprint: string;
}

export interface StandardMtfSnapshotIdentity {
  readonly schemaVersion: typeof STANDARD_MTF_SCHEMA_VERSION;
  readonly methodologyVersion: string;
  readonly symbol: CompareSymbol;
  /** Deterministic evaluation time; for v1 this is exactly candleCutoff. */
  readonly generatedAt: number;
  readonly candleCutoff: number;
  readonly evaluationPolicy: typeof STANDARD_MTF_EVALUATION_POLICY;
  readonly timeframeInputs: Readonly<Record<Timeframe, StandardMtfTimeframeInputIdentity>>;
  readonly parameters: StandardMtfParameters;
  readonly inputFingerprint: string;
  readonly parameterFingerprint: string;
  readonly snapshotId: string;
  readonly cacheKey: string;
}

export interface StandardMtfSnapshot {
  readonly schemaVersion: typeof STANDARD_MTF_SCHEMA_VERSION;
  readonly methodologyVersion: string;
  readonly snapshotId: string;
  readonly cacheKey: string;
  readonly identity: DeepReadonly<StandardMtfSnapshotIdentity>;

  readonly symbol: CompareSymbol;
  readonly generatedAt: number;
  readonly candleCutoff: number;
  readonly evaluationPolicy: typeof STANDARD_MTF_EVALUATION_POLICY;

  readonly timeframeResults: Readonly<Record<Timeframe, StandardMtfTimeframeResult>>;
  readonly categories: DeepReadonly<StandardMtfCategories>;
  /** Phase 4 structural context. It is evidence only; no category weight is assigned here. */
  readonly derived: DeepReadonly<Readonly<Record<Timeframe, DerivedStructuralIntelligence>>>;

  readonly marketState: OverallMarketState;
  readonly direction: Verdict;
  readonly confidence: number;
  readonly tradeability: number;

  readonly supportingEvidence: readonly StandardMtfEvidence[];
  readonly opposingEvidence: readonly StandardMtfEvidence[];

  /**
   * The canonical Board → M8 → M9 chain that owns official direction and
   * tradeability. Kept with the snapshot so consumers cannot replace it with
   * presentation-layer consensus or score calculations.
   */
  readonly canonical: DeepReadonly<{
    board: BoardDecision;
    market: MarketIntelligenceResult;
    decision: TradeDecisionResult;
  }>;
}

export interface StandardMtfIdentityInput {
  readonly symbol: CompareSymbol;
  /** UNIX seconds. No wall clock is read by the identity builder. */
  readonly candleCutoff: number;
  /** Exact, already-closed inputs for each official timeframe. */
  readonly closedCandlesByTimeframe: Readonly<Record<Timeframe, readonly Candle[]>>;
  readonly parameters: StandardMtfParameters;
  readonly methodologyVersion?: string;
}

function assertFiniteInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

/** Canonical JSON: sorted object keys, strict finite values, no undefined. */
export function canonicalStandardMtfJson(value: StandardMtfJson): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Standard MTF identity values must be finite');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStandardMtfJson).join(',')}]`;
  const object = value as Readonly<Record<string, StandardMtfJson>>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalStandardMtfJson(object[key])}`).join(',')}}`;
}

/** Stable FNV-1a digest used for cache/snapshot identity, not for security. */
export function standardMtfFingerprint(value: StandardMtfJson): string {
  const input = canonicalStandardMtfJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function candleValue(candle: Candle): StandardMtfJson {
  return [
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.takerBuyVolume ?? null,
  ];
}

export function fingerprintStandardMtfCandles(candles: readonly Candle[]): string {
  return standardMtfFingerprint(candles.map(candleValue));
}

/**
 * Creates the complete deterministic identity for an official Standard MTF
 * snapshot. Symbol, timeframe inputs, exact candles, cutoff, schema,
 * methodology, and every result-affecting parameter participate in cache
 * identity. Replays therefore resolve to the same identity as live evaluation
 * over the identical closed-bar prefix.
 */
export function createStandardMtfSnapshotIdentity(input: StandardMtfIdentityInput): DeepReadonly<StandardMtfSnapshotIdentity> {
  assertFiniteInteger(input.candleCutoff, 'candleCutoff');
  const timeframeInputs = {} as Record<Timeframe, StandardMtfTimeframeInputIdentity>;
  for (const timeframe of STANDARD_MTF_TIMEFRAMES) {
    const candles = input.closedCandlesByTimeframe[timeframe];
    let previousTime = -1;
    for (const candle of candles) {
      assertFiniteInteger(candle.time, `${timeframe} candle time`);
      if (candle.time > input.candleCutoff) throw new Error(`${timeframe} contains a candle after candleCutoff`);
      if (candle.time <= previousTime) throw new Error(`${timeframe} candles must be strictly time-ascending`);
      previousTime = candle.time;
    }
    timeframeInputs[timeframe] = {
      timeframe,
      candleCutoff: input.candleCutoff,
      firstCandleTime: candles[0]?.time ?? null,
      lastCandleTime: candles[candles.length - 1]?.time ?? null,
      candleCount: candles.length,
      candleFingerprint: fingerprintStandardMtfCandles(candles),
    };
  }

  const methodologyVersion = input.methodologyVersion ?? STANDARD_MTF_METHODOLOGY_VERSION;
  if (!methodologyVersion.trim()) throw new Error('methodologyVersion must not be empty');
  const parameterFingerprint = standardMtfFingerprint(input.parameters);
  const identityCore: Readonly<Record<string, StandardMtfJson>> = {
    schemaVersion: STANDARD_MTF_SCHEMA_VERSION,
    methodologyVersion,
    symbol: input.symbol,
    generatedAt: input.candleCutoff,
    candleCutoff: input.candleCutoff,
    evaluationPolicy: STANDARD_MTF_EVALUATION_POLICY,
    timeframeInputs: timeframeInputs as unknown as StandardMtfJson,
    parameterFingerprint,
  };
  const inputFingerprint = standardMtfFingerprint(timeframeInputs as unknown as StandardMtfJson);
  const snapshotId = `standard-mtf:${standardMtfFingerprint({ ...identityCore, inputFingerprint })}`;
  const cacheKey = [
    'standard-mtf',
    `schema=${STANDARD_MTF_SCHEMA_VERSION}`,
    `method=${methodologyVersion}`,
    `symbol=${input.symbol}`,
    `cutoff=${input.candleCutoff}`,
    `inputs=${inputFingerprint}`,
    `params=${parameterFingerprint}`,
  ].join('|');

  return deepFreezeStandardMtf({
    schemaVersion: STANDARD_MTF_SCHEMA_VERSION,
    methodologyVersion,
    symbol: input.symbol,
    generatedAt: input.candleCutoff,
    candleCutoff: input.candleCutoff,
    evaluationPolicy: STANDARD_MTF_EVALUATION_POLICY,
    timeframeInputs,
    parameters: input.parameters,
    inputFingerprint,
    parameterFingerprint,
    snapshotId,
    cacheKey,
  });
}

/**
 * Validates the duplicated routing fields at the publication boundary, then
 * freezes the complete snapshot. Engines should publish through this function
 * rather than returning a mutable object typed with a cast.
 */
export function publishStandardMtfSnapshot(snapshot: StandardMtfSnapshot): DeepReadonly<StandardMtfSnapshot> {
  const identity = snapshot.identity;
  const coherent =
    snapshot.schemaVersion === identity.schemaVersion &&
    snapshot.methodologyVersion === identity.methodologyVersion &&
    snapshot.snapshotId === identity.snapshotId &&
    snapshot.cacheKey === identity.cacheKey &&
    snapshot.symbol === identity.symbol &&
    snapshot.generatedAt === identity.generatedAt &&
    snapshot.candleCutoff === identity.candleCutoff &&
    snapshot.evaluationPolicy === identity.evaluationPolicy;
  if (!coherent) throw new Error('Standard MTF snapshot fields do not match identity');
  if (!Number.isFinite(snapshot.confidence) || snapshot.confidence < 0 || snapshot.confidence > 100) {
    throw new Error('Standard MTF confidence must be between 0 and 100');
  }
  if (!Number.isFinite(snapshot.tradeability) || snapshot.tradeability < 0 || snapshot.tradeability > 100) {
    throw new Error('Standard MTF tradeability must be between 0 and 100');
  }
  return deepFreezeStandardMtf(snapshot);
}

/** Runtime immutability for the official publication boundary. */
export function deepFreezeStandardMtf<T>(value: T): DeepReadonly<T> {
  const seen = new WeakSet<object>();
  const freeze = (current: unknown): void => {
    if (current === null || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    for (const child of Object.values(current)) freeze(child);
    Object.freeze(current);
  };
  freeze(value);
  return value as DeepReadonly<T>;
}
