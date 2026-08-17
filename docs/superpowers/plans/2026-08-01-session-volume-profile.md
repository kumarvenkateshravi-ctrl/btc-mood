# Session Volume Profile (SVP) — Implementation Plan

> **Status: Phases 1–4 shipped.** Two decisions changed during the build, both
> driven by measurement rather than theory:
>
> 1. **D vs Balanced is split by value-area coverage, not kurtosis.** A normal
>    distribution's kurtosis is *exactly* 3.0, so a 3.0 threshold put every
>    bell-shaped profile on a knife edge — the same fixture flipped class under a
>    trivial change. Measured `vaCoverage` separates the two ~3x (tight bell 0.15,
>    broad bell 0.43). Kurtosis remains in `ShapeFeatures` as a report diagnostic.
> 2. **`trendVaCoverage` is 0.68, not 0.72.** A flat profile's value area covers
>    ~70% of its range *by definition* (that is what a 70% value area means), so
>    a 0.72 bound could never fire on a true trend day.
>
> Phase 5 (reports/narration) and Phase 7 (Tier B data) remain open.

Target: reproduce TradingView's paid **SVP HD** indicator (see `SVP.md` spec and the
two settings screenshots) inside btc-mood, as a first-class custom indicator.

---

## 1. What SVP actually is

A **horizontal** histogram of traded volume bucketed by *price*, drawn once per
session, plus three derived levels:

| Term | Meaning |
|---|---|
| **Row** | A price bucket. Bar length = volume traded in that bucket. |
| **POC** | Point of Control — the price row with the *most* volume. |
| **Value Area** | The contiguous band around POC holding N% (default 70) of session volume. |
| **VAH / VAL** | Value Area High / Low — the band's top and bottom edges. |
| **Up/Down** | Each row split by whether the contributing bar closed up or down. Delta = up − down. |

---

## 2. Architectural findings (these constrain the design)

Established by reading the current codebase, not assumed:

1. **`CustomIndicatorDef`** (`lib/customIndicatorsLibrary.ts`) already drives the
   `IndicatorSettingsModal` Inputs/Style/Visibility tabs. The attached screenshots map
   **1:1** onto `inputs[]` (with `group`, `disabledIf`, `tooltip`) and `styles[]`
   (with `color`, `thickness`, `lineStyle`, `display`). No modal work needed.

2. **`IndicatorPlot.data` is time-indexed, 1-to-1 with candles**
   (`lib/indicatorFramework.ts:82-91`). All three plot types (`line`, `band`,
   `histogram`) map onto the *time* axis.
   → **A volume profile is price-indexed and cannot be expressed as an
   `IndicatorPlot`.** It must be drawn by a custom primitive.

3. **Primitive precedent exists** — `gradientZonePrimitive`, `orderOverlayPrimitive`,
   `indicatorFillPrimitive`, `indicatorBandPrimitive`, `priceLinesPrimitive`,
   `chartFxPrimitive`. Each is attached via `candleSeries.attachPrimitive(...)` in
   `components/Chart.tsx` and fed from `components/chart/useChartData.ts`.

4. **`IndicatorResult` already has non-plot payload slots** — `levels`, `fills`,
   `gradientFills`, `markers`, `candleColors`. Adding a `profiles` slot follows the
   existing pattern exactly, rather than inventing a parallel channel.

5. **`/api/klines` accepts only `tf` + `symbol`** (`lib/fetcher.ts:30-35`) and returns
   a fixed window. There is no `startTime` / `endTime` / `limit`. This is the single
   biggest constraint on profile *accuracy* — see §4.

---

## 3. The crypto adaptation (important — spec is equity-centric)

The TradingView spec's `Sessions` input is built for **equities**:
`All / Each / Pre-market / Market / Post-market`. BTC/USDT trades **24/7 with no
pre- or post-market**, so four of those five options are meaningless here.

Proposed adaptation — keep the input, change the option set:

| SVP.md (equities) | btc-mood (crypto) |
|---|---|
| All | **Daily (UTC)** — one profile per UTC day *(default)* |
| Each / Pre / Post | *dropped — no extended hours* |
| Custom | **Custom** — user-defined start/end + timezone *(kept as-is)* |
| — | **Weekly** — one profile per ISO week *(added; useful for crypto)* |
| — | **Visible range** — one profile over the visible bars *(added; the most-used mode in practice)* |

The `Custom session` time inputs and the timezone dropdown from screenshot 1 carry
over unchanged.

---

## 4. Data strategy — the accuracy tradeoff

TradingView builds SVP from **lower-timeframe** bars (the depth table in `SVP.md`
§Calculation: a 1h chart uses 10m bars, etc.). We have two viable tiers:

**Tier A — chart-candle approximation (no backend work)**
Distribute each visible candle's volume across its own high→low range (uniform, or
triangular weighted toward the close). Ships immediately, zero new infra.
*Accuracy: rough — a 1h candle spanning $800 smears volume evenly across it.*

**Tier B — true lower-timeframe profile (backend work required)**
Extend `/api/klines` to accept `interval`, `startTime`, `endTime`, `limit`, then
fetch sub-TF bars per the depth table and bucket their real volume.
*Accuracy: matches TradingView. Cost: API change + rate-limit budget (already
120 req/min per IP) + a caching layer.*

**Recommendation: build Tier A first behind the same UI**, then swap the data source
to Tier B without touching the primitive or the settings. The compute function takes
bars in and returns rows out; where the bars came from is an implementation detail.

---

## 5. Profile Shape Classification Engine ← the differentiator

TradingView draws the profile and stops. It has no notion of *what kind* of profile
this is. Classification is where the analytical value lives, and it's what turns a
picture into a report.

### 5.1 Taxonomy — resolve two overlaps first

The 8 requested classes contain two collisions. A classifier must be mutually
exclusive or it isn't deterministic, so these need a ruling:

- **`Balanced` vs `D Shape`** — in Market Profile literature these are *the same
  thing*: a "D" is the normal/bell distribution, fat in the middle. Proposed split by
  **degree of peakedness**: `D Shape` = textbook tight bell (narrow value area,
  strong central peak); `Balanced` = symmetric but broad/flat.
- **`Extreme`** — traditionally a *feature* (single-print rejection tails), not a
  shape. A P-shaped profile can also have extremes. Proposed: reserve the class for
  profiles where POC sits in the top/bottom **decile** with a sharp rejection tail
  (i.e. beyond P/b), *and* additionally expose `hasExtremes` as an orthogonal flag so
  the information is never lost.

**Alternative (cleaner):** collapse `Balanced` → `D`, demote `Extreme` to a pure
flag. That gives 6 mutually-exclusive shapes + 2 flags. Both models are implemented
the same way — only the threshold table changes. See §7 decision 4.

### 5.2 Features — all derived from the Phase-1 profile

| Feature | Formula | Detects |
|---|---|---|
| `pocPosition` | `(pocPrice − low) / (high − low)` → 0..1 | where the peak sits |
| `vaCoverage` | `(VAH − VAL) / (high − low)` | concentrated vs spread |
| `maxRowShare` | `maxRowVol / totalVol` | peakedness |
| `skew` | volume-weighted 3rd standardized moment | asymmetry / direction |
| `kurtosis` | volume-weighted 4th standardized moment | tight bell vs flat |
| `peaks` | prominence-filtered local maxima on smoothed rows | modality |
| `valleyDepth` | `1 − (minRowVol between peaks / min(peakA, peakB))` | separation quality |
| `tailShare` | volume in the top/bottom 10% of rows | rejection extremes |

Rows are smoothed (3-row moving average) *before* peak detection so a single noisy
row can't fake a second distribution.

**Sign convention:** a bulge at the top means a long *lower* tail → **negative** skew.

### 5.3 Decision cascade — first match wins

Ordered rules, not a black box. Deterministic, debuggable, and every branch is
independently testable:

```
0.  rows < 8 || totalVol == 0                          → Neutral (insufficient)
1.  peaks >= 2 && valleyDepth >= 0.55                  → Double Distribution
2.  maxRowShare < 0.06 && vaCoverage > 0.72            → Trend
3.  (pocPosition >= 0.90 || <= 0.10) && tailShare high → Extreme
4.  pocPosition >= 0.65 && skew < -0.35                → P Shape
5.  pocPosition <= 0.35 && skew > +0.35                → b Shape
6.  |pocPosition - 0.5| <= 0.12 && kurtosis >= 3.0     → D Shape
7.  |pocPosition - 0.5| <= 0.18                        → Balanced
8.  else                                               → Neutral
```

Order matters: Double Distribution is tested first because a two-peaked profile can
otherwise masquerade as Balanced (its mean sits in the middle of the valley).

All thresholds live in one exported `SHAPE_THRESHOLDS` const — tunable without
touching logic, and snapshot-testable.

### 5.4 Output contract

```ts
interface ProfileClassification {
  shape: ProfileShape;        // the 8 classes
  confidence: number;         // 0..1, margin to the nearest competing threshold
  features: ShapeFeatures;    // every value from §5.2, for debugging + reports
  hasExtremes: boolean;       // orthogonal flag (see §5.1)
  why: string;                // human sentence for narration
}
```

Confidence comes from the *margin* to the nearest rule boundary, so a profile that
barely clears `pocPosition >= 0.65` reports low confidence rather than a false
certainty. Reports can then suppress weak calls.

### 5.5 What this unlocks (the reason it's worth building)

- **Narration** (`lib/narrate.ts`) gains a real sentence: *"b-shape on 4h — long
  liquidation, sellers took control into the close."*
- **Reports** (`lib/reportsEngine.ts`) can aggregate shape frequency over time —
  "14 of the last 20 sessions were P-shaped" is a genuine regime read.
- **Signal Matrix** can carry a shape row per timeframe.
- **Shape transitions** are the real signal: `Balanced → Double Distribution` marks
  a breakout from balance; `Trend → Balanced` marks exhaustion into acceptance.

Shape alone is descriptive. Shape *sequence* is predictive-adjacent — and it's
information no charting platform currently hands you.

---

## 6. Phased build

### Phase 1 — Pure computation (no UI)
`lib/indicators/sessionVolumeProfile.ts` + `.test.ts`

- `groupIntoSessions(candles, mode, customWindow) → Session[]`
- `buildProfile(bars, opts) → { rows, poc, vah, val, total }`
  - Row bucketing: `Number of Rows` (default 24) or `Ticks Per Row`, with the
    rounding rule from `SVP.md` §Rows Layout.
  - Up/down split per bar (`close >= open`).
  - **Value Area walk**: start at POC; repeatedly take the larger of the two
    adjacent rows (above/below) until cumulative ≥ `valueAreaVolume`% of total;
    VAH/VAL are that band's edges.
- Pure functions, no chart imports → fully unit-testable.

**Tests:** known-volume fixtures with hand-computed POC/VAH/VAL; the 70% walk;
row-count rounding edge cases; empty/single-bar sessions.

### Phase 2 — Classification engine (pure, no UI)
`lib/indicators/profileShape.ts` + `.test.ts`

- `extractFeatures(profile) → ShapeFeatures` (§5.2)
- `classifyProfile(profile) → ProfileClassification` (§5.3–5.4)
- `SHAPE_THRESHOLDS` exported for tuning.

Depends only on Phase 1's output type — zero chart imports, so it lands fully
tested before any pixel is drawn.

**Tests:** one hand-built fixture per shape (a synthetic bell → `D`, top-heavy →
`P`, bottom-heavy → `b`, twin-peaked with deep valley → `Double Distribution`,
flat/elongated → `Trend`, POC in top decile → `Extreme`); boundary cases either
side of each threshold; confidence monotonicity (moving a feature toward a
boundary must lower confidence); insufficient-data guard.

### Phase 3 — Rendering primitive
`lib/sessionVolumeProfilePrimitive.ts`, modelled on `gradientZonePrimitive.ts`

- Draw per session: horizontal bars anchored to the session's x-range.
- `Placement` (Left/Right) and `Width (% of the box)` (default 30) from screenshot 2.
- Separate fills for Up / Down volume and Value-Area Up / Down (four colors, per
  the screenshot).
- POC / VAH / VAL lines with `Extend … Right` options (`SVP.md` §Inputs).
- Optional per-row `Values` labels.
- Theme-aware: pull hexes via `getChartPalette()` (`lib/chartTheme.ts`) so it
  re-skins with the six MDS themes.

### Phase 4 — Framework wiring
- Add `profiles?: VolumeProfileRender[]` to `IndicatorResult`
  (`lib/indicatorFramework.ts`), alongside `gradientFills`/`markers`. Each carries
  its `ProfileClassification` so downstream consumers get the shape for free.
- Register `sessionVolumeProfile` in `CUSTOM_INDICATORS` with the full `inputs[]`
  and `styles[]` from the two screenshots, plus a `showShapeLabel` toggle.
- Attach + feed the primitive in `components/Chart.tsx` /
  `components/chart/useChartData.ts`, following the `gradientZone` path.
- Render the shape as a small label on each profile (e.g. `P · 0.82`).

### Phase 5 — Reports & narration integration
This is the payoff phase — the reason §5 exists.

- `lib/narrate.ts` — add a profile-shape clause to the existing narration, using
  `classification.why`. Follows the current deterministic-sentence pattern.
- `lib/reportsEngine.ts` — aggregate shape frequency and **shape transitions** over
  a lookback window; surface the transition table (`Balanced → Double Distribution`
  etc.) as its own report block.
- Optional: a `Profile Shape` row in `SignalMatrix` (per timeframe).

**Tests:** narration determinism (same input → same sentence); transition detection
across a synthetic session sequence.

### Phase 6 — Polish
- Legend entry (eye / gear / ×) — free once registered.
- Perf guard: cap total rows (`SVP.md` notes TV's own <6,000 limit); skip profiles
  narrower than a few px; recompute only when the session set or settings change.
- Verify live across all six themes and every timeframe.

### Phase 7 (optional) — Tier B accuracy
Extend `/api/klines`, add the depth-ratio table, swap the bar source.
Classification automatically sharpens with the better data — no code change.

---

## 7. Open decisions (need your call)

1. **Data tier** — ship Tier A (approximate, fast) first, or go straight to Tier B
   (accurate, needs API work)?
2. **Session modes** — is the crypto adaptation in §3 right? Specifically, should
   **Visible Range** be the default rather than Daily? (It's the most-used VP mode
   for 24/7 markets.)
3. **Scope of v1** — full parity with both screenshots (incl. Delta mode, Ticks Per
   Row, per-row Values labels), or a lean v1 = Daily/Visible-range + Up/Down +
   POC/VAH/VAL, adding the rest after it's on screen?
4. **Shape taxonomy** — keep all 8 classes with the `Balanced`/`D` peakedness split
   and `Extreme` as its own class (§5.1), or the cleaner **6 shapes + 2 flags**
   (collapse `Balanced`→`D`, demote `Extreme` to a flag)? This only changes the
   threshold table, so it's reversible — but it sets the report vocabulary.

---

## 8. Files touched

| File | Change |
|---|---|
| `lib/indicators/sessionVolumeProfile.ts` | **new** — session grouping + profile math |
| `lib/indicators/sessionVolumeProfile.test.ts` | **new** — unit tests |
| `lib/indicators/profileShape.ts` | **new** — features + classification cascade |
| `lib/indicators/profileShape.test.ts` | **new** — one fixture per shape + boundaries |
| `lib/sessionVolumeProfilePrimitive.ts` | **new** — canvas rendering + shape label |
| `lib/indicatorFramework.ts` | add `profiles?` to `IndicatorResult` |
| `lib/customIndicatorsLibrary.ts` | register the indicator + inputs/styles |
| `components/Chart.tsx` | attach primitive, null on cleanup |
| `components/chart/useChartData.ts` | feed profile data |
| `lib/narrate.ts` | *(Phase 5)* shape clause in narration |
| `lib/reportsEngine.ts` | *(Phase 5)* shape frequency + transition table |
| `components/SignalMatrix.tsx` | *(Phase 5, optional)* profile-shape row |
| `app/api/klines/route.ts` | *(Phase 7 only)* time-window params |
