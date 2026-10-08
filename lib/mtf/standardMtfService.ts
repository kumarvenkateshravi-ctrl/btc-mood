// Official Standard MTF publication service.
//
// This is intentionally headless: pages receive an immutable snapshot from the
// canonical Board -> M8 -> M9 chain and may only use presentation data for
// legacy visual continuity. Presentation calculations never feed the snapshot's
// direction, confidence, tradeability, market state, or evidence.

import type { CompareSymbol } from '../compare';
import { createIndicatorEvaluationContext } from '../indicatorEvaluation';
import { computeAlignmentMatrix, type AlignmentMatrix } from '../alignment';
import {
  buildSummary,
  computeConsensus,
  computeHeatmap,
  computeTimeframeDetails,
  computeWeightedScore,
  detectStructure,
  type Consensus,
  type HeatmapRow,
  type MarketStructure,
  type Summary,
  type TimeframeDetails,
  type WeightedScore,
} from '../multiTimeframe';
import { TIMEFRAMES, type Candle, type Timeframe } from '../types';
import { computeDailyWeeklyVwapCross, type DailyWeeklyVwapCross } from './vwapCrossover';
import { countActiveTodayFvgs, type ActiveTodayFvgCounts } from './fvgActivity';
import { evaluateClosedDerivedIntelligence, STRUCTURAL_INTELLIGENCE_VERSION, type DerivedStructuralIntelligence } from './derivedIntelligence';
import { computeStandardCategoryIntelligence, STANDARD_CATEGORY_INTELLIGENCE_VERSION } from './standardCategoryIntelligence';
import { computeBoardDecision } from './board/boardEngine';
import { computeTradeDecision } from './decision/decisionEngine';
import { computeFullMarketIntelligence } from './market/marketEngine';
import { buildTimeframeSnapshots } from './timeframe/snapshots';
import type { TimeframeSnapshot } from './timeframe/timeframeTypes';
import {
  STANDARD_MTF_METHODOLOGY_VERSION,
  STANDARD_MTF_TIMEFRAMES,
  createStandardMtfSnapshotIdentity,
  deepFreezeStandardMtf,
  fingerprintStandardMtfCandles,
  publishStandardMtfSnapshot,
  type DeepReadonly,
  type StandardMtfCategories,
  type StandardMtfParameters,
  type StandardMtfSnapshot,
  type StandardMtfTimeframeResult,
  type StandardMtfUnavailableCategoryResult,
} from './standardMtfContract';

/** Enough bars for the longest default alignment/category indicator (EMA 200). */
export const STANDARD_MTF_MIN_CLOSED_BARS = 200;

export interface StandardMtfBuildInput {
  readonly symbol: CompareSymbol;
  readonly candlesByTimeframe: Partial<Record<Timeframe, readonly Candle[]>>;
  /**
   * Live sources normally append a forming candle. Replay callers can pass a
   * known-closed prefix and set this false; both produce the same identity when
   * their selected closed bars are equal.
   */
  readonly hasFormingBar?: boolean;
  /** Inclusive UNIX-second replay boundary. It affects input selection only. */
  readonly replayCutoff?: number;
  /** Explicit service configuration that can affect official results. */
  readonly parameters?: StandardMtfParameters;
  readonly methodologyVersion?: string;
}

export interface StandardMtfPresentation {
  /** Legacy display-only data retained so the existing page does not redesign. */
  readonly matrix: AlignmentMatrix;
  readonly consensus: Consensus;
  readonly weighted: WeightedScore;
  readonly heatmap: readonly HeatmapRow[];
  readonly details: Readonly<Record<Timeframe, TimeframeDetails>>;
  readonly structures: Readonly<Record<Timeframe, MarketStructure>>;
  readonly summary: Summary;
  readonly vwapCrosses: Readonly<Record<Timeframe, DailyWeeklyVwapCross>>;
  readonly activeTodayFvgs: Readonly<Record<Timeframe, ActiveTodayFvgCounts>>;
}

export interface StandardMtfBuildResult {
  readonly snapshot: DeepReadonly<StandardMtfSnapshot>;
  readonly presentation: DeepReadonly<StandardMtfPresentation>;
  readonly closedCandlesByTimeframe: Readonly<Record<Timeframe, readonly Candle[]>>;
}

function insufficientCategory<Id extends keyof StandardMtfCategories>(id: Id, reason: string): StandardMtfUnavailableCategoryResult<Id> {
  return {
    id,
    availability: 'insufficient_data' as const,
    reason,
    score: null,
    verdict: null,
    confidence: null,
    strength: null,
    state: 'insufficient_data' as const,
    contributors: [] as const,
    diagnostics: {},
    signals: [] as const,
    warnings: [] as const,
  };
}

function insufficientCategories(count: number): StandardMtfCategories {
  const reason = 'Requires at least ' + STANDARD_MTF_MIN_CLOSED_BARS + ' closed bars; received ' + count + '.';
  return {
    trend: insufficientCategory('trend', reason),
    momentum: insufficientCategory('momentum', reason),
    volume: insufficientCategory('volume', reason),
    volatility: insufficientCategory('volatility', reason),
    marketStructure: insufficientCategory('marketStructure', reason),
    volumeProfile: insufficientCategory('volumeProfile', reason),
    orderFlow: insufficientCategory('orderFlow', reason),
    confluence: insufficientCategory('confluence', reason),
  };
}

/**
 * M3 remains the base confidence authority. Standard MTF publishes an explicit
 * reliability adjustment for category coverage and conflicts; unavailable XAU
 * order flow is excluded rather than treated as a failed or bearish category.
 */
function categoryAwareConfidence(base: number, categories: StandardMtfCategories): number {
  const coverageCategories = Object.entries(categories)
    .filter(([id]) => id !== 'orderFlow')
    .map(([, category]) => category);
  const coverage = coverageCategories.length === 0 ? 0 : coverageCategories.filter((category) => category.availability === 'available').length / coverageCategories.length;
  let penalty = (1 - coverage) * 20;
  if (categories.volumeProfile.availability === 'available' && categories.volumeProfile.state === 'mixed_range') penalty += 6;
  if (
    categories.trend.availability === 'available' &&
    categories.marketStructure.availability === 'available' &&
    categories.trend.verdict !== 'neutral' &&
    categories.marketStructure.verdict !== 'neutral' &&
    categories.trend.verdict !== categories.marketStructure.verdict
  ) penalty += 10;
  if (categories.confluence.availability === 'available' && categories.confluence.state === 'mixed') penalty += 4;
  return Math.round(Math.max(0, Math.min(100, base * (0.85 + coverage * 0.15) - penalty)));
}

function selectClosedCandles(input: StandardMtfBuildInput): Record<Timeframe, Candle[]> {
  const selected = {} as Record<Timeframe, Candle[]>;
  const hasFormingBar = input.hasFormingBar ?? true;
  for (const timeframe of STANDARD_MTF_TIMEFRAMES) {
    const bounded = (input.candlesByTimeframe[timeframe] ?? [])
      .filter((candle) => input.replayCutoff == null || candle.time <= input.replayCutoff)
      .map((candle) => ({ ...candle }));
    selected[timeframe] = hasFormingBar && bounded.length > 0 ? bounded.slice(0, -1) : bounded;
  }
  return selected;
}

function cutoffOf(candlesByTimeframe: Readonly<Record<Timeframe, readonly Candle[]>>): number {
  return STANDARD_MTF_TIMEFRAMES.reduce(
    (cutoff, timeframe) => Math.max(cutoff, candlesByTimeframe[timeframe].at(-1)?.time ?? 0),
    0,
  );
}

function officialParameters(input: StandardMtfBuildInput): StandardMtfParameters {
  // Selection mode is intentionally absent: a live and replay evaluation with
  // the same bounded closed inputs have the same semantic identity.
  return {
    service: 'standard-mtf-board-m8-m9/1',
    board: { schemaVersion: 1, executionTimeframe: '5m' },
    market: { schemaVersion: 1, controllerInput: '5m' },
    decision: { schemaVersion: 1, smcConfluence: 'not_applied' },
    categoryAdapters: {
      canonical: STANDARD_CATEGORY_INTELLIGENCE_VERSION,
      trend: 'grouped-price-alignment-plus-vwap-structure',
      momentum: 'grouped-direction-acceleration-extremes-context',
      volume: 'grouped-participation-and-obv-cmf-flow',
      volatility: 'non-directional-range-and-squeeze-context',
      marketStructure: 'existing-smc-only',
      volumeProfile: 'phase4-poc-structure-primary',
      orderFlow: 'valid-taker-side-only',
      confluence: 'phase4-fvg-context-only',
    },
    derivedStructuralIntelligence: STRUCTURAL_INTELLIGENCE_VERSION,
    minimumClosedBars: STANDARD_MTF_MIN_CLOSED_BARS,
    caller: input.parameters ?? {},
  } as StandardMtfParameters;
}

function evidence(
  entries: readonly { source: string; text: string }[],
  side: 'supporting' | 'opposing',
  categories: StandardMtfCategories,
  direction: StandardMtfSnapshot['direction'],
): StandardMtfSnapshot['supportingEvidence'] {
  const engineEvidence = entries.map((entry, index) => ({
    source: entry.source as 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8',
    text: entry.text,
    code: entry.source + '_' + side + '_' + index,
  }));
  const categoryEvidence = Object.values(categories).flatMap((category) => {
    if (category.availability !== 'available') return [];
    const matchesDirection = category.verdict === direction;
    const isContextWarning = category.warnings.length > 0;
    const include = side === 'supporting' ? matchesDirection : (category.verdict !== 'neutral' && category.verdict !== direction) || isContextWarning;
    if (!include) return [];
    const first = side === 'supporting' ? category.signals[0] : category.warnings[0] ?? category.signals[0];
    if (!first) return [];
    return [{
      source: 'M8' as const,
      text: category.id + ': ' + first.message,
      code: 'CATEGORY_' + category.id + '_' + side.toUpperCase(),
      category: category.id,
    }];
  });
  const seen = new Set<string>();
  return [...categoryEvidence, ...engineEvidence].filter((item) => {
    const key = item.code + ':' + item.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function presentationFor(
  closed: Record<Timeframe, Candle[]>,
  raw: Partial<Record<Timeframe, readonly Candle[]>>,
): StandardMtfPresentation {
  const matrix = computeAlignmentMatrix(closed, [...TIMEFRAMES]);
  const details = {} as Record<Timeframe, TimeframeDetails>;
  const structures = {} as Record<Timeframe, MarketStructure>;
  const vwapCrosses = {} as Record<Timeframe, DailyWeeklyVwapCross>;
  const activeTodayFvgs = {} as Record<Timeframe, ActiveTodayFvgCounts>;
  for (const timeframe of STANDARD_MTF_TIMEFRAMES) {
    details[timeframe] = computeTimeframeDetails(closed[timeframe]);
    structures[timeframe] = detectStructure(closed[timeframe]);
    // These two values are display-only legacy/chart adjuncts. They receive raw
    // inputs so their established forming-bar display behavior is unchanged.
    const source = [...(raw[timeframe] ?? [])];
    vwapCrosses[timeframe] = computeDailyWeeklyVwapCross(source);
    activeTodayFvgs[timeframe] = countActiveTodayFvgs(source, timeframe);
  }
  const weighted = computeWeightedScore(matrix, [...TIMEFRAMES]);
  return {
    matrix,
    consensus: computeConsensus(matrix, [...TIMEFRAMES]),
    weighted,
    heatmap: computeHeatmap(matrix, closed, [...TIMEFRAMES]),
    details,
    structures,
    summary: buildSummary(matrix, weighted),
    vwapCrosses,
    activeTodayFvgs,
  };
}

/** Returns the deterministic identity/cache key without evaluating M8 or M9. */
export function standardMtfSnapshotCacheKey(input: StandardMtfBuildInput): string {
  const closed = selectClosedCandles(input);
  return createStandardMtfSnapshotIdentity({
    symbol: input.symbol,
    candleCutoff: cutoffOf(closed),
    closedCandlesByTimeframe: closed,
    parameters: officialParameters(input),
    methodologyVersion: input.methodologyVersion ?? STANDARD_MTF_METHODOLOGY_VERSION,
  }).cacheKey;
}

export function buildStandardMtfSnapshot(input: StandardMtfBuildInput): StandardMtfBuildResult {
  const closed = selectClosedCandles(input);
  const candleCutoff = cutoffOf(closed);
  const identity = createStandardMtfSnapshotIdentity({
    symbol: input.symbol,
    candleCutoff,
    closedCandlesByTimeframe: closed,
    parameters: officialParameters(input),
    methodologyVersion: input.methodologyVersion ?? STANDARD_MTF_METHODOLOGY_VERSION,
  });

  const matrix = computeAlignmentMatrix(closed, [...TIMEFRAMES]);
  const board = computeBoardDecision(matrix, closed);
  const snapshots = new Map<Timeframe, TimeframeSnapshot>(
    buildTimeframeSnapshots(closed).map((snapshot) => [snapshot.timeframe, snapshot]),
  );

  const timeframeResults = {} as Record<Timeframe, StandardMtfTimeframeResult>;
  const derived = {} as Record<Timeframe, DerivedStructuralIntelligence>;
  for (const timeframe of STANDARD_MTF_TIMEFRAMES) {
    const candles = closed[timeframe];
    const enoughData = candles.length >= STANDARD_MTF_MIN_CLOSED_BARS;
    const source = candles.map((candle) => ({ ...candle }));
    const mode = input.replayCutoff == null ? 'live' : 'replay';
    const context = createIndicatorEvaluationContext({
      rawCandles: source,
      displayCandles: source,
      symbol: input.symbol,
      timeframe,
      mode,
      hasFormingBar: false,
      replay: mode === 'replay' ? { sessionId: 'standard-mtf', cutTime: candleCutoff, executionTimeframe: timeframe } : undefined,
      sourceRevision: fingerprintStandardMtfCandles(candles),
    });
    const structural = evaluateClosedDerivedIntelligence(context);
    derived[timeframe] = structural;
    timeframeResults[timeframe] = {
      timeframe,
      availability: enoughData ? 'available' : 'insufficient_data',
      ...(enoughData ? {} : { reason: 'Requires at least ' + STANDARD_MTF_MIN_CLOSED_BARS + ' closed bars; received ' + candles.length + '.' }),
      candleCutoff,
      candleCount: candles.length,
      candleFingerprint: fingerprintStandardMtfCandles(candles),
      snapshot: enoughData ? snapshots.get(timeframe) ?? null : null,
      categories: enoughData
        ? computeStandardCategoryIntelligence({ symbol: input.symbol, context, derived: structural })
        : insufficientCategories(candles.length),
    };
  }

  const executionCategories = timeframeResults[board.executionTimeframe].categories;
  // M8 remains execution-timeframe scoped by its existing Arch v2 contract.
  // Categories are passed into that canonical synthesis; they do not choose a
  // direction or bypass M9.
  const market = computeFullMarketIntelligence({ '5m': closed['5m'] }, { candlesAreClosed: true, categories: executionCategories });
  const decision = computeTradeDecision(board, market, closed, undefined, { candlesAreClosed: true });
  const snapshot = publishStandardMtfSnapshot({
    schemaVersion: identity.schemaVersion,
    methodologyVersion: identity.methodologyVersion,
    snapshotId: identity.snapshotId,
    cacheKey: identity.cacheKey,
    identity,
    symbol: input.symbol,
    generatedAt: identity.generatedAt,
    candleCutoff: identity.candleCutoff,
    evaluationPolicy: identity.evaluationPolicy,
    timeframeResults,
    categories: executionCategories,
    derived,
    marketState: market.result.headline.state,
    direction: board.bias,
    confidence: categoryAwareConfidence(market.layers.confidence.confidence, executionCategories),
    // M8 supplies the opportunity score; M9's gate is the final actionable
    // authority, so a blocked decision cannot be presented as tradeable.
    tradeability: decision.action === 'no_trade' ? 0 : market.result.opportunity.score,
    supportingEvidence: evidence(market.result.evidence.supporting, 'supporting', executionCategories, board.bias),
    opposingEvidence: evidence(market.result.evidence.opposing, 'opposing', executionCategories, board.bias),
    canonical: { board, market: market.result, decision },
  });

  return {
    snapshot,
    presentation: deepFreezeStandardMtf(presentationFor(closed, input.candlesByTimeframe)),
    closedCandlesByTimeframe: deepFreezeStandardMtf(closed),
  };
}
