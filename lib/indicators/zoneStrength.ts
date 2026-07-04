// Pure zone-importance scoring. NO imports from the framework, chart, or
// rendering — rendering reads these numbers, it never feeds them, so visual
// changes never touch this math.

import type { Candle } from '../types';
import type { HtfPeriod, HtfBucketOHLC } from './htf';

export type ZoneKind = 'supply' | 'supplyTarget' | 'demand' | 'demandTarget';

export interface Zone {
  kind: ZoneKind;
  tf: HtfPeriod;
  upper: number;
  lower: number;
  formedAtIndex: number;
  formedOHLC: HtfBucketOHLC;
  strength?: ZoneStrength;
}

export type ZoneFactor =
  | 'formationVolume' | 'rejectionStrength' | 'retests'
  | 'freshness' | 'confluence' | 'zoneWidth';

export type ZoneStrengthWeights = Record<ZoneFactor, number>;

export const DEFAULT_ZONE_STRENGTH_WEIGHTS: ZoneStrengthWeights = {
  confluence: 0.25, rejectionStrength: 0.22, formationVolume: 0.18,
  retests: 0.13, zoneWidth: 0.12, freshness: 0.10,
};

export interface ZoneStrength {
  score: number; // 0..100
  tier: 'weak' | 'medium' | 'strong';
  factors: Record<ZoneFactor, number>;
}

export interface ScoreZoneCtx {
  avgPeriodVolume: number; // mean HTF-period volume
  atrAtFormation: number;  // ATR(14) at the formation bar
  reactBars?: number;      // default 5
  freshWindow?: number;    // default 200
  widthAtrMult?: number;   // default 3
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const zoneType = (k: ZoneKind): 'supply' | 'demand' =>
  k === 'supply' || k === 'supplyTarget' ? 'supply' : 'demand';
const inZone = (z: Zone, c: Candle): boolean => c.low <= z.upper && c.high >= z.lower;

/** Distinct in-zone runs strictly after the formation bar. */
export function countRetests(zone: Zone, candles: Candle[]): number {
  let touches = 0;
  let inside = false;
  for (let i = zone.formedAtIndex + 1; i < candles.length; i++) {
    const now = inZone(zone, candles[i]);
    if (now && !inside) touches++;
    inside = now;
  }
  return touches;
}

/** Average rejection move away from the zone, in zone-heights, across touches. */
function rejectionStrength(zone: Zone, candles: Candle[], reactBars: number): number {
  const height = Math.max(1e-9, zone.upper - zone.lower);
  const type = zoneType(zone.kind);
  let inside = false;
  let sum = 0;
  let touches = 0;
  for (let i = zone.formedAtIndex + 1; i < candles.length; i++) {
    const now = inZone(zone, candles[i]);
    if (!now && inside) {
      // a touch just ended at i-1; measure the move away over the next reactBars
      let away = 0;
      for (let j = i; j < Math.min(candles.length, i + reactBars); j++) {
        const move = type === 'supply' ? zone.lower - candles[j].low : candles[j].high - zone.upper;
        if (move > away) away = move;
      }
      sum += away / height;
      touches++;
    }
    inside = now;
  }
  return touches === 0 ? 0 : sum / touches;
}

export function scoreZone(
  zone: Zone,
  candles: Candle[],
  otherActiveZones: Zone[],
  ctx: ScoreZoneCtx,
  weights: Partial<ZoneStrengthWeights> = {},
): ZoneStrength {
  const reactBars = ctx.reactBars ?? 5;
  const freshWindow = ctx.freshWindow ?? 200;
  const widthAtrMult = ctx.widthAtrMult ?? 3;
  const n = candles.length;

  const formationVolume = ctx.avgPeriodVolume > 0
    ? clamp01(zone.formedOHLC.volume / (ctx.avgPeriodVolume * 2)) : 0;

  const rej = clamp01(rejectionStrength(zone, candles, reactBars) / 3);

  const retests = clamp01(countRetests(zone, candles) / 4);

  const barsSince = Math.max(0, (n - 1) - zone.formedAtIndex);
  const freshness = clamp01(1 - barsSince / freshWindow);

  // Confluence requires the SAME exact zone kind on another TF (e.g. Daily
  // supply overlapping Weekly supply) — a projected target band must not
  // inflate a real reaction zone's score.
  let overlapCount = 0;
  for (const o of otherActiveZones) {
    if (o.kind === zone.kind && zone.lower <= o.upper && zone.upper >= o.lower) overlapCount++;
  }
  const confluence = clamp01(overlapCount / 2);

  const height = zone.upper - zone.lower;
  const zoneWidth = ctx.atrAtFormation > 0
    ? clamp01(1 - height / (ctx.atrAtFormation * widthAtrMult)) : 0;

  const factors: Record<ZoneFactor, number> = {
    formationVolume, rejectionStrength: rej, retests, freshness, confluence, zoneWidth,
  };

  const w = { ...DEFAULT_ZONE_STRENGTH_WEIGHTS, ...weights };
  const totalW = (Object.keys(factors) as ZoneFactor[]).reduce((s, k) => s + (w[k] || 0), 0);
  const score = totalW > 0
    ? 100 * (Object.keys(factors) as ZoneFactor[]).reduce((s, k) => s + w[k] * factors[k], 0) / totalW
    : 0;

  const tier: ZoneStrength['tier'] = score < 40 ? 'weak' : score <= 70 ? 'medium' : 'strong';
  return { score, tier, factors };
}
