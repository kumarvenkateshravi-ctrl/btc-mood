# Value & Flow widget — design

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning

## Purpose

Session Volume Profile says **where the battle is** (which prices the market has
accepted as fair). Daily Order Flow says **who is winning** (whether buyers or
sellers are pressing today). Neither alone tells you whether a move away from
value is real.

This widget joins them into a single named reading of the market's current
condition, with the evidence that produced it.

## Scope boundary

The widget is **descriptive, not prescriptive**. It names the market's
condition; it does not issue a trade verdict.

This is deliberate. The app already has four things that answer "what should I
do": the M9 Trade Decision Engine, the MTF Board, Market Context, and Signal
Matrix. A fifth independent verdict would eventually contradict them on screen
and erode trust in all of them. The trade call stays with M9 and the Board;
this widget supplies a condition they don't currently express.

### Non-goals

- No probability or percentage likelihood. There is no backtest behind these
  states, so any number would be fabricated.
- No trade signals, entries, stops or targets.
- No historical day browsing. Today only.
- No new market mathematics. This is a reasoning layer over three existing,
  tested modules.

## Inputs

All three already exist as pure exported functions:

| Source | Function | Supplies |
|---|---|---|
| `lib/indicators/sessionVolumeProfile.ts` | `buildSessionProfiles()` | `poc`, `vah`, `val`, `low`, `high`, `rows` |
| `lib/indicators/profileShape.ts` | `classifyProfile()` | `shape`, `confidence`, `hasExtremes`, `why` |
| `lib/dailyOrderFlow.ts` | `flowStats()`, `sparkSeries()` | `delta`, `buyShare`, `dominant`, cumulative delta |

Plus the current price and recent closes from `candlesByTf['5m']`.

## Architecture

| Layer | File | Responsibility |
|---|---|---|
| Fusion engine | `lib/valueFlow.ts` *(new)* | Pure. Input → one `ValueFlowReading`. No React, no chart, no network. |
| Shared flow state | `lib/hooks/useDailyOrderFlow.ts` *(new, extracted)* | Owns accumulator, backfill, and the single WS subscription. |
| Widget | `components/ValueFlowWidget.tsx` *(new)* | Render only. |
| Registration | `components/WidgetsPanel.tsx`, `app/app/page.tsx` | Opt-in, same pattern as Daily Order Flow. |

### Why the hook extraction is in scope

`subscribeTrades()` in `lib/ws.ts` opens a **new WebSocket per call** — it does
not multiplex. If `ValueFlowWidget` subscribed independently while
`DailyOrderFlowWidget` was also mounted, the app would hold two sockets on the
same `@aggTrade` stream and run the same accumulation twice.

Extracting the accumulator + backfill + subscription into
`useDailyOrderFlow(symbol, candles)` and consuming it from both widgets fixes
this. `DailyOrderFlowWidget` gets thinner; its behaviour is unchanged.

### Session-mode independence

The widget computes its **own UTC-daily profile**. It does not reuse the
session mode configured on the SVP chart indicator (15m / 30m / 1h / 4h /
daily / weekly / monthly / visible / custom).

Reusing it would mean changing a chart setting silently changes the widget's
meaning, and a non-daily mode would stop lining up with the UTC-daily order
flow. The cost is a little duplicated computation; the benefit is that the
widget always means exactly one thing.

## Engine contract

```ts
type Location = 'above-value' | 'in-value' | 'below-value';
type Pressure = 'buyers' | 'sellers' | 'balanced';
type FlowMomentum = 'accelerating' | 'steady' | 'fading';
type Conviction = 'low' | 'medium' | 'high';

type MarketState =
  | 'continuation-up'   | 'drifting-above' | 'failed-breakout'
  | 'coiling-up'        | 'balanced-rotation' | 'coiling-down'
  | 'failed-breakdown'  | 'drifting-below' | 'continuation-down';

interface ValueFlowInput {
  profile: VolumeProfile;
  classification: ProfileClassification;
  flow: DailyFlowStats;
  cumulativeDelta: number[];
  price: number;
  recentCloses: number[];
}

interface ValueFlowReading {
  state: MarketState;
  location: Location;
  pressure: Pressure;
  momentum: FlowMomentum;
  conviction: Conviction;
  /** 0..1 share of the acceptance window beyond the breached boundary. */
  acceptance: number;
  /** 2-3 plain sentences naming the facts behind `state`. */
  evidence: string[];
  hasData: boolean;
}

export function readValueFlow(input: ValueFlowInput): ValueFlowReading;
```

## The state grid

`state` is resolved in two steps: a **base state**, which is a total function of
(`location`, `pressure`), then a single documented **acceptance degradation**
(see below). Nine cells, mutually exclusive, fully covering.

|  | Buyers winning | Balanced | Sellers winning |
|---|---|---|---|
| **Above value** | `continuation-up` | `drifting-above` | `failed-breakout` |
| **In value** | `coiling-up` | `balanced-rotation` | `coiling-down` |
| **Below value** | `failed-breakdown` | `drifting-below` | `continuation-down` |

The two off-diagonal cells — `failed-breakout` and `failed-breakdown` — are the
readings unobtainable from either tool alone: price has left value but flow
refuses to confirm it. They are the reason for building this.

A grid is used rather than an ordered cascade because location and pressure are
genuinely independent; a cascade would have to rank one above the other, which
is not true of the domain. A total grid also makes unreachable states
impossible by construction — the failure mode `profileShape.ts` shipped twice
(`dKurtosis: 3.0`, which a normal distribution sits exactly on, and
`trendVaCoverage: 0.72`, which a 70% value area can never exceed).

## Derivations

### Location

```
in-value    ⟺  val <= price <= vah
above-value ⟺  price > vah
below-value ⟺  price < val
```

Bounds inclusive on both sides, so a price exactly on VAH or VAL is
deterministic and no gap exists between cells.

### Acceptance

Share of the last **12 closed 5m bars** (one hour) whose close is beyond the
breached boundary. When `location` is `in-value`, acceptance is reported as
`1` (price is where it belongs; nothing is being tested).

Below **0.33** the excursion is treated as a *poke* rather than acceptance, and
the state degrades:

- `continuation-up` → `drifting-above`
- `continuation-down` → `drifting-below`

This is what prevents a single wick beyond VAH reading as a breakout. It does
not degrade `failed-*` states — a poke that flow also rejects is still a
failure, and arguably a cleaner one.

Note the degraded state collides with the balanced-flow cell: a poked
`continuation-up` and a genuine `drifting-above` both render as
`drifting-above`. This is accepted — "drifting above value" describes both
honestly — and no information is lost, because `pressure`, `acceptance` and
`evidence` remain separately exposed on the reading.

### Pressure

Taken from `flowStats().dominant` unchanged, so this widget can never disagree
with the Daily Order Flow widget rendered above it.

Note `BALANCED_BAND` is 0.02, so `balanced` is rare and the middle column will
seldom fire. This is accepted for v1: consistency with the existing widget
matters more than a tuned band, and real readings should inform any widening
rather than a blind guess now.

### Flow momentum

From `cumulativeDelta`: compare the slope of the final third against the slope
of the earlier two-thirds.

| Condition | Result |
|---|---|
| recent ≥ 1.3× earlier, same sign | `accelerating` |
| recent ≤ 0.5× earlier, or sign flipped | `fading` |
| otherwise | `steady` |
| fewer than 6 samples | `steady` |

### Conviction

Counts agreeing factors:

1. `acceptance >= 0.6` (always true when `in-value`, where acceptance is 1)
2. `|buyShare − 0.5| > 0.10`
3. Momentum reinforces the base state, defined explicitly as:
   - `accelerating` **and** pressure agrees with location
     (`above-value` + `buyers`, or `below-value` + `sellers`), **or**
   - `fading` **and** pressure opposes location
     (`above-value` + `sellers`, or `below-value` + `buyers`) — a failing move
     losing steam is itself confirmation of the failure
   - `in-value`: counts when momentum is `steady` (balance is genuine)
4. `classification.confidence > 0.3`

3–4 → `high`; 2 → `medium`; 0–1 → `low`. Deliberately ordinal, not a
percentage.

Conviction is forced to `low` when fewer than **12 closed 5m bars** (one hour)
of the UTC day have elapsed, regardless of factor count.

### Evidence

Two to three sentences generated from the resolved components, e.g.

- "Price is above today's value area (63,910 vs VAH 63,720)."
- "Buyers hold 58% of today's volume."
- "Cumulative delta has been fading since midday."

## Data flow

```
candlesByTf['5m']
  ├→ buildSessionProfiles(mode:'daily') → today's profile → classifyProfile()
  └→ useDailyOrderFlow(symbol, candles) → flowStats() + sparkSeries()
                                    ↓
                          readValueFlow(...) → ValueFlowReading → widget
```

Profile and flow are **both keyed on the UTC day**, so they roll over together
and can never describe different days.

## Edge cases

| Case | Behaviour |
|---|---|
| Profile has fewer than `SHAPE_THRESHOLDS.minRows` (8) rows | `hasData: false`; widget shows "Building today's profile…" |
| No candles for today yet | `hasData: false` |
| Flow unseeded (no `takerBuyVolume` on any candle) | Pressure reported unavailable, never guessed |
| Fewer than 12 closed 5m bars into the UTC day | Conviction forced to `low` — the profile is least meaningful exactly then, and the widget should say so |
| Price exactly on VAH or VAL | `in-value` (inclusive bounds) |
| Flat / single-row profile | `hasData: false` rather than a degenerate classification |
| UTC day rollover | Profile and flow reset together; no mixed-day reading |

## Performance

The profile rebuild is memoised on a **closed-bar signature**, not recomputed
per tick. Per the project's `indicator-tick-perf` constraint, expensive
indicator work on every tick hangs the chart.

## Testing

`lib/valueFlow.test.ts`:

- **All 9 grid cells asserted explicitly**, so no state can be unreachable.
- Poke vs acceptance: same location, acceptance above and below 0.33, assert
  the `continuation-*` → `drifting-*` degradation and that `failed-*` does not
  degrade.
- Momentum: accelerating, steady, fading, sign-flip, and the under-6-samples
  guard.
- Conviction laddering: 0–4 agreeing factors → expected ordinal, plus the
  "under 12 bars into the day forces `low`" override.
- Boundary prices exactly on VAH and VAL.
- Degenerate profiles (flat, single row, under `minRows`) → `hasData: false`.
- Day-rollover coherence: profile and flow never describe different UTC days.

`lib/hooks/useDailyOrderFlow.test.ts` (or equivalent): the extracted hook
preserves `DailyOrderFlowWidget`'s existing behaviour — backfill seeds once per
symbol+day, watermark prevents double-count, symbol switch resets.

## Open items intentionally deferred

- Widening `BALANCED_BAND` for state purposes — revisit after observing real
  readings.
- Feeding the reading into the MTF Board as an input — possible later; out of
  scope while the widget is descriptive-only.
- Historical day browsing.
