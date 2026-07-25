# MTF Board — Arch v2 (5m-only proof)

Source: `C:\Users\ravic\Downloads\MTF-5mins.md` (user-provided architecture note, 2026-07-25).

## Problem

M9's `direction` was echoed from M8's `headline.bias`, which is itself M5's
`hierarchy.htfBias` — a weighted vote whose `controller` TF can still dominate
via authority fallback even when weak. Diagnosed 2026-07-21 (`scripts/m9-diagnose.ts`):
a 1D controller at 47% confidence vetoed 5 of 6 bullish timeframes through a
phantom bias-flip + lifecycle label conflicts. M5's control-transfer safety
valve did not prevent this because M9's environment gate deferred to M8's
readiness/bias verbatim, with no floor on how much a single weak layer could
suppress an otherwise-aligned stack.

## Decision (Arch v2, 5m-only proof phase)

1. **Board** (new, `lib/mtf/board/`) is the SOLE source of `direction`
   (`long`/`short`/`no_trade`), `conviction`, `trendStrength`, `marketStructure`,
   and `executionTimeframe` (fixed `'5m'` this phase).
2. Board is built from the **existing, independent** `lib/alignment.ts` +
   `lib/multiTimeframe.ts` pipeline (`computeAlignmentMatrix`, `computeConsensus`,
   `computeWeightedScore`, `detectStructure`) — already running on the Custom MTF
   page, never wired into `lib/mtf/`. This keeps the Board structurally incapable
   of consuming M1–M4 (no circularity with "M0–M4 justify the Board").
3. M0–M4 continue running unchanged, purely to explain the Board's call
   (which indicators/categories support or disagree).
4. M5–M8 continue running unchanged, but their ONLY path into M9 is
   `riskTierOf` — they may downgrade (never upgrade) the risk tier. They can no
   longer force `action = 'no_trade'`.
5. M9 receives `BoardDecision` + candles + optional SMC; direction/executionTf
   are echoed verbatim from the Board, never recomputed. M9's structural gates
   (`insufficient_data`, `insufficient_structure`, `rr_too_low`) are unchanged —
   those are execution-feasibility checks, not opinions, and stay hard blocks.

## Board formulas

- `agreementPct = round(max(bull, bear) / total * 100)` over `Consensus` — % of
  scored timeframes agreeing with the dominant side.
- `conviction = round(agreementPct * (1 - BOARD_CONFIG.dissentPenaltyWeight * dissentExtremity))`,
  where `dissentExtremity` is the average `|score-50|/50` (0=near-neutral, 1=maximally
  extreme) of only the timeframes whose verdict OPPOSES the dominant bias — a mild
  dissenter (near-neutral score) barely reduces conviction; an extreme dissenter reduces
  it up to `dissentPenaltyWeight` (0.3). Deliberately NOT weighted by TF authority/position
  — that per-TF-importance weighting is exactly the mechanism that caused the original
  controller-veto bug, so dissent intensity is measured on raw score extremity only.
  Below `BOARD_CONFIG.minConviction` (55), direction collapses to `no_trade` regardless.
- `warnings: BoardSignal[]` — `BOARD_STRONG_DISSENT` fires when `dissentExtremity >=
  BOARD_CONFIG.strongDissentThreshold` (0.5), naming the conviction reduction. Empty
  otherwise. Mirrors the `{code,message,severity}` shape used by every other `lib/mtf/`
  layer (`AgreementResult`, `ConfidenceResult`, `MarketIntelligenceResult`,
  `TradeDecisionResult`) — added so `BoardDecision` isn't the one layer inconsistent
  with its neighbors, and so future UI explanations don't need a contract change.
- `trendStrength.score = round(min(1, |weighted.overall - 50| / 50) * 100)`,
  bucketed weak(<30)/moderate(<60)/strong(>=60).
- `marketStructure = detectStructure(candlesByTf['5m'])` — reused verbatim,
  unmodified (HH/HL/LH/LL structure, already exists, already TF-agnostic).
- `bias = weighted.outlook`; `direction = bias==='neutral' ? 'no_trade' : conviction < minConviction ? 'no_trade' : bias==='bullish'?'long':'short'`.

## Review feedback incorporated (second pass, 2026-07-25)

A review of this design (`MTF-51mins.md`) raised 5 points. Adopted: (1) conviction
should weight dissent intensity, not just vote count — implemented above; (2) reserve
`warnings[]` on the contract now, matching every other `lib/mtf/` layer — implemented
above. Declined: an extra "Board Inputs" abstraction layer between `lib/alignment.ts`
and the Board — `computeBoardDecision` already takes typed data contracts
(`AlignmentMatrix`/`Consensus`/`WeightedScore`), the same arm's-length pattern M3 uses
(`Voter[]`) and M8 uses (five frozen result objects); a further indirection is premature
for a "prove it on 5m first" phase with no second implementation to abstract over.
Not actionable: "trend strength is simplistic" (already a tunable v1 constant, no
concrete fix proposed) and "keep execution separate from structure" (already true —
confirmed, not a change request).

## Non-goals (this phase)

- Generalizing `executionTimeframe` beyond `'5m'`.
- Touching M1–M8 internal logic (only M9's consumption of M5–M8 changes).
- SMC as a Board input (spec Phase 4 explicitly scopes SMC to M9 only).

## Follow-up fix: M6-M8 must be fed 5m candles only (2026-07-25, post-implementation)

Live-verified defect found right after shipping the plan: the Board correctly evaluates
all 6 timeframes for direction, but M6/M7/M8 (`computeFullMarketIntelligence`) were still
being fed the FULL `candlesByTf`, so M5's own `controller`-selection (unchanged, frozen
logic) could float to any TF by authority — e.g. `15M controls` shown in the "Market
Intelligence Verdict" panel next to a 5m Board/M9 decision. The advisory layer was
describing a different timeframe than the one being traded, which is confusing and not
what "explain/advise the Board's 5m call" was supposed to mean.

Fix (input-shaping only, no M1-M8 engine code touched — consistent with the Non-goals
above): `computeFullMarketIntelligence` is now called with `{ '5m': candlesByTf['5m'] }`
wherever its result feeds M9 or the on-screen M8/M6/M7 panels
(`decisionEngine.ts`'s `computeFullTradeDecision`, `useMarketIntelligence.ts`'s `full`).
This forces M5's controller to trivially be `'5m'` (the only TF present), cascading
correctly through M6's lifecycle and M7's probability. The Board's OWN direction
computation is untouched — it still consumes the full 6-TF `candlesByTf`, since
cross-sectional alignment is its entire purpose.

The ORIGINAL full 6-TF cross-sectional hierarchy is kept alive as `useMarketIntelligence`'s
new `crossTf` field, used only by the "Timeframe Hierarchy" panel (where a genuine
multi-TF view — controller transfer, per-TF regime table — is the point, not a defect)
and by `TradeContextCard`'s `deriveTradeContext`. Consequence accepted for this 5m-only
phase: M8's risk/quality no longer surface a brewing reversal on a HIGHER timeframe (e.g.
"1D shows reversal risk") since it now only ever looks at 5m — an acceptable simplification
matching "prove it on 5m first," to be revisited once execution generalizes beyond 5m.
