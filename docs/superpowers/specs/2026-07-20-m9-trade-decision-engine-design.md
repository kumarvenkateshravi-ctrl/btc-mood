# M9 — Trade Decision Engine (frozen design)

**Date:** 2026-07-20 · **Status:** FROZEN (user-approved) · **Milestone:** M9 of the canonical M0–M10 roadmap
**Depends on:** the permanently frozen Intelligence Platform v1.0 (M0–M7) + M8, consumed via
`FullMarketIntelligence` — never modified, never recomputed.

## Position in the stack

M0–M8 *describe* the market; M9 is the first layer that *proposes an action*. It is still not
execution (no orders, no account, no equity) and it never overrides or recomputes the layers
below — it **gates, translates, and prices** M8's conclusion. A passed trade is a *proposal
conditioned on the current closed-bar state*, never a prediction.

Scope decisions (user-selected during brainstorm):
1. **Full trade plan** — direction + go/no-go + entry zone, stop, targets, RR.
2. **Hybrid levels** — self-contained ATR + swing-structure core; optional `SmcSnapshot`
   parameter refines levels within bounded tolerances.
3. **Risk tier only** — no account math; tiers scale against consumer equity.
4. **One default execution model** — style presets (scalp/swing) become named config presets
   later, purely additive.
5. **Architecture A** — gated pipeline of small pure modules, M4/M8 house style.

## Entry points

```typescript
computeTradeDecision(
  intel: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: SmcSnapshot,
): TradeDecisionResult

computeFullTradeDecision(candlesByTf, smc?): { decision: TradeDecisionResult; intel: FullMarketIntelligence }
```

- `intel.result` supplies the verdicts; `intel.layers.hierarchy` supplies the trigger tier for
  execution-TF selection (same derivation as `deriveTradeContext`: highest-authority trigger →
  else lowest-weight entry → else controller).
- Candles are required because **M9 owns price levels** (M7/M8 explicitly excluded them).
  M9 slices closed bars itself (`length > 1 ? slice(0,-1) : identity`) — same closed-bar
  discipline as M8's entry point.
- `smc` optional: omitted ⇒ output is the pure core, **byte-for-byte** (identity invariant).

## Contract — `lib/mtf/decision/decisionTypes.ts`

```typescript
export type TradeAction = 'long' | 'short' | 'no_trade';
export type RiskTier    = 'full' | 'half' | 'quarter' | 'none';
export type EntryType   = 'market' | 'pullback';
export type LevelSource = 'atr' | 'swing' | 'smc_orderblock' | 'smc_fvg' | 'smc_liquidity';

export interface PriceLevel { price: number; source: LevelSource; description: string }

export interface ConfluenceNote {
  code: string;                       // e.g. ENTRY_SNAPPED_OB, STOP_EXTENDED_LIQUIDITY, TARGET_LIQUIDITY
  message: string;
  field: 'entry' | 'stop' | 'target';
  before: number;                     // core value prior to adjustment
  after: number;                      // refined value
}

export interface DecisionSignal { code: string; message: string; severity: 'info' | 'warning' | 'strong' }

export interface TradeSetup {
  entry: { zone: [number, number]; type: EntryType; basis: PriceLevel };  // zone = [low, high]
  stop: PriceLevel & { distancePct: number };
  targets: Array<PriceLevel & { rr: number }>;   // [structural, measured] or [measured] when no obstacle exists
  rr: number;                                    // to targets[0] — the honest headline number
  atr: number;                                   // audit: the ATR every level was built from
}

export interface TradeDecisionResult {
  schemaVersion: 1;
  action: TradeAction;
  gate: { passed: boolean; blockedBy: string | null; reason: string };   // named first-match rung
  direction: Verdict;                 // echoed from M8 headline.bias — NEVER recomputed
  executionTf: Timeframe;
  setup: TradeSetup | null;           // null ⟺ action === 'no_trade'
  riskTier: RiskTier;                 // 'none' ⟺ action === 'no_trade'
  confluence: ConfluenceNote[];       // empty without smc input
  calibration: 'prior' | 'empirical'; // propagated from M8, never hidden
  explanation: string[];
  signals: DecisionSignal[];
  warnings: DecisionSignal[];
  diagnostics: {
    schemaVersions: { market: number };
    atr: number | null;
    swingHigh: number | null;         // the confirmed swings the levels were built from
    swingLow: number | null;
    rawRR: number | null;             // RR before any rejection decision
    smcApplied: boolean;
  };
}
```

Every price carries a `LevelSource` + description — the levels equivalent of M4/M7's
audit-identity discipline. Structural invariants (tested): `setup === null ⟺ action === 'no_trade'
⟺ riskTier === 'none'`; `gate.passed === (action !== 'no_trade')`.

## Gate — first-match no-trade ladder (`gate.ts`)

M9 **defers to M8's environment gate**. Rungs, in order (first match wins; each rung has a
stable `blockedBy` code):

| # | Rung | `blockedBy` | Notes |
|---|------|-------------|-------|
| 1 | `readiness.state !== 'ready'` | `environment_<state>` | M8's reason passed through verbatim; M9 never second-guesses wait/no_trade/avoid |
| 2 | `headline.bias === 'neutral'` | `no_directional_edge` | belt-and-braces (readiness ladder makes this rare) |
| 3 | `risk.level === 'extreme'` | `extreme_risk` | |
| 4 | `outlook.invalidation.invalidated` | `lifecycle_invalidated` | |
| 5 | execution-TF candles missing/too short | `insufficient_data` | pre-pricing structural rung |
| 6 | missing the required **anchoring** swing (low for long, high for short) | `insufficient_structure` | the opposing swing is optional — without it the measured target leads (see Levels) |
| 7 | `rr < DECISION_CONFIG.minRR` | `rr_too_low` | fires when a structural obstacle sits too close to entry, or after SMC refinement lowers RR; `diagnostics.rawRR` records the rejected value |

Rungs 5–7 mean the gate is evaluated in two phases: environment rungs (1–4) before pricing,
structural/pricing rungs (5–7) after. A `no_trade` from rungs 5–7 still reports
`direction`/`executionTf` (context is real; only the setup is unavailable).

## Levels core — ATR + swing structure (`swings.ts`, `levels.ts`)

Closed bars of the execution TF only. **ATR:** `pm.rma(pm.tr(candles), atrLength)` from
`lib/pineMath` (same TradingView-faithful math as `lib/indicators/atr.ts`, without the
chart-plot wrapper); the *last* value is used, must be a positive finite number.

**Swings** (`swings.ts`): fractal detection — bar *i* is a swing high iff its high is strictly
greater than the highs of the `k` bars on each side (`k = DECISION_CONFIG.swingConfirmBars`);
mirror for lows. Only **confirmed** swings count (the last `k` bars can't confirm). The engine
uses the most recent confirmed swing low and swing high.

For a **long** (short mirrors exactly):
- **Entry zone**: anchored at the nearest supporting structure. Anchor = last confirmed swing
  low; zone = `[anchor, anchor + entryZoneAtrMult·ATR]`. If the last close is inside the zone
  → `type: 'market'`, else `type: 'pullback'` (a limit proposal at the zone).
- **Stop**: `swingLow − stopAtrMult·ATR` (beyond structure), `distancePct` from entry-zone
  midpoint.
- **Targets** *(amended during planning — the original substitution rule made gate rung 7
  unfireable, since the measured target has RR = `targetRR` ≥ `minRR` by construction)*:
  the most recent confirmed opposing swing high **beyond the entry zone** is the *structural
  obstacle*. If one exists, it is **always** target 1 and it gates the RR — a structural
  obstacle too close to entry is an honest no-trade (`rr_too_low`), never papered over by an
  imaginary measured target. Target 2 is then the measured move: entryMid `+ targetRR·risk`
  where risk = entryMid − stop. If **no** structural obstacle exists (e.g. price at highs),
  the measured move is the sole target (`source: 'atr'`, single-element array) and RR =
  `targetRR` by construction.
- **RR** = `(target1 − entryMid) / (entryMid − stop)`, rounded to 2 dp.

Degenerate protections: stop must be strictly below entry zone (long); non-positive risk ⇒
`insufficient_structure`; last close already at/beyond the stop (long: `close ≤ stop`) means
the supporting structure is broken ⇒ `insufficient_structure`. All arithmetic on plain
numbers; no timestamps.

## SMC confluence refiner — optional, bounded, additive (`smcConfluence.ts`)

Consumes `SmcSnapshot.objects` only. Eligible objects: `state ∈ {'active','tested'}` and
direction matching the trade side (supporting for entry/stop, opposing for targets).

- **Entry snap**: a supporting `orderBlock` or `fvg` whose band overlaps or lies within
  `smcSnapToleranceAtrMult·ATR` of the entry zone ⇒ entry zone becomes the object's
  `[bottom, top]` (long; mirror short), source `smc_orderblock`/`smc_fvg`,
  note `ENTRY_SNAPPED_*`. Nearest such object wins.
- **Stop extension**: a supporting `liquidityPool` strictly beyond the stop but within
  `stopExtendMaxAtrMult·ATR` of it ⇒ stop moves just past the pool
  (`pool ∓ stopBufferAtrMult·ATR`), note `STOP_EXTENDED_LIQUIDITY` + a stop-hunt warning.
- **Target upgrade**: an opposing `liquidityPool` between entry and current target 1 (and
  still yielding RR ≥ `minRR`) ⇒ becomes target 1, source `smc_liquidity`, note
  `TARGET_LIQUIDITY`.

**Invariants (tested):** refiner runs *after* the core and only adjusts within the config
tolerances; every adjustment emits a `ConfluenceNote` with `before`/`after`; RR is recomputed
after refinement and the RR gate re-checked; omitting `smc` reproduces the core result
byte-for-byte; an `smc` input with no eligible objects likewise changes nothing.
`diagnostics.smcApplied` is true iff `confluence.length > 0`.

## Risk tier — first-match ladder (`riskTier.ts`)

| Rung | Tier |
|------|------|
| gate failed | `none` |
| quality `excellent` ∧ risk ≤ `low` | `full` |
| quality ≥ `good` ∧ risk ≤ `medium` | `half` |
| otherwise (gate passed) | `quarter` |

Then the cap: if `calibration === 'prior'` and the ladder chose `full`, the tier is reduced to
`PRIOR_TIER_CAP` (`'half'`).

**Honesty coupling:** while M7 runs on model priors, no environment can justify `full` risk.
When the cap bites, an info signal `TIER_CAPPED_PRIOR` explains it. Consumers convert tiers to
size against their own equity; M9 stays account-agnostic.

## Config — `config.ts` (all exported, JSDoc'd "conservative default; tuned later; API stable")

```typescript
DECISION_CONFIG = {
  atrLength: 14,
  swingConfirmBars: 2,          // k bars each side to confirm a fractal swing
  entryZoneAtrMult: 0.25,
  stopAtrMult: 1.0,
  targetRR: 2.0,                // measured-move target
  minRR: 1.5,                   // gate rung 7
  smcSnapToleranceAtrMult: 0.5,
  stopExtendMaxAtrMult: 0.75,
  stopBufferAtrMult: 0.1,
  minCandles: 20,               // rung 5 floor (must cover atrLength + swing confirmation)
}
PRIOR_TIER_CAP: RiskTier = 'half'
```

## Explanation & honesty rules (`explanation.ts`)

Deterministic template sentences; **banned predictive vocabulary** test applies
(`likely/expected/will/probable/should/forecast/anticipat*/predict*`). Wording frames the setup
as a conditional proposal ("Setup proposed…", "invalid below/above <stop>"); the stop IS the
invalidation. `calibration` propagated into both the top-level field and a permanent
`DECISION_MODEL_PRIORS` info signal while `'prior'`.

## Testing

House TDD rules: hand-computed candle fixtures for swings/ATR/entry/stop/targets/RR (exact
values); gate-ladder tests via the M8 `testFixtures` factories + `computeMarketIntelligence`;
structural invariants (`setup ⟺ action ⟺ riskTier`, gate/action consistency); no-SMC and
no-eligible-SMC identity tests; refiner bound tests (object outside tolerance ⇒ untouched);
RR re-gate after refinement; banned-vocab; determinism (same inputs ⇒ deep-equal); closed-bar
slicing test on the convenience entry point.

## Files

`lib/mtf/decision/{decisionTypes, config, gate, swings, levels, smcConfluence, riskTier,
explanation, decisionEngine}.ts` (+ colocated `*.test.ts`) — M4/M8 house shape.

## Non-goals (v1)

Order execution/brokerage, account equity/leverage math, style presets (config constants only),
alerts, UI wiring (a later Phase 1c validates M9 live, mirroring Phase 1b), M10 goal-based
plans, empirical calibration (arrives via M7's priors swap point, zero M9 contract change).
