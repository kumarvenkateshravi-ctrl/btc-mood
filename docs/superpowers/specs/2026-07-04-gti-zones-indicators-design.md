# GTI-Inspired Zone & Level Indicators — Design

**Status:** Approved (brainstorming) — ready for implementation plan
**Date:** 2026-07-04
**Branch:** `feat/gti-zones-indicators`

## Overview

Add four self-contained custom indicators to btc-mood, inspired by the concepts
in a user-supplied trading-indicator manual (the "GHOSTTRADES ZONES" / GTI
product for Indian markets). We implement only **generic, public-domain
technical-analysis concepts** (supply/demand zones, volume-spike highlighting,
pivot support/resistance, Fibonacci pivots) in our own indicator framework. We
do **not** copy the source product's code, name, logo, branding, or its
undisclosed proprietary formulas. Where the source hides its exact math, we
define our own documented, deterministic algorithm.

Each indicator is a pure `IndicatorComputeFn` registered in
`lib/customIndicatorsLibrary.ts`, following the existing pattern (e.g.
`lib/indicators/maRibbonTV.ts`, `superTrend.ts`). All four are deterministic and
covered by golden-master tests using the existing harness
(`lib/testing/goldenMaster.ts`, `lib/indicators/*.golden.test.ts`).

## Scope

**In scope (4 universal indicators + 2 shared helpers):**
1. Supply/Demand Zones (`sd_zones`) — the core feature, with a **Zone Strength
   Score** ranking each zone by importance
2. Volume-Spike Detection (`vol_spike`) — markers, not candle recolor
3. Support & Resistance Lines (`magic_sr`)
4. Fibonacci Pivots (`fib_pivot`)
5. Shared higher-timeframe (HTF) resampling helper (`lib/indicators/htf.ts`)
6. Zone-strength scoring helper (`lib/indicators/zoneStrength.ts`)

All four are universal, asset-agnostic TA concepts suited to a Bitcoin /
cryptocurrency platform (MyCryptoStack).

**Out of scope (removed — anything tied to Indian equity/derivatives markets):**
- India VIX volatility forecast table
- Weekly options-expiry range tables
- Bank Nifty / Nifty index logic and index-benchmark tables
- Any exchange-session / market-holiday calendar handling (crypto is 24/7 UTC)

**Deferred (depends on features not yet built):**
- One-click "combined preset" that stacks these + existing SuperTrend/VWAP/RSI.
  Requires the indicator-templates + multi-instance features (separate,
  un-executed plan). Until then the user enables indicators individually.
- True candle-body recoloring for volume spikes (needs a Chart-core per-bar
  color override). v1 uses markers; recolor is a later follow-up.

**Already exists in the app (not rebuilt):** SuperTrend, VWAP, VWAP Bands, MA
Ribbon, RSI, Volume, OBV.

## Shared context: framework capabilities relied on

From `lib/indicatorFramework.ts` (already present — no framework changes needed):
- `IndicatorPlot` with `type: 'line' | 'band' | 'histogram'`; `'band'` data is a
  per-candle array of `{ upper, lower } | null` — used for zone rectangles.
- `IndicatorLevel` (hline with `value`, `color`, `lineStyle`, `title`) — used for
  S/R and Fib-pivot horizontal lines and for zone labels.
- `IndicatorMarker` (`index`, `position`, `color`, `shape`, `text`) — used for
  volume-spike marks.
- `IndicatorResult.signals: SignalSide[]` — one per candle; all four emit
  `'neutral'` (these are visual/context indicators, not signal generators).
- `CustomIndicatorConfig.settings.inputs` — the per-instance config bag.

Registration shape (`CustomIndicatorDef`): `{ id, name, description, inputs[],
styles[], compute }`.

## Shared helper: `lib/indicators/htf.ts`

Two of the four indicators (`sd_zones`, `fib_pivot`) need "the previous completed
higher-timeframe period's OHLC, mapped to each base-timeframe bar." Extract this
once as a tested helper.

```ts
export type HtfPeriod = '4H' | 'D' | 'W' | 'M';

export interface HtfBucketOHLC {
  open: number; high: number; low: number; close: number;
  volume: number;    // summed base-bar volume for the period (used by scoring)
  startTime: number; // unix seconds of the period's first bar
}

/**
 * Period key for a bar's unix-second timestamp, aligned to UTC (crypto is
 * 24/7 so no exchange session/calendar handling is needed):
 *   4H → floor(t / 14400)
 *   D  → UTC calendar day
 *   W  → ISO week (Monday start)
 *   M  → UTC year*12 + month
 */
export function periodKey(timeSec: number, period: HtfPeriod): number;

/**
 * For each base candle i, returns the OHLC of the PREVIOUS fully-completed HTF
 * period at bar i (or null until at least one prior period has closed). This is
 * the non-repainting primitive: bar i only ever sees periods that closed at or
 * before i's period start, so no lookahead.
 */
export function priorPeriodOHLC(
  candles: Candle[],
  period: HtfPeriod,
): (HtfBucketOHLC | null)[];
```

Edge cases: empty input → `[]`; bars before the second period → `null`.

**Note:** `maRibbonTV.ts` has its own HTF logic; we do NOT refactor it now
(it works and is golden-tested). `htf.ts` is new and focused. A future cleanup
could unify them.

## Indicator 1: Supply/Demand Zones (`sd_zones`)

**Purpose:** Plot non-repainting horizontal supply and demand price bands derived
from the previous completed HTF period, for up to three user-chosen timeframes at
once.

**Zone objects (internal model, drives both scoring and rendering):** For each
completed HTF period the compute builds discrete `Zone` objects — one Supply, one
Demand, one Supply Target, one Demand Target — using `priorPeriodOHLC(candles, tf)`:
- `range = p.high - p.low`
- `bodyTop = max(p.open, p.close)`, `bodyBottom = min(p.open, p.close)`
- **Supply zone** = `{ upper: p.high, lower: bodyTop }`
- **Demand zone** = `{ upper: bodyBottom, lower: p.low }`
- **Supply Target zone** = `{ upper: p.high + range * k, lower: p.high }`
- **Demand Target zone** = `{ upper: p.low, lower: p.low - range * k }`

where `k = targetFactor` (default `1.5`). Each `Zone` records `{ kind, tf, upper,
lower, formedAtIndex, formedOHLC }`. Zones are constant for every bar within a
period and change only when a new period opens → non-repainting; historical bars
retain the zone live at that bar.

```ts
export interface Zone {
  kind: 'supply' | 'supplyTarget' | 'demand' | 'demandTarget';
  tf: HtfPeriod;
  upper: number; lower: number;
  formedAtIndex: number;      // base-bar index where the zone became active
  formedOHLC: HtfBucketOHLC;  // the prior period that defined it
  strength?: ZoneStrength;    // filled by the scoring pass (see below)
}
```

**Per-bar bands (rendering):** for each base bar `i` and each zone kind, the
active zone is the one with the greatest `formedAtIndex ≤ i`; its `{ upper, lower }`
is emitted for that band plot at bar `i` (or `null` before any zone formed).

**Config inputs:**
- `tf1` select, default `'D'`; options `None, 4H, D, W, M`
- `tf2` select, default `'None'`; same options
- `tf3` select, default `'None'`; same options
- `targetFactor` number, default `1.5`, min `0`, max `5`, step `0.1`
- `showLabels` boolean, default `true`
- `showStrength` boolean, default `true` — append the strength score to labels
- `minStrength` number, default `0`, min `0`, max `100` — hide zones scoring below

**Output:** For each active (non-`None`) TF, four `band` plots, id/title
`"{tfLabel} {zoneLabel}"` where `tfLabel ∈ {4H,D,W,M}` and `zoneLabel ∈
{Su, Su T, De, De T}` (e.g. `"D Su"`, `"W De T"`). Up to 3×4 = 12 bands.
- Supply/Supply-Target: salmon fill (`rgba(242,54,69,0.10)` zone,
  `rgba(242,54,69,0.06)` target); Demand/Demand-Target: green
  (`rgba(38,166,154,0.10)` / `rgba(38,166,154,0.06)`).
- The **current** (most recently formed) zone of each kind whose
  `strength.score ≥ minStrength` gets an `IndicatorLevel` at its `upper` with
  `title` = label, plus ` ★{score}` when `showStrength` (e.g. `"D Su ★82"`), and
  its band fill opacity scaled by tier (weak → base, medium → ×1.6, strong → ×2.4,
  capped at `0.32`). Zones below `minStrength` are omitted (band `null` + no label).

**Signals:** all `'neutral'`.

**Golden-master test:** synthetic series spanning ≥3 daily periods; assert band
values freeze per period and match the prior period's OHLC-derived bounds; assert
`null` before the second period; assert target projections use `k = 1.5`; assert a
zone below `minStrength` is filtered out.

## Shared helper: Zone Strength Score (`lib/indicators/zoneStrength.ts`)

**Purpose:** Rank each supply/demand zone by importance so the strongest zones
stand out and weak ones can be filtered. A pure, deterministic, unit-tested
function — no framework or chart coupling — so it's reusable and extensible.

```ts
export interface ZoneStrength {
  score: number;   // 0..100
  tier: 'weak' | 'medium' | 'strong';
  factors: {       // each normalized 0..1, for transparency/testing
    formationVolume: number;
    rejectionStrength: number;
    retests: number;
    freshness: number;
    confluence: number;
  };
}

export function scoreZone(
  zone: Zone,
  candles: Candle[],
  otherActiveZones: Zone[], // same-instance zones from OTHER timeframes
  cfg?: Partial<ZoneStrengthWeights>,
): ZoneStrength;
```

**Factors** (all computed only from bars at/after `zone.formedAtIndex` → no
lookahead beyond formation; each clamped to `[0,1]`):

1. **Formation volume** — the impulse that created the zone.
   `formationVolume = clamp(zone.formedOHLC.volume / (avgPeriodVolume * 2), 0, 1)`
   where `avgPeriodVolume` is the mean HTF-period volume over the lookback.
2. **Rejection strength** — how hard price left the zone on each touch. For each
   touch, measure the max move away from the zone within `reactBars` (default 5)
   bars, as a fraction of `zone` height; average across touches.
   `rejectionStrength = clamp(avgRejection / 3, 0, 1)`.
3. **Retests** — count of distinct touches (a run of consecutive in-zone bars =
   one touch) after formation. `retests = clamp(touchCount / 4, 0, 1)`.
4. **Freshness** — newer zones score higher: `freshness =
   clamp(1 - barsSinceFormed / freshWindow, 0, 1)` (`freshWindow` default 200).
5. **Confluence** — overlap with a **same-kind** zone from another active TF
   (Daily supply overlapping Weekly supply). `confluence = clamp(overlapCount /
   2, 0, 1)`; `0` when only one TF is active.

**Score:** weighted sum × 100, default weights (documented, overridable via
`cfg`, so the model is extensible):
`confluence 0.30, rejectionStrength 0.25, formationVolume 0.20, retests 0.15,
freshness 0.10`.
**Tier:** `< 40` weak, `40–70` medium, `> 70` strong.

**Consumption:** `sd_zones` scores every zone it builds, filters by `minStrength`,
and uses `tier` for label text + band opacity (see Indicator 1 output).

**Unit test:** construct zones with controlled candle fixtures and assert each
factor independently (e.g. a high-volume formation raises `formationVolume`; two
overlapping-TF zones raise `confluence`; an untouched fresh zone scores on
`freshness` only), plus the final weighted score and tier boundaries.

## Indicator 2: Volume-Spike Detection (`vol_spike`)

**Purpose:** Mark bars with abnormally high volume, split by direction —
"major buying" (up-close spike) vs "major selling" (down-close spike).

**Algorithm:**
- `volMa[i] = SMA(volume, length)[i]` (default `length = 20`)
- bar `i` is a spike when `volMa[i]` is defined and
  `volume[i] > volMa[i] * mult` (default `mult = 1.8`)
- up-spike (`close[i] >= open[i]`): buying → blue marker
- down-spike (`close[i] < open[i]`): selling → dark/black marker

**Config inputs:**
- `length` number, default `20`, min `1`, max `500`
- `mult` number, default `1.8`, min `1`, max `10`, step `0.1`

**Output:** `markers[]` only (no plots). Up-spike → `{ position: 'belowBar',
color: '#2962FF', shape: 'arrowUp' }`; down-spike → `{ position: 'aboveBar',
color: '#131722', shape: 'arrowDown' }`. `plots: []`, `signals` all `'neutral'`.

**Golden-master test:** fixture with a known volume-spike bar (up and down);
assert exactly those indices are marked with the right color/shape; assert
warm-up bars (< length) produce no marks.

## Indicator 3: Magic S/R Lines (`magic_sr`)

**Purpose:** Extra horizontal support/resistance from recent swing pivots.

**Algorithm:**
- Pivot high at `i`: `high[i] == max(high[i-L .. i+L])` and `i` has `L` bars on
  both sides (`L = lookback`, default `10`). Pivot low symmetric on `low`.
- Take the most recent `count` (default `3`) confirmed pivot highs whose price is
  **above** the last close → resistance lines; most recent `count` pivot lows
  **below** the last close → support lines.
- `showUp` toggles resistance lines, `showDown` toggles support lines.

**Config inputs:**
- `lookback` number, default `10`, min `2`, max `100`
- `count` number, default `3`, min `1`, max `10`
- `showUp` boolean, default `true`
- `showDown` boolean, default `true`

**Output:** `levels[]` — resistance lines color `#5aa2e6` title `"R"`, support
lines color `#f23645` title `"S"`. `plots: []`, `signals` `'neutral'`.

**Repaint note (documented, expected):** pivots need `L` bars of right-hand
confirmation, so the newest `L` bars can't yet host a pivot — standard pivot
behavior, called out in the indicator description.

**Golden-master test:** fixture with clear swing highs/lows; assert the detected
pivot prices and that only the requested `count` nearest above/below the last
close are emitted.

## Indicator 4: Fibonacci Pivots (`fib_pivot`)

**Purpose:** Classic Fibonacci pivot levels from the prior Day/Week/Month range.

**Algorithm:** Using `priorPeriodOHLC(candles, period)` (`period ∈ {D, W, M}`,
default `D`), for each bar with prior period `p`:
- `P = (p.high + p.low + p.close) / 3`, `range = p.high - p.low`
- `R1 = P + f1*range`, `R2 = P + f2*range`, `R3 = P + f3*range`
- `S1 = P - f1*range`, `S2 = P - f2*range`, `S3 = P - f3*range`
- defaults `f1 = 0.382`, `f2 = 0.618`, `f3 = 1.0`

Levels are constant within a period; recomputed on each new period.

**Config inputs:**
- `period` select, default `'D'`; options `D, W, M`
- `f1` number, default `0.382`; `f2` default `0.618`; `f3` default `1.0`
  (min `0`, max `4`, step `0.001`)

**Output:** 7 `levels[]` — `P` (orange `#FF6D00`), `R1/R2/R3` (`#5aa2e6`),
`S1/S2/S3` (`#f23645`), titles `"P"`, `"R1".."S3"`. Uses the **last** bar's
prior-period values for the level prices (levels are single horizontal lines, so
we take the current period's pivot). `plots: []`, `signals` `'neutral'`.

**Golden-master test:** fixture spanning ≥2 daily periods; assert P/R/S equal the
hand-computed Fibonacci pivots of the prior day; assert null/empty before the
second period.

## Registration & wiring

- Add four `import` lines + four `CustomIndicatorDef` entries to
  `lib/customIndicatorsLibrary.ts` (append to `CUSTOM_INDICATORS`).
- No changes to `ChartPanel`/`Chart`/`useChartData` — bands, levels, and markers
  already render through the existing pipeline.
- Each indicator overlays on the price pane (`pane: 'overlay'` implicit — zones,
  S/R, Fib pivots, and volume markers all sit on price).

## Testing strategy

- One `*.golden.test.ts` per indicator + a unit test for `htf.ts`
  (`periodKey` boundaries, `priorPeriodOHLC` no-lookahead + null warm-up).
- Golden masters generated with the existing `UPDATE_GOLDEN=1` workflow and
  committed, matching the repo's other indicators.
- Full gate per task: `npx tsc --noEmit` (0 new errors), `npx eslint <files>`
  (0 errors), `npx vitest run` (green).

## Task decomposition (for the implementation plan)

1. `lib/indicators/htf.ts` + unit tests (foundation for `sd_zones` and `fib_pivot`).
2. `lib/indicators/zoneStrength.ts` + unit tests (foundation for `sd_zones`).
3. `sd_zones` compute (zone objects + scoring + bands/labels) + golden test +
   registration.
4. `vol_spike` compute + golden test + registration.
5. `magic_sr` compute + golden test + registration.
6. `fib_pivot` compute + golden test + registration.
7. Full verification + `graphify update .`.

(Order: the two helpers first, then `sd_zones` which depends on both; the other
three indicators are independent and could be built in any order or in parallel.)

## Open risks

- **Visual fidelity:** the source draws right-extended zone rectangles with
  in-chart text labels; our `band` plots render filled bands across bars and
  `level` titles at the right edge — close but not pixel-identical. Acceptable
  for v1; a custom `ISeriesPrimitive` (like `orderOverlayPrimitive`) could match
  the exact look later if desired.
- **12 bands** when all 3 zone TFs are active is heavy but within the existing
  renderer's capability; default is one TF (Daily) active.
- **Strength scoring granularity (v1):** the score/opacity/label are applied to
  the *current* active zone of each kind (per TF). Historical band segments render
  without per-segment score coloring, because one `band` plot carries a single
  color across all periods. Full per-zone colored rectangles + inline score labels
  would need the custom `ISeriesPrimitive` noted above; the `zoneStrength` module
  is written to support that later without change.
