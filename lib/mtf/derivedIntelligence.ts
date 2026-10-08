// Phase 4 derived structural intelligence.
// These engines compose Phase 3 primitives into structural context only. They
// deliberately do not assign category weights or alter a trade decision.

import type { IndicatorEvaluationContext } from '../indicatorEvaluation';
import { anchoredVwap } from '../indicators/maFvg/anchoredVwap';
import type { FvgDomainObject } from '../fvg/domain';
import {
  closedPrimitiveCandles,
  createClosedPocPrimitiveEvaluator,
  evaluateClosedFvgPrimitive,
  type ClosedPocPrimitives,
  type PocPeriodResult,
  type PrimitiveProvenance,
} from './primitiveFoundation';

export type FvgStructuralState = 'bullish' | 'bearish' | 'mixed' | 'none' | 'insufficient_data';
export type VwapStructuralState = 'strong_bullish' | 'bullish' | 'mixed' | 'bearish' | 'strong_bearish' | 'insufficient_data';
export type PocStructuralState = 'fully_bullish' | 'bullish' | 'mixed_range' | 'bearish' | 'fully_bearish' | 'insufficient_data';
export type VwapCrossEvent = 'crossed_above' | 'crossed_below' | 'none';

export const VWAP_STRUCTURE_EQUALITY_EPSILON = 1e-8;
export const STRUCTURAL_INTELLIGENCE_VERSION = 'phase-4/1.0.0' as const;

export interface StructuralSignal {
  readonly code: string;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'strong';
}

export interface FvgSideIntelligence {
  readonly activeCount: number;
  readonly nearest: Readonly<FvgDomainObject> | null;
  /** Absolute distance to the nearest gap boundary; zero while price is inside. */
  readonly nearestDistance: number | null;
  readonly nearestDistancePct: number | null;
  readonly priceInside: boolean;
  /** FVG domain has no canonical strength metric, so this remains null. */
  readonly strength: null;
}

export interface FvgIntelligence {
  readonly state: FvgStructuralState;
  readonly bullish: FvgSideIntelligence;
  readonly bearish: FvgSideIntelligence;
  readonly dominantSide: 'bullish' | 'bearish' | 'balanced' | null;
  readonly signals: readonly StructuralSignal[];
  readonly warnings: readonly StructuralSignal[];
  readonly provenance: PrimitiveProvenance & { readonly methodologyVersion: typeof STRUCTURAL_INTELLIGENCE_VERSION };
}

export interface VwapStructureIntelligence {
  readonly state: VwapStructuralState;
  readonly price: number | null;
  readonly daily: number | null;
  readonly weekly: number | null;
  readonly priceDistanceDaily: number | null;
  readonly priceDistanceDailyPct: number | null;
  readonly priceDistanceWeekly: number | null;
  readonly priceDistanceWeeklyPct: number | null;
  readonly dailyWeeklySpread: number | null;
  readonly dailyWeeklySpreadPct: number | null;
  readonly crossover: {
    readonly event: VwapCrossEvent;
    readonly time: number | null;
    readonly barsSince: number | null;
  };
  readonly signals: readonly StructuralSignal[];
  readonly warnings: readonly StructuralSignal[];
  readonly provenance: PrimitiveProvenance & { readonly methodologyVersion: typeof STRUCTURAL_INTELLIGENCE_VERSION };
}

export interface PocStructureIntelligence {
  readonly state: PocStructuralState;
  readonly price: number | null;
  readonly fourHour: Readonly<PocPeriodResult>;
  readonly daily: Readonly<PocPeriodResult>;
  readonly weekly: Readonly<PocPeriodResult>;
  readonly ordering: readonly ('4h' | 'daily' | 'weekly')[] | null;
  readonly nearest: {
    readonly timeframe: '4h' | 'daily' | 'weekly';
    readonly price: number;
    readonly distance: number;
    readonly distancePct: number | null;
  } | null;
  readonly distances: Readonly<Record<'4h' | 'daily' | 'weekly', number | null>>;
  readonly signals: readonly StructuralSignal[];
  readonly warnings: readonly StructuralSignal[];
  readonly provenance: PrimitiveProvenance & { readonly methodologyVersion: typeof STRUCTURAL_INTELLIGENCE_VERSION };
}

export interface DerivedStructuralIntelligence {
  readonly fvg: FvgIntelligence;
  readonly vwap: VwapStructureIntelligence;
  readonly poc: PocStructureIntelligence;
}

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function provenance(context: IndicatorEvaluationContext) {
  return freeze({
    source: 'raw' as const,
    finality: 'closed' as const,
    symbol: context.symbol,
    timeframe: context.timeframe,
    mode: context.mode,
    sourceRevision: context.sourceRevision,
    replayCutoff: context.replay?.cutTime ?? null,
    methodologyVersion: STRUCTURAL_INTELLIGENCE_VERSION,
  });
}

function distanceToRange(price: number, bottom: number, top: number): number {
  if (price < bottom) return bottom - price;
  if (price > top) return price - top;
  return 0;
}

function sideIntelligence(price: number, gaps: readonly FvgDomainObject[]): FvgSideIntelligence {
  if (gaps.length === 0) return freeze({ activeCount: 0, nearest: null, nearestDistance: null, nearestDistancePct: null, priceInside: false, strength: null });
  const sorted = [...gaps].sort((left, right) => {
    const distance = distanceToRange(price, left.bottom, left.top) - distanceToRange(price, right.bottom, right.top);
    return distance || right.createdTime - left.createdTime || left.id.localeCompare(right.id);
  });
  const nearest = sorted[0];
  const nearestDistance = distanceToRange(price, nearest.bottom, nearest.top);
  return freeze({
    activeCount: gaps.length,
    nearest: freeze({ ...nearest, provenance: nearest.provenance ? freeze({ ...nearest.provenance }) : undefined }),
    nearestDistance,
    nearestDistancePct: price === 0 ? null : (nearestDistance / Math.abs(price)) * 100,
    priceInside: nearestDistance === 0,
    strength: null,
  });
}

/** Derives context from active/unmitigated FVGs only; mitigated history is ignored. */
export function deriveFvgIntelligence(
  price: number | null,
  gaps: readonly FvgDomainObject[],
  context: IndicatorEvaluationContext,
): FvgIntelligence {
  if (price == null || !Number.isFinite(price)) return freeze({
    state: 'insufficient_data', bullish: sideIntelligence(0, []), bearish: sideIntelligence(0, []), dominantSide: null,
    signals: freeze([]), warnings: freeze([{ code: 'FVG_INSUFFICIENT_DATA', message: 'A closed current price is required for FVG structure.', severity: 'warning' }]), provenance: provenance(context),
  });
  const active = gaps.filter((gap) => gap.active && (gap.lifecycle === 'active' || gap.lifecycle === 'partiallyMitigated'));
  const bullish = sideIntelligence(price, active.filter((gap) => gap.direction === 'bullish'));
  const bearish = sideIntelligence(price, active.filter((gap) => gap.direction === 'bearish'));
  let state: FvgStructuralState = 'none';
  let dominantSide: FvgIntelligence['dominantSide'] = null;
  if (active.length > 0 && bullish.activeCount > 0 && bearish.activeCount > 0) {
    if (bullish.priceInside && !bearish.priceInside) { state = 'bullish'; dominantSide = 'bullish'; }
    else if (bearish.priceInside && !bullish.priceInside) { state = 'bearish'; dominantSide = 'bearish'; }
    else { state = 'mixed'; dominantSide = 'balanced'; }
  } else if (bullish.activeCount > 0) { state = 'bullish'; dominantSide = 'bullish'; }
  else if (bearish.activeCount > 0) { state = 'bearish'; dominantSide = 'bearish'; }
  const signals: StructuralSignal[] = [];
  const warnings: StructuralSignal[] = [];
  if (state === 'bullish') signals.push({ code: 'FVG_BULLISH_ACTIVE', message: 'Active bullish FVG structure is nearest to price.', severity: bullish.priceInside ? 'strong' : 'info' });
  if (state === 'bearish') signals.push({ code: 'FVG_BEARISH_ACTIVE', message: 'Active bearish FVG structure is nearest to price.', severity: bearish.priceInside ? 'strong' : 'info' });
  if (state === 'mixed') warnings.push({ code: 'FVG_MIXED_ACTIVE', message: 'Active bullish and bearish FVGs provide conflicting structure.', severity: 'warning' });
  return freeze({ state, bullish, bearish, dominantSide, signals: freeze(signals), warnings: freeze(warnings), provenance: provenance(context) });
}

export function evaluateClosedFvgIntelligence(context: IndicatorEvaluationContext): FvgIntelligence {
  const candles = closedPrimitiveCandles(context);
  if (candles.length < 3) return deriveFvgIntelligence(null, [], context);
  return deriveFvgIntelligence(candles[candles.length - 1].close, evaluateClosedFvgPrimitive(context), context);
}

function compare(left: number, right: number, epsilon = VWAP_STRUCTURE_EQUALITY_EPSILON): -1 | 0 | 1 {
  const tolerance = Math.max(Math.abs(left), Math.abs(right), 1) * epsilon;
  return Math.abs(left - right) <= tolerance ? 0 : left > right ? 1 : -1;
}

/** The six strict Price/Daily/Weekly permutations have an explicit frozen mapping. */
export function classifyVwapStructure(price: number, daily: number, weekly: number): VwapStructuralState {
  const pd = compare(price, daily);
  const pw = compare(price, weekly);
  const dw = compare(daily, weekly);
  if (pd === 0 || pw === 0 || dw === 0) {
    if (pd === 0 && pw === 0) return 'mixed';
    if (pd >= 0 && pw >= 0) return 'bullish';
    if (pd <= 0 && pw <= 0) return 'bearish';
    return 'mixed';
  }
  // P>D>W, P>W>D, D>P>W, D>W>P, W>P>D, W>D>P respectively.
  if (pd > 0 && pw > 0 && dw > 0) return 'strong_bullish';
  if (pd > 0 && pw > 0 && dw < 0) return 'bullish';
  if (pd < 0 && pw > 0) return 'mixed';
  if (pd < 0 && pw < 0 && dw > 0) return 'bearish';
  if (pd > 0 && pw < 0) return 'mixed';
  return 'strong_bearish';
}

function crossover(daily: Array<number | null>, weekly: Array<number | null>, candles: readonly { time: number }[]) {
  let prior: -1 | 1 | null = null;
  let event: VwapCrossEvent = 'none';
  let index: number | null = null;
  for (let i = 0; i < daily.length; i += 1) {
    const d = daily[i];
    const w = weekly[i];
    if (d == null || w == null) continue;
    const sign = compare(d, w);
    // Equality is not a crossover and does not reset a prior non-equal sign.
    if (sign === 0) continue;
    if (prior != null && sign !== prior) { event = sign > 0 ? 'crossed_above' : 'crossed_below'; index = i; }
    prior = sign;
  }
  const last = daily.length - 1;
  return freeze({ event, time: index == null ? null : candles[index].time, barsSince: index == null ? null : last - index });
}

export function evaluateClosedVwapStructure(context: IndicatorEvaluationContext): VwapStructureIntelligence {
  const candles = closedPrimitiveCandles(context);
  if (candles.length === 0) return freeze({ state: 'insufficient_data', price: null, daily: null, weekly: null, priceDistanceDaily: null, priceDistanceDailyPct: null, priceDistanceWeekly: null, priceDistanceWeeklyPct: null, dailyWeeklySpread: null, dailyWeeklySpreadPct: null, crossover: freeze({ event: 'none' as const, time: null, barsSince: null }), signals: freeze([]), warnings: freeze([{ code: 'VWAP_INSUFFICIENT_DATA', message: 'No closed candles are available for VWAP structure.', severity: 'warning' }]), provenance: provenance(context) });
  const source = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
  const dailySeries = anchoredVwap(candles, source, 'session').vwap;
  const weeklySeries = anchoredVwap(candles, source, 'week').vwap;
  const price = candles[candles.length - 1].close;
  const daily = dailySeries[dailySeries.length - 1];
  const weekly = weeklySeries[weeklySeries.length - 1];
  if (daily == null || weekly == null) return freeze({ state: 'insufficient_data', price, daily: daily ?? null, weekly: weekly ?? null, priceDistanceDaily: null, priceDistanceDailyPct: null, priceDistanceWeekly: null, priceDistanceWeeklyPct: null, dailyWeeklySpread: null, dailyWeeklySpreadPct: null, crossover: crossover(dailySeries, weeklySeries, candles), signals: freeze([]), warnings: freeze([{ code: 'VWAP_INSUFFICIENT_DATA', message: 'Daily or weekly VWAP is unavailable from the closed-bar source.', severity: 'warning' }]), provenance: provenance(context) });
  const state = classifyVwapStructure(price, daily, weekly);
  const event = crossover(dailySeries, weeklySeries, candles);
  const signals: StructuralSignal[] = [];
  if (state === 'strong_bullish' || state === 'strong_bearish') signals.push({ code: 'VWAP_' + state.toUpperCase(), message: 'Price and daily/weekly VWAP are fully aligned.', severity: 'strong' });
  else if (state === 'bullish' || state === 'bearish') signals.push({ code: 'VWAP_' + state.toUpperCase(), message: 'Price is on the directional side of both VWAPs with an inverted VWAP stack.', severity: 'info' });
  const warnings = state === 'mixed' ? [{ code: 'VWAP_MIXED', message: 'Price is between or equal to the daily/weekly VWAP structure.', severity: 'warning' as const }] : [];
  return freeze({ state, price, daily, weekly, priceDistanceDaily: price - daily, priceDistanceDailyPct: ((price - daily) / Math.abs(daily)) * 100, priceDistanceWeekly: price - weekly, priceDistanceWeeklyPct: ((price - weekly) / Math.abs(weekly)) * 100, dailyWeeklySpread: daily - weekly, dailyWeeklySpreadPct: ((daily - weekly) / Math.abs(weekly)) * 100, crossover: event, signals: freeze(signals), warnings: freeze(warnings), provenance: provenance(context) });
}

function pocDirection(price: number, poc: number): -1 | 0 | 1 { return compare(price, poc); }

export function derivePocStructure(price: number | null, pocs: ClosedPocPrimitives, context: IndicatorEvaluationContext): PocStructureIntelligence {
  const entries: Array<{ timeframe: '4h' | 'daily' | 'weekly'; result: PocPeriodResult }> = [
    { timeframe: '4h', result: pocs.fourHour }, { timeframe: 'daily', result: pocs.daily }, { timeframe: 'weekly', result: pocs.weekly },
  ];
  const insufficient = price == null || entries.some(({ result }) => result.availability !== 'available' || result.poc == null);
  const distances = freeze(Object.fromEntries(entries.map(({ timeframe, result }) => [timeframe, price == null || result.poc == null ? null : Math.abs(price - result.poc)])) as Record<'4h' | 'daily' | 'weekly', number | null>);
  if (insufficient) return freeze({ state: 'insufficient_data', price, fourHour: pocs.fourHour, daily: pocs.daily, weekly: pocs.weekly, ordering: null, nearest: null, distances, signals: freeze([]), warnings: freeze([{ code: 'POC_INSUFFICIENT_DATA', message: '4H, daily, and weekly developing POCs are all required for stack structure.', severity: 'warning' }]), provenance: provenance(context) });
  const valid = entries as Array<{ timeframe: '4h' | 'daily' | 'weekly'; result: PocPeriodResult & { poc: number } }>;
  const directions = valid.map(({ result }) => pocDirection(price as number, result.poc));
  const above = directions.filter((direction) => direction > 0).length;
  const below = directions.filter((direction) => direction < 0).length;
  let state: PocStructuralState;
  if (above === 3) state = 'fully_bullish';
  else if (below === 3) state = 'fully_bearish';
  // A partial state requires both majority alignment and 4H agreement. This
  // preserves 4H importance without allowing it to override the full stack.
  else if (above === 2 && pocDirection(price as number, pocs.fourHour.poc as number) > 0) state = 'bullish';
  else if (below === 2 && pocDirection(price as number, pocs.fourHour.poc as number) < 0) state = 'bearish';
  else state = 'mixed_range';
  const ranked = [...valid].sort((left, right) => right.result.poc - left.result.poc || ({ '4h': 0, daily: 1, weekly: 2 }[left.timeframe] - ({ '4h': 0, daily: 1, weekly: 2 }[right.timeframe])));
  const nearestRanked = [...valid].sort((left, right) => Math.abs((price as number) - left.result.poc) - Math.abs((price as number) - right.result.poc) || ({ '4h': 0, daily: 1, weekly: 2 }[left.timeframe] - ({ '4h': 0, daily: 1, weekly: 2 }[right.timeframe])));
  const nearestEntry = nearestRanked[0];
  const nearestDistance = Math.abs((price as number) - nearestEntry.result.poc);
  const signals: StructuralSignal[] = [];
  const warnings: StructuralSignal[] = [];
  if (state === 'fully_bullish' || state === 'fully_bearish') signals.push({ code: 'POC_' + state.toUpperCase(), message: 'Price is on one side of the complete 4H/daily/weekly POC stack.', severity: 'strong' });
  else if (state === 'bullish' || state === 'bearish') signals.push({ code: 'POC_' + state.toUpperCase(), message: 'Two POCs and 4H POC align on one side of price.', severity: 'info' });
  else warnings.push({ code: 'POC_MIXED_RANGE', message: 'Price is trapped within the active POC stack.', severity: 'warning' });
  return freeze({ state, price, fourHour: pocs.fourHour, daily: pocs.daily, weekly: pocs.weekly, ordering: freeze(ranked.map(({ timeframe }) => timeframe)), nearest: freeze({ timeframe: nearestEntry.timeframe, price: nearestEntry.result.poc, distance: nearestDistance, distancePct: price === 0 ? null : (nearestDistance / Math.abs(price as number)) * 100 }), distances, signals: freeze(signals), warnings: freeze(warnings), provenance: provenance(context) });
}

export function evaluateClosedPocStructure(context: IndicatorEvaluationContext): PocStructureIntelligence {
  const candles = closedPrimitiveCandles(context);
  const pocs = createClosedPocPrimitiveEvaluator()(context);
  return derivePocStructure(candles[candles.length - 1]?.close ?? null, pocs, context);
}

export function evaluateClosedDerivedIntelligence(context: IndicatorEvaluationContext): DerivedStructuralIntelligence {
  return freeze({ fvg: evaluateClosedFvgIntelligence(context), vwap: evaluateClosedVwapStructure(context), poc: evaluateClosedPocStructure(context) });
}
