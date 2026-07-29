# Jumbo Zones Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a NEW "Jumbo Zones" indicator (`jumbo_zones`) implementing the creator's official Elephant Edge model — session-open anchor + percentile bands of the median bull/bear session expansion — leaving the existing `elephant_zone` indicator untouched for side-by-side comparison.

**Architecture:** A new file `lib/indicators/jumboZones.ts` with two pure helpers (`median`, `expansionZones`) plus `computeJumboZones`. Reuses the existing band-plot rendering and pivot-line logic. Registered as a second, independent indicator. `elephant_zone` and `elephantZone.ts` are not modified.

**Tech Stack:** TypeScript, Vitest, existing `IndicatorPlot` band rendering + `resolveInputs`.

## Global Constraints

- New indicator id `jumbo_zones`, name "Jumbo Zones". The existing `elephant_zone` indicator stays exactly as-is.
- Anchor = today's session open (first bar of the UTC day). Zones frozen at session start from PRIOR completed sessions + today's open — non-repainting (today's own high/low never affect today's zones).
- Defaults: `sessionLookback` 20, `avgMethod` median, `expansionMode` directional, percentiles `21/29/53/62`.
- Validation: every band `lower = Math.min(a,b)`, `upper = Math.max(a,b)`.
- Two pivots carried over: `PIVOT` (cyan prev-close), `PIVOT_P` (indigo HLC/3).
- Self-consistency tests only — no Pine golden master.
- `npx tsc --noEmit` clean (ignore only the pre-existing `lib/indicators/maFvg/signals.test.ts` parse error). Full `npx vitest run` green.

---

## File Structure

- Create: `lib/indicators/jumboZones.ts` — helpers + engine (one focused file).
- Create: `lib/indicators/jumboZones.test.ts` — helper + engine tests.
- Modify: `lib/customIndicatorsLibrary.ts` — add a `computeJumboZones` import and a `jumbo_zones` registry entry.

---

### Task 1: New file with pure helpers (`median`, `expansionZones`)

**Files:**
- Create: `lib/indicators/jumboZones.ts`
- Create: `lib/indicators/jumboZones.test.ts`

**Interfaces:**
- Produces: `interface ZoneBand { lower: number; upper: number }`; `median(xs: number[]): number`; `expansionZones(open: number, resistExp: number, supportExp: number, inner: [number, number], outer: [number, number]): { R1: ZoneBand; R2: ZoneBand; S1: ZoneBand; S2: ZoneBand }`.

- [ ] **Step 1: Create the test file with failing helper tests**

Create `lib/indicators/jumboZones.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { computeJumboZones, median, expansionZones } from './jumboZones';

const DAY = 86400;
const oc = (time: number, o: number, h: number, l: number): Candle => ({ time, open: o, high: h, low: l, close: o, volume: 1 });

describe('median', () => {
  it('odd / even / unsorted / empty', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe('expansionZones', () => {
  it('matches the creator worked example (O 64000, EB 780, ES 760, 21/29/53/62)', () => {
    const z = expansionZones(64000, 780, 760, [21, 29], [53, 62]);
    expect(z.R1.lower).toBeCloseTo(64163.8, 6); expect(z.R1.upper).toBeCloseTo(64226.2, 6);
    expect(z.R2.lower).toBeCloseTo(64413.4, 6); expect(z.R2.upper).toBeCloseTo(64483.6, 6);
    expect(z.S1.lower).toBeCloseTo(63779.6, 6); expect(z.S1.upper).toBeCloseTo(63840.4, 6);
    expect(z.S2.lower).toBeCloseTo(63528.8, 6); expect(z.S2.upper).toBeCloseTo(63597.2, 6);
  });
  it('validates crossing percentiles via min/max (never flips)', () => {
    const z = expansionZones(1000, 100, 100, [35, 29], [53, 62]);
    expect(z.R1.lower).toBeLessThan(z.R1.upper);
    expect(z.R1.lower).toBeCloseTo(1029, 6); // min(1035, 1029)
    expect(z.R1.upper).toBeCloseTo(1035, 6);
  });
});
```

- [ ] **Step 2: Create the engine file with only the helpers (so the imports resolve)**

Create `lib/indicators/jumboZones.ts`:

```typescript
// "Jumbo Zones" — the creator's official Elephant Edge model (steps 1-7 + freeze).
// A SEPARATE indicator from `elephant_zone` (kept for comparison). No Pine source
// exists; this is a best-effort reconstruction from the creator's documentation.
//
// Model: each new UTC session, anchor = today's session OPEN. From the last N
// PRIOR sessions' expansion (bull = high-open, bear = open-low), take a robust
// average (median default), then percentile-pair bands around the open:
//   R1 = [O + ER·21%, O + ER·29%], R2 = [O + ER·53%, O + ER·62%]  (ER = bull exp)
//   S1/S2 mirror below with ES (bear exp). directional (separate bull/bear) or
//   symmetric ((EB+ES)/2). Bands validated (min/max), frozen per session,
//   non-repainting. Plus prev-close & HLC/3 pivots.
// Design: docs/superpowers/specs/2026-07-29-elephant-zone-v2-expansion-percentile-design.md

import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorPlot, IndicatorResult, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

const SECONDS_PER_DAY = 86400;

export interface ZoneBand { lower: number; upper: number; }

/** Median of a numeric array (0 for empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The 4 Jumbo zone bands from the session open + resistance/support expansion +
 *  inner/outer percentile pairs (percent values, e.g. [21,29]). Each band is
 *  min/max-validated so it never flips. */
export function expansionZones(
  open: number,
  resistExp: number,
  supportExp: number,
  inner: [number, number],
  outer: [number, number],
): { R1: ZoneBand; R2: ZoneBand; S1: ZoneBand; S2: ZoneBand } {
  const band = (a: number, b: number): ZoneBand => ({ lower: Math.min(a, b), upper: Math.max(a, b) });
  const [p1, p2] = inner;
  const [p3, p4] = outer;
  return {
    R1: band(open + resistExp * (p1 / 100), open + resistExp * (p2 / 100)),
    R2: band(open + resistExp * (p3 / 100), open + resistExp * (p4 / 100)),
    S1: band(open - supportExp * (p1 / 100), open - supportExp * (p2 / 100)),
    S2: band(open - supportExp * (p3 / 100), open - supportExp * (p4 / 100)),
  };
}
```

(Note: `computeJumboZones` is referenced by the test import but added in Task 2 — the helper tests are run with `-t` filters that don't call it, so they pass; the file compiles once Task 2 adds it. Run the filtered helper tests now.)

- [ ] **Step 3: Run the helper tests to verify they pass**

Run: `npx vitest run lib/indicators/jumboZones.test.ts -t "median|expansionZones"`
Expected: PASS (the two helper describes).

- [ ] **Step 4: Commit**

```bash
git add lib/indicators/jumboZones.ts lib/indicators/jumboZones.test.ts
git commit -m "feat(indicator): Jumbo Zones helpers (median, expansionZones)"
```

---

### Task 2: Add the Jumbo Zones engine

**Files:**
- Modify: `lib/indicators/jumboZones.ts` (append inputs, defaults, `computeJumboZones`)
- Modify: `lib/indicators/jumboZones.test.ts` (append the engine describe)

**Interfaces:**
- Consumes: `median`, `expansionZones`, `ZoneBand` (Task 1).
- Produces: `JumboZonesInputs`, `JUMBO_ZONES_DEFAULTS`, `computeJumboZones(candles, config?)` emitting bands `R1, R2, S1, S2` and lines `PIVOT, PIVOT_P`.

- [ ] **Step 1: Append the failing engine tests**

Append to `lib/indicators/jumboZones.test.ts`:

```typescript
describe('computeJumboZones', () => {
  const find = (candles: Candle[], id: string) => computeJumboZones(candles).plots.find((p) => p.id === id)!;
  // 3 one-bar sessions. day0 bull=700 bear=740; day1 bull=860 bear=780;
  // day2 target (open 64000). median bull(700,860)=780, bear(740,780)=760 → doc example.
  const CANDLES = [
    oc(0, 63000, 63700, 62260),           // day0: bull 700, bear 740
    oc(DAY, 63500, 64360, 62720),          // day1: bull 860, bear 780
    oc(2 * DAY, 64000, 64010, 63990),      // day2: target session (open 64000)
  ];

  it('empty candles → no plots, no throw', () => {
    expect(() => computeJumboZones([])).not.toThrow();
    expect(computeJumboZones([]).plots).toEqual([]);
  });

  it('day-2 zones use median prior expansion + today\'s open (matches the doc example)', () => {
    const r1 = find(CANDLES, 'R1'); const s2 = find(CANDLES, 'S2');
    expect(r1.data[0]).toBeNull(); // day0: no prior session
    expect(r1.data[1]).not.toBeNull(); // day1: has day0 prior
    const r1d2 = r1.data[2] as { upper: number; lower: number };
    expect(r1d2.lower).toBeCloseTo(64163.8, 6);
    expect(r1d2.upper).toBeCloseTo(64226.2, 6);
    const s2d2 = s2.data[2] as { upper: number; lower: number };
    expect(s2d2.lower).toBeCloseTo(63528.8, 6);
    expect(s2d2.upper).toBeCloseTo(63597.2, 6);
    expect(r1.type).toBe('band');
    expect(r1.zoneStyle).toEqual({ boundary: 'lower', lineStyle: 'solid', emphasis: 0 });
    expect(find(CANDLES, 'S1').zoneStyle).toEqual({ boundary: 'upper', lineStyle: 'solid', emphasis: 0 });
  });

  it('symmetric mode uses (EB+ES)/2 both sides', () => {
    const cfg = { expansionMode: 'symmetric' } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    // E = (780+760)/2 = 770; R1 = [64000+770*0.21, 64000+770*0.29] = [64161.7, 64223.3]
    const r1 = computeJumboZones(CANDLES, cfg).plots.find((p) => p.id === 'R1')!;
    const r1d2 = r1.data[2] as { upper: number; lower: number };
    expect(r1d2.lower).toBeCloseTo(64161.7, 6);
    expect(r1d2.upper).toBeCloseTo(64223.3, 6);
  });

  it('emits R1/R2/S1/S2 bands + PIVOT/PIVOT_P lines, all overlay', () => {
    const plots = computeJumboZones(CANDLES).plots;
    expect(plots.map((p) => p.id).sort()).toEqual(['PIVOT', 'PIVOT_P', 'R1', 'R2', 'S1', 'S2']);
    for (const p of plots) {
      const expected = (p.id === 'PIVOT' || p.id === 'PIVOT_P') ? 'line' : 'band';
      expect(p.type).toBe(expected);
      expect(p.pane).toBe('overlay');
    }
  });

  it('pivots: anchor = prev close, HLC/3 = prev-day aggregate', () => {
    const pivot = find(CANDLES, 'PIVOT'); const pp = find(CANDLES, 'PIVOT_P');
    expect(pivot.data[1]).toBe(63000); // day1 anchor = day0 close
    expect((pp.data[1] as number)).toBeCloseTo((63700 + 62260 + 63000) / 3, 6);
  });

  it('respects show toggles (hide support + pivots)', () => {
    const cfg = { showSupport: false, showPivot: false, showPivotP: false } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const ids = computeJumboZones(CANDLES, cfg).plots.map((p) => p.id);
    expect(ids).not.toContain('S1');
    expect(ids).not.toContain('PIVOT');
    expect(ids).not.toContain('PIVOT_P');
    expect(ids).toContain('R1');
  });
});
```

- [ ] **Step 2: Run the engine tests to verify they fail**

Run: `npx vitest run lib/indicators/jumboZones.test.ts -t "computeJumboZones"`
Expected: FAIL — `computeJumboZones` not yet exported.

- [ ] **Step 3: Append inputs, defaults, and the engine to `lib/indicators/jumboZones.ts`**

Append to the end of `lib/indicators/jumboZones.ts`:

```typescript
export type AvgMethod = 'median' | 'mean';
export type ExpansionMode = 'directional' | 'symmetric';

export interface JumboZonesInputs {
  /** Prior sessions to average expansion over. */
  sessionLookback: number;
  avgMethod: AvgMethod;
  /** directional = separate bull/bear expansion; symmetric = mean of both. */
  expansionMode: ExpansionMode;
  /** Inner/outer percentile pairs (percent values). */
  innerLow: number;
  innerHigh: number;
  outerLow: number;
  outerHigh: number;
  showResistance: boolean;
  showSupport: boolean;
  showPivot: boolean;
  showPivotP: boolean;
  upperColor: string;
  lowerColor: string;
  pivotColor: string;
  pivotPColor: string;
  pivotLineWidth: number;
}

export const JUMBO_ZONES_DEFAULTS: JumboZonesInputs = {
  sessionLookback: 20,
  avgMethod: 'median',
  expansionMode: 'directional',
  innerLow: 21,
  innerHigh: 29,
  outerLow: 53,
  outerHigh: 62,
  showResistance: true,
  showSupport: true,
  showPivot: true,
  showPivotP: true,
  upperColor: 'rgba(176,124,64,1)',  // amber resistance
  lowerColor: 'rgba(64,150,108,1)',  // green support
  pivotColor: 'rgba(80,190,240,1)',  // cyan (prev close)
  pivotPColor: 'rgba(99,102,241,1)', // indigo (HLC/3)
  pivotLineWidth: 3,
};

export function computeJumboZones(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<JumboZonesInputs>(config, JUMBO_ZONES_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const dayOf = (t: number) => Math.floor(t / SECONDS_PER_DAY);
  const dayKeys = candles.map((c) => dayOf(c.time));
  const dayEndsAt = (i: number) => i + 1 < n && dayKeys[i + 1] !== dayKeys[i];

  // Anchor pivot (previous day's last close).
  const anchorForDay = new Map<number, number>();
  for (let i = 1; i < n; i++) {
    const day = dayKeys[i];
    if (dayKeys[i - 1] !== day && !anchorForDay.has(day)) {
      anchorForDay.set(day, candles[i - 1].close);
    }
  }

  // Per-day session aggregate: open (first bar), high (max), low (min), close (last).
  const dayAgg = new Map<number, { open: number; high: number; low: number; close: number }>();
  const orderedDays: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dayKeys[i];
    const a = dayAgg.get(d);
    if (!a) { dayAgg.set(d, { open: candles[i].open, high: candles[i].high, low: candles[i].low, close: candles[i].close }); orderedDays.push(d); }
    else { a.high = Math.max(a.high, candles[i].high); a.low = Math.min(a.low, candles[i].low); a.close = candles[i].close; }
  }
  const dayIndexOf = new Map<number, number>(orderedDays.map((d, idx) => [d, idx]));

  const avg = inp.avgMethod === 'mean'
    ? (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    : median;

  // Zones per day from the last `sessionLookback` PRIOR sessions' expansion.
  const zonesForDay = new Map<number, ReturnType<typeof expansionZones>>();
  for (const day of orderedDays) {
    const p = dayIndexOf.get(day)!;
    if (p <= 0) continue; // no prior session
    const from = Math.max(0, p - inp.sessionLookback);
    const bull: number[] = [];
    const bear: number[] = [];
    for (let q = from; q < p; q++) {
      const a = dayAgg.get(orderedDays[q])!;
      bull.push(a.high - a.open);
      bear.push(a.open - a.low);
    }
    const EB = avg(bull);
    const ES = avg(bear);
    const resistExp = inp.expansionMode === 'symmetric' ? (EB + ES) / 2 : EB;
    const supportExp = inp.expansionMode === 'symmetric' ? (EB + ES) / 2 : ES;
    const O = dayAgg.get(day)!.open;
    zonesForDay.set(day, expansionZones(O, resistExp, supportExp, [inp.innerLow, inp.innerHigh], [inp.outerLow, inp.outerHigh]));
  }

  const plots: IndicatorPlot[] = [];

  // Zone bands — each day is a separate run (different upper/lower), so the band
  // primitive draws one rectangle per session; no day-boundary null needed.
  const pushZone = (id: string, pick: (z: ReturnType<typeof expansionZones>) => ZoneBand, color: string, boundary: 'lower' | 'upper') => {
    const data = new Array<{ upper: number; lower: number } | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const z = zonesForDay.get(dayKeys[i]);
      if (!z) continue;
      const b = pick(z);
      data[i] = { upper: b.upper, lower: b.lower };
    }
    plots.push({ id, title: id, color, type: 'band', pane: 'overlay', data, zoneStyle: { boundary, lineStyle: 'solid', emphasis: 0 } });
  };
  if (inp.showResistance) {
    pushZone('R1', (z) => z.R1, inp.upperColor, 'lower');
    pushZone('R2', (z) => z.R2, inp.upperColor, 'lower');
  }
  if (inp.showSupport) {
    pushZone('S1', (z) => z.S1, inp.lowerColor, 'upper');
    pushZone('S2', (z) => z.S2, inp.lowerColor, 'upper');
  }

  // Pivots (pixel-width lines, day-boundary break).
  if (inp.showPivot) {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const anchor = anchorForDay.get(dayKeys[i]);
      if (anchor == null) continue;
      data[i] = dayEndsAt(i) ? null : anchor;
    }
    plots.push({ id: 'PIVOT', title: 'Pivot', color: inp.pivotColor, type: 'line', pane: 'overlay', data, lineWidth: inp.pivotLineWidth });
  }

  if (inp.showPivotP) {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const p = dayIndexOf.get(dayKeys[i])!;
      if (p <= 0) continue; // no prior day
      const prev = dayAgg.get(orderedDays[p - 1])!;
      data[i] = dayEndsAt(i) ? null : (prev.high + prev.low + prev.close) / 3;
    }
    plots.push({ id: 'PIVOT_P', title: 'Pivot P', color: inp.pivotPColor, type: 'line', pane: 'overlay', data, lineWidth: inp.pivotLineWidth });
  }

  return { plots, signals };
}
```

- [ ] **Step 4: Run the full test file + typecheck**

Run: `npx vitest run lib/indicators/jumboZones.test.ts`
Expected: PASS (helpers + engine).

Run: `npx tsc --noEmit 2>&1 | grep -v "signals.test.ts"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/jumboZones.ts lib/indicators/jumboZones.test.ts
git commit -m "feat(indicator): Jumbo Zones engine (session-open expansion-percentile bands)"
```

---

### Task 3: Register the Jumbo Zones indicator

**Files:**
- Modify: `lib/customIndicatorsLibrary.ts` (add import + `jumbo_zones` entry; leave `elephant_zone` untouched)

**Interfaces:**
- Consumes: `computeJumboZones` (Task 2).

- [ ] **Step 1: Add the import**

In `lib/customIndicatorsLibrary.ts`, add next to the existing `computeElephantZone` import (around line 28):

```typescript
import { computeJumboZones } from './indicators/jumboZones';
```

- [ ] **Step 2: Add the `jumbo_zones` registry entry**

In `lib/customIndicatorsLibrary.ts`, add this object to the `CUSTOM_INDICATORS` array immediately AFTER the existing `elephant_zone` entry (before the closing `];`):

```typescript
  {
    id: 'jumbo_zones',
    name: 'Jumbo Zones',
    description:
      'Official Elephant Edge model: adaptive S/R zones from historical session expansion. Anchored on today\'s session OPEN, R1/R2 (resistance) and S1/S2 (support) are percentile-pair bands of the median bull/bear expansion over the last N sessions — they widen/tighten with volatility and reset each session. Cross-market (crypto/forex/indices). Separate from Elephant Zone for comparison. Best-effort reconstruction; compare before trusting.',
    inputs: [
      { id: 'sessionLookback', name: 'Session lookback', type: 'number', default: 20, min: 1, max: 200, step: 1 },
      { id: 'avgMethod', name: 'Average method', type: 'select', default: 'median', options: [{ value: 'median', label: 'Median (robust)' }, { value: 'mean', label: 'Mean' }] },
      { id: 'expansionMode', name: 'Expansion mode', type: 'select', default: 'directional', options: [{ value: 'directional', label: 'Directional (bull/bear)' }, { value: 'symmetric', label: 'Symmetric' }] },
      { id: 'innerLow', name: 'Inner % low', type: 'number', default: 21, min: 0, max: 500, step: 1, group: 'Percentiles' },
      { id: 'innerHigh', name: 'Inner % high', type: 'number', default: 29, min: 0, max: 500, step: 1, group: 'Percentiles' },
      { id: 'outerLow', name: 'Outer % low', type: 'number', default: 53, min: 0, max: 500, step: 1, group: 'Percentiles' },
      { id: 'outerHigh', name: 'Outer % high', type: 'number', default: 62, min: 0, max: 500, step: 1, group: 'Percentiles' },
      { id: 'showResistance', name: 'Show resistance', type: 'boolean', default: true, group: 'Display' },
      { id: 'showSupport', name: 'Show support', type: 'boolean', default: true, group: 'Display' },
      { id: 'showPivot', name: 'Show pivot (prev close)', type: 'boolean', default: true, group: 'Display' },
      { id: 'showPivotP', name: 'Show pivot P (HLC/3)', type: 'boolean', default: true, group: 'Display' },
      { id: 'pivotLineWidth', name: 'Pivot line width', type: 'number', default: 3, min: 1, max: 4, step: 1, group: 'Display' },
    ],
    styles: [
      { id: 'R1', name: 'Resistance 1 (inner)', color: 'rgba(176,124,64,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'R2', name: 'Resistance 2 (outer)', color: 'rgba(176,124,64,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'S1', name: 'Support 1 (inner)', color: 'rgba(64,150,108,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'S2', name: 'Support 2 (outer)', color: 'rgba(64,150,108,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'PIVOT', name: 'Pivot (prev close)', color: 'rgba(80,190,240,1)', thickness: 3, lineStyle: 'solid', display: true },
      { id: 'PIVOT_P', name: 'Pivot P (HLC/3)', color: 'rgba(99,102,241,1)', thickness: 3, lineStyle: 'solid', display: true },
    ],
    compute: computeJumboZones,
  },
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit 2>&1 | grep -v "signals.test.ts"` — expect no output.
Run: `npx vitest run` — expect all green except the pre-existing `signals.test.ts` parse error.

- [ ] **Step 4: Live verify**

Set the active indicator to `jumbo_zones` (`localStorage['btc-mood:chart-indicators:v1'] = ["jumbo_zones::default"]`, reload). Confirm: 2 amber resistance bands above + 2 green support bands below, naturally different widths, frozen per session and resetting daily; cyan prev-close + indigo HLC/3 pivots; 0 console errors. Toggle Expansion mode → symmetric → bands become equidistant. Confirm the existing "Elephant Zone (S/R Levels)" indicator is still present and unchanged in the picker.

- [ ] **Step 5: Commit**

```bash
git add lib/customIndicatorsLibrary.ts
git commit -m "feat(indicator): register Jumbo Zones (separate from Elephant Zone)"
```

---

## Self-Review

**Spec coverage:**
- New `jumbo_zones` indicator, `elephant_zone` untouched → Tasks 1-3 all in new file + additive registry entry. ✓
- Session-open anchor, bull/bear expansion, median over N prior → Task 2. ✓
- Percentile-pair bands + min/max validation → Task 1 `expansionZones`. ✓
- directional / symmetric modes → Task 2. ✓
- Freeze / non-repainting → Task 2 (prior sessions + today's open only). ✓
- R1/R2/S1/S2 bands + pivots as lines → Task 2 + Task 3 styles. ✓
- Config + registry → Task 2 interface + Task 3. ✓
- Worked-example, validation, modes, plot-set tests → Tasks 1-2. ✓

**Placeholder scan:** none — all code and test bodies complete.

**Type consistency:** `ZoneBand`, `median`, `expansionZones` match between Task 1 and Task 2. `JumboZonesInputs` fields (Task 2) match registry input ids (Task 3): `sessionLookback`, `avgMethod`, `expansionMode`, `innerLow/innerHigh/outerLow/outerHigh`, `show*`, `pivotLineWidth`. Colors in `JUMBO_ZONES_DEFAULTS` and `styles` use identical RGB. Plot ids `R1/R2/S1/S2/PIVOT/PIVOT_P` match engine emission and registry styles. `computeJumboZones` name matches across the new file, tests, and the registry import.
