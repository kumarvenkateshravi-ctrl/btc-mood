// lib/indicators/sdSignals.ts
import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorResult, IndicatorLevel, IndicatorPlot, SignalSide } from '../indicatorFramework';
import type { HtfPeriod } from './htf';
import { buildZones, atrSeries, computeSdZones, scoreZoneAtFormation } from './sdZones';
import { countRetests, DEFAULT_ZONE_STRENGTH_WEIGHTS, type Zone } from './zoneStrength';
import { resolveInputs } from './itsTemplates';
import type { IndicatorEvaluationContext } from '../indicatorEvaluation';
import { evaluationIdentity, selectIndicatorCandles } from '../indicatorEvaluation';
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
  showConfidence: boolean; showRRBox: boolean;
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
  showConfidence: true, showRRBox: true,
};

/** Build and score zones using immutable formation-time evidence. */
export function buildScoredZones(candles: Candle[], tfs: HtfPeriod[], targetFactor: number): ScoredZone[] {
  if (candles.length === 0) return [];
  const byTf = new Map<HtfPeriod, Zone[]>();
  for (const tf of tfs) byTf.set(tf, buildZones(candles, tf, targetFactor));
  const all = [...byTf.values()].flat();

  return all.map((z) => {
    const zoneType: 'supply' | 'demand' = z.kind === 'supply' || z.kind === 'supplyTarget' ? 'supply' : 'demand';
    const asOfZones = all.filter((o) => o.formedAtIndex <= z.formedAtIndex);
    const isConfluence = asOfZones.some((o) => o !== z && o.tf !== z.tf && o.kind === z.kind && z.lower <= o.upper && z.upper >= o.lower);
    const strength = z.kind === 'demand' || z.kind === 'supply'
      ? scoreZoneAtFormation(z, candles, all, DEFAULT_ZONE_STRENGTH_WEIGHTS)
      : { score: 0, tier: 'weak' as const, factors: { formationVolume: 0, rejectionStrength: 0, retests: 0, freshness: 0, confluence: 0, zoneWidth: 0 } };
    return {
      kind: z.kind, zoneType, tf: z.tf, upper: z.upper, lower: z.lower, mid: (z.upper + z.lower) / 2,
      formedAtIndex: z.formedAtIndex, formedTime: z.formedOHLC.startTime,
      strength, formationEvidence: strength, isConfluence, retestCount: countRetests(z, candles.slice(0, z.formedAtIndex + 1)),
    };
  });
}

function toEngineConfig(inp: SdSignalsInputs, hasFormingBar = true): SignalEngineConfig {
  return {
    ...DEFAULT_SIGNAL_CONFIG,
    confirmation: inp.confirmation, minTier: inp.minTier,
    confidenceFloor: inp.confidenceFloor, minRR: inp.minRR,
    slBufferMode: inp.slBufferMode, slBuffer: inp.slBuffer, tickSize: inp.tickSize,
    maxBarsToTrigger: inp.maxBarsToTrigger, maxBarsInTrade: inp.maxBarsInTrade,
    closedBarOnly: inp.signalOn === 'close' && hasFormingBar,
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

function eventCacheKey(candles: Candle[], inp: SdSignalsInputs, ctx: SignalContext, evaluationContext?: IndicatorEvaluationContext): string {
  if (evaluationContext) candles = selectIndicatorCandles(evaluationContext, 'raw', 'closed').filter((c) => !evaluationContext.replay || c.time <= evaluationContext.replay.cutTime);
  const n = candles.length;
  const firstTime = n > 0 ? candles[0].time : 0;
  const lastClosedTime = n > 1 ? candles[n - 2].time : 0; // penultimate = last closed bar
  return `${n}|${firstTime}|${lastClosedTime}|${ctx.symbol}|${ctx.timeframe}|${evaluationContext ? evaluationIdentity(evaluationContext) : 'legacy'}|${JSON.stringify(inp)}`;
}

/** Emission boundary — every consumer (chart, dashboard, backtester, future
 *  alerts) reads SdSignal[] from here. Pure + deterministic, cached per
 *  closed-bar signature so repeated intrabar calls are O(1). */
export function computeSdSignalEvents(
  candles: Candle[],
  config?: CustomIndicatorConfig,
  ctx: SignalContext = { symbol: '', timeframe: '' },
  evaluationContext?: IndicatorEvaluationContext,
): SdSignal[] {
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  const sourceCandles = evaluationContext
    ? selectIndicatorCandles(evaluationContext, 'raw', 'closed').filter((c) => !evaluationContext.replay || c.time <= evaluationContext.replay.cutTime)
    : candles;
  const tfs = resolveTfs(inp);
  if (sourceCandles.length === 0 || tfs.length === 0) return [];

  const effectiveCtx = evaluationContext ? { symbol: evaluationContext.symbol, timeframe: evaluationContext.timeframe } : ctx;
  const key = eventCacheKey(sourceCandles, inp, effectiveCtx, evaluationContext);
  const cached = _eventCache.get(key);
  if (cached) return cached;

  const zones = buildScoredZones(sourceCandles, tfs, inp.targetFactor);
  const atr = atrSeries(sourceCandles, 14);
  const engineConfig = toEngineConfig(inp, evaluationContext ? evaluationContext.hasFormingBar : true);
  const events = generateSignals(sourceCandles, zones, atr, engineConfig, effectiveCtx);

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
export function computeSdSignals(candles: Candle[], config?: CustomIndicatorConfig, computedSourcesOrContext?: Record<string, (number | null)[]> | IndicatorEvaluationContext, context?: IndicatorEvaluationContext): IndicatorResult {
  const evaluationContext = context ?? (computedSourcesOrContext && 'rawCandles' in computedSourcesOrContext ? computedSourcesOrContext as IndicatorEvaluationContext : undefined);
  const inp = resolveInputs<SdSignalsInputs>(config, SD_SIGNALS_DEFAULTS);
  if (evaluationContext) candles = selectIndicatorCandles(evaluationContext, 'raw', 'closed').filter((c) => !evaluationContext.replay || c.time <= evaluationContext.replay.cutTime);
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
  } as unknown as CustomIndicatorConfig, evaluationContext);

  const plots: IndicatorPlot[] = zoneResult.plots.map((p) => {
    const show = p.id.includes(' Su') ? inp.showSupply : inp.showDemand;
    return show ? p : { ...p, data: p.data.map(() => null) };
  });

  // 2. Signals over ALL history — arrows via the per-bar signals[] path.
  const events = computeSdSignalEvents(candles, config, { symbol: evaluationContext?.symbol ?? '', timeframe: evaluationContext?.timeframe ?? '' }, evaluationContext);
  const triggered = events.filter((e) => e.triggeredIndex != null && TRIGGERED.has(e.status));
  if (inp.showSignals) {
    for (const e of triggered) signals[e.triggeredIndex as number] = e.side;
  }

  // 2b. Anchor each signal to its source zone: the band primitive draws an
  //     origin dot + tick on the zone boundary at the trigger bar, so the
  //     arrow visibly originates from the zone that produced it.
  for (const e of triggered) {
    const plotId = `${e.zoneTf} ${e.zoneKind === 'supply' ? 'Su' : 'De'}`;
    const plot = plots.find((p) => p.id === plotId);
    if (!plot?.zoneStyle) continue;
    (plot.zoneStyle.anchors ??= []).push(e.triggeredIndex as number);
  }

  // 3. Full trade setup for the most-recent signal (a live one if any, else the latest).
  //    Mockup trade levels: entry teal, stop red, targets dashed green.
  const active = [...triggered].reverse().find((e) => LIVE.has(e.status)) ?? triggered[triggered.length - 1];
  if (active) {
    const sideTxt = active.side === 'buy' ? 'BUY' : 'SELL';
    const entryTitle = inp.showConfidence
      ? `${sideTxt} · ★ ${Math.round(active.confidence)} · R${active.riskReward.toFixed(1)}`
      : `Entry ${active.entry.toFixed(1)}`;
    if (inp.showEntry) levels.push({ value: active.entry, color: '#26c6da', lineStyle: 'solid', lineWidth: 2, title: entryTitle });
    if (inp.showSl) levels.push({ value: active.stopLoss, color: '#f23645', lineStyle: 'solid', lineWidth: 1, title: `SL ${active.stopLoss.toFixed(1)}` });
    if (inp.showTp1) levels.push({ value: active.takeProfit1, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP1 ${active.takeProfit1.toFixed(1)}` });
    if (inp.showTp2) levels.push({ value: active.takeProfit2, color: '#22d39a', lineStyle: 'dashed', lineWidth: 1, title: `TP2 ${active.takeProfit2.toFixed(1)}` });
  }

  // 4. R:R box — reward (entry→TP1) and risk (entry→SL) shading from the
  //    trigger bar forward, so the trade's geometry is visible at a glance.
  //    Plots are always emitted (null data when absent) to keep the chart's
  //    plot signature stable; they render via the legacy soft-fill band path.
  const reward = new Array<{ upper: number; lower: number } | null>(n).fill(null);
  const risk = new Array<{ upper: number; lower: number } | null>(n).fill(null);
  if (active && inp.showRRBox && active.triggeredIndex != null) {
    for (let i = active.triggeredIndex; i < n; i++) {
      reward[i] = {
        upper: Math.max(active.entry, active.takeProfit1),
        lower: Math.min(active.entry, active.takeProfit1),
      };
      risk[i] = {
        upper: Math.max(active.entry, active.stopLoss),
        lower: Math.min(active.entry, active.stopLoss),
      };
    }
  }
  plots.push({ id: 'R:R Reward', title: 'R:R Reward', color: 'rgba(34,211,154,0.05)', type: 'band', pane: 'overlay', data: reward });
  plots.push({ id: 'R:R Risk', title: 'R:R Risk', color: 'rgba(242,54,69,0.05)', type: 'band', pane: 'overlay', data: risk });

  return { plots, signals, levels };
}
