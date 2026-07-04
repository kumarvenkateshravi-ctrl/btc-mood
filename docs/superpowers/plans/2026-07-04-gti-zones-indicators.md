# GTI-Inspired Zone & Level Indicators — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four universal, crypto-suited TA indicators — Supply/Demand Zones (with a configurable Zone Strength Score), Volume-Spike Detection, Support & Resistance, and Fibonacci Pivots — plus two pure helper modules, all wired into the existing indicator framework.

**Architecture:** Each indicator is a pure `IndicatorComputeFn` registered in `lib/customIndicatorsLibrary.ts`, following the existing `lib/indicators/*.ts` pattern. Two shared pure helpers (`htf.ts` for higher-timeframe resampling, `zoneStrength.ts` for scoring) have no framework/chart coupling. Rendering reuses the framework's existing `band`/`level`/`marker` outputs — no framework changes.

**Tech Stack:** TypeScript (strict), vitest, existing helpers `lib/pineMath.ts` (`sma`, `rma`), `lib/indicators/itsTemplates.ts` (`resolveInputs`), golden-master harness (`lib/testing/goldenRunner.ts`, `lib/testing/syntheticCandles.ts`). Next.js app — no Next-specific code here.

**Spec:** `docs/superpowers/specs/2026-07-04-gti-zones-indicators-design.md`

## Global Constraints

- Crypto-only, asset-agnostic. No India-market features (VIX, options-expiry, Nifty). 24/7 UTC — no session/holiday calendar.
- Supported zone timeframes: `4H, D, W, M` (no Quarterly).
- Defaults: zone TF `D`; `targetFactor 1.5`; volume-spike `mult 1.8` on `SMA(volume,20)`.
- Zone Strength weights configurable; `DEFAULT_ZONE_STRENGTH_WEIGHTS = { confluence:0.25, rejectionStrength:0.22, formationVolume:0.18, retests:0.13, zoneWidth:0.12, freshness:0.10 }`. Tiers: `<40` weak, `40–70` medium, `>70` strong.
- `zoneStrength.ts` must have zero imports from the framework, chart, or rendering.
- All indicator compute fns emit `signals` all `'neutral'` (visual/context indicators, not signal generators).
- `Candle` = `{ time, open, high, low, close, volume }` (`lib/types.ts`); `time` is unix **seconds**.
- Per task: `npx tsc --noEmit` (0 new errors), `npx eslint <touched files>` (0 errors), `npx vitest run <touched tests>` green, then the full `npx vitest run` before commit. Golden fixtures generated with `UPDATE_GOLDEN=1` and committed.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Final task runs `graphify update .`.

## File structure

- Create `lib/indicators/htf.ts` — HTF period keying + prior-period OHLC (pure).
- Create `lib/indicators/htf.test.ts`.
- Create `lib/indicators/zoneStrength.ts` — `Zone`, weights, `scoreZone` (pure).
- Create `lib/indicators/zoneStrength.test.ts`.
- Create `lib/indicators/sdZones.ts` — `buildZones`, `summarizeZones` (engine API), `computeSdZones` (indicator).
- Create `lib/indicators/sdZones.test.ts`, `lib/indicators/sdZones.golden.test.ts`.
- Create `lib/indicators/volSpike.ts` + `volSpike.golden.test.ts`.
- Create `lib/indicators/magicSr.ts` + `magicSr.golden.test.ts`.
- Create `lib/indicators/fibPivot.ts` + `fibPivot.golden.test.ts`.
- Modify `lib/customIndicatorsLibrary.ts` — register the four indicators.

---

### Task 1: HTF resampling helper (`htf.ts`)

**Files:**
- Create: `lib/indicators/htf.ts`
- Test: `lib/indicators/htf.test.ts`

**Interfaces:**
- Produces (used by Tasks 3, 8):
  - `type HtfPeriod = '4H' | 'D' | 'W' | 'M'`
  - `interface HtfBucketOHLC { open; high; low; close; volume; startTime }` (all `number`)
  - `periodKey(timeSec: number, period: HtfPeriod): number`
  - `priorPeriodOHLC(candles: Candle[], period: HtfPeriod): (HtfBucketOHLC | null)[]`

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/htf.test.ts
import { describe, it, expect } from 'vitest';
import { periodKey, priorPeriodOHLC } from './htf';
import type { Candle } from '../types';

const c = (timeSec: number, o: number, h: number, l: number, cl: number, v = 1): Candle =>
  ({ time: timeSec, open: o, high: h, low: l, close: cl, volume: v });

const DAY = 86400;

describe('periodKey', () => {
  it('4H buckets every 14400s', () => {
    expect(periodKey(0, '4H')).toBe(0);
    expect(periodKey(14399, '4H')).toBe(0);
    expect(periodKey(14400, '4H')).toBe(1);
  });
  it('D buckets per UTC day', () => {
    expect(periodKey(0, 'D')).toBe(0);
    expect(periodKey(DAY - 1, 'D')).toBe(0);
    expect(periodKey(DAY, 'D')).toBe(1);
  });
  it('W buckets Monday-start (epoch day 0 is Thursday)', () => {
    // 1970-01-01 Thu .. 1970-01-04 Sun => week 0; 1970-01-05 Mon => week 1
    expect(periodKey(0, 'W')).toBe(periodKey(3 * DAY, 'W'));
    expect(periodKey(4 * DAY, 'W')).toBe(periodKey(0, 'W') + 1);
  });
  it('M buckets per UTC calendar month', () => {
    const jan = Date.UTC(2021, 0, 15) / 1000;
    const feb = Date.UTC(2021, 1, 3) / 1000;
    expect(periodKey(feb, 'M')).toBe(periodKey(jan, 'M') + 1);
  });
});

describe('priorPeriodOHLC', () => {
  it('empty input returns []', () => {
    expect(priorPeriodOHLC([], 'D')).toEqual([]);
  });
  it('is null within the first period, then the prior completed period', () => {
    // Day 0: two bars; Day 1: one bar; Day 2: one bar.
    const candles = [
      c(0, 10, 12, 9, 11, 5),        // day 0
      c(3600, 11, 15, 10, 14, 7),    // day 0  -> day0 OHLC: o10 h15 l9 c14 v12
      c(DAY, 14, 16, 13, 15, 3),     // day 1  -> prior = day0
      c(2 * DAY, 15, 15, 8, 9, 4),   // day 2  -> prior = day1 (o14 h16 l13 c15 v3)
    ];
    const prior = priorPeriodOHLC(candles, 'D');
    expect(prior[0]).toBeNull();
    expect(prior[1]).toBeNull();
    expect(prior[2]).toEqual({ open: 10, high: 15, low: 9, close: 14, volume: 12, startTime: 0 });
    expect(prior[3]).toEqual({ open: 14, high: 16, low: 13, close: 15, volume: 3, startTime: DAY });
  });
  it('never looks ahead: a bar only sees periods that closed before its period', () => {
    const candles = [c(0, 1, 2, 0, 1, 1), c(DAY, 5, 9, 4, 8, 1)];
    const prior = priorPeriodOHLC(candles, 'D');
    // bar 1 (day 1) must NOT see its own day; only day 0.
    expect(prior[1]).toEqual({ open: 1, high: 2, low: 0, close: 1, volume: 1, startTime: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/htf.test.ts`
Expected: FAIL — cannot resolve `./htf`.

- [ ] **Step 3: Implement `htf.ts`**

```ts
// lib/indicators/htf.ts
// Higher-timeframe resampling for zone/pivot indicators. Pure, UTC-aligned;
// crypto is 24/7 so there is no exchange session or holiday calendar.

import type { Candle } from '../types';

export type HtfPeriod = '4H' | 'D' | 'W' | 'M';

export interface HtfBucketOHLC {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  startTime: number; // unix seconds of the period's first bar
}

const SEC_4H = 14400;
const SEC_DAY = 86400;

/** UTC-aligned period index for a bar's unix-second timestamp. */
export function periodKey(timeSec: number, period: HtfPeriod): number {
  if (period === '4H') return Math.floor(timeSec / SEC_4H);
  if (period === 'D') return Math.floor(timeSec / SEC_DAY);
  if (period === 'W') {
    // Monday-start weeks. Epoch day 0 (1970-01-01) is a Thursday, so the
    // Monday on/before it is day -3; +3 shifts the boundary to Monday.
    const days = Math.floor(timeSec / SEC_DAY);
    return Math.floor((days + 3) / 7);
  }
  // 'M' — UTC calendar month.
  const d = new Date(timeSec * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * For each base candle, the OHLC of the PREVIOUS fully-completed HTF period
 * (or null until at least one prior period has closed). Non-repainting: a bar
 * only ever sees periods whose key differs from its own, so no lookahead.
 */
export function priorPeriodOHLC(
  candles: Candle[],
  period: HtfPeriod,
): (HtfBucketOHLC | null)[] {
  const n = candles.length;
  const out = new Array<HtfBucketOHLC | null>(n).fill(null);
  if (n === 0) return out;

  let curKey = periodKey(candles[0].time, period);
  let cur: HtfBucketOHLC = {
    open: candles[0].open, high: candles[0].high, low: candles[0].low,
    close: candles[0].close, volume: candles[0].volume, startTime: candles[0].time,
  };
  let prev: HtfBucketOHLC | null = null;

  for (let i = 0; i < n; i++) {
    const k = periodKey(candles[i].time, period);
    if (k !== curKey) {
      prev = cur; // the just-finished bucket is now the completed prior period
      curKey = k;
      cur = {
        open: candles[i].open, high: candles[i].high, low: candles[i].low,
        close: candles[i].close, volume: candles[i].volume, startTime: candles[i].time,
      };
    } else if (i > 0) {
      cur.high = Math.max(cur.high, candles[i].high);
      cur.low = Math.min(cur.low, candles[i].low);
      cur.close = candles[i].close;
      cur.volume += candles[i].volume;
    }
    out[i] = prev;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/indicators/htf.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (0 new errors), `npx eslint lib/indicators/htf.ts lib/indicators/htf.test.ts` (0 errors).

```bash
git add lib/indicators/htf.ts lib/indicators/htf.test.ts
git commit -m "feat: HTF resampling helper (period keys + prior-period OHLC)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Zone Strength scoring (`zoneStrength.ts`)

**Files:**
- Create: `lib/indicators/zoneStrength.ts`
- Test: `lib/indicators/zoneStrength.test.ts`

**Interfaces:**
- Consumes: `HtfPeriod`, `HtfBucketOHLC` from `./htf` (Task 1).
- Produces (used by Task 3):
  - `type ZoneKind = 'supply' | 'supplyTarget' | 'demand' | 'demandTarget'`
  - `interface Zone { kind: ZoneKind; tf: HtfPeriod; upper: number; lower: number; formedAtIndex: number; formedOHLC: HtfBucketOHLC; strength?: ZoneStrength }`
  - `type ZoneFactor = 'formationVolume'|'rejectionStrength'|'retests'|'freshness'|'confluence'|'zoneWidth'`
  - `type ZoneStrengthWeights = Record<ZoneFactor, number>`
  - `const DEFAULT_ZONE_STRENGTH_WEIGHTS: ZoneStrengthWeights`
  - `interface ZoneStrength { score: number; tier: 'weak'|'medium'|'strong'; factors: Record<ZoneFactor, number> }`
  - `interface ScoreZoneCtx { avgPeriodVolume: number; atrAtFormation: number; reactBars?: number; freshWindow?: number; widthAtrMult?: number }`
  - `function countRetests(zone: Zone, candles: Candle[]): number` (raw touch count; also used by the summary)
  - `scoreZone(zone: Zone, candles: Candle[], otherActiveZones: Zone[], ctx: ScoreZoneCtx, weights?: Partial<ZoneStrengthWeights>): ZoneStrength`

Note (refinement of the spec signature): `scoreZone` takes a `ScoreZoneCtx` for the two scalars it cannot cheaply derive itself (`avgPeriodVolume`, `atrAtFormation`); `sdZones` computes and passes them.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/zoneStrength.test.ts
import { describe, it, expect } from 'vitest';
import { scoreZone, countRetests, DEFAULT_ZONE_STRENGTH_WEIGHTS, type Zone } from './zoneStrength';
import type { HtfBucketOHLC } from './htf';
import type { Candle } from '../types';

const bar = (o: number, h: number, l: number, cl: number, v = 1): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: cl, volume: v });

const ohlc = (v: number): HtfBucketOHLC =>
  ({ open: 100, high: 110, low: 90, close: 105, volume: v, startTime: 0 });

// A demand zone [90..95] formed at index 2 from a period of volume 100.
const demandZone = (over: Partial<Zone> = {}): Zone => ({
  kind: 'demand', tf: 'D', upper: 95, lower: 90, formedAtIndex: 2, formedOHLC: ohlc(100), ...over,
});

const ctx = { avgPeriodVolume: 100, atrAtFormation: 10 };

describe('countRetests', () => {
  it('counts distinct in-zone runs after formation (not the formation bar)', () => {
    // formedAtIndex 2; bars 3-4 in zone (one touch), 5 out, 6 in (second touch)
    const candles = [
      bar(100, 110, 90, 105), bar(100, 110, 90, 105), bar(100, 110, 90, 105), // 0,1,2
      bar(96, 96, 92, 93),  // 3 in [90..95]
      bar(94, 95, 91, 92),  // 4 in
      bar(120, 122, 118, 121), // 5 out
      bar(96, 97, 93, 94),  // 6 in (2nd touch)
    ];
    expect(countRetests(demandZone(), candles)).toBe(2);
  });
});

describe('scoreZone', () => {
  it('returns factors in 0..1 and score in 0..100', () => {
    const candles = Array.from({ length: 10 }, () => bar(100, 110, 90, 105));
    const s = scoreZone(demandZone(), candles, [], ctx);
    Object.values(s.factors).forEach((f) => {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    });
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(['weak', 'medium', 'strong']).toContain(s.tier);
  });

  it('high formation volume raises formationVolume factor', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const low = scoreZone(demandZone({ formedOHLC: ohlc(50) }), candles, [], ctx).factors.formationVolume;
    const high = scoreZone(demandZone({ formedOHLC: ohlc(200) }), candles, [], ctx).factors.formationVolume;
    expect(high).toBeGreaterThan(low);
  });

  it('a tighter zone scores higher on zoneWidth', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const tight = scoreZone(demandZone({ upper: 91 }), candles, [], ctx).factors.zoneWidth; // height 1
    const wide = scoreZone(demandZone({ upper: 120 }), candles, [], ctx).factors.zoneWidth; // height 30
    expect(tight).toBeGreaterThan(wide);
  });

  it('an overlapping same-type zone on another TF raises confluence', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const other: Zone = demandZone({ tf: 'W', upper: 96, lower: 93 }); // overlaps [90..95]
    const alone = scoreZone(demandZone(), candles, [], ctx).factors.confluence;
    const withConf = scoreZone(demandZone(), candles, [other], ctx).factors.confluence;
    expect(alone).toBe(0);
    expect(withConf).toBeGreaterThan(0);
  });

  it('custom weights change the score', () => {
    const candles = Array.from({ length: 6 }, () => bar(100, 110, 90, 105));
    const a = scoreZone(demandZone(), candles, [], ctx, DEFAULT_ZONE_STRENGTH_WEIGHTS).score;
    const b = scoreZone(demandZone(), candles, [], ctx, { zoneWidth: 10, confluence: 0 }).score;
    expect(b).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/zoneStrength.test.ts`
Expected: FAIL — cannot resolve `./zoneStrength`.

- [ ] **Step 3: Implement `zoneStrength.ts`**

```ts
// lib/indicators/zoneStrength.ts
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

  const type = zoneType(zone.kind);
  let overlapCount = 0;
  for (const o of otherActiveZones) {
    if (zoneType(o.kind) === type && zone.lower <= o.upper && zone.upper >= o.lower) overlapCount++;
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/indicators/zoneStrength.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (0 new errors), `npx eslint lib/indicators/zoneStrength.ts lib/indicators/zoneStrength.test.ts` (0 errors).

```bash
git add lib/indicators/zoneStrength.ts lib/indicators/zoneStrength.test.ts
git commit -m "feat: configurable zone-strength scoring (6 factors incl. zone width)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Zone builder + engine summary API (`sdZones.ts` — pure part)

**Files:**
- Create: `lib/indicators/sdZones.ts`
- Test: `lib/indicators/sdZones.test.ts`

**Interfaces:**
- Consumes: `priorPeriodOHLC`, `HtfPeriod`, `HtfBucketOHLC` (Task 1); `Zone`, `scoreZone`, `ScoreZoneCtx`, `ZoneStrengthWeights`, `ZoneStrength`, `countRetests` (Task 2); `pm.rma` (`lib/pineMath.ts`).
- Produces (used by Task 4 and the future AI engine):
  - `interface SdZonesConfig { tfs: HtfPeriod[]; targetFactor: number; weights?: Partial<ZoneStrengthWeights> }`
  - `buildZones(candles: Candle[], tf: HtfPeriod, targetFactor: number): Zone[]`
  - `atrSeries(candles: Candle[], length: number): (number | null)[]`
  - `interface ZoneSummary { zoneType: 'supply'|'demand'; kind: Zone['kind']; tf: HtfPeriod; upper; lower; mid; zoneStrength; tier; factors; distanceToPrice; isMultiTimeframeConfluence; retestCount; formedAtIndex; formedTime }` (numbers except noted)
  - `summarizeZones(candles: Candle[], cfg: SdZonesConfig): ZoneSummary[]`

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/sdZones.test.ts
import { describe, it, expect } from 'vitest';
import { buildZones, summarizeZones } from './sdZones';
import type { Candle } from '../types';

const DAY = 86400;
// day 0: range 90..110, body 100..105 ; then later days below.
const series: Candle[] = [
  { time: 0, open: 100, high: 110, low: 90, close: 105, volume: 10 },
  { time: 3600, open: 105, high: 110, low: 95, close: 108, volume: 10 },
  { time: DAY, open: 108, high: 109, low: 92, close: 96, volume: 5 },   // day 1 -> zones from day 0
  { time: DAY + 3600, open: 96, high: 98, low: 93, close: 94, volume: 5 },
  { time: 2 * DAY, open: 94, high: 95, low: 80, close: 85, volume: 5 }, // day 2 -> zones from day 1
];

describe('buildZones', () => {
  it('freezes 4 zones per period from the prior period OHLC with targetFactor', () => {
    const zones = buildZones(series, 'D', 1.5);
    // First formation is at index 2 (day 1), from day 0: o100 h110 l90 c105.
    const day1 = zones.filter((z) => z.formedAtIndex === 2);
    const byKind = Object.fromEntries(day1.map((z) => [z.kind, z]));
    // day-0 BUCKET is o100 h110 l90 c108 (last close in the period wins), so
    // range = 20; bodyTop = max(100,108) = 108; bodyBottom = 100.
    expect(byKind.supply).toMatchObject({ upper: 110, lower: 108 });
    expect(byKind.demand).toMatchObject({ upper: 100, lower: 90 });
    expect(byKind.supplyTarget).toMatchObject({ upper: 110 + 20 * 1.5, lower: 110 });
    expect(byKind.demandTarget).toMatchObject({ upper: 90, lower: 90 - 20 * 1.5 });
  });
  it('produces no zones before the second period', () => {
    const oneDay = series.slice(0, 2);
    expect(buildZones(oneDay, 'D', 1.5)).toEqual([]);
  });
});

describe('summarizeZones', () => {
  it('emits engine fields for the current active zones', () => {
    const out = summarizeZones(series, { tfs: ['D'], targetFactor: 1.5 });
    expect(out.length).toBeGreaterThan(0);
    const s = out[0];
    expect(s).toHaveProperty('zoneStrength');
    expect(s).toHaveProperty('zoneType');
    expect(s).toHaveProperty('distanceToPrice');
    expect(s).toHaveProperty('isMultiTimeframeConfluence');
    expect(s).toHaveProperty('retestCount');
    expect(['supply', 'demand']).toContain(s.zoneType);
    // distanceToPrice is a signed % from the last close (85) to the zone mid.
    expect(typeof s.distanceToPrice).toBe('number');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/sdZones.test.ts`
Expected: FAIL — cannot resolve `./sdZones`.

- [ ] **Step 3: Implement the pure part of `sdZones.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/indicators/sdZones.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (0 new errors), `npx eslint lib/indicators/sdZones.ts lib/indicators/sdZones.test.ts` (0 errors).

```bash
git add lib/indicators/sdZones.ts lib/indicators/sdZones.test.ts
git commit -m "feat: supply/demand zone builder + AI-engine summary API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Supply/Demand Zones indicator (`computeSdZones`) + register

**Files:**
- Modify: `lib/indicators/sdZones.ts` (add `computeSdZones`)
- Modify: `lib/customIndicatorsLibrary.ts` (register `sd_zones`)
- Test: `lib/indicators/sdZones.golden.test.ts`

**Interfaces:**
- Consumes: `buildZones`, `summarizeZones`, `atrSeries` (Task 3); `resolveInputs` (`lib/indicators/itsTemplates.ts`); framework types (`IndicatorResult`, `IndicatorPlot`, `IndicatorLevel`, `CustomIndicatorConfig`).
- Produces: `computeSdZones(candles, config?): IndicatorResult`; a `CustomIndicatorDef` entry `id: 'sd_zones'`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/sdZones.golden.test.ts
import { describe, it, expect } from 'vitest';
import { computeSdZones } from './sdZones';
import { defineGoldenTest } from '../testing/goldenRunner';
import { makeDeterministicCandles } from '../testing/syntheticCandles';

describe('sd_zones golden master', () => {
  defineGoldenTest({
    name: 'sdZones',
    compute: computeSdZones,
    params: { tf1: 'D', tf2: 'None', tf3: 'None', targetFactor: 1.5 },
  });

  it('emits a band plot per zone kind for the active TF, all neutral signals', () => {
    const candles = makeDeterministicCandles(600, 5); // spans multiple UTC days
    const res = computeSdZones(candles, {
      id: 'sd_zones',
      settings: { inputs: { tf1: 'D', tf2: 'None', tf3: 'None', targetFactor: 1.5, minStrength: 0 }, styles: {}, visibility: {} },
    });
    const ids = res.plots.map((p) => p.id);
    expect(ids).toContain('D Su');
    expect(ids).toContain('D De');
    res.plots.forEach((p) => expect(p.type).toBe('band'));
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
    expect(res.signals.length).toBe(candles.length);
  });

  it('minStrength filters out weak current zones (their label level is omitted)', () => {
    const candles = makeDeterministicCandles(600, 5);
    const cfg = (minStrength: number) => computeSdZones(candles, {
      id: 'sd_zones',
      settings: { inputs: { tf1: 'D', targetFactor: 1.5, minStrength }, styles: {}, visibility: {} },
    });
    const many = cfg(0).levels?.length ?? 0;
    const few = cfg(101).levels?.length ?? 0; // nothing scores > 100
    expect(few).toBeLessThan(many);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/sdZones.golden.test.ts`
Expected: FAIL — `computeSdZones` not exported.

- [ ] **Step 3: Implement `computeSdZones` (append to `sdZones.ts`)**

Add these imports at the top of `sdZones.ts`:

```ts
import type { IndicatorResult, IndicatorPlot, IndicatorLevel, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { scoreZone as _scoreZone } from './zoneStrength'; // already imported as scoreZone; reuse existing import
```

(If `scoreZone` is already imported from Task 3, do not re-import — use the existing binding.)

Append:

```ts
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
const SUPPLY_FILL = 'rgba(242,54,69,0.10)';
const SUPPLY_TARGET_FILL = 'rgba(242,54,69,0.06)';
const DEMAND_FILL = 'rgba(38,166,154,0.10)';
const DEMAND_TARGET_FILL = 'rgba(38,166,154,0.06)';

const fillFor = (kind: Zone['kind']): string =>
  kind === 'supply' ? SUPPLY_FILL : kind === 'supplyTarget' ? SUPPLY_TARGET_FILL :
  kind === 'demand' ? DEMAND_FILL : DEMAND_TARGET_FILL;

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
  const levels: IndicatorLevel[] = [];
  const kinds: Zone['kind'][] = ['supply', 'supplyTarget', 'demand', 'demandTarget'];

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
      plots.push({ id: label, title: label, color: fillFor(kind), type: 'band', pane: 'overlay', data });

      // label + strength for the current zone of this kind
      const cur = kindZones[kindZones.length - 1];
      if (cur && inp.showLabels) {
        const st = scored.get(cur);
        if ((st?.score ?? 0) >= inp.minStrength) {
          const scoreTxt = inp.showStrength && st ? ` ★${Math.round(st.score)}` : '';
          levels.push({ value: cur.upper, color: fillFor(kind), lineStyle: 'dotted', lineWidth: 1, title: `${label}${scoreTxt}` });
        }
      }
    }
  }

  return { plots, signals, levels };
}
```

- [ ] **Step 4: Run to verify pass, then generate the golden fixture**

Run: `npx vitest run lib/indicators/sdZones.golden.test.ts`
Expected: the two `it(...)` behavioral tests PASS; the `defineGoldenTest` case FAILS the first time (no fixture yet).
Run: `UPDATE_GOLDEN=1 npx vitest run lib/indicators/sdZones.golden.test.ts`
Expected: fixture written, all PASS. Re-run without the env var to confirm PASS.

- [ ] **Step 5: Register `sd_zones`**

In `lib/customIndicatorsLibrary.ts` add the import near the others:

```ts
import { computeSdZones } from './indicators/sdZones';
```

Append to `CUSTOM_INDICATORS`:

```ts
  {
    id: 'sd_zones',
    name: 'Supply / Demand Zones',
    description: 'Non-repainting supply/demand price bands from the prior higher-TF period (up to 3 TFs), ranked by a configurable Zone Strength Score.',
    inputs: [
      { id: 'tf1', name: 'Timeframe 1', type: 'select', default: 'D', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf2', name: 'Timeframe 2', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf3', name: 'Timeframe 3', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'targetFactor', name: 'Target projection ×', type: 'number', default: 1.5, min: 0, max: 5, step: 0.1 },
      { id: 'showLabels', name: 'Show labels', type: 'boolean', default: true },
      { id: 'showStrength', name: 'Show strength score', type: 'boolean', default: true },
      { id: 'minStrength', name: 'Min strength', type: 'number', default: 0, min: 0, max: 100, step: 1 },
      { id: 'wConfluence', name: 'Weight: Confluence', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wRejection', name: 'Weight: Rejection', type: 'number', default: 0.22, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wVolume', name: 'Weight: Volume', type: 'number', default: 0.18, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wRetests', name: 'Weight: Retests', type: 'number', default: 0.13, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wZoneWidth', name: 'Weight: Zone Width', type: 'number', default: 0.12, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wFreshness', name: 'Weight: Freshness', type: 'number', default: 0.10, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
    ],
    styles: [
      { id: 'D Su', name: 'Supply', color: SUPPLY_FILL, thickness: 1, lineStyle: 'solid', display: true },
      { id: 'D De', name: 'Demand', color: DEMAND_FILL, thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeSdZones,
  },
```

(Where `SUPPLY_FILL`/`DEMAND_FILL` are the same rgba strings; inline the literals in the library file — do not import the internal constants.)

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit` (0 new errors), `npx eslint lib/indicators/sdZones.ts lib/indicators/sdZones.golden.test.ts lib/customIndicatorsLibrary.ts` (0 errors), `npx vitest run` (green).

```bash
git add lib/indicators/sdZones.ts lib/indicators/sdZones.golden.test.ts lib/customIndicatorsLibrary.ts lib/testing/fixtures/sdZones.json
git commit -m "feat: Supply/Demand Zones indicator with Zone Strength Score

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Volume-Spike Detection (`volSpike.ts`) + register

**Files:**
- Create: `lib/indicators/volSpike.ts`
- Modify: `lib/customIndicatorsLibrary.ts`
- Test: `lib/indicators/volSpike.golden.test.ts`

**Interfaces:**
- Consumes: `pm.sma`; `resolveInputs`; framework types.
- Produces: `computeVolSpike(candles, config?): IndicatorResult`; `CustomIndicatorDef` `id: 'vol_spike'`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/volSpike.golden.test.ts
import { describe, it, expect } from 'vitest';
import { computeVolSpike } from './volSpike';
import { defineGoldenTest } from '../testing/goldenRunner';
import type { Candle } from '../types';

const flat = (v: number, up: boolean): Candle =>
  ({ time: 0, open: 100, high: 101, low: 99, close: up ? 101 : 99, volume: v });

describe('vol_spike golden master', () => {
  defineGoldenTest({ name: 'volSpike', compute: computeVolSpike, params: { length: 20, mult: 1.8 } });

  it('marks up-spikes blue below the bar and down-spikes dark above', () => {
    // 20 calm bars (vol 10), then an up-spike (vol 30) and a down-spike (vol 40).
    const candles: Candle[] = [
      ...Array.from({ length: 20 }, () => flat(10, true)),
      flat(30, true),   // index 20: up-spike (30 > 10*1.8)
      flat(40, false),  // index 21: down-spike
    ];
    const res = computeVolSpike(candles, { id: 'vol_spike', settings: { inputs: { length: 20, mult: 1.8 }, styles: {}, visibility: {} } });
    const up = res.markers?.find((m) => m.index === 20);
    const down = res.markers?.find((m) => m.index === 21);
    expect(up).toMatchObject({ position: 'belowBar', shape: 'arrowUp' });
    expect(down).toMatchObject({ position: 'aboveBar', shape: 'arrowDown' });
    // warm-up bars (< length) produce no marks
    expect(res.markers?.some((m) => m.index < 20)).toBe(false);
    expect(res.plots).toEqual([]);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/volSpike.golden.test.ts`
Expected: FAIL — cannot resolve `./volSpike`.

- [ ] **Step 3: Implement `volSpike.ts`**

```ts
// lib/indicators/volSpike.ts
import type { Candle } from '../types';
import type { IndicatorResult, IndicatorMarker, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import * as pm from '../pineMath';
import { resolveInputs } from './itsTemplates';

interface VolSpikeInputs { length: number; mult: number; }
const DEFAULTS: VolSpikeInputs = { length: 20, mult: 1.8 };

const BUY_BLUE = '#2962FF';
const SELL_DARK = '#131722';

/** Marks bars whose volume exceeds `mult × SMA(volume, length)`: blue up-arrow
 *  below an up-close (major buying), dark down-arrow above a down-close. */
export function computeVolSpike(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { length, mult } = resolveInputs<VolSpikeInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const volMa = pm.sma(candles.map((c) => c.volume), length);
  const markers: IndicatorMarker[] = [];

  for (let i = 0; i < n; i++) {
    const ma = volMa[i];
    if (ma === null || ma <= 0) continue;
    if (candles[i].volume > ma * mult) {
      const up = candles[i].close >= candles[i].open;
      markers.push({
        index: i,
        position: up ? 'belowBar' : 'aboveBar',
        color: up ? BUY_BLUE : SELL_DARK,
        shape: up ? 'arrowUp' : 'arrowDown',
        text: up ? 'B' : 'S',
      });
    }
  }
  return { plots: [], signals, markers };
}
```

- [ ] **Step 4: Run + generate fixture**

Run: `npx vitest run lib/indicators/volSpike.golden.test.ts` (behavioral test PASS; golden FAILS first).
Run: `UPDATE_GOLDEN=1 npx vitest run lib/indicators/volSpike.golden.test.ts` then re-run without env → PASS.

- [ ] **Step 5: Register `vol_spike`**

`lib/customIndicatorsLibrary.ts`: add `import { computeVolSpike } from './indicators/volSpike';` and append:

```ts
  {
    id: 'vol_spike',
    name: 'Volume Spike Detection',
    description: 'Marks abnormal-volume bars: blue up-arrow = major buying, dark down-arrow = major selling.',
    inputs: [
      { id: 'length', name: 'Volume MA Length', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'Spike ×', type: 'number', default: 1.8, min: 1, max: 10, step: 0.1 },
    ],
    styles: [],
    compute: computeVolSpike,
  },
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit`, `npx eslint lib/indicators/volSpike.ts lib/indicators/volSpike.golden.test.ts lib/customIndicatorsLibrary.ts`, `npx vitest run` (all clean/green).

```bash
git add lib/indicators/volSpike.ts lib/indicators/volSpike.golden.test.ts lib/customIndicatorsLibrary.ts lib/testing/fixtures/volSpike.json
git commit -m "feat: Volume Spike Detection indicator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Support & Resistance lines (`magicSr.ts`) + register

**Files:**
- Create: `lib/indicators/magicSr.ts`
- Modify: `lib/customIndicatorsLibrary.ts`
- Test: `lib/indicators/magicSr.golden.test.ts`

**Interfaces:**
- Consumes: `resolveInputs`; framework types (`IndicatorLevel`).
- Produces: `computeMagicSr(candles, config?): IndicatorResult`; `CustomIndicatorDef` `id: 'magic_sr'`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/magicSr.golden.test.ts
import { describe, it, expect } from 'vitest';
import { computeMagicSr } from './magicSr';
import { defineGoldenTest } from '../testing/goldenRunner';
import type { Candle } from '../types';

const c = (h: number, l: number): Candle => ({ time: 0, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 });

describe('magic_sr golden master', () => {
  defineGoldenTest({ name: 'magicSr', compute: computeMagicSr, params: { lookback: 2, count: 3, showUp: true, showDown: true } });

  it('emits resistance levels above and support levels below the last close', () => {
    // A pivot high at index 3 (high 120), pivot low at index 7 (low 80), lookback 2.
    const candles: Candle[] = [
      c(100, 95), c(101, 96), c(102, 97),
      c(120, 110),           // 3: pivot high (higher than ±2 neighbors)
      c(103, 98), c(102, 97), c(101, 96),
      c(90, 80),             // 7: pivot low
      c(95, 88), c(97, 90),
    ];
    const res = computeMagicSr(candles, { id: 'magic_sr', settings: { inputs: { lookback: 2, count: 3, showUp: true, showDown: true }, styles: {}, visibility: {} } });
    const vals = (res.levels ?? []).map((l) => l.value);
    expect(vals).toContain(120); // resistance pivot high
    expect(vals).toContain(80);  // support pivot low
    expect(res.plots).toEqual([]);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
  });

  it('respects showUp / showDown toggles', () => {
    const candles: Candle[] = [c(100, 95), c(101, 96), c(120, 110), c(101, 96), c(100, 95)];
    const noUp = computeMagicSr(candles, { id: 'magic_sr', settings: { inputs: { lookback: 1, count: 3, showUp: false, showDown: true }, styles: {}, visibility: {} } });
    expect((noUp.levels ?? []).every((l) => l.title !== 'R')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/magicSr.golden.test.ts`
Expected: FAIL — cannot resolve `./magicSr`.

- [ ] **Step 3: Implement `magicSr.ts`**

```ts
// lib/indicators/magicSr.ts
import type { Candle } from '../types';
import type { IndicatorResult, IndicatorLevel, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

interface MagicSrInputs { lookback: number; count: number; showUp: boolean; showDown: boolean; }
const DEFAULTS: MagicSrInputs = { lookback: 10, count: 3, showUp: true, showDown: true };

const RES = '#5aa2e6';
const SUP = '#f23645';

/** Pivot high at i: high[i] is the strict max of high[i-L..i+L] (needs L bars
 *  each side). Pivot low symmetric. Emits the nearest `count` pivots above/below
 *  the last close as resistance/support levels. */
export function computeMagicSr(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { lookback: L, count, showUp, showDown } = resolveInputs<MagicSrInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = L; i < n - L; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - L; j <= i + L; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivotHighs.push(candles[i].high);
    if (isLow) pivotLows.push(candles[i].low);
  }

  const lastClose = candles[n - 1].close;
  const levels: IndicatorLevel[] = [];

  if (showUp) {
    pivotHighs.filter((p) => p > lastClose)
      .sort((a, b) => a - b).slice(0, count)
      .forEach((p) => levels.push({ value: p, color: RES, lineStyle: 'solid', lineWidth: 1, title: 'R' }));
  }
  if (showDown) {
    pivotLows.filter((p) => p < lastClose)
      .sort((a, b) => b - a).slice(0, count)
      .forEach((p) => levels.push({ value: p, color: SUP, lineStyle: 'solid', lineWidth: 1, title: 'S' }));
  }

  return { plots: [], signals, levels };
}
```

- [ ] **Step 4: Run + generate fixture**

Run: `npx vitest run lib/indicators/magicSr.golden.test.ts` (behavioral PASS; golden FAILS first).
Run: `UPDATE_GOLDEN=1 npx vitest run lib/indicators/magicSr.golden.test.ts` then re-run → PASS.

- [ ] **Step 5: Register `magic_sr`**

`lib/customIndicatorsLibrary.ts`: add `import { computeMagicSr } from './indicators/magicSr';` and append:

```ts
  {
    id: 'magic_sr',
    name: 'Support & Resistance',
    description: 'Horizontal S/R from recent swing pivots: resistance above price, support below.',
    inputs: [
      { id: 'lookback', name: 'Pivot Lookback', type: 'number', default: 10, min: 2, max: 100, step: 1 },
      { id: 'count', name: 'Lines Each Side', type: 'number', default: 3, min: 1, max: 10, step: 1 },
      { id: 'showUp', name: 'Show Resistance', type: 'boolean', default: true },
      { id: 'showDown', name: 'Show Support', type: 'boolean', default: true },
    ],
    styles: [],
    compute: computeMagicSr,
  },
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit`, `npx eslint lib/indicators/magicSr.ts lib/indicators/magicSr.golden.test.ts lib/customIndicatorsLibrary.ts`, `npx vitest run`.

```bash
git add lib/indicators/magicSr.ts lib/indicators/magicSr.golden.test.ts lib/customIndicatorsLibrary.ts lib/testing/fixtures/magicSr.json
git commit -m "feat: Support & Resistance (pivot-based magic lines) indicator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Fibonacci Pivots (`fibPivot.ts`) + register

**Files:**
- Create: `lib/indicators/fibPivot.ts`
- Modify: `lib/customIndicatorsLibrary.ts`
- Test: `lib/indicators/fibPivot.golden.test.ts`

**Interfaces:**
- Consumes: `priorPeriodOHLC`, `HtfPeriod` (Task 1); `resolveInputs`; framework types.
- Produces: `computeFibPivot(candles, config?): IndicatorResult`; `CustomIndicatorDef` `id: 'fib_pivot'`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/indicators/fibPivot.golden.test.ts
import { describe, it, expect } from 'vitest';
import { computeFibPivot } from './fibPivot';
import { defineGoldenTest } from '../testing/goldenRunner';
import type { Candle } from '../types';

const DAY = 86400;

describe('fib_pivot golden master', () => {
  defineGoldenTest({ name: 'fibPivot', compute: computeFibPivot, params: { period: 'D', f1: 0.382, f2: 0.618, f3: 1.0 } });

  it('computes P/R/S from the prior daily range', () => {
    // day 0: high 110, low 90, close 100 -> P=100, range=20
    const candles: Candle[] = [
      { time: 0, open: 95, high: 110, low: 90, close: 100, volume: 1 },
      { time: DAY, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    ];
    const res = computeFibPivot(candles, { id: 'fib_pivot', settings: { inputs: { period: 'D', f1: 0.382, f2: 0.618, f3: 1.0 }, styles: {}, visibility: {} } });
    const byTitle = Object.fromEntries((res.levels ?? []).map((l) => [l.title, l.value]));
    expect(byTitle.P).toBeCloseTo(100, 6);
    expect(byTitle.R1).toBeCloseTo(100 + 0.382 * 20, 6);
    expect(byTitle.S3).toBeCloseTo(100 - 1.0 * 20, 6);
    expect(res.plots).toEqual([]);
    expect(res.signals.every((s) => s === 'neutral')).toBe(true);
  });

  it('emits no levels before the second period', () => {
    const oneDay: Candle[] = [{ time: 0, open: 95, high: 110, low: 90, close: 100, volume: 1 }];
    const res = computeFibPivot(oneDay, { id: 'fib_pivot', settings: { inputs: { period: 'D' }, styles: {}, visibility: {} } });
    expect(res.levels ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/indicators/fibPivot.golden.test.ts`
Expected: FAIL — cannot resolve `./fibPivot`.

- [ ] **Step 3: Implement `fibPivot.ts`**

```ts
// lib/indicators/fibPivot.ts
import type { Candle } from '../types';
import type { IndicatorResult, IndicatorLevel, CustomIndicatorConfig, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';
import { priorPeriodOHLC, type HtfPeriod } from './htf';

interface FibPivotInputs { period: string; f1: number; f2: number; f3: number; }
const DEFAULTS: FibPivotInputs = { period: 'D', f1: 0.382, f2: 0.618, f3: 1.0 };

const P_COLOR = '#FF6D00';
const R_COLOR = '#5aa2e6';
const S_COLOR = '#f23645';

/** Classic Fibonacci pivots from the prior D/W/M range: P=(H+L+C)/3,
 *  R/S at P ± f×(H−L). Levels use the current period's prior-period values. */
export function computeFibPivot(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { period, f1, f2, f3 } = resolveInputs<FibPivotInputs>(config, DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  const tf: HtfPeriod = period === 'W' ? 'W' : period === 'M' ? 'M' : 'D';
  if (n === 0) return { plots: [], signals };

  const prior = priorPeriodOHLC(candles, tf);
  const p = prior[n - 1]; // current period's prior-period OHLC
  if (!p) return { plots: [], signals };

  const pivot = (p.high + p.low + p.close) / 3;
  const range = p.high - p.low;
  const levels: IndicatorLevel[] = [
    { value: pivot, color: P_COLOR, lineStyle: 'solid', lineWidth: 1, title: 'P' },
    { value: pivot + f1 * range, color: R_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'R1' },
    { value: pivot + f2 * range, color: R_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'R2' },
    { value: pivot + f3 * range, color: R_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'R3' },
    { value: pivot - f1 * range, color: S_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'S1' },
    { value: pivot - f2 * range, color: S_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'S2' },
    { value: pivot - f3 * range, color: S_COLOR, lineStyle: 'dotted', lineWidth: 1, title: 'S3' },
  ];
  return { plots: [], signals, levels };
}
```

- [ ] **Step 4: Run + generate fixture**

Run: `npx vitest run lib/indicators/fibPivot.golden.test.ts` (behavioral PASS; golden FAILS first).
Run: `UPDATE_GOLDEN=1 npx vitest run lib/indicators/fibPivot.golden.test.ts` then re-run → PASS.

- [ ] **Step 5: Register `fib_pivot`**

`lib/customIndicatorsLibrary.ts`: add `import { computeFibPivot } from './indicators/fibPivot';` and append:

```ts
  {
    id: 'fib_pivot',
    name: 'Fibonacci Pivots',
    description: 'Fibonacci pivot P / R1-3 / S1-3 from the prior Day/Week/Month range.',
    inputs: [
      { id: 'period', name: 'Period', type: 'select', default: 'D', options: [{ value: 'D', label: 'Day' }, { value: 'W', label: 'Week' }, { value: 'M', label: 'Month' }] },
      { id: 'f1', name: 'Fib 1', type: 'number', default: 0.382, min: 0, max: 4, step: 0.001 },
      { id: 'f2', name: 'Fib 2', type: 'number', default: 0.618, min: 0, max: 4, step: 0.001 },
      { id: 'f3', name: 'Fib 3', type: 'number', default: 1.0, min: 0, max: 4, step: 0.001 },
    ],
    styles: [],
    compute: computeFibPivot,
  },
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit`, `npx eslint lib/indicators/fibPivot.ts lib/indicators/fibPivot.golden.test.ts lib/customIndicatorsLibrary.ts`, `npx vitest run`.

```bash
git add lib/indicators/fibPivot.ts lib/indicators/fibPivot.golden.test.ts lib/customIndicatorsLibrary.ts lib/testing/fixtures/fibPivot.json
git commit -m "feat: Fibonacci Pivots indicator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification + graph update

**Files:** none new.

- [ ] **Step 1:** `npx tsc --noEmit` → 0 new errors (the 2 pre-existing errors, if this branch has them, are unrelated).
- [ ] **Step 2:** `npx eslint .` → no new errors.
- [ ] **Step 3:** `npx vitest run` → full suite green, including all four new golden fixtures.
- [ ] **Step 4:** Manual smoke on `npm run dev`, `/app`: add each of the four indicators from the Indicators menu — Supply/Demand Zones shows salmon/green bands with `★score` labels; Volume Spike Detection shows blue/dark arrows on high-volume bars; Support & Resistance shows R/S lines; Fibonacci Pivots shows P/R/S lines. Confirm no console errors.
- [ ] **Step 5:** `graphify update .`
- [ ] **Step 6:** Fixup commit if needed.

---

## Design decisions locked in this plan

1. **`scoreZone` takes a `ScoreZoneCtx`** for `avgPeriodVolume` and `atrAtFormation` — the two scalars it cannot cheaply derive — keeping the function pure and its per-factor math testable in isolation.
2. **One `band` plot per (TF, zone-kind)** keyed `"{TF} {kind}"` (e.g. `"D Su"`); the current zone of each kind also emits an `IndicatorLevel` label carrying `★score`. Historical bars keep their frozen zone; only the current zone is strength-filtered.
3. **`summarizeZones` is the AI-engine seam** — it and `computeSdZones` share `buildZones` + `scoreZone`, so the engine's numbers and the chart's numbers cannot diverge.
4. **Golden tests pair a `defineGoldenTest` snapshot with explicit behavioral assertions** for marker/level-only indicators, since those aren't line plots.
5. **No framework changes** — bands, levels, and markers all render through the existing `useChartData` pipeline.
