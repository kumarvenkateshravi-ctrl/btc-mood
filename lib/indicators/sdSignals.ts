// lib/indicators/sdSignals.ts
import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult, IndicatorLevel, IndicatorPlot, SignalSide } from '../indicatorFramework';
import type { HtfPeriod } from './htf';
import { buildZones, atrSeries, computeSdZones } from './sdZones';
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
  signalOn: 'close' | 'live';
  // Display toggles — the indicator renders the full trade setup by default.
  showSupply: boolean; showDemand: boolean; showSignals: boolean;
  showEntry: boolean; showSl: boolean; showTp1: boolean; showTp2: boolean;
  showConfidence: boolean;
}

// Default to TWO zone timeframes (D + 4H): the zone-strength score weights
// multi-timeframe confluence highest, so a single TF scores "weak" and gets
// filtered out — one TF produces no signals. D+4H lets confluence contribute.
const SD_SIGNALS_DEFAULTS: SdSignalsInputs = {
  tf1: 'D', tf2: '4H', tf3: 'None', targetFactor: 1.5,
  confirmation: 'rejection_close', minTier: 'medium',
  confidenceFloor: 55, minRR: 1.5,
  slBufferMode: 'atr', slBuffer: 0.25, tickSize: 0.1,
  maxBarsToTrigger: 20, maxBarsInTrade: 150,
  signalOn: 'close',
  showSupply: true, showDemand: true, showSignals: true,
  showEntry: true, showSl: true, showTp1: true, showTp2: true,
  showConfidence: true,
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
    closedBarOnly: inp.signalOn === 'close',
  };
}

const resolveTfs = (inp: SdSignalsInputs): HtfPeriod[] =>
  [inp.tf1, inp.tf2, inp.tf3].filter((t): t is HtfPeriod => t === '4H' || t === 'D' || t === 'W' || t === 'M');

// Signals are non-repainting (they depend only on CLOSED bars), so a live
// forming-bar tick cannot change any past signal. Rebuilding every zone +
// re-simulating on every WebSocket tick would saturate the main thread and
// hang the chart, so we cache on a cheap closed-bar signature and only
// recompute when a bar actually closes (candle count / last-closed time
// changes) or the config/context changes.
const _eventCache = new Map<string, SdSignal[]>();

function eventCacheKey(candles: Candle[], inp: SdSignalsInputs, ctx: SignalContext): string {
  const n = candles.length;
  const firstTime = n > 0 ? candles[0].time : 0;
  const lastClosedTime = n > 1 ? candles[n - 2].time : 0; // penultimate = last closed bar
  return `${n}|${firstTime}|${lastClosedTime}|${ctx.symbol}|${ctx.timeframe}|${JSON.stringify(inp)}`;
}

/** Emission boundary — every consumer (chart, dashboard, backtester, future
 *  alerts) reads SdSignal[] from here. Pure + deterministic, cached per
 *  closed-bar signature so repeated intrabar calls are O(1). */
export function computeSdSignalEvents(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  ctx: SignalContext = { symbol: '', timeframe: '' },
): SdSignal[] {
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  const tfs = resolveTfs(inp);
  if (candles.length === 0 || tfs.length === 0) return [];

  const key = eventCacheKey(candles, inp, ctx);
  const cached = _eventCache.get(key);
  if (cached) return cached;

  const zones = buildScoredZones(candles, tfs, inp.targetFactor);
  const atr = atrSeries(candles, 14);
  const events = generateSignals(candles, zones, atr, toEngineConfig(inp), ctx);

  if (_eventCache.size > 8) _eventCache.clear(); // bound memory; keys rotate as bars close
  _eventCache.set(key, events);
  return events;
}

const TRIGGERED = new Set<SdSignal['status']>(['triggered', 'tp1', 'tp2', 'stopped', 'expired']);
const LIVE = new Set<SdSignal['status']>(['triggered', 'tp1']);

/**
 * Complete trade-setup renderer: draws the same Supply/Demand zones as sd_zones
 * (reused verbatim) PLUS BUY/SELL arrows across all history and the entry/SL/TP
 * lines for the most-recent signal — so one indicator gives the full context.
 * All parts are individually toggleable.
 */
export function computeSdSignals(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const levels: IndicatorLevel[] = [];

  // 1. Zones — reuse sd_zones' exact band plots so the Signals indicator shows
  //    the same context the engine is built on. Hidden kinds keep their (empty)
  //    host line series so the entry/SL/TP price-lines still render.
  const zoneResult = computeSdZones(candles, {
    id: 'sd_zones',
    settings: { inputs: {
      tf1: inp.tf1, tf2: inp.tf2, tf3: inp.tf3, targetFactor: inp.targetFactor,
      showLabels: inp.showConfidence, showStrength: inp.showConfidence, minStrength: 0,
    } },
  } as unknown as CustomIndicatorConfig);

  const plots: IndicatorPlot[] = zoneResult.plots.map((p) => {
    const show = p.id.includes(' Su') ? inp.showSupply : inp.showDemand;
    return show ? p : { ...p, data: p.data.map(() => null) };
  });
  if (inp.showConfidence) levels.push(...(zoneResult.levels ?? []));

  // 2. Signals over ALL history — arrows via the per-bar signals[] path.
  const events = computeSdSignalEvents(candles, config);
  const triggered = events.filter((e) => e.triggeredIndex != null && TRIGGERED.has(e.status));
  if (inp.showSignals) {
    for (const e of triggered) signals[e.triggeredIndex as number] = e.side;
  }

  // 3. Full trade setup for the most-recent signal (a live one if any, else the latest).
  const active = [...triggered].reverse().find((e) => LIVE.has(e.status)) ?? triggered[triggered.length - 1];
  if (active) {
    const sideTxt = active.side === 'buy' ? 'BUY' : 'SELL';
    const entryTitle = inp.showConfidence
      ? `${sideTxt} · ★${Math.round(active.confidence)} · R${active.riskReward.toFixed(1)}`
      : `Entry ${active.entry.toFixed(1)}`;
    if (inp.showEntry) levels.push({ value: active.entry, color: '#2A62FF', lineStyle: 'solid', lineWidth: 2, title: entryTitle });
    if (inp.showSl) levels.push({ value: active.stopLoss, color: '#f5a623', lineStyle: 'dashed', lineWidth: 1, title: `SL ${active.stopLoss.toFixed(1)}` });
    if (inp.showTp1) levels.push({ value: active.takeProfit1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${active.takeProfit1.toFixed(1)}` });
    if (inp.showTp2) levels.push({ value: active.takeProfit2, color: '#22d39a', lineStyle: 'dotted', lineWidth: 1, title: `TP2 ${active.takeProfit2.toFixed(1)}` });
  }

  return { plots, signals, levels };
}
