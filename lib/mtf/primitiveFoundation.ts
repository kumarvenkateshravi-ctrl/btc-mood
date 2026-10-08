// Phase 3 reusable MTF primitive foundation.
//
// This module deliberately owns only normalization and composition. The
// numerical engines remain in their existing canonical homes: chart
// indicators, MTF evaluators, SMC, FVG, Session Volume Profile, and daily
// taker-side order flow. It is not a category weighting or decision engine.

import type { IndicatorPlot, IndicatorSettings } from '../indicatorFramework';
import type { IndicatorEvaluationContext } from '../indicatorEvaluation';
import { createProfileDataProvider } from '../indicators/profileDataProvider';
import type { ProfileSourceProvenance } from '../indicators/profileDataProvider';
import { classifyProfile, type ProfileClassification } from '../indicators/profileShape';
import {
  type ProfileOptions,
  type SessionMode,
  type VolumeProfile,
} from '../indicators/sessionVolumeProfile';
import { SessionVolumeProfileCache } from '../indicators/sessionVolumeProfileIncremental';
import { computeVwap } from '../indicators/vwap';
import { computeWilliamsR } from '../indicators/williamsR';
import { computeRsi } from '../indicators/rsi';
import { computeAtr } from '../indicators/atr';
import { computeBollingerBands } from '../indicators/bollingerBands';
import { computeKeltnerChannels } from '../indicators/keltnerChannels';
import { computeObv } from '../indicators/obv';
import { computeFvgDomain, DEFAULT_FVG_POLICY, type FvgDomainObject, type FvgPolicy } from '../fvg/domain';
import { computeSmc } from '../smc/engine';
import type { SmcConfig, SmcSnapshot } from '../smc/types';
import { evaluateAdx } from './indicators/adx';
import { evaluateEma } from './indicators/ema';
import { evaluateMacd } from './indicators/macd';
import { evaluateRsi } from './indicators/rsi';
import { evaluateSupertrend } from './indicators/supertrend';
import type { IndicatorSignal, Verdict } from './types';
import { verdictOf } from './types';
import * as pm from '../pineMath';
import type { Candle } from '../types';

export type PrimitiveAvailability = 'available' | 'insufficient_data' | 'unavailable';
export type PrimitiveDirection = Exclude<Verdict, 'neutral'> | 'neutral';
export type PrimitiveId =
  | 'ema' | 'sma' | 'vwap' | 'supertrend' | 'adx'
  | 'rsi' | 'macd' | 'stochRsi' | 'roc' | 'williamsR' | 'cci'
  | 'volume' | 'volumeSma' | 'obv' | 'cmf'
  | 'atr' | 'bollingerBands' | 'keltnerChannels' | 'donchianChannels' | 'standardDeviation' | 'squeeze';

export interface PrimitiveProvenance {
  readonly source: 'raw';
  readonly finality: 'closed';
  readonly symbol: string;
  readonly timeframe: string;
  readonly mode: 'live' | 'replay';
  readonly sourceRevision: string;
  readonly replayCutoff: number | null;
}

/** A small shared result contract for primitives that have no existing MTF evaluator. */
export interface PrimitiveResult {
  readonly id: PrimitiveId;
  readonly availability: PrimitiveAvailability;
  readonly reason?: string;
  readonly value: number | null;
  readonly state: string;
  /** Null is deliberate for strength-only primitives such as ADX and volume. */
  readonly direction: PrimitiveDirection | null;
  readonly strength: number | null;
  readonly confidence: number | null;
  readonly signals: readonly IndicatorSignal[];
  readonly warnings: readonly IndicatorSignal[];
  readonly diagnostics: Readonly<Record<string, number | string | boolean | null>>;
  readonly provenance: PrimitiveProvenance;
}

export type PrimitiveSettings = Readonly<Partial<Record<PrimitiveId, IndicatorSettings>>>;

export interface ClosedPrimitiveInput {
  readonly context: IndicatorEvaluationContext;
  readonly settings?: PrimitiveSettings;
}

const DEFAULT_SMA_LENGTH = 20;
const DEFAULT_VOLUME_LENGTH = 20;
const DEFAULT_CMF_LENGTH = 20;
const DEFAULT_DONCHIAN_LENGTH = 20;
const DEFAULT_ROC_LENGTH = 14;
const DEFAULT_STOCH_RSI_LENGTH = 14;

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function provenance(context: IndicatorEvaluationContext): PrimitiveProvenance {
  return freeze({
    source: 'raw',
    finality: 'closed',
    symbol: context.symbol,
    timeframe: context.timeframe,
    mode: context.mode,
    sourceRevision: context.sourceRevision,
    replayCutoff: context.replay?.cutTime ?? null,
  });
}

/** Raw, closed, and replay-bounded. Display transforms can never reach this path. */
export function closedPrimitiveCandles(context: IndicatorEvaluationContext): Candle[] {
  const closed = context.closedCandles;
  const bounded = context.replay ? closed.filter((candle) => candle.time <= context.replay!.cutTime) : closed;
  return bounded.slice();
}

function unavailable(
  id: PrimitiveId,
  context: IndicatorEvaluationContext,
  reason: string,
  availability: Exclude<PrimitiveAvailability, 'available'> = 'insufficient_data',
): PrimitiveResult {
  return freeze({
    id, availability, reason, value: null, state: availability, direction: null,
    strength: null, confidence: null, signals: freeze([]), warnings: freeze([]), diagnostics: freeze({}), provenance: provenance(context),
  });
}

function result(
  id: PrimitiveId,
  context: IndicatorEvaluationContext,
  value: number,
  state: string,
  direction: PrimitiveDirection | null,
  strength: number | null,
  confidence: number | null,
  diagnostics: Record<string, number | string | boolean | null> = {},
  signals: IndicatorSignal[] = [],
  warnings: IndicatorSignal[] = [],
): PrimitiveResult {
  return freeze({
    id, availability: 'available', value, state, direction, strength, confidence,
    diagnostics: freeze({ ...diagnostics }), signals: freeze([...signals]), warnings: freeze([...warnings]), provenance: provenance(context),
  });
}

function numberAtEnd(data: IndicatorPlot['data']): number | null {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const item = data[index];
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (item && typeof item === 'object' && 'value' in item && Number.isFinite(item.value)) return item.value;
  }
  return null;
}

function custom(id: string, settings: IndicatorSettings | undefined) {
  return settings ? { id, settings } : undefined;
}

function configuredLength(settings: IndicatorSettings | undefined, fallback: number): number {
  const candidate = Number(settings?.inputs.length);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : fallback;
}

function directional(value: number, neutral = 0): PrimitiveDirection {
  return value > neutral ? 'bullish' : value < neutral ? 'bearish' : 'neutral';
}

function indicatorResult(
  id: PrimitiveId,
  context: IndicatorEvaluationContext,
  evaluation: ReturnType<typeof evaluateEma>,
  direction: PrimitiveDirection | null,
): PrimitiveResult {
  if (evaluation.display === '—') return unavailable(id, context, 'The closed-bar history has not warmed up this indicator.');
  return result(id, context, evaluation.score, evaluation.display, direction, evaluation.strength ?? null, evaluation.confidence ?? null,
    { score: evaluation.score, display: evaluation.display }, evaluation.signals ?? [], evaluation.warnings ?? []);
}

/** Trend primitives. ADX intentionally has no direction. */
export function evaluateClosedTrendPrimitives(input: ClosedPrimitiveInput): readonly PrimitiveResult[] {
  const { context, settings = {} } = input;
  const candles = closedPrimitiveCandles(context);
  if (candles.length === 0) {
    return freeze(['ema', 'sma', 'vwap', 'supertrend', 'adx'].map((id) => unavailable(id as PrimitiveId, context, 'No closed candles are available.')));
  }

  const ema = evaluateEma(candles, settings.ema);
  const supertrend = evaluateSupertrend(candles, settings.supertrend);
  const adx = evaluateAdx(candles, settings.adx);
  const smaLength = configuredLength(settings.sma, DEFAULT_SMA_LENGTH);
  const sma = pm.sma(candles.map((candle) => candle.close), smaLength);
  const smaValue = sma[sma.length - 1];
  const vwapValue = numberAtEnd(computeVwap(candles, custom('vwap', settings.vwap)).plots[0]?.data ?? []);
  const close = candles[candles.length - 1].close;
  const trend: PrimitiveResult[] = [
    indicatorResult('ema', context, ema, verdictOf(ema.score)),
    smaValue == null
      ? unavailable('sma', context, 'SMA requires the configured number of closed candles.')
      : result('sma', context, smaValue, close > smaValue ? 'above' : close < smaValue ? 'below' : 'at', directional(close - smaValue), Math.min(100, Math.abs(close - smaValue) / Math.max(Math.abs(smaValue), 1e-9) * 10_000), null, { length: smaLength, close }),
    vwapValue == null
      ? unavailable('vwap', context, 'VWAP requires positive closed-bar volume.')
      : result('vwap', context, vwapValue, close > vwapValue ? 'above' : close < vwapValue ? 'below' : 'at', directional(close - vwapValue), Math.min(100, Math.abs(close - vwapValue) / Math.max(Math.abs(vwapValue), 1e-9) * 10_000), null, { close }),
    indicatorResult('supertrend', context, supertrend, verdictOf(supertrend.score)),
    indicatorResult('adx', context, adx, null),
  ];
  return freeze(trend);
}

/** Momentum primitives retain oscillator state; they are not a voting system. */
export function evaluateClosedMomentumPrimitives(input: ClosedPrimitiveInput): readonly PrimitiveResult[] {
  const { context, settings = {} } = input;
  const candles = closedPrimitiveCandles(context);
  if (candles.length === 0) return freeze(['rsi', 'macd', 'stochRsi', 'roc', 'williamsR', 'cci'].map((id) => unavailable(id as PrimitiveId, context, 'No closed candles are available.')));
  const rsi = evaluateRsi(candles, settings.rsi);
  const macd = evaluateMacd(candles, settings.macd);
  const rsiSeries = computeRsi(candles).plots.find((plot) => plot.id === 'rsi')?.data
    .map((item) => typeof item === 'number' ? item : null) ?? [];
  const stochLength = configuredLength(settings.stochRsi, DEFAULT_STOCH_RSI_LENGTH);
  const rocLength = configuredLength(settings.roc, DEFAULT_ROC_LENGTH);
  const cciLength = configuredLength(settings.cci, 20);
  const stoch = stochRsi(rsiSeries, stochLength);
  const rocBase = candles.length > rocLength ? candles[candles.length - 1 - rocLength].close : null;
  const roc = rocBase && rocBase !== 0 ? ((candles[candles.length - 1].close - rocBase) / rocBase) * 100 : null;
  const williams = numberAtEnd(computeWilliamsR(candles, custom('williamsR', settings.williamsR)).plots[0]?.data ?? []);
  const cci = pm.cciSeries(candles.map((candle) => (candle.high + candle.low + candle.close) / 3), cciLength);
  const cciValue = cci[cci.length - 1];
  const out: PrimitiveResult[] = [
    indicatorResult('rsi', context, rsi, verdictOf(rsi.score)),
    indicatorResult('macd', context, macd, verdictOf(macd.score)),
    stoch == null
      ? unavailable('stochRsi', context, 'Stoch RSI requires warmed RSI history plus the configured RSI window.')
      : result('stochRsi', context, stoch, stoch >= 80 ? 'overbought' : stoch <= 20 ? 'oversold' : 'normal', stoch > 50 ? 'bullish' : stoch < 50 ? 'bearish' : 'neutral', Math.abs(stoch - 50) * 2, null, { length: stochLength }),
    roc == null
      ? unavailable('roc', context, 'ROC requires the configured number of closed candles plus one reference bar.')
      : result('roc', context, roc, roc > 0 ? 'positive' : roc < 0 ? 'negative' : 'flat', directional(roc), Math.min(100, Math.abs(roc) * 10), null, { length: rocLength }),
    williams == null
      ? unavailable('williamsR', context, 'Williams %R requires 14 closed candles.')
      : result('williamsR', context, williams, williams >= -20 ? 'overbought' : williams <= -80 ? 'oversold' : 'normal', williams > -50 ? 'bullish' : williams < -50 ? 'bearish' : 'neutral', Math.abs(williams + 50) * 2, null, { length: 14 }),
    cciValue == null
      ? unavailable('cci', context, 'CCI requires the configured number of closed candles.')
      : result('cci', context, cciValue, cciValue >= 100 ? 'overbought' : cciValue <= -100 ? 'oversold' : 'normal', directional(cciValue), Math.min(100, Math.abs(cciValue) / 2), null, { length: cciLength }),
  ];
  return freeze(out);
}

function stochRsi(series: Array<number | null>, length: number): number | null {
  const values = series.filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < length) return null;
  const window = values.slice(-length);
  const low = Math.min(...window);
  const high = Math.max(...window);
  if (high === low) return 50;
  return ((window[window.length - 1] - low) / (high - low)) * 100;
}

export function evaluateClosedVolumePrimitives(input: ClosedPrimitiveInput): readonly PrimitiveResult[] {
  const { context, settings = {} } = input;
  const candles = closedPrimitiveCandles(context);
  if (candles.length === 0) return freeze(['volume', 'volumeSma', 'obv', 'cmf'].map((id) => unavailable(id as PrimitiveId, context, 'No closed candles are available.')));
  const volume = candles[candles.length - 1].volume;
  const volumeLength = configuredLength(settings.volumeSma, DEFAULT_VOLUME_LENGTH);
  const cmfLength = configuredLength(settings.cmf, DEFAULT_CMF_LENGTH);
  const volumes = candles.map((candle) => candle.volume);
  const volumeSma = pm.sma(volumes, volumeLength).at(-1);
  const obvData = computeObv(candles, custom('obv', settings.obv)).plots[0]?.data ?? [];
  const obv = numberAtEnd(obvData);
  const priorObv = numberAtEnd(obvData.slice(0, -5));
  const cmf = calculateCmf(candles, cmfLength);
  const out: PrimitiveResult[] = [
    result('volume', context, volume, 'activity', null, null, null, { volume }),
    volumeSma == null ? unavailable('volumeSma', context, 'Volume SMA requires the configured number of closed candles.') : result('volumeSma', context, volumeSma, volume > volumeSma ? 'above_average' : 'below_average', null, Math.min(100, (volume / Math.max(volumeSma, 1e-9)) * 50), null, { length: volumeLength, relativeVolume: volume / Math.max(volumeSma, 1e-9) }),
    obv == null ? unavailable('obv', context, 'OBV requires closed candles.') : result('obv', context, obv, priorObv == null ? 'initializing' : obv > priorObv ? 'rising' : obv < priorObv ? 'falling' : 'flat', priorObv == null ? null : directional(obv - priorObv), priorObv == null ? null : Math.min(100, Math.abs(obv - priorObv) / Math.max(Math.abs(obv), 1) * 1000), null),
    cmf == null ? unavailable('cmf', context, 'CMF requires the configured number of closed candles with volume.') : result('cmf', context, cmf, cmf > 0 ? 'positive' : cmf < 0 ? 'negative' : 'flat', directional(cmf), Math.min(100, Math.abs(cmf) * 100), null, { length: cmfLength }),
  ];
  return freeze(out);
}

function calculateCmf(candles: Candle[], length: number): number | null {
  if (candles.length < length) return null;
  let flowVolume = 0;
  let volume = 0;
  for (const candle of candles.slice(-length)) {
    const range = candle.high - candle.low;
    const multiplier = range === 0 ? 0 : ((candle.close - candle.low) - (candle.high - candle.close)) / range;
    flowVolume += multiplier * candle.volume;
    volume += candle.volume;
  }
  return volume > 0 ? flowVolume / volume : null;
}

export function evaluateClosedVolatilityPrimitives(input: ClosedPrimitiveInput): readonly PrimitiveResult[] {
  const { context, settings = {} } = input;
  const candles = closedPrimitiveCandles(context);
  if (candles.length === 0) return freeze(['atr', 'bollingerBands', 'keltnerChannels', 'donchianChannels', 'standardDeviation', 'squeeze'].map((id) => unavailable(id as PrimitiveId, context, 'No closed candles are available.')));
  const atr = numberAtEnd(computeAtr(candles, custom('atr', settings.atr)).plots[0]?.data ?? []);
  const bollinger = computeBollingerBands(candles, custom('bollingerBands', settings.bollingerBands)).plots;
  const keltner = computeKeltnerChannels(candles, custom('keltnerChannels', settings.keltnerChannels)).plots;
  const bbUpper = numberAtEnd(bollinger.find((plot) => plot.id === 'upper')?.data ?? []);
  const bbLower = numberAtEnd(bollinger.find((plot) => plot.id === 'lower')?.data ?? []);
  const kcUpper = numberAtEnd(keltner.find((plot) => plot.id === 'upper')?.data ?? []);
  const kcLower = numberAtEnd(keltner.find((plot) => plot.id === 'lower')?.data ?? []);
  const closes = candles.map((candle) => candle.close);
  const stddevLength = configuredLength(settings.standardDeviation, 20);
  const donchianLength = configuredLength(settings.donchianChannels, DEFAULT_DONCHIAN_LENGTH);
  const stddev = pm.stdev(closes, stddevLength).at(-1);
  const donchian = donchianWidth(candles, donchianLength);
  const hasSqueezeBands = bbUpper != null && bbLower != null && kcUpper != null && kcLower != null;
  const squeezeOn = hasSqueezeBands && bbUpper < kcUpper && bbLower > kcLower;
  const squeezeOff = hasSqueezeBands && bbUpper > kcUpper && bbLower < kcLower;
  const out: PrimitiveResult[] = [
    atr == null ? unavailable('atr', context, 'ATR(14) requires 14 closed candles.') : result('atr', context, atr, 'normal', null, null, null, { length: 14 }),
    bbUpper == null || bbLower == null ? unavailable('bollingerBands', context, 'Bollinger Bands require 20 closed candles.') : result('bollingerBands', context, bbUpper - bbLower, 'available', null, null, null, { upper: bbUpper, lower: bbLower }),
    kcUpper == null || kcLower == null ? unavailable('keltnerChannels', context, 'Keltner Channels require warmed EMA and ATR history.') : result('keltnerChannels', context, kcUpper - kcLower, 'available', null, null, null, { upper: kcUpper, lower: kcLower }),
    donchian == null ? unavailable('donchianChannels', context, 'Donchian Channels require the configured number of closed candles.') : result('donchianChannels', context, donchian, 'available', null, null, null, { length: donchianLength }),
    stddev == null ? unavailable('standardDeviation', context, 'Standard deviation requires the configured number of closed candles.') : result('standardDeviation', context, stddev, 'normal', null, null, null, { length: stddevLength }),
    bbUpper == null || bbLower == null || kcUpper == null || kcLower == null ? unavailable('squeeze', context, 'Squeeze requires valid Bollinger and Keltner bands.') : result('squeeze', context, (bbUpper - bbLower) / Math.max(kcUpper - kcLower, 1e-9), squeezeOn ? 'SQUEEZE' : squeezeOff ? 'EXPANDING' : 'NORMAL', null, squeezeOn ? 100 : squeezeOff ? 75 : 50, null, { derivedFrom: 'bollingerBands/keltnerChannels' }),
  ];
  return freeze(out);
}

function donchianWidth(candles: Candle[], length: number): number | null {
  if (candles.length < length) return null;
  const window = candles.slice(-length);
  return Math.max(...window.map((candle) => candle.high)) - Math.min(...window.map((candle) => candle.low));
}

export interface PocPeriodResult {
  readonly period: '4h' | 'daily' | 'weekly';
  readonly availability: PrimitiveAvailability;
  readonly state: 'developing' | 'finalized' | 'insufficient_data';
  readonly poc: number | null;
  readonly vah: number | null;
  readonly val: number | null;
  readonly startTime: number | null;
  readonly endTime: number | null;
  readonly shape: ProfileClassification | null;
  /** Retains the profile's estimated/authoritative source tier for derived consumers. */
  readonly source: Readonly<ProfileSourceProvenance> | null;
  readonly cacheIdentity: string;
}

export interface ClosedPocPrimitives {
  readonly fourHour: PocPeriodResult;
  readonly daily: PocPeriodResult;
  readonly weekly: PocPeriodResult;
  /** Yesterday's final profile only; it intentionally does not extend into today. */
  readonly previousDailyShape: ProfileClassification | null;
}

function profileResult(profile: VolumeProfile | undefined, period: PocPeriodResult['period'], cacheIdentity: string, source: ProfileSourceProvenance): PocPeriodResult {
  if (!profile) return freeze({ period, availability: 'insufficient_data', state: 'insufficient_data', poc: null, vah: null, val: null, startTime: null, endTime: null, shape: null, source: freeze({ ...source }), cacheIdentity });
  return freeze({ period, availability: 'available', state: 'developing', poc: profile.poc, vah: profile.vah, val: profile.val, startTime: profile.startTime, endTime: profile.endTime, shape: classifyProfile(profile), source: freeze({ ...(profile.source ?? source) }), cacheIdentity });
}

/** Creates a cache-owning POC evaluator; the cache identity includes symbol, source, replay cut, and settings. */
export function createClosedPocPrimitiveEvaluator(profileOptions: Partial<ProfileOptions> = {}) {
  let cacheIdentity: string | null = null;
  let cache: SessionVolumeProfileCache | null = null;
  return (context: IndicatorEvaluationContext): ClosedPocPrimitives => {
    const candles = closedPrimitiveCandles(context);
    const closedContext: IndicatorEvaluationContext = { ...context, rawCandles: candles, displayCandles: candles, closedCandles: candles, hasFormingBar: false };
    const provider = createProfileDataProvider({ context: closedContext });
    const scopedIdentity = JSON.stringify({ provider: provider.cacheIdentity, profileOptions });
    if (cacheIdentity !== scopedIdentity || !cache) {
      cacheIdentity = scopedIdentity;
      cache = new SessionVolumeProfileCache(scopedIdentity, provider.provenance);
    }
    const profiles = (mode: SessionMode) => cache!.provider(provider.source.candles, { mode }, profileOptions);
    const fourHour = profiles('4h');
    const daily = profiles('daily');
    const weekly = profiles('weekly');
    const previousDaily = daily.length > 1 ? daily[daily.length - 2] : undefined;
    return freeze({
      fourHour: profileResult(fourHour.at(-1), '4h', scopedIdentity, provider.provenance),
      daily: profileResult(daily.at(-1), 'daily', scopedIdentity, provider.provenance),
      weekly: profileResult(weekly.at(-1), 'weekly', scopedIdentity, provider.provenance),
      previousDailyShape: previousDaily ? classifyProfile(previousDaily) : null,
    });
  };
}

export function evaluateClosedStructurePrimitive(context: IndicatorEvaluationContext, config?: Partial<SmcConfig>): SmcSnapshot {
  const candles = closedPrimitiveCandles(context);
  const closedContext: IndicatorEvaluationContext = { ...context, rawCandles: candles, displayCandles: candles, closedCandles: candles, hasFormingBar: false };
  const snapshot = computeSmc(candles, config, closedContext);
  // Wall-clock duration is operational telemetry, not analytical evidence.
  // Remove it at this publication seam so same candles/config always publish
  // the same reusable structure result. Callers measuring performance can use
  // computeSmc directly without polluting a replayable snapshot.
  return {
    ...snapshot,
    diagnostics: { ...snapshot.diagnostics, computeMs: 0 },
  };
}

/** FVG uses the existing shared domain and keeps raw, closed-bar policy explicit. */
export function evaluateClosedFvgPrimitive(context: IndicatorEvaluationContext, policy: Partial<FvgPolicy> = {}): readonly FvgDomainObject[] {
  const candles = closedPrimitiveCandles(context);
  const resolved: FvgPolicy = { ...DEFAULT_FVG_POLICY, ...policy, source: 'raw', requireClosedBars: true, threshold: policy.threshold ?? DEFAULT_FVG_POLICY.threshold };
  return freeze(computeFvgDomain(candles, resolved, { rawCandles: candles, symbol: context.symbol, mode: context.mode, sourceRevision: context.sourceRevision, replay: context.replay ? { sessionId: context.replay.sessionId, cutTime: context.replay.cutTime } : undefined }).map((gap) => freeze({ ...gap, provenance: gap.provenance ? freeze({ ...gap.provenance }) : undefined })));
}

export interface TakerSideOrderFlowResult {
  readonly availability: 'available' | 'unavailable';
  readonly reason?: string;
  readonly buyVolume: number | null;
  readonly sellVolume: number | null;
  readonly bidAskDelta: number | null;
  readonly cumulativeDelta: number | null;
  readonly imbalance: number | null;
  readonly aggression: 'buying' | 'selling' | 'balanced' | null;
  /** Always unavailable until trade-at-price/order-book data exists. */
  readonly absorption: null;
  readonly absorptionReason: string;
  readonly provenance: PrimitiveProvenance & { readonly metricSource: 'binance-kline-taker-buy-base-volume' | 'unavailable' };
}

/**
 * Uses only supplied taker-side data. OHLCV candle colour is never used to
 * infer aggressor direction; one missing or invalid value makes the aggregate
 * unavailable rather than presenting a partial metric as complete.
 */
export function evaluateClosedTakerSideOrderFlow(context: IndicatorEvaluationContext): TakerSideOrderFlowResult {
  const candles = closedPrimitiveCandles(context);
  const base = provenance(context);
  if (candles.length === 0 || candles.some((candle) => !Number.isFinite(candle.takerBuyVolume) || (candle.takerBuyVolume as number) < 0 || (candle.takerBuyVolume as number) > candle.volume)) {
    return freeze({ availability: 'unavailable', reason: 'Taker-side buy volume is unavailable for one or more closed candles.', buyVolume: null, sellVolume: null, bidAskDelta: null, cumulativeDelta: null, imbalance: null, aggression: null, absorption: null, absorptionReason: 'Absorption requires trade-at-price or order-book data, which is not available from OHLCV/taker-volume candles.', provenance: freeze({ ...base, metricSource: 'unavailable' }) });
  }
  let buyVolume = 0;
  let sellVolume = 0;
  for (const candle of candles) {
    buyVolume += candle.takerBuyVolume as number;
    sellVolume += candle.volume - (candle.takerBuyVolume as number);
  }
  const total = buyVolume + sellVolume;
  const cumulativeDelta = buyVolume - sellVolume;
  const last = candles[candles.length - 1];
  const bidAskDelta = (last.takerBuyVolume as number) - (last.volume - (last.takerBuyVolume as number));
  const imbalance = total > 0 ? cumulativeDelta / total : 0;
  return freeze({ availability: 'available', buyVolume, sellVolume, bidAskDelta, cumulativeDelta, imbalance, aggression: imbalance > 0.02 ? 'buying' : imbalance < -0.02 ? 'selling' : 'balanced', absorption: null, absorptionReason: 'Absorption requires trade-at-price or order-book data, which is not available from OHLCV/taker-volume candles.', provenance: freeze({ ...base, metricSource: 'binance-kline-taker-buy-base-volume' }) });
}
