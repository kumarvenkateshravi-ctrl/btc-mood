// MyCryptoStack Volume Distribution Zones — ORIGINAL engine.
//
// Methodology: classic volume-profile value-area analysis — a proportional
// range-volume histogram per completed HTF period, with adaptive resolution
// and threshold, buy/sell volume estimation, and an original zone-lifecycle
// scoring model (health / acceptance / reaction / sweep / classification /
// clustering / confidence). The LuxAlgo "Supply and Demand Daily" script
// (CC BY-NC-SA) was studied as RESEARCH ONLY; no code or algorithm is ported:
// this engine bins proportional bar-range volume (not point-binned highs/
// lows), adapts bins and threshold to volatility, splits buy/sell volume,
// and scores zone lifecycles — none of which exist in that script.
//
// Pure module: no framework / chart / store imports (types + math only).

import type { Candle } from '../types';
import { periodKey, type HtfPeriod } from './htf';
import * as pm from '../pineMath';

export type VdKind = 'supply' | 'demand';
export type VdStatus = 'fresh' | 'retest1' | 'retest2' | 'weak' | 'consumed' | 'broken';
export type VdClassification = 'institutional' | 'exhaustion' | 'major' | 'minor';

/** AI-ready structured zone (Enhancement 12) — the shared contract consumed by
 *  the renderer, the signal layer, and (later) the Context/Decision engine. */
export interface VdZone {
  id: string; // `${tf}:${kind}:${periodStartTime}`
  kind: VdKind;
  tf: HtfPeriod;
  upper: number;
  lower: number;
  midpoint: number;
  weightedAverage: number;
  volume: number;      // volume accumulated inside the zone
  buyVolume: number;
  sellVolume: number;
  delta: number;       // buy − sell
  imbalance: number;   // delta / volume, −1..1
  threshold: number;   // adaptive threshold % used for this period
  volShare: number;    // zone volume / period volume, 0..1
  periodRange: number; // source period high − low (measured-move basis)
  formedAtIndex: number; // first bar AFTER the source period closed
  formedTime: number;
  endIndex: number | null; // last active bar (break/replacement); null = still active
  // ---- lifecycle intelligence ----
  status: VdStatus;
  health: number;         // 100 → 0
  touches: number;
  acceptanceBars: number; // longest run of consecutive closes inside
  reactionScore: number;  // 0..1 avg bounce quality across touch episodes
  swept: boolean;         // liquidity sweep seen (pierce + reclaim)
  classification: VdClassification;
  clustered: boolean;     // overlaps a same-kind zone on another TF
  confidence: number;     // 0..100
  brokenAtIndex: number | null;
}

export interface VdConfig {
  tfs: HtfPeriod[];
  thrBase: number;        // base threshold % (adaptive around this)
  volMult: number;        // rejection volume > volMult × SMA20(vol)
  maxRetests: number;     // signal gate: touches so far ≤ maxRetests
  minHealth: number;      // signal gate: health at bar ≥ minHealth
  confidenceFloor: number;// signal gate: bar-time confidence ≥ floor
  minRR: number;          // signal gate: R:R to TP1 ≥ minRR
  slBufferAtr: number;    // SL buffer beyond the distal edge, in ATR14
  acceptanceBarsLimit: number; // consecutive closes inside ⇒ consumed
  trendFilter: boolean;   // buy only above EMA50 / sell only below
}

export const VD_DEFAULTS: VdConfig = {
  tfs: ['D', '4H'],
  thrBase: 10,
  volMult: 1.2,
  maxRetests: 3,
  minHealth: 40,
  confidenceFloor: 50,
  minRR: 1.2,
  slBufferAtr: 0.25,
  acceptanceBarsLimit: 3,
  trendFilter: true,
};

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x: number): number => clamp(x, 0, 1);

// ---------------------------------------------------------------------------
// Period scaffolding
// ---------------------------------------------------------------------------

export interface PeriodSlice {
  start: number; // first bar index of the period
  end: number;   // last bar index of the period (inclusive)
  key: number;
}

/** Contiguous COMPLETED periods only: the trailing (possibly still-forming)
 *  period is dropped, so zones freeze at period close — non-repainting. */
export function splitCompletedPeriods(candles: Candle[], tf: HtfPeriod): PeriodSlice[] {
  const out: PeriodSlice[] = [];
  if (candles.length === 0) return out;
  let start = 0;
  let key = periodKey(candles[0].time, tf);
  for (let i = 1; i < candles.length; i++) {
    const k = periodKey(candles[i].time, tf);
    if (k !== key) {
      out.push({ start, end: i - 1, key });
      start = i;
      key = k;
    }
  }
  // The trailing bucket [start .. n-1] is the live period — intentionally omitted.
  return out;
}

// ---------------------------------------------------------------------------
// Adaptive parameters (Enhancements 3 + 4)
// ---------------------------------------------------------------------------

/** Adaptive bin count: more volatility resolution when the period range spans
 *  many ATRs. `clamp(round((range / atr) × 6), 30, 120)`; 50 when ATR unknown. */
export function adaptiveBins(range: number, atr: number | null): number {
  if (atr == null || atr <= 0 || range <= 0) return 50;
  return clamp(Math.round((range / atr) * 6), 30, 120);
}

/** Adaptive threshold %: wide periods demand more volume share to qualify.
 *  `clamp(thrBase × range / avgRange, 7, 15)`; thrBase when no history. */
export function adaptiveThreshold(range: number, avgRange: number | null, thrBase: number): number {
  if (avgRange == null || avgRange <= 0 || range <= 0) return thrBase;
  return clamp(thrBase * (range / avgRange), 7, 15);
}

// ---------------------------------------------------------------------------
// Histogram + zone extraction (the core)
// ---------------------------------------------------------------------------

export interface RawZone {
  upper: number;
  lower: number;
  midpoint: number;
  weightedAverage: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  volShare: number;
}

export interface PeriodZones {
  supply: RawZone | null;
  demand: RawZone | null;
  bins: number;
  threshold: number;
  periodHigh: number;
  periodLow: number;
  periodVolume: number;
}

/**
 * Build the period's proportional range-volume histogram and extract the
 * supply/demand zones: accumulate binned volume inward from each extreme
 * until the cumulative share reaches `threshold`% of period volume.
 */
export function extractPeriodZones(
  candles: Candle[],
  slice: PeriodSlice,
  bins: number,
  threshold: number,
): PeriodZones {
  let pHigh = -Infinity;
  let pLow = Infinity;
  let pVol = 0;
  for (let i = slice.start; i <= slice.end; i++) {
    pHigh = Math.max(pHigh, candles[i].high);
    pLow = Math.min(pLow, candles[i].low);
    pVol += candles[i].volume;
  }
  const range = pHigh - pLow;
  const empty: PeriodZones = {
    supply: null, demand: null, bins, threshold,
    periodHigh: pHigh, periodLow: pLow, periodVolume: pVol,
  };
  if (range <= 0 || pVol <= 0 || bins < 1) return empty;

  const r = range / bins;
  const vol = new Array<number>(bins).fill(0);
  const buy = new Array<number>(bins).fill(0);

  // Distribute each bar's volume proportionally across every bin its
  // [low, high] range overlaps; split buy/sell by close position in range.
  for (let i = slice.start; i <= slice.end; i++) {
    const c = candles[i];
    const span = c.high - c.low;
    const buyFrac = span > 0 ? (c.close - c.low) / span : 0.5;
    if (span <= 0) {
      const b = clamp(Math.floor((c.close - pLow) / r), 0, bins - 1);
      vol[b] += c.volume;
      buy[b] += c.volume * buyFrac;
      continue;
    }
    const bLo = clamp(Math.floor((c.low - pLow) / r), 0, bins - 1);
    const bHi = clamp(Math.floor((c.high - pLow) / r - 1e-9), 0, bins - 1);
    for (let b = bLo; b <= bHi; b++) {
      const binLo = pLow + b * r;
      const binHi = binLo + r;
      const overlap = Math.min(c.high, binHi) - Math.max(c.low, binLo);
      if (overlap <= 0) continue;
      const frac = overlap / span;
      vol[b] += c.volume * frac;
      buy[b] += c.volume * frac * buyFrac;
    }
  }

  const need = (threshold / 100) * pVol;

  const build = (kind: VdKind): RawZone | null => {
    let cum = 0;
    let cumBuy = 0;
    let wnum = 0;
    let edgeBin = -1;
    if (kind === 'supply') {
      for (let b = bins - 1; b >= 0; b--) {
        cum += vol[b];
        cumBuy += buy[b];
        wnum += (pLow + (b + 0.5) * r) * vol[b];
        if (cum >= need) { edgeBin = b; break; }
      }
    } else {
      for (let b = 0; b < bins; b++) {
        cum += vol[b];
        cumBuy += buy[b];
        wnum += (pLow + (b + 0.5) * r) * vol[b];
        if (cum >= need) { edgeBin = b; break; }
      }
    }
    if (edgeBin < 0 || cum <= 0) return null;
    const upper = kind === 'supply' ? pHigh : pLow + (edgeBin + 1) * r;
    const lower = kind === 'supply' ? pLow + edgeBin * r : pLow;
    return {
      upper, lower,
      midpoint: (upper + lower) / 2,
      weightedAverage: wnum / cum,
      volume: cum,
      buyVolume: cumBuy,
      sellVolume: cum - cumBuy,
      volShare: cum / pVol,
    };
  };

  return { ...empty, supply: build('supply'), demand: build('demand') };
}

// ---------------------------------------------------------------------------
// Zone lifecycle intelligence (Enhancements 1, 7, 8, 9, 10, 11 + confidence 5)
// ---------------------------------------------------------------------------

const inZone = (z: { upper: number; lower: number }, c: Candle): boolean =>
  c.low <= z.upper && c.high >= z.lower;
const closeInside = (z: { upper: number; lower: number }, c: Candle): boolean =>
  c.close >= z.lower && c.close <= z.upper;

interface LifecycleResult {
  touches: number;
  acceptanceBars: number;
  reactionScore: number;
  swept: boolean;
  status: VdStatus;
  brokenAtIndex: number | null;
  consumedAtIndex: number | null;
}

/** Walk bars [from..to] (closed bars) applying the lifecycle rules. */
export function walkZoneLifecycle(
  candles: Candle[],
  zone: { upper: number; lower: number; kind: VdKind },
  from: number,
  to: number,
  atr: Array<number | null>,
  acceptanceLimit: number,
): LifecycleResult {
  let touches = 0;
  let insideCloseStreak = 0;
  let maxStreak = 0;
  let swept = false;
  let brokenAtIndex: number | null = null;
  let consumedAtIndex: number | null = null;
  const reactions: number[] = [];
  let wasIn = false;

  for (let i = from; i <= to && i < candles.length; i++) {
    const c = candles[i];
    const nowIn = inZone(zone, c);
    if (nowIn && !wasIn) touches++;

    // Acceptance (E8): consecutive closes inside ⇒ price accepted the level.
    if (closeInside(zone, c)) {
      insideCloseStreak++;
      maxStreak = Math.max(maxStreak, insideCloseStreak);
      if (insideCloseStreak >= acceptanceLimit && consumedAtIndex == null) consumedAtIndex = i;
    } else {
      insideCloseStreak = 0;
    }

    // Liquidity sweep (E9): wick pierces the distal edge, close reclaims.
    if (zone.kind === 'demand' && c.low < zone.lower && c.close >= zone.lower) swept = true;
    if (zone.kind === 'supply' && c.high > zone.upper && c.close <= zone.upper) swept = true;

    // Broken: candle BODY fully beyond the distal boundary.
    const bodyLo = Math.min(c.open, c.close);
    const bodyHi = Math.max(c.open, c.close);
    const broke = zone.kind === 'demand' ? bodyHi < zone.lower : bodyLo > zone.upper;
    if (broke) { brokenAtIndex = i; break; }

    // Reaction (E10): when a touch episode ends, measure the bounce (MFE over
    // the next 5 closed bars, in ATRs, in the rejection direction).
    if (!nowIn && wasIn) {
      const a = atr[i] ?? 0;
      if (a > 0) {
        let mfe = 0;
        for (let k = i; k <= Math.min(i + 4, to); k++) {
          mfe = Math.max(
            mfe,
            zone.kind === 'demand' ? candles[k].high - zone.upper : zone.lower - candles[k].low,
          );
        }
        reactions.push(clamp01(mfe / (2 * a)));
      }
    }
    wasIn = nowIn;
  }

  const reactionScore = reactions.length
    ? reactions.reduce((s, x) => s + x, 0) / reactions.length
    : 0;

  let status: VdStatus;
  if (brokenAtIndex != null) status = 'broken';
  else if (consumedAtIndex != null) status = 'consumed';
  else if (touches === 0) status = 'fresh';
  else if (touches === 1) status = 'retest1';
  else if (touches === 2) status = 'retest2';
  else status = 'weak';

  return { touches, acceptanceBars: maxStreak, reactionScore, swept, status, brokenAtIndex, consumedAtIndex };
}

/** Health ladder (E1): 100 → 0. */
export function zoneHealth(status: VdStatus, touches: number): number {
  if (status === 'broken') return 0;
  if (status === 'consumed') return 10;
  return Math.max(20, 100 - 20 * touches);
}

/** Classification (E7), priority order. */
export function classifyZone(
  volShare: number,
  threshold: number,
  imbalance: number,
  isPeriodExtreme: boolean,
): VdClassification {
  const thrFrac = threshold / 100;
  if (volShare >= 1.5 * thrFrac && Math.abs(imbalance) >= 0.2) return 'institutional';
  if (isPeriodExtreme) return 'exhaustion';
  if (volShare >= 1.2 * thrFrac) return 'major';
  return 'minor';
}

/** Confidence blend (E5), 0..100. All inputs normalized 0..1. */
export function zoneConfidence(f: {
  volQuality: number;
  health: number;      // 0..100
  reaction: number;
  trendAlign: number;  // 0 | 1
  clustered: number;   // 0 | 1
  proximity: number;
}): number {
  return Math.round(
    100 * clamp01(
      0.20 * clamp01(f.volQuality) +
      0.25 * clamp01(f.health / 100) +
      0.15 * clamp01(f.reaction) +
      0.15 * (f.trendAlign ? 1 : 0) +
      0.15 * (f.clustered ? 1 : 0) +
      0.10 * clamp01(f.proximity),
    ),
  );
}

// ---------------------------------------------------------------------------
// Full zone build (all TFs, with intelligence)
// ---------------------------------------------------------------------------

/** Wilder ATR(14) (self-contained so the engine stays pure). */
export function vdAtr(candles: Candle[], length = 14): (number | null)[] {
  const n = candles.length;
  const tr = new Array<number | null>(n).fill(null);
  for (let i = 1; i < n; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return pm.rma(tr, length);
}

export function buildVdZones(candles: Candle[], cfg: VdConfig): VdZone[] {
  const n = candles.length;
  if (n === 0 || cfg.tfs.length === 0) return [];
  const atr = vdAtr(candles);
  const closes = candles.map((c) => c.close);
  const ema50 = pm.ema(closes, 50);
  const lastClosed = n - 1; // callers pass closed candles; the live bar is handled by the signal layer
  const zones: VdZone[] = [];

  for (const tf of cfg.tfs) {
    const slices = splitCompletedPeriods(candles, tf);
    const ranges: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];

    for (let s = 0; s < slices.length; s++) {
      const slice = slices[s];
      let pHigh = -Infinity, pLow = Infinity;
      for (let i = slice.start; i <= slice.end; i++) {
        pHigh = Math.max(pHigh, candles[i].high);
        pLow = Math.min(pLow, candles[i].low);
      }
      const range = pHigh - pLow;

      // Rolling stats over the PRIOR 20 periods (no lookahead).
      const prior = ranges.slice(-20);
      const avgRange = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
      const prior20Highs = highs.slice(-20);
      const prior20Lows = lows.slice(-20);
      const isHighExtreme = prior20Highs.length > 0 && pHigh > Math.max(...prior20Highs);
      const isLowExtreme = prior20Lows.length > 0 && pLow < Math.min(...prior20Lows);
      ranges.push(range);
      highs.push(pHigh);
      lows.push(pLow);

      const bins = adaptiveBins(range, atr[slice.end]);
      const threshold = adaptiveThreshold(range, avgRange, cfg.thrBase);
      const pz = extractPeriodZones(candles, slice, bins, threshold);
      const formedAtIndex = slice.end + 1;
      if (formedAtIndex >= n) continue; // period closed on the final bar — zone starts next bar

      // Active until the NEXT period's zone of the same (tf, kind) forms.
      const nextFormed = s + 1 < slices.length ? slices[s + 1].end + 1 : null;

      for (const kind of ['supply', 'demand'] as const) {
        const raw = kind === 'supply' ? pz.supply : pz.demand;
        if (!raw) continue;
        const windowEnd = nextFormed != null ? Math.min(nextFormed - 1, lastClosed) : lastClosed;
        const life = walkZoneLifecycle(
          candles, { upper: raw.upper, lower: raw.lower, kind },
          formedAtIndex, windowEnd, atr, cfg.acceptanceBarsLimit,
        );
        const endIndex = life.brokenAtIndex ?? (nextFormed != null ? nextFormed - 1 : null);
        const health = zoneHealth(life.status, life.touches);

        zones.push({
          id: `${tf}:${kind}:${candles[slice.start].time}`,
          kind, tf,
          upper: raw.upper, lower: raw.lower,
          midpoint: raw.midpoint, weightedAverage: raw.weightedAverage,
          volume: raw.volume, buyVolume: raw.buyVolume, sellVolume: raw.sellVolume,
          delta: raw.buyVolume - raw.sellVolume,
          imbalance: raw.volume > 0 ? (raw.buyVolume - raw.sellVolume) / raw.volume : 0,
          threshold, volShare: raw.volShare, periodRange: range,
          formedAtIndex, formedTime: candles[slice.start].time, endIndex,
          status: life.status, health,
          touches: life.touches, acceptanceBars: life.acceptanceBars,
          reactionScore: life.reactionScore, swept: life.swept,
          classification: classifyZone(
            raw.volShare, threshold,
            raw.volume > 0 ? (raw.buyVolume - raw.sellVolume) / raw.volume : 0,
            kind === 'supply' ? isHighExtreme : isLowExtreme,
          ),
          clustered: false, // set below, needs the full set
          confidence: 0,    // set below (depends on clustering)
          brokenAtIndex: life.brokenAtIndex,
        });
      }
    }
  }

  // Clustering (E11): same-kind zones on DIFFERENT TFs whose price ranges and
  // active windows overlap.
  for (const z of zones) {
    z.clustered = zones.some((o) =>
      o !== z && o.kind === z.kind && o.tf !== z.tf &&
      z.lower <= o.upper && z.upper >= o.lower &&
      (z.endIndex ?? n - 1) >= o.formedAtIndex && (o.endIndex ?? n - 1) >= z.formedAtIndex,
    );
  }

  // Confidence (E5) — after clustering is known.
  for (const z of zones) {
    const evalIdx = Math.min(z.endIndex ?? lastClosed, lastClosed);
    const emaAt = ema50[evalIdx];
    const closeAt = candles[evalIdx].close;
    const trendAlign = emaAt != null && (z.kind === 'demand' ? closeAt > emaAt : closeAt < emaAt) ? 1 : 0;
    const aAt = atr[evalIdx] ?? 0;
    const dist = closeAt >= z.lower && closeAt <= z.upper
      ? 0
      : Math.min(Math.abs(closeAt - z.upper), Math.abs(closeAt - z.lower));
    const proximity = aAt > 0 ? 1 - clamp01(dist / (5 * aAt)) : 0;
    z.confidence = zoneConfidence({
      volQuality: z.volShare / (1.5 * (z.threshold / 100)),
      health: z.health,
      reaction: z.reactionScore,
      trendAlign,
      clustered: z.clustered ? 1 : 0,
      proximity,
    });
  }

  return zones;
}

// ---------------------------------------------------------------------------
// Signal layer (closed bars only)
// ---------------------------------------------------------------------------

export interface VdSignal {
  side: 'buy' | 'sell';
  zoneId: string;
  tf: HtfPeriod;
  index: number; // trigger bar (closed)
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskReward: number; // to TP1
  swept: boolean;     // sweep seen on/just before the trigger
  confidence: number; // bar-time confidence used for the gate
}

/**
 * Closed-bar signals: a bar TOUCHES a healthy zone and CLOSES beyond its
 * proximal boundary, on above-average volume, aligned with trend, with
 * acceptable health/confidence and R:R. The forming bar is never evaluated —
 * pass only closed candles or rely on the caller's slice.
 */
export function generateVdSignals(
  candles: Candle[],
  zones: VdZone[],
  cfg: VdConfig,
): VdSignal[] {
  const n = candles.length;
  if (n < 2) return [];
  const atr = vdAtr(candles);
  const volSma = pm.sma(candles.map((c) => c.volume), 20);
  const ema50 = pm.ema(candles.map((c) => c.close), 50);
  const out: VdSignal[] = [];
  const lastClosed = n - 2; // strict: never evaluate the forming last bar

  for (const z of zones) {
    const side: 'buy' | 'sell' = z.kind === 'demand' ? 'buy' : 'sell';
    const windowEnd = Math.min(z.endIndex ?? lastClosed, lastClosed);
    let touchesSoFar = 0;
    let wasIn = false;
    let insideStreak = 0;
    const reactionsSoFar: number[] = [];
    let sweptSoFar = false;

    for (let i = z.formedAtIndex; i <= windowEnd; i++) {
      const c = candles[i];
      const nowIn = inZone(z, c);
      if (nowIn && !wasIn) touchesSoFar++;
      insideStreak = closeInside(z, c) ? insideStreak + 1 : 0;
      if (z.kind === 'demand' && c.low < z.lower && c.close >= z.lower) sweptSoFar = true;
      if (z.kind === 'supply' && c.high > z.upper && c.close <= z.upper) sweptSoFar = true;

      // Rejection: touched this bar AND closed beyond the proximal boundary.
      const rejected = z.kind === 'demand'
        ? c.low <= z.upper && c.low >= z.lower && c.close > z.upper
        : c.high >= z.lower && c.high <= z.upper && c.close < z.lower;

      if (rejected && insideStreak < cfg.acceptanceBarsLimit) {
        const vAvg = volSma[i];
        const highVol = vAvg != null && c.volume > cfg.volMult * vAvg;
        const emaAt = ema50[i];
        const trendOk = !cfg.trendFilter ||
          (emaAt != null && (side === 'buy' ? c.close > emaAt : c.close < emaAt));
        const healthAtBar = Math.max(20, 100 - 20 * touchesSoFar);
        const reactionSoFar = reactionsSoFar.length
          ? reactionsSoFar.reduce((s, x) => s + x, 0) / reactionsSoFar.length
          : 0;
        const confAtBar = zoneConfidence({
          volQuality: z.volShare / (1.5 * (z.threshold / 100)),
          health: healthAtBar,
          reaction: reactionSoFar,
          trendAlign: trendOk ? 1 : 0,
          clustered: z.clustered ? 1 : 0,
          proximity: 1, // at the zone by definition
        });

        if (highVol && trendOk && touchesSoFar <= cfg.maxRetests && healthAtBar >= cfg.minHealth && confAtBar >= cfg.confidenceFloor) {
          const a = atr[i] ?? 0;
          const entry = c.close;
          const stopLoss = side === 'buy' ? z.lower - cfg.slBufferAtr * a : z.upper + cfg.slBufferAtr * a;
          const risk = Math.abs(entry - stopLoss);
          if (risk > 0) {
            // Opposite zone (same TF preferred, else any) active at bar i.
            const opposite = zones
              .filter((o) =>
                o.kind !== z.kind && o.formedAtIndex <= i && (o.endIndex ?? lastClosed) >= i &&
                (side === 'buy' ? o.weightedAverage > entry : o.weightedAverage < entry))
              .sort((a1, b1) => (a1.tf === z.tf ? -1 : 0) - (b1.tf === z.tf ? -1 : 0))[0];
            const dir = side === 'buy' ? 1 : -1;
            const tp1 = opposite ? opposite.weightedAverage : entry + dir * 1.5 * risk;
            const tp2 = opposite
              ? (side === 'buy' ? opposite.upper : opposite.lower)
              : entry + dir * 2.5 * risk;
            const tp3 = z.periodRange > 0 ? entry + dir * z.periodRange : entry + dir * 4 * risk;
            const riskReward = Math.abs(tp1 - entry) / risk;
            if (riskReward >= cfg.minRR) {
              out.push({
                side, zoneId: z.id, tf: z.tf, index: i,
                entry, stopLoss, tp1, tp2, tp3, riskReward,
                swept: sweptSoFar, confidence: confAtBar,
              });
            }
          }
        }
      }

      // Track episode-end reactions for the bar-time confidence.
      if (!nowIn && wasIn) {
        const a = atr[i] ?? 0;
        if (a > 0) {
          let mfe = 0;
          for (let k = i; k <= Math.min(i + 4, windowEnd); k++) {
            mfe = Math.max(
              mfe,
              z.kind === 'demand' ? candles[k].high - z.upper : z.lower - candles[k].low,
            );
          }
          reactionsSoFar.push(clamp01(mfe / (2 * a)));
        }
      }
      wasIn = nowIn;
    }
  }

  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Trade lifecycle (closed bars): every signal becomes a tracked trade with an
// exact entry, live stop, TP progression and measured outcome.
// ---------------------------------------------------------------------------

export type VdTradeStatus = 'active' | 'tp1' | 'tp2' | 'tp3' | 'stopped' | 'exit';

export interface VdTrade {
  signal: VdSignal;
  status: VdTradeStatus;
  /** The stop as currently enforced (steps to break-even / trails in later phases). */
  slCurrent: number;
  entryIndex: number;
  resolvedIndex: number | null; // bar that ended the trade (stop/tp3/exit)
  exitPrice: number | null;
  barsHeld: number;
  mfeR: number; // max favorable excursion, in R
  maeR: number; // max adverse excursion, in R
  realizedR: number | null; // null while unresolved
}

/**
 * Walk each signal forward over CLOSED bars. Conservative ordering: when a bar
 * spans both the stop and a target, the stop counts first.
 */
export function walkVdTrades(candles: Candle[], signals: VdSignal[]): VdTrade[] {
  const lastClosed = candles.length - 1; // callers pass closed candles
  const out: VdTrade[] = [];

  for (const s of signals) {
    const dir = s.side === 'buy' ? 1 : -1;
    const risk = Math.abs(s.entry - s.stopLoss);
    const t: VdTrade = {
      signal: s, status: 'active', slCurrent: s.stopLoss,
      entryIndex: s.index, resolvedIndex: null, exitPrice: null,
      barsHeld: 0, mfeR: 0, maeR: 0, realizedR: null,
    };
    if (risk <= 0) { out.push(t); continue; }

    for (let i = s.index + 1; i <= lastClosed; i++) {
      const c = candles[i];
      t.barsHeld = i - s.index;
      const favorable = dir > 0 ? c.high - s.entry : s.entry - c.low;
      const adverse = dir > 0 ? s.entry - c.low : c.high - s.entry;
      t.mfeR = Math.max(t.mfeR, favorable / risk);
      t.maeR = Math.max(t.maeR, adverse / risk);

      const slHit = dir > 0 ? c.low <= t.slCurrent : c.high >= t.slCurrent;
      if (slHit) {
        t.status = 'stopped';
        t.resolvedIndex = i;
        t.exitPrice = t.slCurrent;
        t.realizedR = (dir * (t.slCurrent - s.entry)) / risk;
        break;
      }
      const hit = (tp: number) => (dir > 0 ? c.high >= tp : c.low <= tp);
      if (t.status === 'active' && hit(s.tp1)) t.status = 'tp1';
      if (t.status === 'tp1' && hit(s.tp2)) t.status = 'tp2';
      if (t.status === 'tp2' && hit(s.tp3)) {
        t.status = 'tp3';
        t.resolvedIndex = i;
        t.exitPrice = s.tp3;
        t.realizedR = (dir * (s.tp3 - s.entry)) / risk;
        break;
      }
    }
    out.push(t);
  }
  return out;
}
