# VD Zones — Trader Execution Layer (Plan)

> Status: DRAFT — awaiting review. Scope: volume_distribution_zones only.
> Goal: exact entry/exit on every signal + tracked outcomes, so traders can act on it.

## Phase 1 — Entry/SL/TP on EVERY signal + Trade Lifecycle

**Engine (`vdEngine.ts`):** new `walkVdTrades(candles, signals, cfg) → VdTrade[]` —
closed-bar walker per accepted signal:

```ts
interface VdTrade {
  signal: VdSignal;                    // entry, sl, tp1-3 already exact
  status: 'active' | 'tp1' | 'tp2' | 'tp3' | 'stopped' | 'exit';
  slCurrent: number;                   // steps to BE / trails (Phase 3)
  entryIndex: number; resolvedIndex: number | null;
  exitPrice: number | null;
  barsHeld: number;
  mfeR: number; maeR: number;          // max favorable/adverse excursion in R
  realizedR: number | null;            // +R at TP levels hit, −1 at stop
}
```
Rules (closed bars, SL-first conservative, same as the sd engine): SL touch → stopped;
TP1/2/3 touched in order; TP3 or stop resolves; MFE/MAE updated per bar.

**Rendering:** constant plot signature — per-bar stepped series covering each trade's
held window (null outside): `Trade Entry` (teal), `Trade SL` (red, follows slCurrent),
`Trade TP1/2/3` (green dashed) line plots + `Trade Reward`/`Trade Risk` band plots
(R:R shading, item 9 — reuses the sd_signals soft-fill technique). Every historical
arrow now shows its full setup at its own bars. Toggle: `showTradeSetups` (on).

Tests: hand-crafted lifecycle fixtures (tp1→tp2→stop ordering, SL-first same-bar,
MFE/MAE exact, barsHeld); golden regen.

## Phase 2 — Trade Table + Performance Stats + Click-to-Focus

- Indicator publishes `VdTrade[]` via contextStore (same pattern as decisions).
- **`VdTradesPanel`** — new "Trades" tab in DashboardAside: one row per trade —
  time · side · grade · **entry · SL · TP1/2/3** · R:R · context score · status
  (Active / TP1 ✓ / Stopped / Exit) · realized R. Numbers via `Num.*`.
- **Stats header** from outcomes: trades, win rate, avg R, profit factor, plus
  per-grade rollup (A+ / A / B win rates) — the trust line (item 7 + 8 seed).
- **Click a row → focus that trade** (item 10): selection id in the store; the
  indicator renders the selected trade's full lines + brighter R:R box. (Canvas
  arrow-click = stretch goal, needs marker hit-testing.)

Tests: panel render (react-dom/server), stats math exact, selection round-trip.

## Phase 3 — Dynamic Exits

1. **Break-even after TP1:** `slCurrent = entry` from the TP1 bar (walker + rendered
   SL line steps up).
2. **Trailing after TP2:** `slCurrent` trails the high-watermark close ∓ `trailAtr ×
   ATR14` (config, default 1.0).
3. **Context exit (deterministic):** full per-bar MTF context history is too costly to
   recompute honestly, so the exit rule uses a chart-TF proxy computable per closed
   bar: EMA9/21 cross against the trade AND close beyond Supertrend → `exit` at that
   bar's close, labeled "context flip". (True per-bar MTF snapshots → Phase 4.)

Config: `beAfterTp1` (on), `trailAtr` (1.0), `contextExit` (on). Tests per rule.

## Phase 4 — Analytics & Optimization (outline)

Per-bar context snapshots recorded forward (ring buffer) → true MTF context exits +
**performance by grade / context-score bucket / timeframe** in the Stats tab; feeds
weight tuning (the config-driven engine makes tuning code-free). Separate plan when
Phases 1–3 are verified.

## Order & effort
P1 (engine walker + rendering) → P2 (table/stats/click) → P3 (exits) — each one
commit, targeted tests while iterating, full suite before commit, user verifies
visually (no Playwright). P4 planned separately.
