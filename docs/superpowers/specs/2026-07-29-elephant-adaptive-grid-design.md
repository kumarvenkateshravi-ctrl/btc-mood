# Elephant Zone — cross-asset adaptive S/R grid — design

Replaces the level math inside the existing `elephant_zone` indicator
(`lib/indicators/elephantZone.ts`). The arbitrary fixed offsets (15/29/51/92
zones) are removed in favor of a psychological / adaptive **grid** that works
across all markets (crypto, ETH, gold, forex, indices, micro-caps). Indicator
id and display name ("Elephant Zone (S/R Levels)") stay the same.

Supersedes the level-calc portion of `2026-07-25-elephant-zone-design.md`.
The daily anchor (previous UTC-day close), the anchor pivot, and the HLC/3
pivot are unchanged and retained.

## Goal

One indicator, three user-selectable spacing modes, that produces clean and
useful S/R levels on any instrument without per-asset manual tuning.

## Spacing modes (`spacingMode` input: 'volatility' | 'round' | 'manual')

For each new UTC day, `anchor = previous day's last close` (unchanged). Then:

### volatility (default — the all-markets mode)
- `avgDailyRange` = mean of `(dayHigh − dayLow)` over the last `atrLength`
  **prior** trading days (default 14). Uses the per-day H/L aggregation already
  built for the HLC/3 pivot. Non-repainting: a given day's grid uses only days
  strictly before it. If fewer than `atrLength` prior days exist, average over
  whatever prior days exist (≥1).
- `rawStep = avgDailyRange × stepFraction` (default `stepFraction = 0.25`, so a
  typical day spans ~4 steps).
- `step = niceSnap(rawStep)` — snapped to the nearest clean increment of the
  form `{1, 2, 2.5, 5} × 10^k`.
- `base = round(anchor / step) × step` — snap the close to the nearest
  step-multiple. Levels are clean multiples of `step`; the base shifts by at
  most half a step between days (no large discontinuity).

### round (pure psychological round-numbers; continuous, never crashes)
- `roundBase = 10^floor(log10(anchor)) / 10`, `step = roundBase / 5`.
  Continuous magnitude (not a hardcoded decade ladder), so tiny prices scale
  correctly — e.g. SHIB ≈ 1.23e-5 → roundBase 1e-6, step 2e-7, base ≈ 1.2e-5
  (no collapse to base 0, which the original decade-bucket version produced).
- `base = round(anchor / roundBase) × roundBase`. Levels are exact round
  numbers; spacing does not adapt to volatility.

### manual
- `roundBase` and `stepSize` taken directly from inputs (per-instrument tuning,
  e.g. forex/gold). `base = round(anchor / roundBase) × roundBase`.

## Levels (all modes)

- `R_k = base + k × step`, `S_k = base − k × step`, for `k = 1 … levelCount`
  (default `levelCount = 4` each side).
- Rendered as **lines** (not zone bands): amber resistance, green support,
  pixel-width so they never collapse when the chart shrinks, broken at each day
  boundary so days don't connect diagonally, `null` on the first day (no prior
  day → no anchor).

## Central reference lines (retained, each toggleable)

- **Base** — the grid's central round/step line, dashed, dim.
- **Pivot** — anchor pivot = previous close (cyan, 3px). Unchanged.
- **Pivot P** — classic `(H+L+C)/3` of the previous day (indigo, 3px). Unchanged.

## `niceSnap(x)` helper

```
exp  = floor(log10(x))
f    = x / 10^exp            // f ∈ [1, 10)
nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 4 ? 2.5 : f < 7 ? 5 : 10
return nice × 10^exp
```
Pure, exported, unit-tested. `x ≤ 0` guarded (returns a safe fallback so the
engine never divides by zero).

## Inputs / registry

`spacingMode` (select, default 'volatility'), `atrLength` (14), `stepFraction`
(0.25), `levelCount` (4), `roundBase` + `stepSize` (manual mode), plus
show/hide toggles and colors for resistance, support, base, both pivots.
Line width inputs for grid lines and pivots.

Plot ids: `R1..R4`, `S1..S4`, `BASE`, `PIVOT`, `PIVOT_P` (all `type: 'line'`,
`pane: 'overlay'`). Registry `styles` list one entry per plot id.

## Honesty caveat (unchanged)

Still a best-effort reconstruction — no Pine source for the real "Elephant
Edge." The round-number premise and the volatility spacing are grounded trading
concepts, but this is NOT verified against the original indicator. Compare live
before trusting it.

## Testing (self-consistency; no golden master)

- `niceSnap`: 1.3→1, 2→2, 3.4→2.5, 6→5, 8→10, 173→200, 0.006→0.005, 0.007→0.01.
- volatility mode: known per-day ranges → expected `avgDailyRange`, `step`,
  `base`, and R/S values; non-repainting (day D uses only prior days).
- round mode: BTC-scale and a tiny-price asset (assert base ≠ 0, supports > 0).
- manual mode: explicit roundBase/stepSize honored.
- base snapping, day reset at UTC boundary, null first day, empty candles.
- plot set = R1-4 + S1-4 + BASE + PIVOT + PIVOT_P, all lines/overlay.

## Out of scope

- No trade signals (that's the separate parked Elephant Trade Engine).
- No zone-band rendering (grid is lines).
- No per-market session boundaries (daily anchor stays 00:00 UTC — fine for
  crypto; acceptable approximation for other markets for now).
