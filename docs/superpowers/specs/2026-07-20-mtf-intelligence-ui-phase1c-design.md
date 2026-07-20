# MTF Intelligence UI — Phase 1c: M9 Trade Decision wiring (frozen design)

**Date:** 2026-07-20 · **Status:** FROZEN (user-directed via MTFM91c.md) · **Surface:** `/custom-multi-timeframe`

## Purpose

Make M9's decision visible on the sanctioned experimentation surface so the user can **practice
with it for several days** before fine-tuning M9 or starting M10 (reviewer + user directive:
"trade with it → replay it → refine if necessary → freeze M9"). This phase delivers the wiring
and a one-session live validation; the multi-day items in MTFM91c.md (different regimes, bar
replay, bullish AND bearish setups, all gate rejection reasons observed in the wild) are the
**user's practice protocol**, not automatable in one session.

The one genuinely new requirement from MTFM91c.md beyond the Phase-1b pattern: an **SMC on/off
toggle** so ATR-only vs ATR+SMC decisions can be compared live.

## Design

1. **Additive M9 export** (no logic change): `executionTimeframeOf(hierarchy)` becomes exported
   from `lib/mtf/decision/decisionEngine.ts` so the hook can select the execution TF's
   `SmcSnapshot` before calling the engine.
2. **Hook** `components/mtf/useTradeDecision.ts`:
   `useTradeDecision(full, candlesByTf, smcByTf, smcEnabled): TradeDecisionResult` — reuses the
   page's already-computed `FullMarketIntelligence` (never re-runs the stack) and the page's
   closed-bar-cached `smcByTf`; passes `smcEnabled ? smcByTf[executionTf] : undefined`.
   Memoized on the closed-bar signature + `smcEnabled` (indicator-tick-perf discipline —
   never recomputes on ticks).
3. **Renderer** `TradeDecisionPanel` in `components/mtf/MarketIntelligence.tsx` (dumb, props
   `{ decision, smcEnabled, onToggleSmc }`): action headline (LONG/SHORT/NO TRADE), direction +
   execution-TF + risk-tier chips, "model priors" chip while `calibration === 'prior'`;
   blocked → gate reason + `blockedBy` code; setup → entry zone (type), stop (+distancePct,
   source), targets (+RR, sources), headline RR, ATR; confluence notes + warnings; explanation
   lines; SMC toggle button labeled "SMC confluence: on/off". Default **ON**.
4. **Mount** directly below `MarketIntelligenceVerdict` (the decision is the actionable
   continuation of the verdict). Page owns `smcOn` state.

## Validation (one session, live Playwright)

Panel renders real BTCUSDT data; 0 console errors; decision coherent with the M8 verdict
(readiness ≠ ready ⇒ NO TRADE with `environment_*`; ready ⇒ setup with levels near current
price and Σ invariants: stop beyond entry zone, targets beyond entry, RR ≥ 1.5); SMC toggle
flips without errors and changes only bounded fields (or nothing when no eligible objects);
screenshot captured.

## Deferred (explicitly out of scope)

Bar-replay integration for M9, alerts, other pages, any M9 logic changes (fine-tuning waits for
practice feedback), M10.

## Tasks

1. Hook + additive export (+ tests).
2. `TradeDecisionPanel` renderer (+ render tests).
3. Mount + live validation + docs/memory.
