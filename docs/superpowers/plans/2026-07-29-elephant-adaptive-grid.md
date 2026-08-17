# Elephant Zone — Cross-Asset Adaptive S/R Grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Elephant Zone indicator's fixed-offset zone math with a three-mode (volatility / round / manual) psychological S/R grid that works across all markets, keeping the same indicator id, name, and the two pivot lines.

**Architecture:** Two pure exported helpers do the level math — `niceSnap` (round a raw step to a clean 1/2/2.5/5×10ᵏ) and `gridScaleFor` (given the day's anchor + prior-day average range, return `{base, step}` per mode). `computeElephantZone` is rewritten to aggregate per-day H/L, feed those into `gridScaleFor`, and emit R/S/Base/Pivot/Pivot-P as line plots. Registry inputs/styles are updated to expose the modes.

**Tech Stack:** TypeScript, Vitest, existing `IndicatorPlot`/`resolveInputs` framework.

## Global Constraints

- Same indicator id `elephant_zone` and display name "Elephant Zone (S/R Levels)". Verbatim from spec.
- Daily anchor = previous UTC-day close (`floor(time/86400)` bucketing), unchanged. Non-repainting: a day's grid uses only strictly-prior days' completed aggregates.
- All plots are `type: 'line'`, `pane: 'overlay'`, broken at day boundaries (`null` at each bar where the next bar is a new day), `null` on the first day (no prior day).
- `levelCount` default 4; `spacingMode` default `'volatility'`; `atrLength` 14; `stepFraction` 0.25.
- Self-consistency tests only — no Pine golden master (honesty caveat retained).
- `npx tsc --noEmit` stays clean (ignore only the pre-existing unrelated `lib/indicators/maFvg/signals.test.ts` parse error). Full `npx vitest run` stays green.

---

## File Structure

- Modify: `lib/indicators/elephantZone.ts` — full rewrite of inputs, defaults, and `computeElephantZone`; add exported `niceSnap` + `gridScaleFor`.
- Modify: `lib/indicators/elephantZone.test.ts` — replace zone-offset tests with grid tests; add helper tests.
- Modify: `lib/customIndicatorsLibrary.ts:705-730` — new `elephant_zone` inputs + styles.

---

### Task 1: Pure level-math helpers (`niceSnap`, `gridScaleFor`)

**Files:**
- Modify: `lib/indicators/elephantZone.ts` (add the two exported helpers + the `SpacingMode` type; leave the old engine in place for now so the file still compiles)
- Modify: `lib/indicators/elephantZone.test.ts` (add a new `describe` block; do not touch existing tests yet)

**Interfaces:**
- Produces: `niceSnap(x: number): number`; `type SpacingMode = 'volatility' | 'round' | 'manual'`; `gridScaleFor(anchor: number, avgDailyRange: number | null, inp: { spacingMode: SpacingMode; stepFraction: number; roundBase: number; stepSize: number }): { base: number; step: number } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/indicators/elephantZone.test.ts` (add the import of the new symbols to the top `import` line):

```typescript
import { computeElephantZone, niceSnap, gridScaleFor } from './elephantZone';

describe('niceSnap', () => {
  it('snaps to the nearest 1 / 2 / 2.5 / 5 / 10 x 10^k', () => {
    expect(niceSnap(1.3)).toBe(1);
    expect(niceSnap(2)).toBe(2);
    expect(niceSnap(3.4)).toBe(2.5);
    expect(niceSnap(6)).toBe(5);
    expect(niceSnap(8)).toBe(10);
    expect(niceSnap(173)).toBe(200);
    expect(niceSnap(0.006)).toBe(0.005);
    expect(niceSnap(0.007)).toBe(0.01); // float-dust safe (6.9999… rounds to 7 → 10)
  });
  it('guards non-positive / non-finite input', () => {
    expect(niceSnap(0)).toBe(0);
    expect(niceSnap(-5)).toBe(0);
    expect(niceSnap(NaN)).toBe(0);
  });
});

describe('gridScaleFor', () => {
  it('volatility mode: step = niceSnap(range x fraction), base snapped to nearest step', () => {
    // range 16 x 0.25 = 4 -> niceSnap -> 5; base = round(110/5)*5 = 110
    expect(gridScaleFor(110, 16, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 }))
      .toEqual({ base: 110, step: 5 });
  });
  it('volatility mode: no range available -> null (no grid that day)', () => {
    expect(gridScaleFor(110, null, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 })).toBeNull();
    expect(gridScaleFor(110, 0, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 })).toBeNull();
  });
  it('round mode: continuous magnitude, exact round levels', () => {
    // anchor 110 -> magnitude 100, roundBase 10, step 2, base = round(110/10)*10 = 110
    expect(gridScaleFor(110, null, { spacingMode: 'round', stepFraction: 0.25, roundBase: 0, stepSize: 0 }))
      .toEqual({ base: 110, step: 2 });
  });
  it('round mode: tiny price never collapses to base 0 (micro-cap safe)', () => {
    const s = gridScaleFor(0.0000123, null, { spacingMode: 'round', stepFraction: 0.25, roundBase: 0, stepSize: 0 })!;
    expect(s.base).toBeGreaterThan(0);
    expect(s.base - 4 * s.step).toBeGreaterThan(0); // deepest support still positive
  });
  it('manual mode: honors roundBase + stepSize', () => {
    // base = round(110/50)*50 = 100, step = 10
    expect(gridScaleFor(110, null, { spacingMode: 'manual', stepFraction: 0.25, roundBase: 50, stepSize: 10 }))
      .toEqual({ base: 100, step: 10 });
  });
  it('guards bad anchor / bad manual params', () => {
    expect(gridScaleFor(0, 16, { spacingMode: 'volatility', stepFraction: 0.25, roundBase: 0, stepSize: 0 })).toBeNull();
    expect(gridScaleFor(110, null, { spacingMode: 'manual', stepFraction: 0.25, roundBase: 0, stepSize: 10 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run lib/indicators/elephantZone.test.ts -t "niceSnap|gridScaleFor"`
Expected: FAIL — `niceSnap`/`gridScaleFor` are not exported.

- [ ] **Step 3: Add the helpers to `lib/indicators/elephantZone.ts`**

Add near the top of the file, after the imports and before `interface ElephantZoneInputs` (leave the existing `ElephantZoneInputs`/`computeElephantZone` untouched in this task):

```typescript
export type SpacingMode = 'volatility' | 'round' | 'manual';

/** Round a raw step to the nearest "nice" increment: 1 / 2 / 2.5 / 5 / 10 × 10^k. */
export function niceSnap(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const exp = Math.floor(Math.log10(x));
  const pow = Math.pow(10, exp);
  const f = Math.round((x / pow) * 1e6) / 1e6; // kill float dust at bucket edges
  const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 4 ? 2.5 : f < 7 ? 5 : 10;
  return nice * pow;
}

/** The grid's centre (base) and spacing (step) for one day's anchor, per mode.
 *  Returns null when a grid can't be formed (bad anchor, no volatility, bad manual params). */
export function gridScaleFor(
  anchor: number,
  avgDailyRange: number | null,
  inp: { spacingMode: SpacingMode; stepFraction: number; roundBase: number; stepSize: number },
): { base: number; step: number } | null {
  if (!(anchor > 0) || !Number.isFinite(anchor)) return null;

  if (inp.spacingMode === 'manual') {
    const { roundBase, stepSize } = inp;
    if (!(roundBase > 0) || !(stepSize > 0)) return null;
    return { base: Math.round(anchor / roundBase) * roundBase, step: stepSize };
  }

  if (inp.spacingMode === 'round') {
    const magnitude = Math.pow(10, Math.floor(Math.log10(anchor)));
    const roundBase = magnitude / 10;
    const step = roundBase / 5;
    if (!(roundBase > 0) || !(step > 0)) return null;
    return { base: Math.round(anchor / roundBase) * roundBase, step };
  }

  // volatility
  if (avgDailyRange == null || !(avgDailyRange > 0)) return null;
  const step = niceSnap(avgDailyRange * inp.stepFraction);
  if (!(step > 0)) return null;
  return { base: Math.round(anchor / step) * step, step };
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `npx vitest run lib/indicators/elephantZone.test.ts -t "niceSnap|gridScaleFor"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/indicators/elephantZone.ts lib/indicators/elephantZone.test.ts
git commit -m "feat(indicator): Elephant grid level-math helpers (niceSnap, gridScaleFor)"
```

---

### Task 2: Rewrite the engine to emit the adaptive grid

**Files:**
- Modify: `lib/indicators/elephantZone.ts` (replace `ElephantZoneInputs`, `ELEPHANT_ZONE_DEFAULTS`, the `SIDES` block, and `computeElephantZone`; keep the helpers from Task 1)
- Modify: `lib/indicators/elephantZone.test.ts` (delete the old zone-offset `describe('computeElephantZone', ...)` body and replace with the grid tests below; keep the `niceSnap`/`gridScaleFor` describes)

**Interfaces:**
- Consumes: `niceSnap`, `gridScaleFor`, `SpacingMode` (Task 1).
- Produces: rewritten `ElephantZoneInputs`, `ELEPHANT_ZONE_DEFAULTS`, `computeElephantZone(candles, config?) → IndicatorResult` emitting line plots `R1..R{levelCount}`, `S1..S{levelCount}`, `BASE`, `PIVOT`, `PIVOT_P`.

- [ ] **Step 1: Replace the engine tests**

In `lib/indicators/elephantZone.test.ts`, replace the entire `describe('computeElephantZone', () => { ... })` block (the original one, NOT the helper describes) with:

```typescript
describe('computeElephantZone (adaptive grid)', () => {
  const find = (candles: Candle[], id: string) => computeElephantZone(candles).plots.find((p) => p.id === id)!;

  it('empty candles → no plots, no throw', () => {
    expect(() => computeElephantZone([])).not.toThrow();
    expect(computeElephantZone([]).plots).toEqual([]);
  });

  it('volatility mode: day 1 grid from day 0 range; base snapped, R/S at base ± k·step', () => {
    // day 0: closes 96 & 110 → high 111, low 95, range 16; avg range(day1)=16
    // step = niceSnap(16·0.25)=niceSnap(4)=5; anchor(day1)=110; base=round(110/5)*5=110
    const candles = [
      bar(0, 96), bar(DAY - 100, 110),       // day 0
      bar(DAY, 200), bar(DAY + 100, 201),    // day 1
    ];
    const r1 = find(candles, 'R1'); const s1 = find(candles, 'S1'); const base = find(candles, 'BASE');
    expect(r1.data[0]).toBeNull(); // day 0 has no prior day → no grid
    expect(r1.data[1]).toBeNull();
    expect(r1.data[2]).toBe(115); // 110 + 1*5
    expect(r1.data[3]).toBe(115);
    expect(s1.data[2]).toBe(105); // 110 - 1*5
    expect(base.data[2]).toBe(110);
    expect(r1.type).toBe('line');
    expect(base.lineStyle).toBe('dashed');
  });

  it('emits R1-4, S1-4, BASE, PIVOT, PIVOT_P (default levelCount 4), all overlay lines', () => {
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200)];
    const ids = computeElephantZone(candles).plots.map((p) => p.id).sort();
    expect(ids).toEqual(['BASE', 'PIVOT', 'PIVOT_P', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4']);
    expect(computeElephantZone(candles).plots.every((p) => p.type === 'line' && p.pane === 'overlay')).toBe(true);
  });

  it('anchor pivot = previous close; HLC/3 pivot = prev-day aggregate (H+L+C)/3', () => {
    // day 0: closes 96,110 → high 111, low 95, close 110 → HLC/3 = (111+95+110)/3 = 105.333…
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200), bar(DAY + 100, 201)];
    expect(find(candles, 'PIVOT').data[2]).toBe(110);
    expect(find(candles, 'PIVOT_P').data[2]).toBeCloseTo((111 + 95 + 110) / 3, 6);
  });

  it('resets grid each UTC day; a later day uses more prior-day ranges', () => {
    const candles = [
      bar(0, 96), bar(DAY - 100, 110),        // day0 range 16
      bar(DAY, 108), bar(2 * DAY - 100, 120),  // day1 range: high 121, low 107 = 14
      bar(2 * DAY, 200),                        // day2
    ];
    // day2 anchor = 120; avg range over days 0,1 = (16+14)/2 = 15; step=niceSnap(15*0.25=3.75)=2.5
    // base = round(120/2.5)*2.5 = 120
    expect(find(candles, 'BASE').data[4]).toBe(120);
    expect(find(candles, 'R1').data[4]).toBe(122.5);
  });

  it('round mode produces exact round-number levels', () => {
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200)];
    const round = { spacingMode: 'round' } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const plots = computeElephantZone(candles, round).plots;
    const base = plots.find((p) => p.id === 'BASE')!;
    const r1 = plots.find((p) => p.id === 'R1')!;
    // anchor 110 → roundBase 10, step 2, base 110
    expect(base.data[2]).toBe(110);
    expect(r1.data[2]).toBe(112);
  });

  it('respects show toggles (hide support + pivots)', () => {
    const candles = [bar(0, 96), bar(DAY - 100, 110), bar(DAY, 200)];
    const cfg = { showSupport: false, showPivot: false, showPivotP: false } as unknown as import('@/lib/indicatorFramework').CustomIndicatorConfig;
    const ids = computeElephantZone(candles, cfg).plots.map((p) => p.id);
    expect(ids).not.toContain('S1');
    expect(ids).not.toContain('PIVOT');
    expect(ids).not.toContain('PIVOT_P');
    expect(ids).toContain('R1');
  });
});
```

- [ ] **Step 2: Run the engine tests to verify they fail**

Run: `npx vitest run lib/indicators/elephantZone.test.ts -t "adaptive grid"`
Expected: FAIL — old engine emits band zones / different plot set.

- [ ] **Step 3: Replace inputs, defaults, and the engine**

In `lib/indicators/elephantZone.ts`, replace the `ElephantZoneInputs` interface, `ELEPHANT_ZONE_DEFAULTS`, the `ZoneSide`/`SIDES` block, and the whole `computeElephantZone` function with:

```typescript
export interface ElephantZoneInputs {
  spacingMode: SpacingMode;
  /** Volatility mode: days of prior daily-range history to average. */
  atrLength: number;
  /** Volatility mode: step = niceSnap(avgDailyRange × stepFraction). */
  stepFraction: number;
  /** Manual mode: base snaps to this; levels step by stepSize. */
  roundBase: number;
  stepSize: number;
  /** Grid levels each side of the base. */
  levelCount: number;
  showResistance: boolean;
  showSupport: boolean;
  showBase: boolean;
  showPivot: boolean;
  showPivotP: boolean;
  upperColor: string;
  lowerColor: string;
  baseColor: string;
  pivotColor: string;
  pivotPColor: string;
  lineWidth: number;
  pivotLineWidth: number;
}

export const ELEPHANT_ZONE_DEFAULTS: ElephantZoneInputs = {
  spacingMode: 'volatility',
  atrLength: 14,
  stepFraction: 0.25,
  roundBase: 1000,
  stepSize: 200,
  levelCount: 4,
  showResistance: true,
  showSupport: true,
  showBase: true,
  showPivot: true,
  showPivotP: true,
  upperColor: 'rgba(176,124,64,1)',  // amber resistance
  lowerColor: 'rgba(64,150,108,1)',  // green support
  baseColor: 'rgba(255,255,255,0.3)',
  pivotColor: 'rgba(80,190,240,1)',  // cyan (prev close)
  pivotPColor: 'rgba(99,102,241,1)', // indigo (HLC/3)
  lineWidth: 2,
  pivotLineWidth: 3,
};

export function computeElephantZone(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<ElephantZoneInputs>(config, ELEPHANT_ZONE_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const dayOf = (t: number) => Math.floor(t / SECONDS_PER_DAY);
  const dayKeys = candles.map((c) => dayOf(c.time));
  const dayEndsAt = (i: number) => i + 1 < n && dayKeys[i + 1] !== dayKeys[i];

  // Anchor per day = the previous day's last close.
  const anchorForDay = new Map<number, number>();
  for (let i = 1; i < n; i++) {
    const day = dayKeys[i];
    if (dayKeys[i - 1] !== day && !anchorForDay.has(day)) {
      anchorForDay.set(day, candles[i - 1].close);
    }
  }

  // Per-day OHLC aggregate + chronological day list (for HLC/3 pivot + avg range).
  const dayAgg = new Map<number, { high: number; low: number; close: number }>();
  const orderedDays: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dayKeys[i];
    const a = dayAgg.get(d);
    if (!a) { dayAgg.set(d, { high: candles[i].high, low: candles[i].low, close: candles[i].close }); orderedDays.push(d); }
    else { a.high = Math.max(a.high, candles[i].high); a.low = Math.min(a.low, candles[i].low); a.close = candles[i].close; }
  }
  const dayIndexOf = new Map<number, number>(orderedDays.map((d, idx) => [d, idx]));

  // Average daily range over the last `atrLength` PRIOR days (non-repainting).
  const avgRangeForDay = (day: number): number | null => {
    const p = dayIndexOf.get(day)!;
    const from = Math.max(0, p - inp.atrLength);
    let sum = 0, count = 0;
    for (let q = from; q < p; q++) {
      const a = dayAgg.get(orderedDays[q])!;
      sum += a.high - a.low; count++;
    }
    return count > 0 ? sum / count : null;
  };

  // Grid scale per day (cached).
  const scaleForDay = new Map<number, { base: number; step: number }>();
  for (const day of orderedDays) {
    const anchor = anchorForDay.get(day);
    if (anchor == null) continue;
    const scale = gridScaleFor(anchor, avgRangeForDay(day), inp);
    if (scale) scaleForDay.set(day, scale);
  }

  const plots: IndicatorPlot[] = [];

  const pushLevel = (id: string, sign: 1 | -1, k: number, color: string) => {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const s = scaleForDay.get(dayKeys[i]);
      if (!s) continue;
      data[i] = dayEndsAt(i) ? null : s.base + sign * k * s.step;
    }
    plots.push({ id, title: id, color, type: 'line', pane: 'overlay', data, lineWidth: inp.lineWidth });
  };
  if (inp.showResistance) for (let k = 1; k <= inp.levelCount; k++) pushLevel(`R${k}`, 1, k, inp.upperColor);
  if (inp.showSupport) for (let k = 1; k <= inp.levelCount; k++) pushLevel(`S${k}`, -1, k, inp.lowerColor);

  if (inp.showBase) {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const s = scaleForDay.get(dayKeys[i]);
      if (!s) continue;
      data[i] = dayEndsAt(i) ? null : s.base;
    }
    plots.push({ id: 'BASE', title: 'Base', color: inp.baseColor, type: 'line', pane: 'overlay', data, lineWidth: 1, lineStyle: 'dashed' });
  }

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

Also update the file's top doc comment block (lines 1-14) to describe the grid model instead of the fixed-offset zones — replace the "Model:" paragraph with:

```typescript
// Model: each new UTC day, anchor = the PREVIOUS day's last close. A psychological
// S/R GRID is drawn around a base near that anchor. Spacing is chosen by mode:
//   volatility — step from the avg prior-day range, snapped to a nice increment
//   round      — continuous round-number magnitude (works at any price scale)
//   manual     — user-set roundBase + stepSize
// Levels: R_k = base + k·step, S_k = base − k·step. Plus a Base line, the anchor
// pivot (prev close) and the classic (H+L+C)/3 pivot. Lines, daily-reset.
// Design: docs/superpowers/specs/2026-07-29-elephant-adaptive-grid-design.md
```

- [ ] **Step 4: Run the full indicator test file**

Run: `npx vitest run lib/indicators/elephantZone.test.ts`
Expected: PASS (helper tests + adaptive-grid tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "signals.test.ts"`
Expected: no output. (If `SIDES`/`half`/`levels` unused-var errors appear, they mean leftover old-engine code — remove it.)

- [ ] **Step 6: Commit**

```bash
git add lib/indicators/elephantZone.ts lib/indicators/elephantZone.test.ts
git commit -m "feat(indicator): Elephant Zone adaptive grid engine (volatility/round/manual)"
```

---

### Task 3: Registry inputs + styles

**Files:**
- Modify: `lib/customIndicatorsLibrary.ts:705-730` (the `elephant_zone` object)

**Interfaces:**
- Consumes: the rewritten `ElephantZoneInputs` (Task 2) and `computeElephantZone`.

- [ ] **Step 1: Replace the `elephant_zone` registry entry**

Replace the entire `elephant_zone` object (currently `lib/customIndicatorsLibrary.ts:705-730`) with:

```typescript
  {
    id: 'elephant_zone',
    name: 'Elephant Zone (S/R Levels)',
    description:
      'Cross-asset psychological S/R grid anchored on the PREVIOUS day\'s close. Spacing adapts by mode: volatility (step from avg daily range, default), round (round-number magnitude — works at any price), or manual. Draws R1-4 / S1-4 grid lines, a Base line, and two pivots (prev close + HLC/3). Best-effort — no Pine source; compare before trusting.',
    inputs: [
      { id: 'spacingMode', name: 'Spacing Mode', type: 'select', default: 'volatility', options: [{ value: 'volatility', label: 'Volatility (adaptive)' }, { value: 'round', label: 'Round numbers' }, { value: 'manual', label: 'Manual' }] },
      { id: 'levelCount', name: 'Levels per side', type: 'number', default: 4, min: 1, max: 20, step: 1 },
      { id: 'atrLength', name: 'Avg range days', type: 'number', default: 14, min: 1, max: 200, step: 1, group: 'Volatility Mode' },
      { id: 'stepFraction', name: 'Step fraction of range', type: 'number', default: 0.25, min: 0.02, max: 2, step: 0.01, group: 'Volatility Mode' },
      { id: 'roundBase', name: 'Round base', type: 'number', default: 1000, min: 0.00000001, max: 1000000, step: 1, group: 'Manual Mode' },
      { id: 'stepSize', name: 'Step size', type: 'number', default: 200, min: 0.00000001, max: 1000000, step: 1, group: 'Manual Mode' },
      { id: 'showResistance', name: 'Show resistance', type: 'boolean', default: true, group: 'Display' },
      { id: 'showSupport', name: 'Show support', type: 'boolean', default: true, group: 'Display' },
      { id: 'showBase', name: 'Show base line', type: 'boolean', default: true, group: 'Display' },
      { id: 'showPivot', name: 'Show pivot (prev close)', type: 'boolean', default: true, group: 'Display' },
      { id: 'showPivotP', name: 'Show pivot P (HLC/3)', type: 'boolean', default: true, group: 'Display' },
      { id: 'lineWidth', name: 'Grid line width', type: 'number', default: 2, min: 1, max: 4, step: 1, group: 'Display' },
      { id: 'pivotLineWidth', name: 'Pivot line width', type: 'number', default: 3, min: 1, max: 4, step: 1, group: 'Display' },
    ],
    styles: [
      { id: 'R1', name: 'Resistance 1', color: 'rgba(176,124,64,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'R2', name: 'Resistance 2', color: 'rgba(176,124,64,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'R3', name: 'Resistance 3', color: 'rgba(176,124,64,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'R4', name: 'Resistance 4', color: 'rgba(176,124,64,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'S1', name: 'Support 1', color: 'rgba(64,150,108,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'S2', name: 'Support 2', color: 'rgba(64,150,108,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'S3', name: 'Support 3', color: 'rgba(64,150,108,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'S4', name: 'Support 4', color: 'rgba(64,150,108,1)', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'BASE', name: 'Base (round number)', color: 'rgba(255,255,255,0.3)', thickness: 1, lineStyle: 'dashed', display: true },
      { id: 'PIVOT', name: 'Pivot (prev close)', color: 'rgba(80,190,240,1)', thickness: 3, lineStyle: 'solid', display: true },
      { id: 'PIVOT_P', name: 'Pivot P (HLC/3)', color: 'rgba(99,102,241,1)', thickness: 3, lineStyle: 'solid', display: true },
    ],
    compute: computeElephantZone,
  },
```

(Note: style entries cover the default `levelCount` 4. If a user raises `levelCount`, R5+/S5+ render with the engine's fallback color — acceptable; add more style entries later if needed.)

- [ ] **Step 2: Typecheck + full suite**

Run: `npx tsc --noEmit 2>&1 | grep -v "signals.test.ts"` — expect no output.
Run: `npx vitest run` — expect all green except the pre-existing `signals.test.ts` parse error.

- [ ] **Step 3: Live verify**

Set the active indicator to `elephant_zone` (the app persists the last indicator in `localStorage['btc-mood:chart-indicators:v1']`; set it to `["elephant_zone::default"]` and reload, or pick it from the Indicators panel). Confirm: a daily grid of amber resistance / green support lines around a dashed Base line, cyan prev-close pivot, indigo HLC/3 pivot; grid resets each day; 0 console errors. Toggle Spacing Mode → round and confirm levels land on round numbers.

- [ ] **Step 4: Commit**

```bash
git add lib/customIndicatorsLibrary.ts
git commit -m "feat(indicator): expose Elephant adaptive-grid modes in the registry"
```

---

## Self-Review

**Spec coverage:**
- Three spacing modes (volatility/round/manual) → Task 1 `gridScaleFor` + Task 3 `spacingMode` input. ✓
- Volatility: avg prior-day range × fraction, niceSnap, base snap → Task 1 + Task 2 `avgRangeForDay`. ✓
- Round: continuous magnitude, micro-cap safe → Task 1 + test. ✓
- Manual → Task 1 + Task 3 inputs. ✓
- levelCount 4, lines, day-break, null first day, non-repainting → Task 2 engine + tests. ✓
- Base line + both pivots retained/toggleable → Task 2 + Task 3. ✓
- niceSnap tests, mode tests, tiny-price, reset, plot set → Tasks 1-2. ✓
- Same id/name → Task 3. ✓

**Placeholder scan:** none — all code and test bodies are complete.

**Type consistency:** `SpacingMode`, `niceSnap`, `gridScaleFor` signatures match between Task 1 (definition) and Task 2 (use). `ElephantZoneInputs` fields (Task 2) match the registry input ids (Task 3): `spacingMode`, `atrLength`, `stepFraction`, `roundBase`, `stepSize`, `levelCount`, `show*`, `lineWidth`, `pivotLineWidth`. Colors live in `ELEPHANT_ZONE_DEFAULTS` (engine fallback) and `styles` (render override) — consistent RGB values. Plot ids `R1..R4/S1..S4/BASE/PIVOT/PIVOT_P` match between engine emission and registry styles.
