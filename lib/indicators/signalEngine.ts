import type { Side, ScoredZone, SignalFactor, SignalExplanation } from './signalTypes';

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
