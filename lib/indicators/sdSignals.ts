// lib/indicators/sdSignals.ts
import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult, IndicatorLevel, IndicatorMarker, SignalSide } from '../indicatorFramework';
import type { HtfPeriod } from './htf';
import { buildZones, atrSeries } from './sdZones';
import { scoreZone, countRetests, DEFAULT_ZONE_STRENGTH_WEIGHTS, type Zone } from './zoneStrength';
import { resolveInputs } from './itsTemplates';
import {
  generateSignals, DEFAULT_SIGNAL_CONFIG,
  type SignalEngineConfig, type SignalContext, type ConfirmationMode, type SlBufferMode,
} from './signalEngine';
import type { ScoredZone, SdSignal } from './signalTypes';

interface SdSignalsInputs {
  tf1: string; tf2: string; tf3: string; targetFactor: number;
  confirmation: ConfirmationMode; minTier: 'medium' | 'strong';
  confidenceFloor: number; minRR: number;
  slBufferMode: SlBufferMode; slBuffer: number; tickSize: number;
  maxBarsToTrigger: number; maxBarsInTrade: number;
}

const SD_SIGNALS_DEFAULTS: SdSignalsInputs = {
  tf1: 'D', tf2: 'None', tf3: 'None', targetFactor: 1.5,
  confirmation: 'rejection_close', minTier: 'medium',
  confidenceFloor: 55, minRR: 1.5,
  slBufferMode: 'atr', slBuffer: 0.25, tickSize: 0.1,
  maxBarsToTrigger: 20, maxBarsInTrade: 150,
};

const avgPeriodVolume = (zones: Zone[]): number => {
  const seen = new Set<number>(); let sum = 0, n = 0;
  for (const z of zones) if (!seen.has(z.formedOHLC.startTime)) { seen.add(z.formedOHLC.startTime); sum += z.formedOHLC.volume; n++; }
  return n ? sum / n : 0;
};

/**
 * Build + score every zone across the configured TFs (all history).
 *
 * PHASE-1 APPROXIMATION (documented in the user-facing indicator description
 * and spec §16): zone strength/confluence is computed against the full set of
 * zones rather than only those that existed at the zone's formation bar. This
 * is faithful enough to validate the signal engine and never repaints (the
 * inputs are fixed once bars close), but it can differ slightly from a strict
 * as-of-formation score.
 * TODO(phase-2): score each zone using only information available at
 * `formedAtIndex` (as-of-formation confluence) for maximally faithful history.
 */
export function buildScoredZones(candles: Candle[], tfs: HtfPeriod[], targetFactor: number): ScoredZone[] {
  if (candles.length === 0) return [];
  const atr = atrSeries(candles, 14);
  const byTf = new Map<HtfPeriod, Zone[]>();
  for (const tf of tfs) byTf.set(tf, buildZones(candles, tf, targetFactor));
  const all = [...byTf.values()].flat();

  return all.map((z) => {
    const zoneType: 'supply' | 'demand' = z.kind === 'supply' || z.kind === 'supplyTarget' ? 'supply' : 'demand';
    const others = all.filter((o) => o !== z && o.tf !== z.tf);
    const isConfluence = others.some((o) => o.kind === z.kind && z.lower <= o.upper && z.upper >= o.lower);
    const strength = z.kind === 'demand' || z.kind === 'supply'
      ? scoreZone(z, candles, others, { avgPeriodVolume: avgPeriodVolume(byTf.get(z.tf) ?? []), atrAtFormation: atr[z.formedAtIndex] ?? 0 }, DEFAULT_ZONE_STRENGTH_WEIGHTS)
      : { score: 0, tier: 'weak' as const, factors: { formationVolume: 0, rejectionStrength: 0, retests: 0, freshness: 0, confluence: 0, zoneWidth: 0 } };
    return {
      kind: z.kind, zoneType, tf: z.tf, upper: z.upper, lower: z.lower, mid: (z.upper + z.lower) / 2,
      formedAtIndex: z.formedAtIndex, formedTime: z.formedOHLC.startTime,
      strength, isConfluence, retestCount: countRetests(z, candles),
    };
  });
}

function toEngineConfig(inp: SdSignalsInputs): SignalEngineConfig {
  return {
    ...DEFAULT_SIGNAL_CONFIG,
    confirmation: inp.confirmation, minTier: inp.minTier,
    confidenceFloor: inp.confidenceFloor, minRR: inp.minRR,
    slBufferMode: inp.slBufferMode, slBuffer: inp.slBuffer, tickSize: inp.tickSize,
    maxBarsToTrigger: inp.maxBarsToTrigger, maxBarsInTrade: inp.maxBarsInTrade,
  };
}

const resolveTfs = (inp: SdSignalsInputs): HtfPeriod[] =>
  [inp.tf1, inp.tf2, inp.tf3].filter((t): t is HtfPeriod => t === '4H' || t === 'D' || t === 'W' || t === 'M');

/** Emission boundary — every consumer (chart, dashboard, backtester, future
 *  alerts) reads SdSignal[] from here. Pure + deterministic. */
export function computeSdSignalEvents(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  ctx: SignalContext = { symbol: '', timeframe: '' },
): SdSignal[] {
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  const tfs = resolveTfs(inp);
  if (candles.length === 0 || tfs.length === 0) return [];
  const zones = buildScoredZones(candles, tfs, inp.targetFactor);
  const atr = atrSeries(candles, 14);
  return generateSignals(candles, zones, atr, toEngineConfig(inp), ctx);
}

const TRIGGERED = new Set<SdSignal['status']>(['triggered', 'tp1', 'tp2', 'stopped', 'expired']);

export function computeSdSignals(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const events = computeSdSignalEvents(candles, config);
  const markers: IndicatorMarker[] = [];
  const levels: IndicatorLevel[] = [];

  for (const e of events) {
    if (e.triggeredIndex == null || !TRIGGERED.has(e.status)) continue;
    signals[e.triggeredIndex] = e.side;
    markers.push({
      index: e.triggeredIndex,
      position: e.side === 'buy' ? 'belowBar' : 'aboveBar',
      color: e.side === 'buy' ? '#26a69a' : '#f23645',
      shape: e.side === 'buy' ? 'arrowUp' : 'arrowDown',
      text: `${e.side === 'buy' ? 'BUY' : 'SELL'} ${e.zoneTf} ★${Math.round(e.confidence)} · R${e.riskReward.toFixed(1)}`,
    });
  }

  const active = [...events].reverse().find((e) => e.status === 'triggered' || e.status === 'tp1');
  if (active) {
    levels.push({ value: active.entry, color: '#2A62FF', lineStyle: 'solid', lineWidth: 1, title: `Entry ${active.entry.toFixed(1)}` });
    levels.push({ value: active.stopLoss, color: '#f5a623', lineStyle: 'dashed', lineWidth: 1, title: `SL ${active.stopLoss.toFixed(1)}` });
    levels.push({ value: active.takeProfit1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${active.takeProfit1.toFixed(1)}` });
    levels.push({ value: active.takeProfit2, color: '#22d39a', lineStyle: 'dotted', lineWidth: 1, title: `TP2 ${active.takeProfit2.toFixed(1)}` });
  }

  return { plots: [], signals, markers, levels };
}
