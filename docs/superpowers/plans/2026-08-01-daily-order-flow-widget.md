# Daily Order Flow Widget — Implementation Plan

Two accumulating columns — **green = buy (taker) volume, red = sell (taker) volume**
— built up across the trading day and updating live, so a glance answers: *are
buyers or sellers in control right now?*

---

## 1. What already exists (verified, not assumed)

Your claim that the app already has order-flow feeds is **correct**, and the
implementation is right:

| Piece | Where | State |
|---|---|---|
| Live tape | `lib/ws.ts` → `subscribeTrades()` on Binance `@aggTrade` | ✅ real taker trades |
| Aggressor side | `lib/ws.ts:213` — `side: data.m ? 'sell' : 'buy'` | ✅ correct convention |
| Buy/sell accumulator | `lib/orderFlow.ts` — `accumulate()` / `delta()` | ⚠️ **per-candle**, see §2 |
| Existing UI | `components/OrderFlowPanel.tsx` | delta for the *current candle* |
| Widget manager | `components/WidgetsPanel.tsx` (`WIDGETS`, `DEFAULT_WIDGET_PREFS`) | ✅ opt-in slot ready |
| Right rail | `components/RightDock.tsx` — already has an `orderflow` panel id | ✅ |

**On the side convention** — worth stating because it's the one thing that silently
inverts a whole order-flow feature: Binance's `m` is *"was the buyer the maker?"*.
If `m === true` the resting order was the buyer's, so the **aggressor was a seller**
→ `'sell'`. `lib/ws.ts` has this the right way round.

---

## 2. The gap: existing accumulation is per-candle, not per-day

`lib/orderFlow.ts:29` resets on every candle boundary — deliberately, because it
feeds a per-candle delta readout:

```ts
if (acc.bucket !== bucket) { acc.bucket = bucket; acc.buyVol = 0; acc.sellVol = 0; }
```

This widget needs the opposite: **one bucket per day that never resets until the
UTC date rolls**. So it needs its own accumulator rather than a change to
`orderFlow.ts` (which `OrderFlowPanel` still depends on for candle-scoped delta).

---

## 3. The real problem: cold start

A WebSocket only delivers trades **from the moment you connect**. Open the app at
15:00 and you have missed 15 hours of the day's flow — for a widget whose whole
premise is *"throughout the day"*, that is fatal, not cosmetic. Two honest options:

### Option A — "Since connect" (no backfill)
Accumulate only what the socket sees. Simple, but the columns mean *"since you
opened the tab"*, which must then be said in the UI. Reloading the page wipes it.

### Option B — Backfill from klines ← recommended
Binance kline rows carry **`takerBuyBaseAssetVolume` at index 9**. That yields the
split exactly:

```
buyVolume  = takerBuyBaseAssetVolume
sellVolume = volume − takerBuyBaseAssetVolume
```

So the day's true buy/sell split is *already reaching your app* — and is being
discarded one line before it would be usable:

> `lib/schemas.ts:45` parses the 12-field tuple but maps only `r[5]` (total
> volume). Index 9 is validated and then dropped.

Fetching today's 1m (or 5m) klines on mount reconstructs the full day, then the
socket takes over live. **Survives reloads, correct at any hour.**

**Cost:** widen `Candle` with an optional `takerBuyVolume?`, or add a small
dedicated fetch. Everything downstream is additive — no existing consumer changes.

**Seam:** the accumulator takes `{buyVol, sellVol}` in. Whether the numbers came
from backfill or the socket is invisible to it, so A can ship first and B slot in
underneath without touching the UI.

---

## 4. Design

### 4.1 What the two columns encode

Bar height = cumulative volume for the day, both drawn to a **shared scale** (the
larger of the two), so their relative height *is* the answer. Supporting readouts:

- **Delta** (buy − sell) with sign and colour — the headline number.
- **Imbalance %** = `buy / (buy + sell)` — the "who is in control" figure, and the
  one that stays comparable across days of different volume.
- Absolute buy / sell volume under each column.

### 4.2 Why not just one delta bar
A single net-delta bar hides *participation*: +100 delta on 200 total volume
(thin, one-sided) reads identically to +100 on 50,000 (heavy two-way fight). Two
columns show magnitude and balance at once — which is exactly why you asked for
two, and it's the right call.

### 4.3 Optional (flag it if you want it)
A thin **intraday sparkline of cumulative delta** under the columns turns "who is
winning now" into "who has been winning, and is it turning" — this is where the
widget stops being a gauge and starts being a signal. Off by default.

---

## 5. Phases

### Phase 1 — `lib/dailyOrderFlow.ts` (+ tests)
Pure, framework-free:
- `emptyDailyFlow()`, `accumulateDaily(acc, trade)` — resets **only** on UTC-day
  rollover.
- `seedFromKlines(acc, candles)` — backfill path (Option B).
- Derived: `delta`, `imbalancePct`, `dominantSide`, `totalVolume`.
- Guard double-counting at the backfill→live handover with a `lastSeededTime`
  watermark, so trades already inside a backfilled kline are ignored.

**Tests:** rollover resets; buy/sell attribution; imbalance at 0 volume (no NaN);
seed + live handover doesn't double count; a seed of an empty day is a no-op.

### Phase 2 — Data source
- Option A: subscribe only.
- Option B: extend `lib/schemas.ts` to keep `r[9]` as `takerBuyVolume`, thread it
  through `Candle`, and seed on mount. (Backwards-compatible: optional field.)

### Phase 3 — `components/DailyOrderFlowWidget.tsx`
- Two columns, shared scale, MDS tokens (`--bull` / `--bear`) so it re-skins with
  all six themes.
- Height animates on change; respects `prefers-reduced-motion`.
- Throttle renders to ~4/s via rAF — the tape can burst to hundreds of msgs/sec
  and must not drive a React render per trade (the existing panel's `setVersion`
  bump is the pattern to avoid at this volume).
- States: connecting · live · stale/disconnected · backfilling · empty.
- Colour is never the only cue: label each column BUY / SELL and show the numbers.

### Phase 4 — Wiring
- Register in `WIDGETS` + `DEFAULT_WIDGET_PREFS` (`components/WidgetsPanel.tsx`),
  opt-in, matching the Active Trade widget precedent.
- Render site keyed off the same pref.
- Reset cleanly on symbol switch (the `useMarketData` stale-candle bug from
  2026-07-31 is the cautionary precedent — flow must not carry across symbols).

---

## 6. Decisions needed

1. **Cold start: A or B?** I recommend **B** — the field is already arriving and
   being discarded, and without it the widget silently means "since you opened the
   tab".
2. **Day boundary: UTC or local?** UTC matches the rest of the app (session
   grouping in `sessionVolumeProfile.ts` uses UTC days). Local is friendlier but
   would disagree with the SVP daily sessions.
3. **Cumulative-delta sparkline** in v1, or columns only?
4. **Placement**: opt-in widget in the right rail (consistent with Active Trade),
   or promoted into the existing `orderflow` RightDock panel next to the
   per-candle delta?

---

## 7. Files

| File | Change |
|---|---|
| `lib/dailyOrderFlow.ts` | **new** — day accumulator + derived metrics |
| `lib/dailyOrderFlow.test.ts` | **new** — rollover, attribution, handover |
| `components/DailyOrderFlowWidget.tsx` | **new** — the two-column widget |
| `lib/schemas.ts` | *(Option B)* keep `takerBuyVolume` from `r[9]` |
| `lib/types.ts` | *(Option B)* optional `takerBuyVolume` on `Candle` |
| `components/WidgetsPanel.tsx` | register + default pref |
| render site (`app/app/page.tsx` or `RightDock`) | mount keyed off the pref |

Unchanged: `lib/orderFlow.ts` and `OrderFlowPanel.tsx` keep their per-candle
behaviour.
