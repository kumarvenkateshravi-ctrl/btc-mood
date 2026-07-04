// lib/indicators/sdZones.ts
import type { Candle } from '../types';
import * as pm from '../pineMath';
import { priorPeriodOHLC, type HtfPeriod, type HtfBucketOHLC } from './htf';
import {
  scoreZone, countRetests, type Zone, type ZoneStrength,
  type ZoneStrengthWeights, type ScoreZoneCtx,
} from './zoneStrength';

export interface SdZonesConfig {
  tfs: HtfPeriod[];
  targetFactor: number;
  weights?: Partial<ZoneStrengthWeights>;
}

/** Wilder ATR(length) series (null during warm-up), for zone-width scoring. */
export function atrSeries(candles: Candle[], length: number): (number | null)[] {
  const n = candles.length;
  const tr = new Array<number | null>(n).fill(null);
  for (let i = 1; i < n; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return pm.rma(tr, length);
}

/** Discrete zone objects, one Supply/Demand/Supply-Target/Demand-Target per
 *  completed HTF period, frozen at the bar the new period opens. */
export function buildZones(candles: Candle[], tf: HtfPeriod, targetFactor: number): Zone[] {
  const prior = priorPeriodOHLC(candles, tf);
  const zones: Zone[] = [];
  let last: HtfBucketOHLC | null = null;
  for (let i = 0; i < candles.length; i++) {
    const p = prior[i];
    if (p && p !== last) {
      last = p;
      const range = p.high - p.low;
      const bodyTop = Math.max(p.open, p.close);
      const bodyBottom = Math.min(p.open, p.close);
      zones.push({ kind: 'supply', tf, upper: p.high, lower: bodyTop, formedAtIndex: i, formedOHLC: p });
      zones.push({ kind: 'demand', tf, upper: bodyBottom, lower: p.low, formedAtIndex: i, formedOHLC: p });
      zones.push({ kind: 'supplyTarget', tf, upper: p.high + range * targetFactor, lower: p.high, formedAtIndex: i, formedOHLC: p });
      zones.push({ kind: 'demandTarget', tf, upper: p.low, lower: p.low - range * targetFactor, formedAtIndex: i, formedOHLC: p });
    }
  }
  return zones;
}

/** Mean volume across the distinct prior periods that formed these zones. */
function avgPeriodVolume(zones: Zone[]): number {
  const seen = new Set<number>();
  let sum = 0, count = 0;
  for (const z of zones) {
    if (!seen.has(z.formedOHLC.startTime)) {
      seen.add(z.formedOHLC.startTime);
      sum += z.formedOHLC.volume;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** The most-recently-formed zone of each (tf, kind) — the live zones. */
function currentZones(zones: Zone[]): Zone[] {
  const byKey = new Map<string, Zone>();
  for (const z of zones) {
    const key = `${z.tf}:${z.kind}`;
    const cur = byKey.get(key);
    if (!cur || z.formedAtIndex > cur.formedAtIndex) byKey.set(key, z);
  }
  return [...byKey.values()];
}

export interface ZoneSummary {
  zoneType: 'supply' | 'demand';
  kind: Zone['kind'];
  tf: HtfPeriod;
  upper: number; lower: number; mid: number;
  zoneStrength: number;
  tier: ZoneStrength['tier'];
  factors: ZoneStrength['factors'];
  distanceToPrice: number;
  isMultiTimeframeConfluence: boolean;
  retestCount: number;
  formedAtIndex: number;
  formedTime: number;
}

/** Pure engine API: build → score → summarize the current active zones. */
export function summarizeZones(candles: Candle[], cfg: SdZonesConfig): ZoneSummary[] {
  if (candles.length === 0) return [];
  const all: Zone[] = [];
  for (const tf of cfg.tfs) all.push(...buildZones(candles, tf, cfg.targetFactor));
  const current = currentZones(all);
  const atr = atrSeries(candles, 14);
  const lastClose = candles[candles.length - 1].close;

  return current.map((z) => {
    const others = current.filter((o) => o !== z && o.tf !== z.tf);
    const ctx: ScoreZoneCtx = {
      avgPeriodVolume: avgPeriodVolume(all.filter((a) => a.tf === z.tf)),
      atrAtFormation: atr[z.formedAtIndex] ?? 0,
    };
    const strength = scoreZone(z, candles, others, ctx, cfg.weights);
    const type = z.kind === 'supply' || z.kind === 'supplyTarget' ? 'supply' : 'demand';
    const mid = (z.upper + z.lower) / 2;
    const conf = others.some(
      (o) => (o.kind === 'supply' || o.kind === 'supplyTarget' ? 'supply' : 'demand') === type &&
        z.lower <= o.upper && z.upper >= o.lower,
    );
    return {
      zoneType: type, kind: z.kind, tf: z.tf,
      upper: z.upper, lower: z.lower, mid,
      zoneStrength: strength.score, tier: strength.tier, factors: strength.factors,
      distanceToPrice: lastClose > 0 ? ((mid - lastClose) / lastClose) * 100 : 0,
      isMultiTimeframeConfluence: conf,
      retestCount: countRetests(z, candles),
      formedAtIndex: z.formedAtIndex,
      formedTime: z.formedOHLC.startTime,
    };
  });
}
