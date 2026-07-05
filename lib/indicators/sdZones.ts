// lib/indicators/sdZones.ts
import type { Candle } from '../types';
import * as pm from '../pineMath';
import { priorPeriodOHLC, type HtfPeriod, type HtfBucketOHLC } from './htf';
import {
  scoreZone, countRetests, type Zone, type ZoneStrength,
  type ZoneStrengthWeights, type ScoreZoneCtx,
} from './zoneStrength';
import type { IndicatorResult, IndicatorPlot, BandZoneStyle, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

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
    // Same exact kind on another TF (matches scoreZone's confluence rule).
    const conf = others.some((o) => o.kind === z.kind && z.lower <= o.upper && z.upper >= o.lower);
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

interface SdZonesInputs {
  tf1: string; tf2: string; tf3: string;
  targetFactor: number; showLabels: boolean; showStrength: boolean; minStrength: number;
  wConfluence: number; wRejection: number; wVolume: number;
  wRetests: number; wZoneWidth: number; wFreshness: number;
}

const SD_DEFAULTS: SdZonesInputs = {
  tf1: 'D', tf2: 'None', tf3: 'None',
  targetFactor: 1.5, showLabels: true, showStrength: true, minStrength: 0,
  wConfluence: 0.25, wRejection: 0.22, wVolume: 0.18, wRetests: 0.13, wZoneWidth: 0.12, wFreshness: 0.10,
};

const TF_LABEL: Record<string, string> = { '4H': '4H', D: 'D', W: 'W', M: 'M' };
const KIND_LABEL: Record<Zone['kind'], string> = {
  supply: 'Su', supplyTarget: 'Su T', demand: 'De', demandTarget: 'De T',
};
// Deep, muted, professional palette (mockup color system): supply = blue,
// demand = orange — STRUCTURE colors, deliberately distinct from the green/red
// DIRECTION colors reserved for signals and trade levels. Slight tone shift
// per timeframe so D and 4H zones read apart even before the label.
const SUPPLY_RGB: Record<string, string> = { '4H': '100,141,245', D: '61,109,235', W: '47,86,199', M: '38,70,163' };
const DEMAND_RGB: Record<string, string> = { '4H': '238,168,96', D: '224,138,46', W: '191,112,32', M: '158,92,26' };

const fillFor = (kind: Zone['kind'], tf: HtfPeriod): string => {
  const rgb = kind === 'supply' || kind === 'supplyTarget' ? SUPPLY_RGB[tf] : DEMAND_RGB[tf];
  const isTarget = kind === 'supplyTarget' || kind === 'demandTarget';
  return `rgba(${rgb},${isTarget ? 0.05 : 0.10})`;
};

export function computeSdZones(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<SdZonesInputs>(config, SD_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');

  const tfs = [inp.tf1, inp.tf2, inp.tf3].filter((t): t is HtfPeriod =>
    t === '4H' || t === 'D' || t === 'W' || t === 'M');

  if (n === 0 || tfs.length === 0) return { plots: [], signals };

  const weights = {
    confluence: inp.wConfluence, rejectionStrength: inp.wRejection, formationVolume: inp.wVolume,
    retests: inp.wRetests, zoneWidth: inp.wZoneWidth, freshness: inp.wFreshness,
  };
  const atr = atrSeries(candles, 14);

  // Build every zone once (needed for confluence + per-bar active lookup).
  const allByTf = new Map<HtfPeriod, Zone[]>();
  for (const tf of tfs) allByTf.set(tf, buildZones(candles, tf, inp.targetFactor));
  const allZones = [...allByTf.values()].flat();
  const current = currentZones(allZones);

  // Score current zones (for labels + opacity + minStrength filter).
  const scored = new Map<Zone, ZoneStrength>();
  for (const z of current) {
    const others = current.filter((o) => o !== z && o.tf !== z.tf);
    scored.set(z, scoreZone(z, candles, others, {
      avgPeriodVolume: avgPeriodVolume(allByTf.get(z.tf) ?? []),
      atrAtFormation: atr[z.formedAtIndex] ?? 0,
    }, weights));
  }

  const plots: IndicatorPlot[] = [];
  const kinds: Zone['kind'][] = ['supply', 'supplyTarget', 'demand', 'demandTarget'];
  const FULL_KIND: Record<'supply' | 'demand', string> = { supply: 'Supply', demand: 'Demand' };

  // Nearest decision zone: the current entry zone closest to price gets the
  // bright "focus" treatment (mockup hierarchy: current > near-term > history).
  const lastClose = candles[n - 1].close;
  let focusKey: string | null = null;
  let focusDist = Infinity;
  for (const z of current) {
    if (z.kind !== 'supply' && z.kind !== 'demand') continue;
    const st = scored.get(z);
    if ((st?.score ?? 0) < inp.minStrength) continue;
    const dist = lastClose >= z.lower && lastClose <= z.upper
      ? 0
      : Math.min(Math.abs(lastClose - z.upper), Math.abs(lastClose - z.lower));
    if (dist < focusDist) {
      focusDist = dist;
      focusKey = `${z.tf}:${z.kind}`;
    }
  }

  for (const tf of tfs) {
    const zones = allByTf.get(tf) ?? [];
    for (const kind of kinds) {
      const kindZones = zones.filter((z) => z.kind === kind);
      // per-bar active band: the most-recent zone of this kind formed at or before i
      const data = new Array<{ upper: number; lower: number } | null>(n).fill(null);
      let zi = -1;
      for (let i = 0; i < n; i++) {
        while (zi + 1 < kindZones.length && kindZones[zi + 1].formedAtIndex <= i) zi++;
        if (zi >= 0) {
          const z = kindZones[zi];
          const st = current.includes(z) ? scored.get(z) : undefined;
          // filter the CURRENT zone by minStrength (historical bars always drawn)
          if (!(current.includes(z) && (st?.score ?? 0) < inp.minStrength)) {
            data[i] = { upper: z.upper, lower: z.lower };
          }
        }
      }
      const label = `${TF_LABEL[tf]} ${KIND_LABEL[kind]}`;

      // Boundary-first zone styling: the edge FACING price carries the weight
      // (supply is approached from below → lower edge; demand from above →
      // upper edge). Timeframes are told apart by dash style; target bands
      // stay subtle context (no boundary, no label).
      const isEntry = kind === 'supply' || kind === 'demand';
      const cur = kindZones[kindZones.length - 1];
      const curScore = cur && current.includes(cur) ? scored.get(cur)?.score ?? 0 : 0;
      const zoneStyle: BandZoneStyle = {
        lineStyle: tf === '4H' ? 'dashed' : 'solid',
      };
      if (isEntry) {
        zoneStyle.boundary = kind === 'supply' ? 'lower' : 'upper';
        zoneStyle.emphasis = curScore / 100;
        zoneStyle.mid = true;
        zoneStyle.focus = focusKey === `${tf}:${kind}`;
        if (inp.showLabels && cur && curScore >= inp.minStrength) {
          const scoreTxt = inp.showStrength ? ` ★ ${Math.round(curScore)}` : '';
          zoneStyle.label = `${TF_LABEL[tf]} ${FULL_KIND[kind]}${scoreTxt}`;
        }
      }

      plots.push({ id: label, title: label, color: fillFor(kind, tf), type: 'band', pane: 'overlay', data, zoneStyle });
    }
  }

  return { plots, signals };
}
