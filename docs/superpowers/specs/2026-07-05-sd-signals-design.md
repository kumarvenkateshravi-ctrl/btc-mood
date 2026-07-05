# Supply/Demand Trade Signals — Design Spec

Date: 2026-07-05
Status: Draft for review
Branch (proposed): `feat/sd-signals`

## 1. Purpose

Turn the existing **Supply / Demand Zones** indicator into a **tradeable signal engine**
that emits discrete, non-repainting **Buy / Sell signals with entry, stop-loss and
targets**, plus a **backtested track record** so the signals are trustworthy enough to
eventually sell as a subscription.

This spec covers **Phase 1** (the signal engine, targets, chart rendering, backtest,
and Signals panel). The **subscription gate** is explicitly deferred to a later phase
(see §12) but the design keeps a clean seam for it.

## 2. Goals / Non-goals

**Goals**
- Deterministic, **non-repainting** signals computed only on closed bars.
- Each signal carries: side, entry, SL, TP1, TP2, R:R, confidence, tier, and lifecycle state.
- A **backtest** that reports win rate, avg R, expectancy, profit factor, max drawdown —
  sliced by zone tier and timeframe.
- Render as chart **markers + entry/SL/TP overlay lines**, and list in a **Signals panel**.
- Reuse the existing pure-engine + golden-master testing pattern.

**Non-goals (this phase)**
- Subscription / paywall / Stripe (later phase).
- Real-order execution (this is a paper/educational product).
- Push notifications (later; in-app toast/alert reuse only).
- Breakout/continuation archetype (Phase 2 — see §11).

## 3. What already exists (build-on inventory)

From `lib/indicators/sdZones.ts` and `zoneStrength.ts`:
- `summarizeZones(candles, cfg) → ZoneSummary[]` — per live zone: `zoneType`
  (supply/demand), `kind` (supply/demand/supplyTarget/demandTarget), `tf`, `upper`,
  `lower`, `mid`, `zoneStrength` (0–100), `tier` (weak/medium/strong), `factors`,
  `distanceToPrice` (%), `isMultiTimeframeConfluence`, `retestCount`, `formedAtIndex`,
  `formedTime`.
- `buildZones()` already builds **measured-move target bands** (`supplyTarget`,
  `demandTarget`) = prior period range × `targetFactor` (default 1.5×).
- Zones are **frozen at HTF period open** → inherently non-repainting.
- `computeSdZones()` already returns `IndicatorResult.signals: SignalSide[]`
  (currently all `'neutral'`) and supports `markers?: IndicatorMarker[]` — a ready hook.
- `IndicatorMarker` = `{ index, position, color, shape: arrowUp|arrowDown|circle|square, text? }`.

**Implication:** we do not need new rendering plumbing for arrows; we need a new pure
engine that produces signal events, and glue that fills `signals[]` + `markers[]`.

## 4. Architecture (pure, isolated units)

```
lib/indicators/
  signalEngine.ts        # PURE: generateSignals(candles, summaries, cfg) -> SignalEvent[]
  signalEngine.test.ts   # unit tests (armed/triggered/stopped/expired transitions)
  signalEngine.golden.test.ts + fixtures/  # locks determinism + non-repaint
  signalBacktest.ts      # PURE: backtestSignals(candles, events) -> BacktestReport
  signalBacktest.test.ts

lib/indicators/sdZones.ts
  computeSdSignals(...)   # NEW glue: summarizeZones -> generateSignals -> IndicatorResult
                          # (fills signals[] + markers[]; reuses zone plots as context)

components/... (Signals panel + chart overlay for the active signal)
lib/customIndicatorsLibrary.ts  # register a new 'sd_signals' indicator entry
```

Each unit has one job and a well-defined interface:
- `generateSignals` — decides *when* a signal fires and *what its levels are*. No IO.
- `backtestSignals` — decides *how each signal resolved*. No IO.
- `computeSdSignals` — adapts the above to the chart framework (`IndicatorResult`).
- UI — renders events; owns no signal logic.

## 5. Data model

```ts
type SignalState =
  | 'armed'        // price entered the zone; awaiting confirmation
  | 'triggered'    // confirmation bar closed; signal is live
  | 'hit_tp1'
  | 'hit_tp2'
  | 'stopped'
  | 'invalidated'  // zone broken before confirmation, or opposing signal
  | 'expired';     // no trigger within maxBarsToTrigger, or no TP/SL within maxBarsInTrade

interface SignalEvent {
  id: string;                 // stable: `${side}:${tf}:${kind}:${zoneFormedAtIndex}`
  side: 'buy' | 'sell';
  zoneTf: HtfPeriod;
  zoneKind: 'supply' | 'demand';
  zoneUpper: number; zoneLower: number;
  entry: number; sl: number; tp1: number; tp2: number;
  rr1: number;                // (tp1-entry)/(entry-sl), sell mirrored
  confidence: number;         // 0..100 (scalar score)
  explanation: SignalExplanation;  // structured 'why' behind the score — see below
  tier: 'medium' | 'strong';  // weak never emits a signal
  state: SignalState;
  armedIndex: number | null;
  triggeredIndex: number | null;
  resolvedIndex: number | null;
  armedTime: number | null;
  triggeredTime: number | null;
  resolvedTime: number | null;
}

/** One weighted piece of evidence behind the confidence score. */
interface SignalFactor {
  key: 'zoneStrength' | 'confluence' | 'riskReward' | 'freshness' | 'formationVolume';
  label: string;         // UI label, e.g. "Multi-TF confluence"
  input: number;         // normalized factor value, 0..1
  weight: number;        // weight applied (from config, §8)
  contribution: number;  // points added to confidence = weight × input × 100
}

/** Structured, renderable rationale — maps to DESIGN.md §E explainable-AI grammar. */
interface SignalExplanation {
  factors: SignalFactor[];   // ordered by contribution desc (§E3 evidence ordering)
  summary: string;           // one-line rationale, e.g. "Fresh strong D-zone, 4H/D confluence, 2.1R"
  counterSignals: string[];  // weakening evidence, e.g. ["retested 3×", "R:R near floor"]
}
```

All indices/times reference the **signal (chart) timeframe** bars, so the event is
fully reconstructable and testable.

## 6. Signal lifecycle (state machine — the non-repaint guarantee)

```
        price enters zone            confirmation bar closes
watching ───────────────► armed ─────────────────────────► triggered ──► active
                            │                                   │
      zone broken / opposing│                                   ├─ bar.high≥tp1 ► hit_tp1
      ─────────────────────►│invalidated                        ├─ (then) ≥tp2 ► hit_tp2
      no trigger in N bars ►│expired                            ├─ bar.low≤sl  ► stopped
                                                                └─ >M bars     ► expired
```

- Transitions are evaluated **only on closed bars**; a signal, once `triggered`, never
  changes its entry/SL/TP → **no repaint**.
- One live signal per `(side, zone)` — deduped by `id`. A new HTF period forms a new
  zone → a new eligible signal.

## 7. Entry / Stop / Target math

For a **BUY at a Demand zone** (SELL at Supply is the mirror; swap high/low, above/below):

- **Arm:** `bar.low ≤ zone.upper` (price has reached the zone) and zone `tier ≥ minTier`.
  This is a cheap, zone-only check — `entry`, R:R and confidence are **not** known yet
  (they depend on the confirmation close), so the full quality gate is applied at
  confirmation, below.
- **Confirm (default `rejection_close`):** a later bar `close > zone.upper`
  (price rejected the zone and closed back above it). Options:
  - `touch` (aggressive): fire on the arming bar close.
  - `rejection_close` (default): close back out of the zone.
  - `reversal_candle` (strict): bullish engulf / hammer within the zone, then close out.
- **Entry** = confirmation bar `close`.
- **Stop-loss** = `zone.lower − buffer`, where `buffer` is **fully configurable** via
  `slBufferMode` + `slBuffer` (§9): `atr` → `slBuffer × ATR(14)` (default, `slBuffer = 0.25`),
  `percent` → `(slBuffer / 100) × entry`, or `ticks` → `slBuffer × tickSize`. Nothing is
  hard-coded. A clean close beyond the SL invalidates the zone thesis.
- **TP1** = lower edge of the **nearest active opposing zone** above entry (nearest
  Supply `lower`). If none exists above, `TP1 = entry + minRR × risk`.
- **TP2** = the corresponding **measured-move target band** (`supplyTarget`/`demandTarget`)
  edge. If missing, `TP2 = entry + 2 × (TP1 − entry)`.
- **risk** = `entry − sl`; **rr1** = `(tp1 − entry) / risk`.
- **Quality gate (at confirmation, when `entry` is known):** emit only if
  `tier ≥ minTier` AND `confidence ≥ confidenceFloor` AND `rr1 ≥ minRR`
  (default `minRR = 1.5`). Otherwise the armed setup is discarded (never shown) —
  it transitions straight to `invalidated`.

## 8. Confidence score (0–100)

Reuses `ZoneSummary.factors` so the score is explainable in the UI:

```
confidence = 100 × Σ wᵢ·factorᵢ, over:
  zoneStrength (normalized 0..1)      w=0.35
  multiTfConfluence (0/1)             w=0.20
  rrNormalized (clamp rr1/3, 0..1)    w=0.20
  freshness (from factors)            w=0.15
  formationVolume (from factors)      w=0.10
```
Weights are config-exposed. `confidenceFloor` default = 55. Banded for UI:
`≥80 High · 65–79 Medium · 55–64 Low` (below floor → not emitted).

**Structured output (not just the scalar):** `generateSignals` returns, on every event,
a `SignalExplanation` (§5) alongside `confidence`:
- `factors[]` — each contributing factor with its normalized `input`, `weight`, and
  point `contribution`, **sorted high→low** so the UI can list the strongest evidence first.
- `summary` — a one-line human rationale generated from the top factors.
- `counterSignals[]` — weakening evidence that did *not* block the signal but should be
  disclosed (e.g. high `retestCount`, `rr1` within 10% of `minRR`, stale zone).

This makes the score auditable and feeds the DESIGN.md §E explainable-AI card directly —
the confidence number is never shown without its reasons.

## 9. Configuration (indicator inputs)

Added to the `sd_signals` indicator config (via `resolveInputs`, matching `sdZones`):

| Input | Default | Meaning |
|---|---|---|
| `confirmation` | `rejection_close` | touch \| rejection_close \| reversal_candle |
| `minTier` | `medium` | medium \| strong |
| `confidenceFloor` | `55` | discard signals below |
| `minRR` | `1.5` | discard signals below TP1 R:R |
| `slBufferMode` | `atr` | `atr` \| `percent` \| `ticks` — how the SL buffer is measured |
| `slBuffer` | `0.25` | SL buffer magnitude, in the chosen mode's units |
| `maxBarsToTrigger` | `20` | armed→expired if no confirm |
| `maxBarsInTrade` | `150` | triggered→expired if unresolved |
| `w*` (confidence weights) | see §8 | tuning without code change |

Zone inputs (`tfs`, `targetFactor`, zone-strength weights) are inherited from the
existing S/D config.

## 10. Backtest & track record (the trust layer)

`backtestSignals(candles, events) → BacktestReport`:
- Replays each `triggered` event forward; resolves outcome via **first-touch,
  intrabar worst-case** ordering (if a bar spans both SL and TP1, count SL first —
  conservative), TP1 then TP2.
- Report metrics: `trades`, `winRate`, `avgR`, `expectancy` (R/trade), `profitFactor`,
  `maxDrawdownR`, `avgBarsInTrade`; plus breakdowns **by tier** and **by zoneTf**.
- Deterministic → covered by a **golden-master** fixture like `sdZones.golden.test.ts`.
- Surfaced later (Phase 2) as a public "Track record" view; Phase 1 exposes the report
  object + a dev/debug panel.

## 11. Rendering & UX (Phase 1)

- **Chart markers:** `arrowUp`/`arrowDown` at the `triggered` bar, colored by side,
  `text` = `"BUY D ★82 · R2.1"` (compact). Fills `IndicatorResult.markers[]`.
- **Per-bar `signals[]`:** `'buy'`/`'sell'` on the trigger bar, else `'neutral'`
  (drives any existing signal-status consumers).
- **Active-signal overlay:** entry / SL / TP1 / TP2 horizontal lines for the most
  recent live signal, reusing the order-overlay visual style (solid entry, dashed
  SL/TP, labels). Reuses `IndicatorLevel[]` (or the existing overlay primitive).
- **Signals panel (new component):** table of recent signals — time, side, tf, entry,
  SL, TP1/TP2, R:R, confidence band, state — sorted newest first. Row → focus the
  chart; **expanding a row reveals the `SignalExplanation`** (factor contribution bars +
  `summary` + `counterSignals`). All numbers via `Num.*` (B5-FREEZE), panel via
  `Panel` (C-FREEZE).
- **Disclaimer:** persistent "paper & educational — not financial advice" line
  wherever signals/track-record are shown.

## 12. Subscription gate (deferred — seam only)

Not built this phase. The seam: `generateSignals` and `backtestSignals` are pure and
already return everything a gate needs. When added, gating happens at the **UI/data
boundary** (e.g. filter emitted events by tier/recency for free users, unlock the
track-record view for paid) — no engine change required. Ties into the deferred
auth+Stripe plan.

## 13. Testing strategy

- `signalEngine.test.ts` — unit tests for each transition: arm on zone touch, confirm
  on rejection close, invalidate on zone break, expire on timeout, R:R gate, tier gate,
  buy/sell mirror symmetry.
- `signalEngine.golden.test.ts` — fixed candle fixture → frozen `SignalEvent[]`
  (locks determinism + **non-repaint**: re-running over a prefix never changes a past
  triggered signal's levels).
- `signalBacktest.test.ts` + golden — metrics on a known fixture; intrabar worst-case
  ordering verified.
- `tsc` + `eslint` clean; full suite green.

## 14. Risks / mitigations

- **Repaint via HTF lookahead** → zones are frozen at period open and confirmation uses
  closed bars only; golden test enforces.
- **Overfitting the quality gate** → keep gates as config, report backtest by tier/TF so
  tuning is evidence-based, not guessed.
- **Look-ahead in TP1 "nearest opposing zone"** → only use zones with
  `formedAtIndex ≤ triggeredIndex`.
- **Over-promising performance** (paid product) → conservative first-touch backtest +
  explicit not-financial-advice disclaimer.

## 15. Phasing

- **Phase 1 (this spec):** `signalEngine`, targets, `computeSdSignals` glue + markers +
  per-bar signals, active-signal overlay, `signalBacktest`, Signals panel, tests.
- **Phase 2 (later):** breakout/continuation archetype, alerts, subscription gate +
  public track-record page.

## 16. Locked decisions (approved 2026-07-05)

1. **Archetype:** **Reversal-only** for Phase 1. Breakout/continuation is Phase 2.
2. **Signal timeframe:** signals are generated on the **current chart timeframe**
   (the confirmation bar is a chart-TF bar; zones still come from the configured HTFs).
3. **Target model:** **TP1 = nearest opposing zone, TP2 = measured-move target band**
   (as specified in §7). Fixed-R is not used in Phase 1.
4. **Indicator packaging:** **`sd_signals` is a separate indicator** from `sd_zones`,
   toggled independently in the indicator library.
