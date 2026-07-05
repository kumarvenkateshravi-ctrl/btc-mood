import { zoneIdOf, type Side, type ScoredZone, type SignalFactor, type SignalExplanation, type SdSignal, type SdSignalStatus } from './signalTypes';
import type { Candle } from '../types';

export type SlBufferMode = 'atr' | 'percent' | 'ticks';
export type ConfirmationMode = 'touch' | 'rejection_close' | 'reversal_candle';

export interface SignalEngineConfig {
  confirmation: ConfirmationMode;
  minTier: 'medium' | 'strong';
  confidenceFloor: number;
  minRR: number;
  slBufferMode: SlBufferMode;
  slBuffer: number;
  tickSize: number;
  maxBarsToTrigger: number;
  maxBarsInTrade: number;
  /** When true, the still-forming last bar is ignored for arm/confirm/resolve
   *  so a signal only appears after its bar has CLOSED (strictly non-repainting). */
  closedBarOnly: boolean;
  wZoneStrength: number;
  wConfluence: number;
  wRiskReward: number;
  wFreshness: number;
  wFormationVolume: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalEngineConfig = {
  confirmation: 'rejection_close',
  minTier: 'medium',
  confidenceFloor: 55,
  minRR: 1.5,
  slBufferMode: 'atr',
  slBuffer: 0.25,
  tickSize: 0.1,
  maxBarsToTrigger: 20,
  maxBarsInTrade: 150,
  closedBarOnly: true,
  wZoneStrength: 0.35,
  wConfluence: 0.20,
  wRiskReward: 0.20,
  wFreshness: 0.15,
  wFormationVolume: 0.10,
};

export function computeStopLoss(
  side: Side,
  zone: { upper: number; lower: number },
  entry: number,
  atr: number,
  cfg: Pick<SignalEngineConfig, 'slBufferMode' | 'slBuffer' | 'tickSize'>,
): number {
  const buffer =
    cfg.slBufferMode === 'atr'
      ? cfg.slBuffer * atr
      : cfg.slBufferMode === 'percent'
        ? (cfg.slBuffer / 100) * entry
        : cfg.slBuffer * cfg.tickSize; // 'ticks'
  return side === 'buy' ? zone.lower - buffer : zone.upper + buffer;
}

export function computeTargets(
  side: Side,
  entry: number,
  sl: number,
  zones: ScoredZone[],
  triggeredIndex: number,
  minRR: number,
): { tp1: number; tp2: number } {
  const risk = Math.abs(entry - sl);
  const active = zones.filter((zn) => zn.formedAtIndex <= triggeredIndex);
  if (side === 'buy') {
    const supplies = active
      .filter((zn) => zn.kind === 'supply' && zn.lower > entry)
      .map((zn) => zn.lower)
      .sort((a, b) => a - b);
    const tp1 = supplies.length ? supplies[0] : entry + minRR * risk;
    const targets = active
      .filter((zn) => zn.kind === 'supplyTarget' && zn.upper > tp1)
      .map((zn) => zn.upper)
      .sort((a, b) => a - b);
    let tp2 = targets.length ? targets[0] : entry + 2 * (tp1 - entry);
    if (tp2 <= tp1) tp2 = tp1 + (tp1 - entry);
    return { tp1, tp2 };
  }
  const demands = active
    .filter((zn) => zn.kind === 'demand' && zn.upper < entry)
    .map((zn) => zn.upper)
    .sort((a, b) => b - a);
  const tp1 = demands.length ? demands[0] : entry - minRR * risk;
  const targets = active
    .filter((zn) => zn.kind === 'demandTarget' && zn.lower < tp1)
    .map((zn) => zn.lower)
    .sort((a, b) => b - a);
  let tp2 = targets.length ? targets[0] : entry - 2 * (entry - tp1);
  if (tp2 >= tp1) tp2 = tp1 - (entry - tp1);
  return { tp1, tp2 };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp100 = (x: number): number => (x < 0 ? 0 : x > 100 ? 100 : x);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const FACTOR_LABEL: Record<SignalFactor['key'], string> = {
  zoneStrength: 'Zone strength',
  confluence: 'Multi-TF confluence',
  riskReward: 'Risk/reward',
  freshness: 'Freshness',
  formationVolume: 'Formation volume',
};

export function computeConfidence(
  zone: ScoredZone,
  rr1: number,
  minRR: number,
  cfg: SignalEngineConfig,
): { confidence: number; explanation: SignalExplanation } {
  const raw: Array<Pick<SignalFactor, 'key' | 'input' | 'weight'>> = [
    { key: 'zoneStrength', input: clamp01(zone.strength.score / 100), weight: cfg.wZoneStrength },
    { key: 'confluence', input: zone.isConfluence ? 1 : 0, weight: cfg.wConfluence },
    { key: 'riskReward', input: clamp01(rr1 / 3), weight: cfg.wRiskReward },
    { key: 'freshness', input: clamp01(zone.strength.factors.freshness), weight: cfg.wFreshness },
    { key: 'formationVolume', input: clamp01(zone.strength.factors.formationVolume), weight: cfg.wFormationVolume },
  ];
  const factors: SignalFactor[] = raw
    .map((f) => ({ ...f, label: FACTOR_LABEL[f.key], contribution: f.weight * f.input * 100 }))
    .sort((a, b) => b.contribution - a.contribution);
  const confidence = clamp100(factors.reduce((s, f) => s + f.contribution, 0));

  const counterSignals: string[] = [];
  if (zone.retestCount >= 3) counterSignals.push(`retested ${zone.retestCount}×`);
  if (rr1 < minRR * 1.1) counterSignals.push('R:R near floor');
  if (zone.strength.factors.freshness < 0.3) counterSignals.push('stale zone');

  const summary =
    `${cap(zone.strength.tier)} ${zone.zoneType} zone` +
    `${zone.isConfluence ? ' with multi-TF confluence' : ''}, ${rr1.toFixed(1)}R ` +
    `(top: ${factors[0].label.toLowerCase()})`;

  return { confidence, explanation: { factors, summary, counterSignals } };
}

export interface SignalContext {
  symbol: string;
  timeframe: string;
}

const TIER_RANK: Record<'weak' | 'medium' | 'strong', number> = { weak: 0, medium: 1, strong: 2 };
const inZone = (zn: { upper: number; lower: number }, bar: Candle): boolean =>
  bar.low <= zn.upper && bar.high >= zn.lower;

function isConfirmed(side: Side, zone: ScoredZone, bar: Candle, mode: ConfirmationMode): boolean {
  if (mode === 'touch') return true;
  const rejected = side === 'buy' ? bar.close > zone.upper : bar.close < zone.lower;
  if (mode === 'rejection_close') return rejected;
  const directional = side === 'buy' ? bar.close > bar.open : bar.close < bar.open; // reversal_candle
  return rejected && directional;
}

/** Pure, non-repainting. Emits one SdSignal per zone that at least armed. */
export function generateSignals(
  candles: Candle[],
  zones: ScoredZone[],
  atr: Array<number | null>,
  cfg: SignalEngineConfig,
  ctx: SignalContext,
): SdSignal[] {
  const out: SdSignal[] = [];
  // Strict non-repaint: when closedBarOnly, never evaluate the still-forming
  // last bar — a signal only appears once its bar has closed.
  const evalLen = cfg.closedBarOnly ? candles.length - 1 : candles.length;
  const entryZones = zones.filter(
    (zn) => (zn.kind === 'demand' || zn.kind === 'supply') && TIER_RANK[zn.strength.tier] >= TIER_RANK[cfg.minTier],
  );

  for (const zone of entryZones) {
    const side: Side = zone.kind === 'demand' ? 'buy' : 'sell';
    const zoneKind: 'supply' | 'demand' = zone.kind === 'demand' ? 'demand' : 'supply';
    const zoneId = zoneIdOf(zone.tf, zoneKind, zone.formedAtIndex);

    // 1. Arm: first bar after formation that enters the zone.
    let armedIndex = -1;
    for (let i = zone.formedAtIndex + 1; i < evalLen; i++) {
      if (inZone(zone, candles[i])) { armedIndex = i; break; }
    }
    if (armedIndex === -1) continue;

    const tier: 'medium' | 'strong' = zone.strength.tier === 'strong' ? 'strong' : 'medium';
    const base: SdSignal = {
      id: `${side}:${zoneId}`, side, timeframe: ctx.timeframe, symbol: ctx.symbol,
      zoneId, zoneTf: zone.tf, zoneKind, status: 'armed',
      entry: NaN, stopLoss: NaN, takeProfit1: NaN, takeProfit2: NaN, riskReward: NaN,
      confidence: 0, explanation: { factors: [], summary: '', counterSignals: [] }, tier,
      rejectReason: null,
      armedIndex, triggeredIndex: null, resolvedIndex: null,
      createdAt: candles[armedIndex].time, resolvedAt: null,
    };

    // 2. Confirm within maxBarsToTrigger; a close beyond the far edge invalidates.
    let triggeredIndex = -1;
    for (let j = armedIndex; j < evalLen && j - armedIndex <= cfg.maxBarsToTrigger; j++) {
      const bar = candles[j];
      const broken = side === 'buy' ? bar.close < zone.lower : bar.close > zone.upper;
      if (broken) { out.push({ ...base, status: 'invalidated', rejectReason: 'zoneBroken' }); triggeredIndex = -2; break; }
      if (isConfirmed(side, zone, bar, cfg.confirmation)) { triggeredIndex = j; break; }
    }
    if (triggeredIndex === -2) continue;
    if (triggeredIndex === -1) { out.push({ ...base, status: 'expired' }); continue; }

    // 3. Levels + quality gate (entry now known).
    const entry = candles[triggeredIndex].close;
    const stopLoss = computeStopLoss(side, zone, entry, atr[triggeredIndex] ?? 0, cfg);
    const { tp1, tp2 } = computeTargets(side, entry, stopLoss, zones, triggeredIndex, cfg.minRR);
    const risk = Math.abs(entry - stopLoss);
    const riskReward = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;
    const { confidence, explanation } = computeConfidence(zone, riskReward, cfg.minRR, cfg);

    const gated: SdSignal = {
      ...base, entry, stopLoss, takeProfit1: tp1, takeProfit2: tp2, riskReward, confidence, explanation,
      triggeredIndex, createdAt: candles[triggeredIndex].time,
    };
    if (confidence < cfg.confidenceFloor || riskReward < cfg.minRR) {
      // Failed the quality gate: it armed + confirmed but never became a live
      // signal, so it is invalidated with no trigger (triggeredIndex stays null).
      // Record which gate rejected it so the UI can explain "no signals".
      const rejectReason = confidence < cfg.confidenceFloor ? 'confidence' : 'riskReward';
      out.push({ ...gated, status: 'invalidated', triggeredIndex: null, rejectReason });
      continue;
    }

    // 4. Resolve forward within maxBarsInTrade (SL first = conservative).
    let status: SdSignalStatus = 'triggered';
    let resolvedIndex: number | null = null;
    let hitTp1 = false;
    for (let k = triggeredIndex + 1; k < evalLen && k - triggeredIndex <= cfg.maxBarsInTrade; k++) {
      const bar = candles[k];
      const slHit = side === 'buy' ? bar.low <= stopLoss : bar.high >= stopLoss;
      const tp1Hit = side === 'buy' ? bar.high >= tp1 : bar.low <= tp1;
      const tp2Hit = side === 'buy' ? bar.high >= tp2 : bar.low <= tp2;
      if (slHit) { status = 'stopped'; resolvedIndex = k; break; }
      if (tp2Hit && hitTp1) { status = 'tp2'; resolvedIndex = k; break; }
      if (tp1Hit) { hitTp1 = true; status = 'tp1'; resolvedIndex = k; }
    }
    if (status === 'triggered') status = 'expired'; // triggered but never resolved in window

    out.push({
      ...gated,
      status,
      resolvedIndex,
      resolvedAt: resolvedIndex != null ? candles[resolvedIndex].time : null,
    });
  }

  return out;
}
