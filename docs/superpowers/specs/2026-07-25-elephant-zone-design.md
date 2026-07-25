# Elephant Zone (S/R levels only) — design

Source: screenshots of "Elephant Edge by AlgoBing V2" (settings panel + NIFTY 15m
chart) and "Elephant Edge 2.0" (unrelated Fibonacci panel — explicitly NOT used).
No Pine source exists for this indicator — this is a best-effort reconstruction
from visual evidence, not a golden-master port.

## Scope

Only the "Elephant Zone Support & Resistance Levels" section of the original
panel: 4 point-offset Levels + Upper/Lower colors. Explicitly OUT OF SCOPE:
strike price levels, marubozu/hammer detection, volume alerts, candle size/body/
wick filters, VWAP, trade-time window, higher-TF trend background, "Elephant
Edge 2.0"'s Fibonacci engine.

## Evidence and reasoning

- Creator states zones appear automatically at exactly 5:30 AM IST = 00:00 UTC
  daily. This is a new-UTC-day boundary check, not an exotic trigger.
- The chart is **NIFTY**, which does not trade 24/7 (session 9:15 AM–3:30 PM
  IST). 5:30 AM IST is BEFORE market open, so "today's open" does not exist yet
  at that moment — the anchor must be something already known at 5:30 AM.
  **Anchor = previous trading day's close**, not today's open (the "today's
  open" hypothesis only holds for 24/7 markets and was ruled out here).
- The 4 Level inputs (15/29/51/92) are editable numbers with no separate "zone
  width" field — most consistent with fixed point OFFSETS from the anchor,
  not a dynamically-recalculated/statistical value.
- The chart showed distinct, separated colored rectangles (visible gaps
  between them), not one continuous shaded region from anchor to the
  outermost level — this rules out a cumulative-band interpretation in favor
  of independent, centered reaction zones at each offset.

## Model (v1)

```
For each new UTC calendar day D:
  anchor = close of the last candle in day D-1
  for N in 1..4:
    center_R = anchor + LevelN
    center_S = anchor - LevelN
    R_N zone = [center_R - zoneWidth/2, center_R + zoneWidth/2]
    S_N zone = [center_S - zoneWidth/2, center_S + zoneWidth/2]
  Each zone is active (drawn) for every candle in day D only.
Day 1 of the provided candle history has no previous day → no zones drawn.
```

`zoneWidth` is a NEW parameter not present in the original panel (which had no
width field) — an invented, tunable constant, defaulted small enough to avoid
adjacent zones overlapping (the tightest gap between levels 15/29/51/92 is 14
points, so width must stay well under that). Default: 6 points (full width).
Flagged explicitly as a guess to correct once compared against the real
indicator.

## Contract

```ts
export interface ElephantZoneInputs {
  level1: number; level2: number; level3: number; level4: number; // point offsets
  zoneWidthPoints: number;
  upperColor: string;
  lowerColor: string;
}
export const ELEPHANT_ZONE_DEFAULTS: ElephantZoneInputs = {
  level1: 15, level2: 29, level3: 51, level4: 92,
  zoneWidthPoints: 6,
  upperColor: 'rgba(247,166,60,0.12)',
  lowerColor: 'rgba(62,207,142,0.12)',
};

export function computeElephantZone(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult // { plots: IndicatorPlot[] } — same shape as computeSdZones
```

Output: 8 `IndicatorPlot`s (`R1`..`R4`, `S1`..`S4`), each `type:'band'`,
`pane:'overlay'`, `data: Array<{upper,lower}|null>` (one entry per candle,
`null` outside that zone's owning day) — reusing the EXACT rendering path
`computeSdZones` already uses, so no new chart/overlay code is needed.

## Registration

New entry `elephant_zone` in `lib/customIndicatorsLibrary.ts`'s `CUSTOM_INDICATORS`,
following the `sd_zones` pattern: `inputs` (level1-4, zoneWidthPoints, upperColor,
lowerColor), `styles` (one per R1-4/S1-4 plot id), `compute: computeElephantZone`.

## Testing

No Pine source exists, so there is no golden-master reference — this is
explicitly a deviation from every other indicator in this codebase. Testing is
self-consistency only (`elephantZone.test.ts`, not `.golden.test.ts`):
day-bucket boundary detection, anchor = previous day's last close, zone math
(center ± width/2), zones persist across all bars of their owning day and
reset at the next UTC boundary, first day in history produces no zones
(no previous day available), empty/short candle arrays don't throw.

**Validation plan:** once built, compare live side-by-side against the real
paid indicator on the same symbol/day. If zone positions differ consistently,
the anchor function (`getPreviousDayClose`) is the single place to correct —
architected as its own function specifically so this is a one-function fix,
not a rewrite.
