// Phase 5 Standard MTF category composition.
//
// This is deliberately a category adapter, not a decision engine. It consumes
// closed-bar Phase 3 primitives plus Phase 4 structural summaries and exposes
// the existing M2 CategoryResult vocabulary at the Standard MTF boundary.
// M8 remains the market-state synthesizer and M9 remains the only trade action
// authority.

import type { CompareSymbol } from '../compare';
import type { IndicatorEvaluationContext } from '../indicatorEvaluation';
import type { SmcSnapshot } from '../smc/types';
import type { Verdict } from './types';
import {
  evaluateClosedMomentumPrimitives,
  evaluateClosedStructurePrimitive,
  evaluateClosedTakerSideOrderFlow,
  evaluateClosedTrendPrimitives,
  evaluateClosedVolatilityPrimitives,
  evaluateClosedVolumePrimitives,
  type PrimitiveResult,
} from './primitiveFoundation';
import type { DerivedStructuralIntelligence } from './derivedIntelligence';
import type {
  CategoryResult,
  CategorySignal,
  MomentumState,
  TrendState,
  VolumeState,
  VolatilityState,
} from './categoryTypes';
import type {
  StandardMtfAvailableCategoryResult,
  StandardMtfCategories,
  StandardMtfCategoryId,
  StandardMtfUnavailableCategoryResult,
} from './standardMtfContract';

export const STANDARD_CATEGORY_INTELLIGENCE_VERSION = 'phase-5/1.0.0' as const;

type Available<Id extends StandardMtfCategoryId, State extends string> =
  StandardMtfAvailableCategoryResult<Id, State>;

const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
const verdict = (score: number): Verdict => score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral';
const directionScore = (direction: PrimitiveResult['direction']): number | null =>
  direction === 'bullish' ? 100 : direction === 'bearish' ? 0 : direction === 'neutral' ? 50 : null;

function unavailable<Id extends StandardMtfCategoryId>(
  id: Id,
  availability: 'unavailable' | 'insufficient_data',
  reason: string,
): StandardMtfUnavailableCategoryResult<Id> {
  return { id, availability, reason, score: null, verdict: null, confidence: null, strength: null,
    state: availability, contributors: [], diagnostics: {}, signals: [], warnings: [] };
}

function signal<Id extends StandardMtfCategoryId>(
  id: Id, code: string, message: string, severity: CategorySignal['severity'] = 'info', source: string[] = [],
): CategorySignal {
  return { category: id as CategorySignal['category'], code, message, severity, source };
}

function available<Id extends StandardMtfCategoryId, State extends string>(
  id: Id,
  score: number,
  state: State,
  confidence: number,
  strength: number,
  contributors: string[],
  diagnostics: Record<string, unknown>,
  signals: CategorySignal[],
  warnings: CategorySignal[] = [],
): Available<Id, State> {
  return {
    id, availability: 'available', score: clamp(score), verdict: verdict(score), state,
    confidence: clamp(confidence), strength: clamp(strength), contributors,
    diagnostics, signals, warnings,
  } as unknown as Available<Id, State>;
}

function primitiveMap(values: readonly PrimitiveResult[]) {
  return new Map(values.map((item) => [item.id, item]));
}

function mean(values: readonly (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value != null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function groupScore(values: readonly PrimitiveResult[]): number | null {
  return mean(values.filter((item) => item.availability === 'available').map((item) => directionScore(item.direction)));
}

function categoryTrend(context: IndicatorEvaluationContext, derived: DerivedStructuralIntelligence): StandardMtfCategories['trend'] {
  const items = primitiveMap(evaluateClosedTrendPrimitives({ context }));
  // EMA/SMA/SuperTrend are one correlated price-alignment group. The Phase 4
  // VWAP stack is one derived group, not three Daily/Weekly/Price votes.
  const alignment = groupScore((['ema', 'sma', 'supertrend'] as const).map((id) => items.get(id)!).filter(Boolean));
  const vwap = derived.vwap.state === 'strong_bullish' ? 100 : derived.vwap.state === 'bullish' ? 75
    : derived.vwap.state === 'strong_bearish' ? 0 : derived.vwap.state === 'bearish' ? 25 : 50;
  if (alignment == null && derived.vwap.state === 'insufficient_data') {
    return unavailable('trend', 'insufficient_data', 'Trend requires closed directional price-alignment or VWAP-structure evidence.');
  }
  const score = alignment == null ? vwap : derived.vwap.state === 'insufficient_data' ? alignment : alignment * 0.7 + vwap * 0.3;
  const adx = items.get('adx');
  const adxStrength = adx?.availability === 'available' ? adx.strength ?? 50 : 50;
  const priceStrength = Math.abs(score - 50) * 2;
  const state: TrendState = score >= 75 ? 'strong_bullish' : score > 55 ? 'bullish' : score <= 25 ? 'strong_bearish' : score < 45 ? 'bearish' : 'ranging';
  const warnings = derived.vwap.state === 'mixed' ? [signal('trend', 'TREND_VWAP_MIXED', 'VWAP structure is mixed; it is a capped context group, not separate votes.', 'warning', ['vwapStructure'])] : [];
  return available('trend', score, state, 65 + Math.min(25, adxStrength * 0.25), (priceStrength * 0.7) + (adxStrength * 0.3),
    ['trendPriceAlignment', 'vwapStructure', 'adxStrength'],
    { groups: ['EMA/SMA/SuperTrend', 'Phase4 VWAP structure', 'ADX strength-only'], alignmentScore: alignment, vwapState: derived.vwap.state, adxStrength },
    [signal('trend', 'TREND_' + state.toUpperCase(), 'Trend price alignment is ' + state.replace('_', ' ') + '.', state.includes('strong') ? 'strong' : 'info', ['ema', 'sma', 'supertrend', 'vwapStructure'])],
    warnings);
}

function categoryMomentum(context: IndicatorEvaluationContext): StandardMtfCategories['momentum'] {
  const items = primitiveMap(evaluateClosedMomentumPrimitives({ context }));
  // RSI/ROC and MACD/Stoch are bounded dimensions; Williams/CCI only flag
  // extremes/condition and never create a reversal vote.
  const direction = groupScore((['rsi', 'roc'] as const).map((id) => items.get(id)!).filter(Boolean));
  const acceleration = groupScore((['macd', 'stochRsi'] as const).map((id) => items.get(id)!).filter(Boolean));
  if (direction == null && acceleration == null) return unavailable('momentum', 'insufficient_data', 'Momentum direction and acceleration both lack warmed closed-bar evidence.');
  const score = direction == null ? acceleration! : acceleration == null ? direction : direction * 0.55 + acceleration * 0.45;
  const extremes = (['rsi', 'williamsR', 'cci'] as const).map((id) => items.get(id)).filter((item): item is PrimitiveResult => item?.availability === 'available' && (item.state === 'overbought' || item.state === 'oversold'));
  const state: MomentumState = score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'flat';
  const warnings = extremes.length ? [signal('momentum', 'MOMENTUM_EXTREME_CONDITION', 'Oscillator extremes are condition/risk context, not reversal direction.', 'warning', extremes.map((item) => item.id))] : [];
  return available('momentum', score, state, 60 + (direction != null && acceleration != null ? 20 : 5), Math.abs(score - 50) * 2,
    ['momentumDirection', 'momentumAcceleration', 'oscillatorExtremes'],
    { groups: ['RSI/ROC direction', 'MACD/Stoch RSI acceleration', 'Williams %R/CCI extremes'], directionScore: direction, accelerationScore: acceleration, extremeCount: extremes.length },
    [signal('momentum', 'MOMENTUM_' + state.toUpperCase(), 'Momentum direction and acceleration are ' + state + '.', Math.abs(score - 50) >= 25 ? 'strong' : 'info', ['rsi', 'roc', 'macd', 'stochRsi'])],
    warnings);
}

function categoryVolume(context: IndicatorEvaluationContext): StandardMtfCategories['volume'] {
  const items = primitiveMap(evaluateClosedVolumePrimitives({ context }));
  const flow = groupScore((['obv', 'cmf'] as const).map((id) => items.get(id)!).filter(Boolean));
  const activity = items.get('volumeSma')?.availability === 'available' ? items.get('volumeSma')!.strength : null;
  if (flow == null && activity == null) return unavailable('volume', 'insufficient_data', 'Participation has no valid closed-bar activity or flow evidence.');
  const score = flow ?? 50;
  const state: VolumeState = score > 55 ? 'buying_pressure' : score < 45 ? 'selling_pressure' : 'balanced';
  return available('volume', score, state, 55 + (flow != null ? 20 : 0) + (activity != null ? 10 : 0), activity ?? 50,
    ['participationIntensity', 'obvCmfFlow'],
    { groups: ['Volume SMA intensity', 'OBV/CMF directional flow'], flowScore: flow, activityStrength: activity },
    [signal('volume', 'VOLUME_' + state.toUpperCase(), 'Participation ' + (flow == null ? 'has no directional flow confirmation.' : 'supports ' + state.replace('_', ' ') + '.'), activity != null && activity >= 75 ? 'strong' : 'info', ['volumeSma', 'obv', 'cmf'])]);
}

function categoryVolatility(context: IndicatorEvaluationContext): StandardMtfCategories['volatility'] {
  const items = primitiveMap(evaluateClosedVolatilityPrimitives({ context }));
  const squeeze = items.get('squeeze');
  const widths = (['bollingerBands', 'keltnerChannels', 'donchianChannels', 'standardDeviation', 'atr'] as const)
    .map((id) => items.get(id)).filter((item): item is PrimitiveResult => item?.availability === 'available');
  if (!widths.length && squeeze?.availability !== 'available') return unavailable('volatility', 'insufficient_data', 'Volatility requires warmed closed-bar range or squeeze evidence.');
  const state: VolatilityState = squeeze?.state === 'SQUEEZE' ? 'compressed' : squeeze?.state === 'EXPANDING' ? 'expanding' : 'normal';
  const strength = state === 'compressed' ? 85 : state === 'expanding' ? 75 : 50;
  const warnings = state === 'compressed' ? [signal('volatility', 'VOLATILITY_SQUEEZE', 'Compression reduces readiness until a directional trigger is confirmed.', 'warning', ['squeeze'])] : [];
  return available('volatility', 50, state, 60 + Math.min(25, widths.length * 5), strength,
    ['rangeVolatility', 'squeezeState'],
    { groups: ['ATR/BB/Keltner/Donchian/standard deviation', 'squeeze state'], widthSources: widths.map((item) => item.id), squeezeState: squeeze?.state ?? null },
    [signal('volatility', 'VOLATILITY_' + state.toUpperCase(), 'Volatility condition is ' + state + '; it has no directional vote.', state === 'expanding' ? 'strong' : 'info', ['atr', 'bollingerBands', 'keltnerChannels', 'donchianChannels', 'standardDeviation', 'squeeze'])],
    warnings);
}

function categoryStructure(context: IndicatorEvaluationContext): StandardMtfCategories['marketStructure'] {
  const smc: SmcSnapshot = evaluateClosedStructurePrimitive(context);
  if (!smc.diagnostics.barsProcessed) return unavailable('marketStructure', 'insufficient_data', 'SMC has no closed bars to evaluate.');
  const bias = smc.state.swingTrend;
  const score = bias > 0 ? 80 : bias < 0 ? 20 : 50;
  const recent = [...smc.events].reverse().find((event) => event.type === 'BOS' || event.type === 'CHOCH');
  const state = bias > 0 ? 'bullish' : bias < 0 ? 'bearish' : 'ranging';
  return available('marketStructure', score, state, 65, smc.scores.structure,
    ['smcSwingRegime', 'latestConfirmedBreak', 'smcContext'],
    { authority: 'existing-smc-only', swingTrend: bias, latestBreak: recent?.type ?? null, latestBreakDirection: recent?.direction ?? null, zone: smc.state.zone, setup: smc.state.setup },
    [signal('marketStructure', 'SMC_' + state.toUpperCase(), 'Existing SMC swing regime is ' + state + '.', Math.abs(bias) === 1 ? 'strong' : 'info', ['smc'])],
    recent?.type === 'CHOCH' ? [signal('marketStructure', 'SMC_CHOCH_CONTEXT', 'Latest confirmed CHoCH is structural context within the single SMC authority.', 'warning', ['smc'])] : []);
}

function categoryProfile(derived: DerivedStructuralIntelligence): StandardMtfCategories['volumeProfile'] {
  const state = derived.poc.state;
  if (state === 'insufficient_data') return unavailable('volumeProfile', 'insufficient_data', 'POC stack requires valid 4H, daily, and weekly raw-volume profiles.');
  const score = state === 'fully_bullish' ? 100 : state === 'bullish' ? 75 : state === 'fully_bearish' ? 0 : state === 'bearish' ? 25 : 50;
  const warnings = state === 'mixed_range' ? [signal('volumeProfile', 'POC_MIXED_RANGE', 'Price is inside the POC stack; this reduces tradeability rather than opposing direction.', 'warning', ['pocStructure'])] : [];
  return available('volumeProfile', score, state, 75, Math.abs(score - 50) * 2,
    ['pocStructure', '4hPocDiagnostic', 'dailyPocDiagnostic', 'weeklyPocDiagnostic'],
    { primaryDirectionalInput: 'Phase4 POC structure', state, fourHour: derived.poc.fourHour.poc, daily: derived.poc.daily.poc, weekly: derived.poc.weekly.poc, previousDailyShape: null },
    [signal('volumeProfile', 'POC_' + state.toUpperCase(), 'Phase 4 POC stack is ' + state.replace('_', ' ') + '.', state.startsWith('fully') ? 'strong' : 'info', ['pocStructure'])],
    warnings);
}

function categoryOrderFlow(symbol: CompareSymbol, context: IndicatorEvaluationContext): StandardMtfCategories['orderFlow'] {
  if (symbol === 'XAUUSD') return unavailable('orderFlow', 'unavailable', 'XAUUSD has no compatible taker-side order-flow provider.');
  const flow = evaluateClosedTakerSideOrderFlow(context);
  if (flow.availability !== 'available') return unavailable('orderFlow', 'unavailable', flow.reason ?? 'Taker-side Order Flow is unavailable.');
  const aggression = flow.aggression ?? 'balanced';
  const score = aggression === 'buying' ? 75 : aggression === 'selling' ? 25 : 50;
  return available('orderFlow', score, aggression === 'buying' ? 'buyers' : aggression === 'selling' ? 'sellers' : 'balanced', 75, Math.abs(score - 50) * 2,
    ['validTakerSideDelta'],
    { bidAskDelta: flow.bidAskDelta, cumulativeDelta: flow.cumulativeDelta, imbalance: flow.imbalance, aggression: flow.aggression, absorption: null, provenance: flow.provenance.metricSource },
    [signal('orderFlow', 'TAKER_' + aggression.toUpperCase(), 'Valid taker-side flow is ' + aggression + '; absorption remains unavailable.', 'info', ['takerBuyVolume'])],
    [signal('orderFlow', 'ABSORPTION_UNAVAILABLE', flow.absorptionReason, 'warning', ['orderBook'])]);
}

function categoryConfluence(derived: DerivedStructuralIntelligence, volatility: StandardMtfCategories['volatility']): StandardMtfCategories['confluence'] {
  if (derived.fvg.state === 'insufficient_data') return unavailable('confluence', 'insufficient_data', 'Confluence requires closed FVG intelligence.');
  const score = derived.fvg.state === 'bullish' ? 70 : derived.fvg.state === 'bearish' ? 30 : 50;
  const warnings = [
    ...(derived.fvg.state === 'mixed' ? [signal('confluence', 'FVG_MIXED', 'Active FVGs conflict; FVG remains context, not final direction authority.', 'warning', ['fvgStructure'])] : []),
    ...(volatility.availability === 'available' && volatility.state === 'compressed' ? [signal('confluence', 'SQUEEZE_CONTEXT', 'Compression is context only and requires a trigger.', 'warning', ['squeeze'])] : []),
  ];
  return available('confluence', score, derived.fvg.state === 'none' ? 'none' : derived.fvg.state, 60, Math.abs(score - 50) * 2,
    ['phase4FvgIntelligence', 'squeezeContext'],
    { primaryDirectionalInput: 'Phase4 FVG intelligence', fvgState: derived.fvg.state, squeezeContext: volatility.availability === 'available' ? volatility.state : null, fibonacci: 'deferred-no-deterministic-anchor-policy' },
    [signal('confluence', 'FVG_' + derived.fvg.state.toUpperCase(), derived.fvg.state === 'none' ? 'No active FVG context.' : 'FVG context is ' + derived.fvg.state + '.', 'info', ['fvgStructure'])],
    warnings);
}

export interface StandardCategoryIntelligenceInput {
  readonly symbol: CompareSymbol;
  readonly context: IndicatorEvaluationContext;
  readonly derived: DerivedStructuralIntelligence;
}

/** Builds all available category intelligence from one frozen, closed-bar context. */
export function computeStandardCategoryIntelligence(input: StandardCategoryIntelligenceInput): StandardMtfCategories {
  const trend = categoryTrend(input.context, input.derived);
  const momentum = categoryMomentum(input.context);
  const volume = categoryVolume(input.context);
  const volatility = categoryVolatility(input.context);
  return {
    trend, momentum, volume, volatility,
    marketStructure: categoryStructure(input.context),
    volumeProfile: categoryProfile(input.derived),
    orderFlow: categoryOrderFlow(input.symbol, input.context),
    confluence: categoryConfluence(input.derived, volatility),
  };
}

/** A tiny adapter used in tests and documentation to confirm M2 shape reuse. */
export type StandardCategoryResult = CategoryResult | Available<StandardMtfCategoryId, string>;
