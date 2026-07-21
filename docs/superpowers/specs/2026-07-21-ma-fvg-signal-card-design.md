# "Moving Averages & FVG" Signal Card (Custom MTF, 5m) — frozen design

**Date:** 2026-07-21 · **Status:** FROZEN (user-approved) · **Surface:** `/custom-multi-timeframe`

## Purpose

A new card that turns the "Moving Averages & FVG" indicator's Buy/Sell signals (5-minute timeframe
only) into an actionable decision surface, with market context shown for situational awareness.

## Architecture (user-specified, non-negotiable)

```
Indicator (MA-FVG, 5m)   →  DECIDES.  Independent. No confluence gate, no confirmation from anything.
        │ when a signal fires ↓
SMC + MTF-5m status      →  EXPLAIN only. Shows the market's current phase alongside the signal.
                            Context is NEVER allowed to filter, confirm, or suppress the decision.
```

The indicator's signal is the sole decision. The 5m MTF status and SMC market structure are
**display context**, rendered in a visually secondary zone labeled "Context — not used to confirm
the signal."

## Data (all already present on the page)

- 5m signals ← `computeMaFvgSignals(candlesByTf['5m'] closed)` (new shared fn — see Task 1).
- 5m MTF status ← `intel.full.layers.hierarchy.perTimeframe['5m']` (bias, regime, confidence).
- SMC structure ← `smcByTf['5m'].state` (swingTrend, zone) + latest structural event; 5m screener phase.

## Freshness & timestamp (user-specified)

Always show the **latest** signal with BOTH its exact generation timestamp (date & time) AND its age
in bars, plus a freshness tier so the trader instantly knows if it's still actionable. On 5m,
1 bar = 5 min. Freshness from `barsAgo = lastClosedBarIndex − signalBarIndex`:

| Tier | Bars ago | Minutes | Dot | Example display |
|------|----------|---------|-----|-----------------|
| **Active** | 0–5 | 0–25 | 🟢 | `Generated: 21 Jul 2026, 10:35 AM • 2 bars ago` |
| **Aging** | 6–20 | 30–100 | 🟡 | `Generated: 21 Jul 2026, 09:40 AM • 12 bars ago` |
| **Stale** | >20 | >100 | ⚪ | `Generated: 21 Jul 2026, 07:15 AM • 42 bars ago` |

Thresholds are exported constants (`SIGNAL_FRESHNESS = { activeMaxBars: 5, agingMaxBars: 20 }`).
Timestamp = the signal bar's `time` (UNIX seconds → `new Date(t*1000)`), formatted in the user's
local timezone as `DD Mon YYYY, h:mm AM/PM`. No expiry, no active-until-invalidated — the tier
communicates actionability; the signal is always shown. Context reflects the current last-closed bar.

## Tasks (each releasable — TDD, tsc clean, suite green, atomic commit)

### 1. Shared signal function
`lib/indicators/maFvg/signals.ts` → `computeMaFvgSignals(candles, config?) → SignalEvent[]`.
Extract the source→rawRsi→wma-strength→price-scale→`emitCrossSignals` chain from the composite;
`computeMaFvg` refactored to call it. Parity test: the composite's `signals`/`markers` are
byte-identical before/after (the chart is unaffected). This is the single source of truth for a
MA-FVG signal, guaranteeing the card and the chart never diverge.

### 2. Card data hook
`components/mtf/useMaFvgSignal.ts` → `useMaFvgSignal(candlesByTf, full, smcByTf)`:
- Runs `computeMaFvgSignals` on **5m closed candles only**, memoized on the 5m closed-bar signature
  (never on ticks — indicator-tick-perf discipline).
- Returns `{ latest: { side, confidence, barTime, barsAgo, freshness, price } | null, recent: […up to 3],
  context: { mtf5m: {bias,regime,confidence} | null, smc: {swingTrend, zone, phase, lastEvent} | null } }`
  where `freshness ∈ {'active','aging','stale'}` from `SIGNAL_FRESHNESS`.
- Context is assembled read-only; it can never change `side`.

### 3. Renderer
`MaFvgSignalCard({ signal })` in `components/mtf/MarketIntelligence.tsx`, heading
**"Moving Averages & FVG"**:
- **Decision zone** (prominent): `BUY` / `SELL` / `No active signal`, direction-coloured, confidence %,
  "N bars ago"; a compact recent-signals row.
- **Context zone** (secondary, labeled "Context — not used to confirm the signal"): 5m MTF status chip
  (bias · regime · conf) + SMC phase/structure line. Rendered when a signal exists.
- Pure props, no logic.

### 4. Mount
`<MaFvgSignalCard signal={maSignal} />` into `app/custom-multi-timeframe/page.tsx` via the new hook,
near the top of the intelligence column.

### 5. Live-verify + docs/memory
Playwright on `/custom-multi-timeframe`: card renders, 5m signal + context coherent, 0 console
errors, screenshot. Constitution/memory note.

## Non-goals (v1)

Other timeframes (5m only), alerts wiring, ANY use of context to gate/confirm/suppress the signal
(forbidden by the architecture), touching M9 or the frozen intelligence stack.
