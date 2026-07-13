# D Smart Line — Implementation Plan

**Date:** 2026-07-12
**Source of truth:** Definedge "D Smart Line" article (C:\Users\ravic\OneDrive\Desktop\TechnicalScanner\DSmartLine.png)
**Status:** Awaiting approval

## 1. What the indicator is

D Smart Line is Definedge's adaptive trailing/trend indicator, born on Renko
charts. Its defining idea: **let the indicator change its behaviour based on
price-action structure — aggressive when the trend is clear, slow when the
market is sideways** — exploiting the Renko property that disparity between
price and an average can only shrink through *corrective bricks* (price must
actually retrace; time alone cannot fix it).

The shipped version (v2) has:

- **Walking Line** — steady adaptive trail. Price above it = bullish regime,
  below = bearish. The stop-loss line.
- **Running Line** — aggressive trail that flips early. Upper edge of the
  bullish cloud, lower edge of the bearish cloud.
- **Cloud** between the two. Price beyond the cloud = trend strength; price
  *inside* = corrective/sideways; wide cloud = major consolidation zone.
- **Signals:**
  - **Arrow (continuation):** brick-Donchian upper band rising → bullish
    arrow under the brick; lower band falling → bearish arrow above. Used
    for pyramiding.
  - **P (pullback):** in an uptrend, counter-trend brick(s) followed by the
    first resumption brick → "P" under the pullback brick. Low-risk entry;
    stop at the Walking Line. Mirrored for downtrends.
  - **★ (exhaustion):** brick direction flip while the Disparity Index
    (price vs. MA of brick closes) is stretched → star above/below the
    brick. The star-pattern breakout then decides continuation vs reversal.

## 2. Critical constraint — no published formulas

Definedge does not publish the construction math; the article is conceptual.
This is therefore a **faithful-in-spirit reconstruction with our own explicit,
deterministic formulas** (documented below and locked by golden-master tests),
NOT a port like the LuxAlgo SMC engine. UI copy must not claim Definedge
equivalence; label it "D Smart-style adaptive cloud".

## 3. Why our architecture makes this cheap

- `lib/renko.ts` already synthesizes bricks (`toRenko`, ATR/fixed/% sizing)
  and the toolbar already has Renko controls.
- `useBaseCandles()` feeds **brick data into the whole indicator pipeline
  when chart type = Renko** — exactly the article's "same formula, brick
  inputs" premise. One indicator implementation is automatically Renko-native
  AND works on candles/Heikin-Ashi (the article's candlestick variant).
- Band plots with `zoneStyle` (from the SMC overlay) give the cloud; the
  marker system gives arrows/P/★.

## 4. Reconstruction spec (deterministic, to be golden-locked)

Input: `Candle[]` (bricks when chart is Renko; candles otherwise). All state
advances bar-by-bar; closed-bar signature caching per the tick-perf rule.

- **Direction & runs:** `dir[i] = sign(close[i] − open[i])` (bricks are
  monotone bodies; on candles use close-vs-close). `run[i]` = consecutive
  same-direction count. `flips(W)` = direction changes in the last W bars.
- **Adaptivity (the core):** trail offset in brick units
  `k[i] = clamp(kBase + λ·flips(W) − μ·min(run[i], runCap), kMin, kMax)`
  — clean runs shrink the offset (aggressive), clustered flips widen it
  (slow). Brick unit `B` = median |close−open| over the last 50 bars
  (= brick size on Renko; ATR-like body scale on candles).
- **Walking Line:** ratchet trail. Uptrend: `walk[i] = max(walk[i−1],
  low[i] − kWalk[i]·B)`; flips to downtrend when `close[i] < walk[i−1]`,
  then mirrors. Never moves against the regime.
- **Running Line:** same construction with `kRun < kWalk` and a shorter
  adaptation window `Wrun < Wwalk`; may retreat (no ratchet) so it hugs
  price and flips early. *(Amended during Phase 1: Running is clamped to the
  Walking line — `max` in bullish, `min` in bearish — because the article is
  explicit that Running is the price-side edge of the cloud; without the
  clamp the edges can invert when chop widens the offsets.)*
- **Cloud/regime:** bullish while `close > walk`. Bullish cloud spans
  [walk, run]; price above run = strength, between run and walk = inside
  cloud (corrective). Width in B units feeds a "consolidation" reading.
- **Arrow:** Donchian(N) of brick highs/lows; upper band strictly rises in
  bullish regime → bullish arrow (fire on transition only, not every bar).
- **P:** regime bullish AND `dir[i−1] = −1` (pullback run 1..3) AND
  `dir[i] = +1` → P at bar i−1. Mirror for bearish.
- **★:** `disp[i] = (close − SMA(close, D)) / SMA(close, D)`. Uptrend
  exhaustion: `dir` flips −1 while `disp[i−1] ≥ T` → star above. Mirror
  below. (On Renko, SMA over bricks makes `disp` shrinkable only by
  corrective bricks — the article's key property, free of charge.)

Defaults (tunable in settings): kBase 2, kMin 1, kMax 4, λ 0.4, μ 0.25,
Wwalk 20, Wrun 8, kRun = kWalk·0.5, Donchian N 10, D 20, T 3%.

## 5. Phases

**Phase 1 — Engine (`lib/indicators/dsmartLine.ts`) + tests.**
Pure `computeDsmart(candles, config) → { walk, run, regime, cloudWidth,
events[] }` (events: arrow/P/star with barIndex + direction). Synthetic
fixtures with known geometry (stair-step trend → line ratchets and P fires;
chop → offsets widen, no P spam; parabolic + flip → star). Golden test via
`defineGoldenTest`.

**Phase 2 — Chart overlay registration (`lib/customIndicatorsLibrary.ts`,
id `dsmart`).** Walking + Running line plots, cloud band (zoneStyle:
bull/bear fills), markers ▲▼ / P / ★ anchored to the candle series.
Settings: mode (cloud | single line), offsets, disparity threshold,
Donchian N, labels on/off. Closed-bar signature cache.

**Phase 3 — Verify on both substrates.** Candles first, then switch chart
type to Renko and confirm brick-native behavior (no code changes expected —
this is the architecture payoff). Playwright: one pass, minimal.

**Phase 4 — Scanner sources (`lib/scanner/dsmartSources.ts`).** Reuse the
M3 SMC pattern: bars-since series for P/arrow/star (backtestable), plus
regime and price-vs-cloud position as full-history series (these ARE per-bar
derivable — better than liveOnly). DSL aliases: `dsmart regime`, `dsmart p`.
Lint/DNA pick them up via `sourceCategories` (category: trend).

**Phase 5 (enhancement, optional) — Renko fidelity.** Our `toRenko` is
close-to-close with 1-brick reversal; TradingView-standard Renko uses
2-brick reversal. Add a `reversalBricks` option (default 1 to preserve the
existing chart; recommend 2 for D Smart) — affects P/star quality on Renko.

## 6. Explicit non-goals (v1)

- No claim of formula equality with Definedge.
- No P&F chart / Turtle-breakout variant (no P&F substrate in the app).
- No auto-pyramiding logic — arrows are informational markers.
- Star support/resistance "breakout of the star pattern" trade rules stay
  narrative (tooltip copy), not signals.

## 7. Scope answers assumed (user was away; override freely)

- Version: **v2 cloud, full** (single-line mode included as a setting).
- Scanner integration: **yes** (Phase 4).
