# Elephant Zone Pivot Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single dashed "Pivot" line at the previous day's close (the existing zone anchor) to the Elephant Zone indicator, so it draws through the center of the 4R/4S ladder.

**Architecture:** Purely additive to `lib/indicators/elephantZone.ts`. Reuse the existing `anchorForDay` map (the pivot value *is* that anchor) and emit one extra `band`-type plot rendered as a dashed labeled centerline via the same `IndicatorBandPrimitive` the zones already use. Register a `PIVOT` style entry so it's colorable/toggleable. Zero changes to shared chart code.

**Tech Stack:** TypeScript, Vitest, existing `IndicatorPlot`/`BandZoneStyle` framework.

## Global Constraints

- Pivot = previous day's close (the zone anchor) — reuse `anchorForDay`, never recompute. Verbatim from spec.
- Rendered via the existing band primitive (a thin band drawn as a dashed labeled centerline) — no changes to `useChartData` or any shared chart code.
- Self-consistency tests only — no Pine source exists, so no golden-master parity (same caveat as the base indicator).
- `npx tsc --noEmit` stays clean (ignore only the pre-existing unrelated `lib/indicators/maFvg/signals.test.ts` parse error). Full `npx vitest run` stays green. Commit once at the end (single cohesive deliverable).

---

## File Structure

- Modify: `lib/indicators/elephantZone.ts` — add `pivotColor` to inputs+defaults; emit a 9th `PIVOT` band plot.
- Modify: `lib/indicators/elephantZone.test.ts` — update the two plot-count assertions (8 → 9) and add pivot-specific tests.
- Modify: `lib/customIndicatorsLibrary.ts` — add a `PIVOT` entry to the `elephant_zone` `styles` array.

---

### Task 1: Pivot line (engine + registry + tests)

**Files:**
- Modify: `lib/indicators/elephantZone.ts`
- Modify: `lib/indicators/elephantZone.test.ts`
- Modify: `lib/customIndicatorsLibrary.ts:717-726` (the `elephant_zone` `styles` array)

**Interfaces:**
- Consumes: existing `computeElephantZone(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult`, `ElephantZoneInputs`, `ELEPHANT_ZONE_DEFAULTS`, `anchorForDay` (internal), `BandZoneStyle` (`{ lineStyle?: 'solid'|'dashed'; mid?: boolean; label?: string }`).
- Produces: a 9th `IndicatorPlot` with `id: 'PIVOT'`, `type: 'band'`, `pane: 'overlay'`, `zoneStyle: { lineStyle: 'dashed', mid: true, label: 'Pivot' }`; new `ElephantZoneInputs.pivotColor: string` (default `'rgba(230,200,120,0.9)'`).

- [ ] **Step 1: Update the two existing plot-count tests + add pivot tests**

In `lib/indicators/elephantZone.test.ts`, change the first test's length assertion from 8 to 9 (the pivot is null on the first day too, so the "all null" loop still holds):

```typescript
  it('first day in history has no previous-day anchor → all zones null', () => {
    const candles = [bar(0, 100), bar(100, 101), bar(200, 102)];
    const { plots } = computeElephantZone(candles);
    expect(plots).toHaveLength(9);
    for (const p of plots) expect(p.data.every((d) => d === null)).toBe(true);
  });
```

Replace the `'produces exactly 8 band plots'` test with:

```typescript
  it('produces exactly 9 band plots (R1-4, S1-4, PIVOT) with the default config', () => {
    const candles = [bar(0, 100), bar(DAY, 110)];
    const { plots } = computeElephantZone(candles);
    expect(plots.map((p) => p.id).sort()).toEqual(['PIVOT', 'R1', 'R2', 'R3', 'R4', 'S1', 'S2', 'S3', 'S4']);
    expect(plots.every((p) => p.type === 'band' && p.pane === 'overlay')).toBe(true);
  });
```

Then append these three new tests inside the `describe` block (before its closing `});`):

```typescript
  it('pivot line is centered on the day anchor (previous day close), null on the first day', () => {
    const candles = [
      bar(0, 100), bar(DAY - 100, 110),          // day 0, last close = 110
      bar(DAY, 200), bar(DAY + 100, 201),        // day 1
    ];
    const pivot = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT')!;
    expect(pivot.data[0]).toBeNull(); // day 0: no prior close
    expect(pivot.data[1]).toBeNull();
    const d2 = pivot.data[2] as { upper: number; lower: number };
    const d3 = pivot.data[3] as { upper: number; lower: number };
    expect((d2.upper + d2.lower) / 2).toBe(110); // day 1 anchor = day 0 close
    expect((d3.upper + d3.lower) / 2).toBe(110);
  });

  it('pivot resets to the new anchor at the next UTC boundary', () => {
    const candles = [
      bar(0, 100), bar(DAY - 100, 110),   // day0 close 110
      bar(DAY, 200), bar(DAY + 100, 220), // day1 close 220
      bar(2 * DAY, 300),                   // day2
    ];
    const pivot = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT')!;
    const day1 = pivot.data[2] as { upper: number; lower: number };
    const day2 = pivot.data[4] as { upper: number; lower: number };
    expect((day1.upper + day1.lower) / 2).toBe(110);
    expect((day2.upper + day2.lower) / 2).toBe(220);
  });

  it('pivot plot is a dashed, labeled centerline (reads as the ladder axis, not a zone)', () => {
    const candles = [bar(0, 100), bar(DAY, 110)];
    const pivot = computeElephantZone(candles).plots.find((p) => p.id === 'PIVOT')!;
    expect(pivot.zoneStyle).toEqual({ lineStyle: 'dashed', mid: true, label: 'Pivot' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/indicators/elephantZone.test.ts`
Expected: FAIL — count tests expect 9 but engine emits 8; `PIVOT` plot not found (`.find(...)!` yields undefined → throws).

- [ ] **Step 3: Add `pivotColor` to the inputs type + defaults**

In `lib/indicators/elephantZone.ts`, add the field to `ElephantZoneInputs` (after `lowerColor`):

```typescript
  upperColor: string;
  lowerColor: string;
  /** Pivot centerline color. High alpha — it's a line, not a fill. */
  pivotColor: string;
}
```

And to `ELEPHANT_ZONE_DEFAULTS`:

```typescript
export const ELEPHANT_ZONE_DEFAULTS: ElephantZoneInputs = {
  level1: 15, level2: 29, level3: 51, level4: 92,
  zoneWidthPoints: 6,
  upperColor: 'rgba(247,166,60,0.12)',
  lowerColor: 'rgba(62,207,142,0.12)',
  pivotColor: 'rgba(230,200,120,0.9)',
};
```

- [ ] **Step 4: Emit the PIVOT plot**

In `computeElephantZone`, add a module-level constant near `SECONDS_PER_DAY`:

```typescript
const SECONDS_PER_DAY = 86400;
/** Half-height of the pivot band, in points. Small + fixed: the band is only a
 *  carrier for the dashed midline (the pivot is a line, not a zone). */
const PIVOT_HALF = 1;
```

Then, immediately before `return { plots, signals };`, append the pivot plot:

```typescript
  const pivotData = new Array<{ upper: number; lower: number } | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    const anchor = anchorForDay.get(dayKeys[i]);
    if (anchor == null) continue;
    pivotData[i] = { upper: anchor + PIVOT_HALF, lower: anchor - PIVOT_HALF };
  }
  plots.push({
    id: 'PIVOT', title: 'Pivot', color: inp.pivotColor, type: 'band', pane: 'overlay',
    data: pivotData,
    zoneStyle: { lineStyle: 'dashed', mid: true, label: 'Pivot' },
  });

  return { plots, signals };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/indicators/elephantZone.test.ts`
Expected: PASS (all tests, including the 3 new pivot tests).

- [ ] **Step 6: Register the PIVOT style entry**

In `lib/customIndicatorsLibrary.ts`, add one line to the `elephant_zone` `styles` array after the `S4` entry (so users get a color picker + show/hide toggle for the pivot):

```typescript
      { id: 'S4', name: 'Support 4', color: 'rgba(62,207,142,0.12)', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'PIVOT', name: 'Pivot (prev close)', color: 'rgba(230,200,120,0.9)', thickness: 1, lineStyle: 'dashed', display: true },
    ],
```

- [ ] **Step 7: Typecheck + full test suite**

Run: `npx tsc --noEmit 2>&1 | grep -v "signals.test.ts"`
Expected: no output (clean).

Run: `npx vitest run`
Expected: all suites green except the pre-existing unrelated `lib/indicators/maFvg/signals.test.ts` parse error.

- [ ] **Step 8: Commit**

```bash
git add lib/indicators/elephantZone.ts lib/indicators/elephantZone.test.ts lib/customIndicatorsLibrary.ts
git commit -m "feat(indicator): Elephant Zone pivot line at prev-day close (zone anchor)"
```

---

## Self-Review

**Spec coverage:**
- Pivot = prev day close / zone anchor → Step 4 reuses `anchorForDay`. ✓
- Dashed line + "Pivot" label, own color, toggleable → Step 4 `zoneStyle`, Step 3 `pivotColor`, Step 6 style entry. ✓
- Resets daily, null on first day → covered by reusing `anchorForDay` (null when no anchor) + tests in Step 1. ✓
- Rendered via band primitive, zero shared-chart-code changes → Step 4 emits a `band` plot only. ✓
- No pivot-derived R/S levels (out of scope) → only one `PIVOT` plot added. ✓
- Tests: center = anchor, null first day, resets at boundary, 9 plots → Step 1. ✓

**Placeholder scan:** none — all code is complete and exact.

**Type consistency:** `PIVOT` id, `pivotColor` field, and `zoneStyle` shape are identical across the engine (Step 4), the type/defaults (Step 3), the tests (Step 1), and the registry (Step 6). `BandZoneStyle` fields (`lineStyle`/`mid`/`label`) match the framework definition.
