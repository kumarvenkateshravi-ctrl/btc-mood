# Volume Distribution Zones v1 — Implementation Plan (supersedes the LuxAlgo port plan)

> **For agentic workers:** execute task-by-task, TDD, commit per task.

**Goal:** Build **MyCryptoStack Volume Distribution Zones** — an ORIGINAL volume-distribution
zone engine (classic volume-profile value-area methodology + original scoring), inspired by
the LuxAlgo research but sharing no code — with zone intelligence (health, confidence,
acceptance, reaction, classification, sweep), a closed-bar signal layer with TP1/TP2/TP3,
and AI-ready structured outputs.

**Why not a port (locked decisions from LuxEnancement.md):**
1. **License — NO port.** The LuxAlgo script (CC BY-NC-SA) is research/reference only.
   This engine uses a different algorithm (proportional range-volume histogram, adaptive
   bins/threshold, buy/sell delta, lifecycle scoring) → original work, commercializable.
2. **Equilibrium — YES:** every zone shows all four: Upper, Weighted Average, Midpoint, Lower.
3. **Retest counters reset per new zone.**
4. **Closed bars only, 100%** — platform-wide non-repaint promise.
5. **TP1/TP2/TP3 — build now:** TP1 = opposite zone wavg · TP2 = opposite zone distal
   boundary · TP3 = measured move (entry ± source-period range).

**Architecture note (Layers):** this indicator is the first producer for the future
Market-Intelligence → Context → Decision engine. Its structured `VdZone` output
(Enhancement 12) is the `MarketFeature` seed; the cross-indicator Context/Decision Engine
is a separate future project — NOT built here.

---

## Original algorithm (Phase 1 — Core Engine)

Per **completed** HTF period (4H / D / W / M; UTC bucketing from `htf.ts`; zones freeze at
period close → non-repainting):

1. **Histogram:** split the period range into `bins` price bins. Each bar's volume is
   distributed **proportionally across every bin its [low, high] range overlaps**
   (⇽ different from Lux's point-binning of highs/lows). Volume is split into
   buy/sell via the close-position estimator: `buyVol = vol × (close−low)/(high−low)`.
2. **Adaptive resolution (E4):** `bins = clamp(round((range / ATR14) × 6), 30, 120)`
   (fallback 50 when ATR unavailable).
3. **Adaptive threshold (E3):** `thr% = clamp(10 × range / SMA₂₀(periodRange), 7, 15)`.
4. **Zone extraction:** accumulate histogram volume downward from the period high until
   cumulative ≥ thr% of period volume → **Supply = [level … high]**. Mirror upward from
   the low → **Demand**. Per zone: `upper, lower, midpoint, weightedAverage`
   (volume-weighted bin price), `volume, buyVolume, sellVolume, delta, imbalance`
   (delta/volume), `threshold`, `binCount`.
5. **Structured output (E12):**

```ts
interface VdZone {
  id: string;                    // `${tf}:${kind}:${periodStart}`
  kind: 'supply' | 'demand'; tf: HtfPeriod;
  upper: number; lower: number; midpoint: number; weightedAverage: number;
  volume: number; buyVolume: number; sellVolume: number; delta: number; imbalance: number;
  threshold: number;             // adaptive thr% used
  formedAtIndex: number; formedTime: number; endIndex: number | null; // null = still active
  // intelligence (Phase 2)
  status: 'fresh' | 'retest1' | 'retest2' | 'weak' | 'consumed' | 'broken';
  health: number;                // 100 → 0
  touches: number; acceptanceBars: number; reactionScore: number; // 0..1
  swept: boolean;                // liquidity sweep seen (E9)
  classification: 'institutional' | 'exhaustion' | 'major' | 'minor'; // E7
  clustered: boolean;            // overlaps same-kind zone on another TF (E11)
  confidence: number;            // 0..100 (E5)
  brokenAtIndex: number | null;
}
```

## Zone intelligence (Phase 2) — deterministic formulas

- **Touches:** a touch episode = bars entering the zone after formation, counted once per
  entry (`inZone && !inZone[1]`). Counters live per zone (reset by construction — E/Q3).
- **Health (E1):** `100 − 20×touches` (floor 20); **consumed → 10**, **broken → 0**.
  Status ladder: fresh(0) → retest1(1) → retest2(2) → weak(≥3) → consumed/broken.
- **Broken:** a bar's **body** fully beyond the distal boundary (demand: max(open,close)
  < lower; supply: min(open,close) > upper). Zone's band run ENDS at that bar (honest
  rendering); no further signals from it.
- **Acceptance (E8):** ≥ `acceptanceBars` (3) consecutive **closes inside** the zone →
  status `consumed` (price accepted, not rejected — no more signals).
- **Reaction score (E10):** after each touch episode ends, MFE over the next 5 bars in
  the rejection direction, in ATRs: `clamp(mfe / (2×ATR14), 0, 1)`; zone keeps the
  average across episodes.
- **Sweep (E9):** wick pierces the distal boundary while the **close reclaims** back
  inside/beyond the proximal side → `swept = true` (+10 confidence, flagged on signals).
- **Classification (E7):** priority — `institutional` (volShare ≥ 1.5×thr AND |imbalance|
  ≥ 0.2) → `exhaustion` (period extreme is the max/min of the last 20 periods) →
  `major` (volShare ≥ 1.2×thr) → `minor`.
- **Clustering (E11):** overlaps a same-kind zone from another configured TF →
  `clustered = true` (feeds confidence).
- **Confidence (E5), 0–100:** `0.20·volQuality + 0.25·health/100 + 0.15·reaction +
  0.15·trendAlign + 0.15·(clustered?1:0) + 0.10·proximity`, where volQuality =
  clamp(volShare/ (1.5×thr), 0, 1), trendAlign = 1 when close vs EMA50 favors the zone
  (demand: close > EMA50), proximity = 1 − clamp(distance-to-price / (5×ATR), 0, 1).
- **Zone memory (E6):** the `VdZone[]` array IS the memory — every zone (incl. broken/
  consumed) is retained with its lifecycle fields; analytics UI = Phase 4 (deferred).

## Signal layer (Phase 3) — closed bars only

For the latest healthy zone per (tf, kind) — status not broken/consumed:
- **Arm:** bar enters zone. **Confirm:** bar **closes** beyond the proximal boundary
  (demand: close > upper). Forming bar never evaluated.
- **Gates (all configurable):** `volume > 1.2×SMA₂₀(vol)` · `touches ≤ 3` ·
  `health ≥ 40` · `confidence ≥ 50` · optional **trend filter ON** (buy only if
  close > EMA50; sell mirrored) · `R:R to TP1 ≥ 1.2`.
- **Levels:** SL = distal edge ∓ 0.25×ATR14 · TP1 = opposite zone `weightedAverage` ·
  TP2 = opposite zone distal boundary · TP3 = entry ± source-period range (measured
  move). Fallbacks when no opposite zone: TP1 = 1.5R, TP2 = 2.5R, TP3 = 4R.
- Output: per-bar `signals[]` (arrows), `levels` for the latest signal (entry teal, SL
  red, TP1/2/3 dashed green), origin anchors on the source zone.

## Rendering

Reuses the premium `BandZoneStyle` renderer: band per (tf, kind) with per-zone runs
(runs END at break bars), boundary = proximal edge, dashed 4H / solid D, `mid: true`
(midpoint), labels `D Supply · 87` (confidence; classification in title-case when not
minor: `D Supply · Inst · 91`), `emphasis = confidence/100`, focus = nearest healthy
zone. Weighted-average = dashed line plots per (tf, kind). Supply blue / demand orange
(platform structure palette). Display toggles: zones per side, wavg, midpoint, signals,
trade levels.

---

## Step-by-step tasks (TDD; commit per task)

**Task 1 — Types + period scaffolding** (`lib/indicators/vdEngine.ts` + test)
`VdZone`, `VdConfig` (+defaults: tf1 D, tf2 4H, thrBase 10, binsAuto, volMult 1.2,
maxRetests 3, minHealth 40, confidenceFloor 50, minRR 1.2, slBufferAtr 0.25,
acceptanceBars 3, trendFilter true), period splitting via `htf.ts` (completed periods
only). Test: 3-day synthetic split, boundaries exact.

**Task 2 — Histogram + zone extraction** (core; same files)
Proportional range-volume histogram, buy/sell split, adaptive bins (E4), adaptive
threshold (E3), supply/demand extraction with upper/lower/mid/wavg/volume/delta.
Tests: hand-computed 4-bar period (bins=4) → exact zone bounds/wavg/delta to 6dp;
mirror demand; degenerate flat-range period → null zones.

**Task 3 — Zone intelligence** (E1, 7, 8, 9, 10, 11 + confidence E5)
Lifecycle walker over bars after formation: touches, broken (body), acceptance,
reaction, sweep, classification, clustering, health, confidence. Tests: each rule
isolated on crafted bars + a full lifecycle (fresh→retest→broken ends the run).

**Task 4 — Signal layer** (closed-bar, gates, TP1/2/3, SL)
Tests: gate-by-gate + full buy lifecycle on crafted bars; forming-bar never signals;
trend filter blocks counter-trend; TP fallbacks.

**Task 5 — Indicator compute + registration**
(`lib/indicators/volumeDistributionZones.ts` + test; `customIndicatorsLibrary.ts`)
`computeVolumeDistributionZones` → IndicatorResult (bands + wavg lines + signals +
levels + anchors); id `volume_distribution_zones`, name "Volume Distribution Zones";
description notes original methodology + closed-bar non-repainting. Framework-shape +
toggle tests. Full suite + tsc + eslint.

**Task 6 — Golden master** (`defineGoldenTest` fixture) — determinism lock.

**Task 7 — Live verification** — add on chart, screenshot: per-period zones with all
four lines (upper/wavg/mid/lower), labels with confidence, runs ending at breaks,
signals + TP1/2/3, perf sane. Commit.

**Phase 4 (deferred, separate plan):** zone analytics (stats, heatmap, performance by
confidence tier), backtest integration, cross-indicator Context/Decision Engine.
