# Elephant Zone v2 — expansion-percentile bands — design

Rebuilds the level math inside the existing `elephant_zone` indicator
(`lib/indicators/elephantZone.ts`) to match the creator's official model
(`zonePlan.md` + the creator's website description). Replaces the psychological
grid (2026-07-29-elephant-adaptive-grid-design.md) entirely. Indicator id and
display name ("Elephant Zone (S/R Levels)") stay the same; the two pivot lines
stay untouched.

## The model (creator steps 1–7 + freeze; 8–15 deferred)

**Anchor — today's session open.** For each UTC day, `O` = the open of that
day's first bar. (Crypto: exact 00:00 UTC session. Other markets: first bar
after the UTC boundary — the same approximation we already use.) This replaces
the previous-close anchor for the ZONES.

**Historical expansion, per completed prior session:**
- `bullExp = sessionHigh − sessionOpen`
- `bearExp = sessionOpen − sessionLow`

**Robust average over the last N prior sessions** (`sessionLookback`, default 20;
`avgMethod` default `median`, alt `mean` — median resists news-day/flash-crash
outliers, as the creator recommends):
- `EB = avg(prior N bullExp)`, `ES = avg(prior N bearExp)`.

**`expansionMode`** (honors both creator sources):
- `directional` (default): resistance uses `EB`, support uses `ES` (asymmetric —
  matches the detailed engineering doc's separate bull/bear).
- `symmetric`: both sides use `E = (EB + ES) / 2` (equal distances up/down —
  matches the website's "plotted symmetrically").

**Percentile-pair bands (2 tiers).** Percent inputs `p1=21, p2=29` (inner) and
`p3=53, p4=62` (outer), each divided by 100. With the resistance expansion `ER`
(= `EB` or `E`) and support expansion `ES'` (= `ES` or `E`):
- **R1** = `[O + ER·0.21 , O + ER·0.29]`
- **R2** = `[O + ER·0.53 , O + ER·0.62]`
- **S1** = `[O − ES'·0.29 , O − ES'·0.21]`
- **S2** = `[O − ES'·0.62 , O − ES'·0.53]`

**Validation (step 7):** each band's `lower = Math.min(a, b)`, `upper =
Math.max(a, b)` — never flips even if a user sets crossing percentiles. A
zero-width band (p equal) renders nothing.

**Freeze (step 12):** each day's `O`, `EB`, `ES` are known at session start (O
from the first bar; expansions from prior completed sessions), so the zones are
computed once and frozen for the whole session. Non-repainting.

## Worked example (from the doc — used as a test)

`O = 64000`, `EB = 780`, `ES = 760`, directional mode, defaults:
- R1 = `[64163.8, 64226.2]` (width 62.4)
- R2 = `[64413.4, 64483.6]` (width 70.2)
- S1 = `[63779.6, 63840.4]` (width 60.8)
- S2 = `[63528.8, 63597.2]` (width 68.4)

Inner and outer widths differ (8% vs 9% of expansion), and bull vs bear differ —
this is why the zones are naturally different widths (answers the earlier width
question).

## Rendering & plots

Reuse the band rendering already in place: **R1/R2** amber bands (`boundary:
'lower'`), **S1/S2** green bands (`boundary: 'upper'`), grouped into per-day runs
by the band primitive. Plots:
- `R1`, `R2`, `S1`, `S2` — `type: 'band'`, `pane: 'overlay'`.
- `PIVOT` (cyan, prev close) and `PIVOT_P` (indigo, HLC/3) — `type: 'line'`,
  **unchanged**. (The grid's `BASE` line is removed — no base concept in v2.)

## Config (replaces all grid inputs)

`sessionLookback` (20), `avgMethod` (median | mean), `expansionMode`
(directional | symmetric), `innerLow` (21), `innerHigh` (29), `outerLow` (53),
`outerHigh` (62), `showResistance`, `showSupport`, `showPivot`, `showPivotP`,
`upperColor`, `lowerColor`, `pivotColor`, `pivotPColor`, `pivotLineWidth`.
Removed: spacingMode, atrLength, stepFraction, roundBase, stepSize, levelCount,
zoneWidthFraction. Registry `styles`: `R1`, `R2`, `S1`, `S2`, `PIVOT`, `PIVOT_P`.

## Out of scope (deferred to the parked Elephant Trade Engine)

Steps 8–15: per-zone strength scoring, opacity-by-strength, zone events
(ENTER/EXIT/REJECT/BREAKOUT/…), confluence with SMC/FVG/VWAP, AI narrative, and
the Doji/Hammer candle-validation + Level-Touch entry filter the website
describes. This build is zone geometry only.

## Honesty caveat

Still a best-effort reconstruction — no Pine source. But now grounded in the
creator's own documented model rather than reverse-engineered guesses. Not
verified byte-for-byte against the original; compare live before trusting.

## Testing (self-consistency; no golden master)

- `median` helper: odd/even counts, unsorted input.
- Session aggregation: open (first bar), high (max), low (min) per UTC day.
- Expansion: bullExp/bearExp per session; median/mean over N prior sessions.
- Band math against the worked example (directional); symmetric mode uses
  `(EB+ES)/2` both sides.
- Validation: crossing percentiles normalize via min/max.
- Session-open anchor; first session → no zones (no prior); freeze /
  non-repainting (today's own high/low never affect today's zones).
- Plot set = R1/R2/S1/S2 bands + PIVOT/PIVOT_P lines; show toggles honored.
