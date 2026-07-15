# Active-Trade Overlay — serving the trader while the position is open

**Date:** 2026-07-15
**Status:** Plan for review

## Where we are today

The live trade overlay already renders (all verified working):
- Entry line + pill (`BUY 0.1 @ 64,574.1`), draggable TP/SL lines with staged
  Discard/Confirm, per-line **projected P&L** badges, a live **unrealized P&L**
  pill (colour-coded), and Reverse / Close / TP-toggle / SL-toggle controls.

What a trader *actively watching an open position* still can't see or do:
- P&L in **R-multiples** and **ROE %** (the two numbers pros actually track);
  only raw USD is shown.
- **How the trade is really going**: max favorable / adverse excursion, time in
  trade, distance to TP/SL.
- **Risk management actions**: move stop to break-even, trail the stop, or
  **scale out** (partial close). Only all-or-nothing Close exists.
- **Liquidation price** for a leveraged position (safety-critical).

## The leverage: it's mostly already computed

This is why the plan is cheap. These pure functions/shapes exist and are
tested; they just aren't wired to the *live* position:
- `lib/paper.ts`: `projectedPnl`, `unrealizedPnl`, `marginFor`,
  `LIQUIDATION_MARGIN_RATIO`, and `VdExitOptions { beAfterTp1, trailAtr,
  contextExit }` (the engine can already break-even + trail).
- `lib/replay/sessionSim.ts`: R-based sizing, `sessionStats` (R, MFE/MAE,
  payoff), `TradeBehavior` (slMoves, maxFavorable, exit kind), `coachingNotes`.
- `components/replay/SessionHud.tsx`: a live balance/P&L/R HUD — the template
  for a live-position HUD.
- Risk Studio schema (`StrategyRisk`: breakEven, trailingAtr, positionRiskPct)
  — currently advisory; this plan makes it act on live trades.

## Design guardrails (from DESIGN.md)

- **Orthogonal channels (Market State Grammar F):** direction (bull/bear colour
  + label) must not also encode confidence or risk. P&L colour = direction of
  outcome only; risk/liquidation gets its own dedicated warn treatment.
- **No false precision:** round money to the instrument tick; R to 0.1; % to 0.1.
- **Risk always visible with reason + timestamp:** entry time, liq price, and
  current R are first-class, never buried.
- **Colourblind-safe:** never red/green alone — pair with sign, arrow, label.

---

## Phased plan

### Phase 1 — The metrics traders actually read (highest ROI, ~half day)
Surface what's already computed, on the entry-row pill + a compact readout:
- **R-multiple**: current P&L / initial risk (entry→SL distance × units). Show
  `+1.4R` next to the USD. If no SL is set, show `R —` and nudge to set one.
- **ROE %** (return on margin) and **P&L % of account** — the exchange-style
  numbers, toggleable A / $ / % like the price scale already has.
- **Risk:Reward** of the current setup: `1 : 2.7` from the TP/SL distances.
- **Distance to TP / SL**: in % and ticks, shown on the line badges.
- **Time in trade**: `held 24m` from the position's entry timestamp.
No engine work; pure derivation from the open position + mark price.

### Phase 2 — In-trade excursion + a live position HUD (~1 day)
- Track **MFE / MAE in R** on the live position as price moves (reuse the
  sessionSim behavior tracker on the live path, keyed off mark price).
- A **live Position HUD** docked above the bottom tabs (mirrors the replay
  SessionHud): entry · mark · P&L $/R/% · MFE/MAE · time · liq · qty. One glance
  answers "how is my trade doing" without reading the chart lines.
- "You're at +1.2R (peaked +1.8R)" — the single most motivating in-trade read.

### Phase 3 — Real risk-management actions (~1-1.5 days)
Wire the existing engine capabilities to one-tap controls on the overlay:
- **Break-even**: move SL to entry (one tap, and an optional auto-BE-after-+1R).
- **Trailing stop**: enable ATR-based trailing (`VdExitOptions.trailAtr` already
  exists in the engine); the SL line trails live.
- **Scale out / partial close**: close 25% / 50% / custom at market, leaving the
  rest running. Requires a partial-close path in `paperStore` (the engine's
  `applyFill` already supports size reduction; this exposes it).
- **Liquidation line**: draw the liq price for leveraged positions from
  `LIQUIDATION_MARGIN_RATIO`, with a dedicated danger treatment as price nears it.

### Phase 4 — Alerts + post-trade continuity (~half day, optional)
- **Position alerts**: notify at "approaching SL/TP" or a chosen % move (reuses
  the existing price-alerts store).
- On close, roll the trade into the existing **Trade History + coaching** so the
  live account gets the same review the replay session already produces.

---

## Recommendation

Do **Phase 1 first** — it is nearly free (all derivation, no engine changes) and
delivers the R / ROE / RR / time read that most separates a pro tool from a toy.
Then Phase 2 (the HUD + MFE/MAE) for the "how's my trade going" glance. Phases 3
and 4 are higher-effort but reuse the paper engine's existing break-even /
trailing / partial-fill support, so they're additive, not new machinery.

Explicit non-goals for v1: pyramiding/adding to a position (kept deliberately
simple, as in replay), and any server-side/real-exchange execution.
