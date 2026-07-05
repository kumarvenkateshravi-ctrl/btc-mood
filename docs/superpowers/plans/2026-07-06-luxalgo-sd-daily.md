# LuxAlgo "Supply and Demand Daily" Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task after user approval.

**Goal:** Port LuxAlgo's *Supply and Demand Daily* (Pine v5) as a new, separate indicator `lux_sd_daily` — volume-profile-derived daily supply/demand zones with Average + Weighted-Average lines — plus the exact signal layer specified in `NewSupplyDem.md` (zone-touch → rejection close → volume confirmation → retest gate) and zone invalidation.

**Status:** DRAFT — awaiting user review.

---

## ⚠️ 0. License notice (decide before we build)

The source is **CC BY-NC-SA 4.0** (© LuxAlgo) — **NonCommercial + ShareAlike + Attribution**.
A TypeScript port is a derivative work, so:
- **NC:** it may not be part of a *paid* product. This conflicts with the planned $5/mo
  subscription for the signals product. Options: (a) keep this indicator in the free tier
  only and never behind the paywall, (b) use it for personal analysis/validation only,
  (c) treat it as research and later build an original volume-profile zone method.
- **BY:** the indicator description/UI must credit "LuxAlgo — Supply and Demand Daily (CC BY-NC-SA 4.0)".
- **SA:** the ported file should carry the same license header.

The plan proceeds with attribution + license header and assumes **(a) free-tier only**
unless you say otherwise.

---

## 1. What the indicator actually does (exact algorithm)

Different from our existing `sd_zones` (prior-period wick zones): this derives zones from
the **intraday volume distribution** — closer to a per-day volume profile.

For each **completed UTC day** D (bars `x1..x2`, matching Pine's `dayofmonth` change;
crypto = UTC, reusing `htf.ts` day bucketing):

1. `max` = day high, `min` = day low, `csum` = Σ day volume, `r = (max − min) / div`
   (`div` = "Resolution", default 50).
2. **Supply** — scan bins downward from `max`. Bin *i* spans `(max−(i+1)r, max−ir)`.
   Iterate the day's bars **newest → oldest** (Pine `j = 1 …`); a bar's volume counts
   toward the bin when its **high** lies strictly inside the bin. After every bar,
   accumulate `sum`, `wavgNum += lvl·Δsum`, and test `sum / csum × 100 > per`
   (`per` = "Threshold %", default 10). On first crossing (can happen mid-bin — we
   replicate that exactly):
   - zone = `[lvl … max]`, `avg = (max + lvl)/2`, `wavg = wavgNum / Σ` (volume-weighted).
3. **Demand** — exact mirror from `min` upward, binning bar **lows**.
4. **One supply + one demand zone per day** (first threshold crossing only) — a known
   limitation the source doc calls out; multi-zone is Phase 2.
5. **Extent (matches Pine):** day D's zones draw from D's first bar to the first bar of
   D+1; the most recent day's zones extend to the live bar.
6. **Intrabar approximation:** Pine samples lower-TF intrabars via
   `request.security_lower_tf`. We use the chart-TF bars of the day as the samples
   (equivalent to Intrabar TF = chart TF). Documented in the indicator description;
   the `Intrabar TF` input is intentionally omitted.

### Signal layer (verbatim from the doc's Pine snippet, evaluated against the latest zones)

- `touchDemand = low ≤ demand.upper && low ≥ demand.lower`
- `rejectDemand = touchDemand && close > demand.upper` (supply mirrored)
- `highVol = volume > SMA20(volume) × 1.2`
- Retest counter per zone: a **new touch episode** (`touch[1] && !touch[2]`) increments;
  counters **reset when a new day's zone replaces the old** (see Q3).
- `buySignal = rejectDemand && highVol && retests < 3` (sell mirrored)
- **SL:** `demand.lower − 0.25×ATR14` (buy) / `supply.upper + 0.25×ATR14` (sell)
- **TP1:** the **opposite zone's wavg** line.
- **Invalidation (doc Step 2, "critical"):** a candle **body** fully beyond the boundary
  (both open & close below demand.lower / above supply.upper) marks the zone broken —
  no further signals from it until the next day's zone replaces it.

---

## 2. Scope

**In (this plan):** exact base port + exact signal snippet + invalidation (doc Steps 1–2),
rendered with our premium zone system, registered as a separate indicator.

**Out (Phase 2 — doc Steps 3–5 + remaining enhancements):** HTF trend filter (50-EMA),
candlestick-pattern filter, multi-zone per day, adaptive threshold, MTF confluence,
alerts. Each is an additive gate/loop change on top of this foundation.

---

## 3. Files

- Create `lib/indicators/luxSdDaily.ts` — pure compute (license header + attribution):
  - `computeLuxDailyZones(candles, per, div)` → per-day
    `{ dayStart, dayEnd, supply: { upper, lower, avg, wavg } | null, demand: … | null }`
  - `computeLuxSdDaily(candles, config?)` → `IndicatorResult`
- Create `lib/indicators/luxSdDaily.test.ts` — unit tests
- Create `lib/indicators/luxSdDaily.golden.test.ts` + fixture (determinism lock)
- Modify `lib/customIndicatorsLibrary.ts` — register `lux_sd_daily`

Reused as-is: `htf.ts` UTC-day bucketing · `atrSeries` (Wilder ATR14) · `pm.sma` ·
band plots + `BandZoneStyle` premium renderer · `signals[]` arrow path · `levels` for
SL/TP · golden harness. **No changes to `signalEngine.ts` or `sd_signals`** — this is a
fully separate indicator.

---

## 4. Rendering (maps 1:1 to the Pine style inputs)

| Pine element | Our rendering |
|---|---|
| Supply box (`#2157f3` @ 80 transp) | band plot `Supply`, `zoneStyle` (boundary = lower, per-day runs, label `Supply ★`-less — plain "Supply") |
| Supply Average (solid) | line plot, per-day stepped segments |
| Supply Weighted (dashed) | line plot, dashed |
| Demand box (`#ff5d00`) / Average / Weighted | mirrored |
| Style toggles (Supply/Area/Average/Weighted, Demand/…) | boolean inputs + per-plot style entries |
| Signals (triangles `#00E676`/`#FF1744`) | per-bar `signals[]` (standard arrow path) |
| SL/TP of most recent signal | `levels`: SL solid red, TP1 dashed green |

Zone colors default to LuxAlgo's blue/orange — conveniently consistent with our new
structure palette. Labels: "D Supply" / "D Demand" (no strength score — this engine has
no scoring; see Q4).

**Inputs:** `per` (Threshold %, 10, 0–100) · `div` (Resolution, 50, 2–500) ·
show/area/avg/wavg toggles per side · signal gates (`volMult` 1.2, `maxRetests` 3,
`slBufferAtr` 0.25, `showSignals`, `showTradeLevels`).

---

## 5. Tasks (each: failing test → implement → verify → commit)

1. **Day bucketing + accumulation** — split candles into UTC days; day max/min/csum.
   Test: synthetic 3-day series, exact boundaries (reuses `htf.ts` semantics).
2. **Bin scan (the core loop)** — exact Pine replication incl. mid-bin threshold crossing
   and wavg-at-crossing. Test: hand-computed 1-day fixture (few bars, div=4) asserting
   zone bounds, avg, wavg to 6dp; mirror test for demand; no-crossing day → null zone.
3. **Zone series builder** — per-day zones → band `runs` + stepped avg/wavg line arrays
   with Pine's extents (historical: own day + 1 bar; latest: to live bar). Test: array
   shape + extents on the 3-day fixture.
4. **Signal layer** — touch/reject/highVol/retest/invalidation exactly as §1. Tests:
   each gate individually + a full lifecycle (touch→reject→signal; body-through →
   broken → no signal; new day → counters reset).
5. **`computeLuxSdDaily` + registration** — assemble `IndicatorResult`, register with
   inputs/styles + attribution in description. Test: framework-shape test; toggles blank
   the right plots. Full suite + tsc + eslint.
6. **Golden master** — `defineGoldenTest` fixture locks determinism.
7. **Live verification** — add on chart, screenshot: zones per day, avg/wavg lines,
   signals, SL/TP levels; perf sanity (compute is O(days × div × barsPerDay) ≈ fine, and
   the indicator memo only recomputes on candle changes).

---

## 6. Open questions (answer at review)

1. **License handling** — confirm free-tier-only (§0), or a different choice?
2. **Equilibrium** — the Pine's Settings define Equilibrium inputs, but the provided
   code never draws it. Implement as the day midpoint `(max+min)/2` line (off by
   default), or omit entirely to match the code exactly? **Plan default: omit.**
3. **Retest counters** — the snippet never resets them (they'd grow forever across
   days); the stated rule is per-zone ("zone not tested more than 2×"). **Plan default:
   reset per new zone** (deviation from snippet, faithful to intent).
4. **Signals on the forming bar** — the snippet evaluates live (repaint-y on the last
   bar, like Pine). Keep Pine semantics, or apply our strict closed-bar convention?
   **Plan default: closed-bar** (consistent with the platform's non-repaint promise).
5. **TP2** — the doc's strategy table adds TP2 = zone boundary / 2× risk, but the
   snippet only defines TP1. **Plan default: TP1 only** (add TP2 in Phase 2).
