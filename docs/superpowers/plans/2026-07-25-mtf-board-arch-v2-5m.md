# MTF Board — Arch v2 (5m-only proof) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a new, independent **Board** engine the sole source of trade direction (LONG/SHORT/NO_TRADE), demote the existing M0–M8 intelligence stack to "explain + advise only" (M5–M8 may cap M9's risk tier but can never flip direction or force no-trade), and prove this end-to-end on the **5m execution timeframe only**, per `C:\Users\ravic\Downloads\MTF-5mins.md`.

**Architecture:**
```
CUSTOM MTF BOARD  (NEW — lib/mtf/board/)
        │  direction / conviction / trendStrength / marketStructure / executionTimeframe='5m'
        ▼
M0–M4   (unchanged — justify only, never consulted for direction)
        ▼
M5–M8   (unchanged core logic — now consumed ONLY to cap M9's riskTier, never to gate action)
        ▼
M9      (Trade Decision — direction/executionTf now echoed from Board, not from M5's hierarchy.htfBias)
```
The Board is built from the **existing, independent alignment pipeline** (`lib/alignment.ts` + `lib/multiTimeframe.ts`'s `computeConsensus`/`computeWeightedScore`/`detectStructure`) that already runs on the Custom MTF page today and has never fed into `lib/mtf/` — this is what makes M0–M4 genuinely "justify, not decide" (they can't be circular, since they're structurally incapable of feeding the Board). This was confirmed with the user (2026-07-25): Board source = existing alignment grid; trendStrength/marketStructure = alignment score + `detectStructure`, not SMC (the spec's own Phase 4 pseudocode scopes SMC to M9 only, not the Board).

**Tech Stack:** TypeScript, Vitest, Next.js/React (client components), existing `lib/mtf/` conventions (co-located `.test.ts`, directory-scoped `testFixtures.ts`, `Panel`/`Stat`/`vColor` UI primitives from `components/mtf/MarketIntelligence.tsx`).

## Global Constraints

- Execution timeframe is **hardcoded to `'5m'`** everywhere in this phase (`BoardDecision.executionTimeframe`). Do not attempt to generalize to other TFs — that is explicitly a later phase per the spec ("Once it works reliably, extend it to 15m, 30m, 1H, etc.").
- M5–M8 (`hierarchy`, `lifecycle`, `probability`, `quality`, `opportunity`, `risk`, `readiness`) **must never appear in a direction/action decision** after this plan — only in `riskTierOf` (tier capping) and in `explanation`/UI display. If you find yourself branching on `market.headline.bias`, `market.readiness.state`, or `hierarchy.htfBias` to decide `action`/`direction`, stop — that's the bug this plan removes.
- Every `lib/mtf/**` module keeps the existing pattern: pure functions, co-located `*.test.ts`, no React/UI imports, `schemaVersion: 1` on new result contracts.
- Do not touch `lib/mtf/timeframe/`, `lib/mtf/market/`, `lib/mtf/lifecycle/`, `lib/mtf/probability/`, `lib/mtf/agreement/`, `lib/mtf/confidence/`, `lib/mtf/categoryEngine.ts`, or any M1–M8 indicator/category module — those stay byte-identical (M0–M7 constitution freeze still applies; only M9's *consumption* of them changes, not their own logic).
- `npx tsc --noEmit` and the full `npm test` (or `npx vitest run`) suite must stay green after every task. Commit after every task.

---

## File Structure

**New:**
- `lib/mtf/board/boardTypes.ts` — `BoardDecision`, `BoardDirection`, `BoardTrendStrength`, `BoardContributor`, `BoardSignal` contracts
- `lib/mtf/board/config.ts` — `BOARD_CONFIG` (conviction floor, trend-strength buckets)
- `lib/mtf/board/config.test.ts`
- `lib/mtf/board/boardEngine.ts` — `computeBoardDecision(matrix, consensus, weighted, candlesByTf)`
- `lib/mtf/board/boardEngine.test.ts`
- `docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md` — frozen design spec (this plan's source of truth for future readers, matching every prior M-phase's convention)

**Modified:**
- `lib/mtf/decision/decisionTypes.ts` — `TradeAction` becomes an alias of `BoardDirection`; `direction` doc comment
- `lib/mtf/decision/gate.ts` — `environmentGate` → `boardGate` (anchored on `BoardDecision`, not `MarketIntelligenceResult`)
- `lib/mtf/decision/gate.test.ts` — rewritten for `boardGate`
- `lib/mtf/decision/riskTier.ts` — advisory caps for `extreme_risk` / `lifecycle_invalidated` added alongside the existing `prior` cap
- `lib/mtf/decision/riskTier.test.ts` — updated + 2 new cases
- `lib/mtf/decision/decisionEngine.ts` — `computeTradeDecision`/`computeFullTradeDecision` take a `BoardDecision`; `executionTimeframeOf` deleted (dead code — Board now owns execution TF selection)
- `lib/mtf/decision/decisionEngine.test.ts` — rewritten
- `lib/mtf/decision/testFixtures.ts` — add `mkBoard`
- `components/mtf/useTradeDecision.ts` — takes `board: BoardDecision` param instead of calling `executionTimeframeOf`
- `components/mtf/useTradeDecision.test.ts` — updated (if it exists; verify in Task 7)
- `components/mtf/MarketIntelligence.tsx` — new `BoardDecisionCard` renderer; `MTFIntelligenceBoard` panel copy updated to read "advisor only"
- `app/custom-multi-timeframe/page.tsx` — compute `board` from the page's already-computed `matrix`/`consensus`/`weighted`; pass to `useTradeDecision` and mount `BoardDecisionCard`
- `scripts/m9-diagnose.ts` — print the Board section before the M9 trace
- `docs/architecture/market-intelligence-pipeline.md` — M9 section invariants/deps updated, new Board summary, spec link added
- `docs/architecture/mtf-engine.md` — one-line consumer-count correction

---

### Task 1: Frozen design spec doc

**Files:**
- Create: `docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md`

This project freezes a short design spec before every M-phase (see the M9/M8/M7... spec docs already in that directory). This task just records the decision so future readers don't have to reconstruct it from chat history.

- [ ] **Step 1: Write the spec doc**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md
git commit -m "docs(mtf): Arch v2 5m-only Board — frozen design spec"
```

---

### Task 2: Board contract + config

**Files:**
- Create: `lib/mtf/board/boardTypes.ts`
- Create: `lib/mtf/board/config.ts`
- Test: `lib/mtf/board/config.test.ts`

**Interfaces:**
- Produces: `BoardDirection`, `BoardTrendStrength`, `BoardContributor`, `BoardDecision`, `BOARD_CONFIG` — consumed by Task 3 (`boardEngine.ts`) and Task 6 (`decisionTypes.ts`, which aliases `TradeAction = BoardDirection`).

- [ ] **Step 1: Write `boardTypes.ts`**

```typescript
// M-Board (Arch v2) — the SOLE source of trade direction in the platform.
// M0-M4 justify it (never decide); M5-M8 advise it (may only cap M9's risk
// tier, never flip direction). Built from the existing, independent
// lib/alignment.ts + lib/multiTimeframe.ts pipeline — structurally incapable
// of consuming M1-M4, which is what keeps "M0-M4 justify the Board" non-circular.
// Spec: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { MarketStructure } from '../../multiTimeframe';

export type BoardDirection = 'long' | 'short' | 'no_trade';

export interface BoardTrendStrength {
  /** 0-100, rescaled distance of the TF-weighted score from neutral (50). */
  score: number;
  label: 'weak' | 'moderate' | 'strong';
}

export interface BoardContributor {
  timeframe: Timeframe;
  /** Per-TF majority verdict (lib/alignment.ts computeTfCells). */
  verdict: Verdict;
  /** Per-TF 0-100 composite score. */
  score: number;
  /** TF_WEIGHT contribution to the weighted overall score. */
  weight: number;
}

/** Same {code,message,severity} shape as every other lib/mtf/ layer's signals
 *  (AgreementResult, ConfidenceResult, MarketIntelligenceResult, TradeDecisionResult)
 *  — kept consistent so BoardDecision isn't the one layer without it. */
export interface BoardSignal {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'strong';
}

export interface BoardDecision {
  schemaVersion: 1;
  /** long/short/no_trade — echoed verbatim by M9, never recomputed downstream. */
  direction: BoardDirection;
  bias: Verdict;
  /** 0-100: agreement % discounted by dissent intensity (see boardEngine.ts). */
  conviction: number;
  trendStrength: BoardTrendStrength;
  marketStructure: MarketStructure;
  /** Fixed '5m' in this phase. */
  executionTimeframe: Timeframe;
  contributors: BoardContributor[];
  /** Empty when nothing to flag. BOARD_STRONG_DISSENT populated by boardEngine.ts. */
  warnings: BoardSignal[];
}
```

- [ ] **Step 2: Write `config.ts`**

```typescript
// M-Board — configuration. Single source for every threshold; no magic numbers
// in boardEngine.ts logic.

export const BOARD_CONFIG = {
  /** Below this cross-TF agreement %, direction collapses to 'no_trade' even
   *  with a clear bias — the floor the old controller-veto bug lacked. */
  minConviction: 55,
  /** trendStrength.score buckets. */
  strengthBuckets: { strong: 60, moderate: 30 },
  /** How much conviction is reduced when the dissenting minority's average
   *  score sits at the extreme opposite pole (0=no penalty at any extremity,
   *  1=agreementPct fully wiped out at max extremity). Applied to raw score
   *  extremity only — deliberately NOT weighted by TF authority/position,
   *  since that per-TF-importance weighting is exactly what caused the
   *  original controller-veto bug. */
  dissentPenaltyWeight: 0.3,
  /** Minimum dissent extremity (0-1) that emits a BOARD_STRONG_DISSENT warning. */
  strongDissentThreshold: 0.5,
} as const;
```

- [ ] **Step 3: Write the failing test `config.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { BOARD_CONFIG } from './config';

describe('M-Board config', () => {
  it('freezes the v1 defaults exactly', () => {
    expect(BOARD_CONFIG).toEqual({
      minConviction: 55,
      strengthBuckets: { strong: 60, moderate: 30 },
      dissentPenaltyWeight: 0.3,
      strongDissentThreshold: 0.5,
    });
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/mtf/board/config.test.ts`
Expected: PASS (this is a value-freeze test, not TDD-red-first — the constants already exist from Step 2).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (only the pre-existing unrelated `DataTable.tsx` errors, per project convention).

- [ ] **Step 6: Commit**

```bash
git add lib/mtf/board/boardTypes.ts lib/mtf/board/config.ts lib/mtf/board/config.test.ts
git commit -m "feat(mtf): Board contract + config (Arch v2, no logic yet)"
```

---

### Task 3: Board engine

**Files:**
- Create: `lib/mtf/board/boardEngine.ts`
- Test: `lib/mtf/board/boardEngine.test.ts`

**Interfaces:**
- Consumes: `AlignmentMatrix` (`lib/alignment.ts`), `Consensus`/`WeightedScore`/`detectStructure` (`lib/multiTimeframe.ts`), `BOARD_CONFIG` (Task 2).
- Produces: `computeBoardDecision(matrix: AlignmentMatrix, consensus: Consensus, weighted: WeightedScore, candlesByTf: Partial<Record<Timeframe, Candle[]>>): BoardDecision` — consumed by Task 6 (`decisionEngine.ts`) and Task 7 (`page.tsx`).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types';
import type { AlignmentMatrix } from '../../alignment';
import type { Consensus, WeightedScore } from '../../multiTimeframe';
import { computeBoardDecision } from './boardEngine';

// Same zigzag builder as lib/multiTimeframe.test.ts's detectStructure suite —
// a strictly monotonic series has no confirmable pivots, so real swing shape
// is needed to exercise detectStructure through the Board.
const swing = (n: number, base: number, trend: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const close = base + i * trend + 5 * Math.sin(i * 0.6);
    return { time: i * 300, open: close, high: close + 1.5, low: close - 1.5, close, volume: 1000 };
  });

const matrixOf = (
  tfVerdict: AlignmentMatrix['tfVerdict'],
  tfScore: AlignmentMatrix['tfScore'],
): AlignmentMatrix => ({ rows: [], tfScore, tfVerdict, sub: {} });

const consensusOf = (bull: number, bear: number, neutral: number): Consensus => {
  const total = bull + bear + neutral;
  return {
    bull, bear, neutral, total,
    pctBull: total ? Math.round((bull / total) * 100) : 0,
    overall: bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral',
  };
};

const weightedOf = (overall: number, outlook: WeightedScore['outlook'], perTf: WeightedScore['perTf']): WeightedScore =>
  ({ overall, outlook, perTf });

describe('computeBoardDecision — Arch v2 sole direction authority', () => {
  it('aligned bullish stack across all 6 TFs → long, full conviction, strong trend, structure from 5m candles', () => {
    const matrix = matrixOf(
      { '1d': 'bullish', '4h': 'bullish', '1h': 'bullish', '30m': 'bullish', '15m': 'bullish', '5m': 'bullish' },
      { '1d': 88, '4h': 86, '1h': 84, '30m': 83, '15m': 82, '5m': 80 },
    );
    const consensus = consensusOf(6, 0, 0);
    const weighted = weightedOf(85, 'bullish', [
      { tf: '1d' as Timeframe, weight: 0.2, score: 88 }, { tf: '4h' as Timeframe, weight: 0.2, score: 86 },
      { tf: '1h' as Timeframe, weight: 0.2, score: 84 }, { tf: '30m' as Timeframe, weight: 0.15, score: 83 },
      { tf: '15m' as Timeframe, weight: 0.15, score: 82 }, { tf: '5m' as Timeframe, weight: 0.1, score: 80 },
    ]);
    const board = computeBoardDecision(matrix, consensus, weighted, { '5m': swing(60, 100, 1) });

    expect(board.schemaVersion).toBe(1);
    expect(board.direction).toBe('long');
    expect(board.bias).toBe('bullish');
    expect(board.conviction).toBe(100); // no dissenters → no penalty
    expect(board.trendStrength).toEqual({ score: 70, label: 'strong' });
    expect(board.marketStructure.verdict).toBe('bullish');
    expect(board.executionTimeframe).toBe('5m');
    expect(board.contributors).toHaveLength(6);
    expect(board.contributors.find((c) => c.timeframe === '1d')).toEqual({ timeframe: '1d', verdict: 'bullish', score: 88, weight: 0.2 });
    expect(board.warnings).toEqual([]);
  });

  it('split stack (low cross-TF agreement, mild dissenters) → no_trade even with a directional bias', () => {
    const matrix = matrixOf(
      { '1d': 'bullish', '4h': 'bearish', '1h': 'bullish', '30m': 'bearish', '15m': 'neutral', '5m': 'bullish' },
      { '1d': 60, '4h': 40, '1h': 58, '30m': 42, '15m': 50, '5m': 56 },
    );
    const consensus = consensusOf(3, 2, 1); // agreementPct = round(3/6*100) = 50
    const weighted = weightedOf(52, 'bullish', [{ tf: '5m' as Timeframe, weight: 0.1, score: 56 }]);
    const board = computeBoardDecision(matrix, consensus, weighted, { '5m': swing(60, 100, 1) });

    // dissenters (bearish vs dominant bullish): '4h'=40, '30m'=42 → extremity (0.2+0.16)/2=0.18
    // conviction = round(50 * (1 - 0.3*0.18)) = round(50*0.946) = 47
    expect(board.conviction).toBe(47);
    expect(board.direction).toBe('no_trade');
    expect(board.bias).toBe('bullish'); // bias still reported even when direction collapses
    expect(board.warnings).toEqual([]); // dissent is mild (0.18 < strongDissentThreshold 0.5) — no warning
  });

  it('conviction accounts for dissent INTENSITY, not just vote count (mild vs extreme dissenter)', () => {
    const base = {
      '1d': 'bullish', '4h': 'bullish', '1h': 'bullish', '30m': 'bullish', '15m': 'bullish',
    } as const;
    const scores = { '1d': 70, '4h': 70, '1h': 70, '30m': 70, '15m': 70 };
    const consensus = consensusOf(5, 1, 0); // agreementPct = round(5/6*100) = 83
    const weighted = weightedOf(65, 'bullish', []);

    const mild = computeBoardDecision(
      matrixOf({ ...base, '5m': 'bearish' }, { ...scores, '5m': 44 }), // just below neutral
      consensus, weighted, {},
    );
    const strong = computeBoardDecision(
      matrixOf({ ...base, '5m': 'bearish' }, { ...scores, '5m': 10 }), // extreme
      consensus, weighted, {},
    );

    expect(mild.conviction).toBe(80);   // round(83 * (1 - 0.3 * (6/50)))
    expect(strong.conviction).toBe(63); // round(83 * (1 - 0.3 * (40/50)))
    expect(strong.conviction).toBeLessThan(mild.conviction);
    expect(mild.warnings).toEqual([]);
    expect(strong.warnings).toEqual([{
      code: 'BOARD_STRONG_DISSENT', severity: 'warning',
      message: '1 timeframe(s) strongly oppose the bullish bias — conviction reduced from 83% to 63%',
    }]);
  });

  it('neutral weighted outlook → no_trade regardless of conviction', () => {
    const matrix = matrixOf({}, {});
    const consensus = consensusOf(0, 0, 6);
    const weighted = weightedOf(50, 'neutral', []);
    const board = computeBoardDecision(matrix, consensus, weighted, {});
    expect(board.direction).toBe('no_trade');
    expect(board.trendStrength).toEqual({ score: 0, label: 'weak' });
    expect(board.warnings).toEqual([]); // neutral bias short-circuits dissent scoring entirely
  });

  it('empty inputs (no candles yet) never throw and default to a safe no_trade', () => {
    const matrix = matrixOf({}, {});
    const consensus = consensusOf(0, 0, 0);
    const weighted = weightedOf(0, 'bearish', []); // computeWeightedScore's real empty-input fallback
    expect(() => computeBoardDecision(matrix, consensus, weighted, {})).not.toThrow();
    const board = computeBoardDecision(matrix, consensus, weighted, {});
    expect(board.direction).toBe('no_trade');
    expect(board.warnings).toEqual([]);
  });

  it('contributors mirror weighted.perTf and pull verdict from the matrix', () => {
    const matrix = matrixOf({ '5m': 'bearish' }, { '5m': 30 });
    const consensus = consensusOf(0, 1, 0);
    const weighted = weightedOf(30, 'bearish', [{ tf: '5m' as Timeframe, weight: 0.1, score: 30 }]);
    const board = computeBoardDecision(matrix, consensus, weighted, { '5m': swing(60, 100, 1) });
    expect(board.contributors).toEqual([{ timeframe: '5m', verdict: 'bearish', score: 30, weight: 0.1 }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/mtf/board/boardEngine.test.ts`
Expected: FAIL — `Cannot find module './boardEngine'` (file doesn't exist yet).

- [ ] **Step 3: Write `boardEngine.ts`**

```typescript
// M-Board (Arch v2) engine. Pure composer over the existing, independent
// alignment pipeline — never recomputes candles into indicator scores itself
// (that's lib/alignment.ts's job); only combines already-computed matrix/
// consensus/weighted into a direction verdict, plus detectStructure for the
// 5m execution-TF's market structure.

import type { Candle, Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { AlignmentMatrix } from '../../alignment';
import { detectStructure, type Consensus, type WeightedScore } from '../../multiTimeframe';
import { BOARD_CONFIG } from './config';
import type { BoardContributor, BoardDecision, BoardDirection, BoardSignal, BoardTrendStrength } from './boardTypes';

function directionOf(bias: BoardDecision['bias'], conviction: number): BoardDirection {
  if (bias === 'neutral') return 'no_trade';
  if (conviction < BOARD_CONFIG.minConviction) return 'no_trade';
  return bias === 'bullish' ? 'long' : 'short';
}

function trendStrengthOf(overall: number): BoardTrendStrength {
  const distance = Math.abs(overall - 50);
  const score = Math.round(Math.min(1, distance / 50) * 100);
  const label = score >= BOARD_CONFIG.strengthBuckets.strong ? 'strong'
    : score >= BOARD_CONFIG.strengthBuckets.moderate ? 'moderate' : 'weak';
  return { score, label };
}

/** How hard the minority is pushing back, on raw score extremity only — NEVER
 *  weighted by TF authority/position (that per-TF-importance weighting is
 *  exactly what caused the original controller-veto bug). Only timeframes
 *  whose verdict OPPOSES the dominant bias count as dissenters; a neutral
 *  read already reduces agreementPct on its own and isn't double-penalized. */
function dissentOf(matrix: AlignmentMatrix, dominantBias: Verdict): { extremity: number; count: number } {
  if (dominantBias === 'neutral') return { extremity: 0, count: 0 };
  const opposing: Verdict = dominantBias === 'bullish' ? 'bearish' : 'bullish';
  const dissentScores = (Object.keys(matrix.tfVerdict) as Timeframe[])
    .filter((tf) => matrix.tfVerdict[tf] === opposing)
    .map((tf) => matrix.tfScore[tf])
    .filter((s): s is number => s != null);
  if (dissentScores.length === 0) return { extremity: 0, count: 0 };
  const extremity = dissentScores.reduce((sum, s) => sum + Math.abs(s - 50) / 50, 0) / dissentScores.length;
  return { extremity, count: dissentScores.length };
}

export function computeBoardDecision(
  matrix: AlignmentMatrix,
  consensus: Consensus,
  weighted: WeightedScore,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
): BoardDecision {
  const agreementPct = Math.round((Math.max(consensus.bull, consensus.bear) / Math.max(1, consensus.total)) * 100);
  const { extremity, count } = dissentOf(matrix, weighted.outlook);
  const conviction = Math.round(agreementPct * (1 - BOARD_CONFIG.dissentPenaltyWeight * extremity));
  const direction = directionOf(weighted.outlook, conviction);
  const trendStrength = trendStrengthOf(weighted.overall);
  const marketStructure = detectStructure(candlesByTf['5m'] ?? []);
  const contributors: BoardContributor[] = weighted.perTf.map((p) => ({
    timeframe: p.tf,
    verdict: matrix.tfVerdict[p.tf] ?? 'neutral',
    score: p.score,
    weight: p.weight,
  }));

  const warnings: BoardSignal[] = [];
  if (extremity >= BOARD_CONFIG.strongDissentThreshold) {
    warnings.push({
      code: 'BOARD_STRONG_DISSENT', severity: 'warning',
      message: `${count} timeframe(s) strongly oppose the ${weighted.outlook} bias — conviction reduced from ${agreementPct}% to ${conviction}%`,
    });
  }

  return {
    schemaVersion: 1,
    direction,
    bias: weighted.outlook,
    conviction,
    trendStrength,
    marketStructure,
    executionTimeframe: '5m',
    contributors,
    warnings,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/mtf/board/boardEngine.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/mtf/board/boardEngine.ts lib/mtf/board/boardEngine.test.ts
git commit -m "feat(mtf): Board engine — the sole direction authority (Arch v2)"
```

---

### Task 4: M9 gate — defer entirely to the Board

**Files:**
- Modify: `lib/mtf/decision/gate.ts`
- Modify: `lib/mtf/decision/gate.test.ts`

**Interfaces:**
- Consumes: `BoardDecision` (Task 2), `BOARD_CONFIG` (Task 2).
- Produces: `boardGate(board: BoardDecision): GateResult` — consumed by Task 6 (`decisionEngine.ts`). Replaces `environmentGate`.

- [ ] **Step 1: Replace `gate.ts`**

```typescript
// M9 — board gate. First-match no-trade check anchored ENTIRELY on the Board's
// direction (Arch v2): the Board is the sole direction authority, M9 defers to
// it and never second-guesses bullish/bearish/neutral itself. Structural/pricing
// rungs (insufficient_data / insufficient_structure / rr_too_low) are composed
// by the orchestrator after pricing. M5-M8 quality/risk/lifecycle no longer gate
// action at all — they only cap riskTier (see riskTier.ts).

import { BOARD_CONFIG } from '../board/config';
import type { BoardDecision } from '../board/boardTypes';
import type { GateResult } from './decisionTypes';

export function boardGate(board: BoardDecision): GateResult {
  if (board.direction === 'no_trade') {
    const reason = board.bias === 'neutral'
      ? 'board bias is neutral — no directional edge'
      : `board conviction ${board.conviction}% is below the ${BOARD_CONFIG.minConviction}% minimum`;
    return { passed: false, blockedBy: 'board_no_trade', reason };
  }
  return {
    passed: true, blockedBy: null,
    reason: `board direction ${board.direction} at ${board.conviction}% conviction`,
  };
}
```

- [ ] **Step 2: Replace `gate.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { BoardDecision } from '../board/boardTypes';
import { boardGate } from './gate';

const board = (patch: Partial<BoardDecision> = {}): BoardDecision => ({
  schemaVersion: 1,
  direction: 'long',
  bias: 'bullish',
  conviction: 70,
  trendStrength: { score: 60, label: 'moderate' },
  marketStructure: { label: 'Bull Trend', sublabel: 'Higher Highs / Higher Lows', verdict: 'bullish' },
  executionTimeframe: '5m',
  contributors: [],
  warnings: [],
  ...patch,
});

describe('M9 board gate — direction deferred entirely to the Board (Arch v2)', () => {
  it('board direction long/short → passes, blockedBy null', () => {
    expect(boardGate(board({ direction: 'long' }))).toEqual({
      passed: true, blockedBy: null, reason: 'board direction long at 70% conviction',
    });
    expect(boardGate(board({ direction: 'short', bias: 'bearish' })).passed).toBe(true);
  });

  it('board direction no_trade + neutral bias → neutral reason', () => {
    const g = boardGate(board({ direction: 'no_trade', bias: 'neutral', conviction: 40 }));
    expect(g).toEqual({
      passed: false, blockedBy: 'board_no_trade', reason: 'board bias is neutral — no directional edge',
    });
  });

  it('board direction no_trade + directional bias but low conviction → conviction reason', () => {
    const g = boardGate(board({ direction: 'no_trade', bias: 'bullish', conviction: 40 }));
    expect(g).toEqual({
      passed: false, blockedBy: 'board_no_trade',
      reason: 'board conviction 40% is below the 55% minimum',
    });
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/mtf/decision/gate.test.ts`
Expected: PASS (3/3). This will still leave `decisionEngine.ts` broken (it imports `environmentGate`) until Task 6 — that's expected mid-plan; do not fix it here.

- [ ] **Step 4: Commit**

```bash
git add lib/mtf/decision/gate.ts lib/mtf/decision/gate.test.ts
git commit -m "feat(mtf): M9 gate defers entirely to the Board (Arch v2)"
```

---

### Task 5: M9 risk tier — advisory caps for extreme risk + invalidated lifecycle

**Files:**
- Modify: `lib/mtf/decision/riskTier.ts`
- Modify: `lib/mtf/decision/riskTier.test.ts`

**Interfaces:**
- Produces: `riskTierOf(market, gatePassed): { tier: RiskTier; capped: boolean; capReason: CapReason }` where `CapReason = 'prior' | 'extreme_risk' | 'lifecycle_invalidated' | null` (return shape changed — `capReason` is new). Consumed by Task 6.

This is where M5–M8's "extreme_risk" and "lifecycle_invalidated" checks move to — they used to be hard gate rungs in `gate.ts` (deleted in Task 4); under Arch v2 they may only downgrade sizing, never the action.

- [ ] **Step 1: Replace `riskTier.ts`**

```typescript
// M9 — risk tier. Account-agnostic sizing signal derived from M8's decomposed
// verdicts. Consumers convert tiers to size against their own equity — M9 never
// knows equity, so concrete sizes would be fake precision.
// Arch v2: M5-M8 are ADVISORS ONLY here — they may downgrade (cap) the risk
// tier but can never flip action/direction (that's the Board's job alone, see
// gate.ts). extreme_risk and lifecycle_invalidated used to be hard gate rungs;
// they are now advisory caps instead.

import type { MarketIntelligenceResult, QualityLevel, RiskLevel } from '../market/marketTypes';
import { PRIOR_TIER_CAP } from './config';
import type { RiskTier } from './decisionTypes';

const QUALITY_RANK: Record<QualityLevel, number> = { excellent: 4, good: 3, average: 2, poor: 1, dangerous: 0 };
const RISK_RANK: Record<RiskLevel, number> = { very_low: 0, low: 1, medium: 2, high: 3, extreme: 4 };
const TIER_RANK: Record<RiskTier, number> = { full: 3, half: 2, quarter: 1, none: 0 };

export type CapReason = 'prior' | 'extreme_risk' | 'lifecycle_invalidated' | null;

/** First-match ladder, then advisory caps (downgrade only, never upgrade). */
export function riskTierOf(
  market: MarketIntelligenceResult,
  gatePassed: boolean,
): { tier: RiskTier; capped: boolean; capReason: CapReason } {
  if (!gatePassed) return { tier: 'none', capped: false, capReason: null };

  if (market.risk.level === 'extreme') {
    return { tier: 'none', capped: true, capReason: 'extreme_risk' };
  }

  const q = QUALITY_RANK[market.quality.level];
  const r = RISK_RANK[market.risk.level];
  let tier: RiskTier;
  if (q >= QUALITY_RANK.excellent && r <= RISK_RANK.low) tier = 'full';
  else if (q >= QUALITY_RANK.good && r <= RISK_RANK.medium) tier = 'half';
  else tier = 'quarter';

  if (market.outlook.invalidation.invalidated && TIER_RANK[tier] > TIER_RANK.quarter) {
    return { tier: 'quarter', capped: true, capReason: 'lifecycle_invalidated' };
  }

  if (tier === 'full' && market.headline.calibration === 'prior') {
    return { tier: PRIOR_TIER_CAP, capped: true, capReason: 'prior' };
  }
  return { tier, capped: false, capReason: null };
}
```

- [ ] **Step 2: Replace `riskTier.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { riskTierOf } from './riskTier';
import { mkMarket } from './testFixtures';

const m = (quality: string, risk: string, calibration: 'prior' | 'empirical') => mkMarket({
  quality: { level: quality as never },
  risk: { level: risk as never },
  headline: { calibration },
});

describe('M9 risk tier — first-match ladder + advisory caps (Arch v2: never flips action)', () => {
  it('gate failed → none, never capped', () => {
    expect(riskTierOf(m('excellent', 'low', 'empirical'), false)).toEqual({ tier: 'none', capped: false, capReason: null });
  });

  it('excellent quality + low risk + empirical calibration → full', () => {
    expect(riskTierOf(m('excellent', 'low', 'empirical'), true)).toEqual({ tier: 'full', capped: false, capReason: null });
    expect(riskTierOf(m('excellent', 'very_low', 'empirical'), true)).toEqual({ tier: 'full', capped: false, capReason: null });
  });

  it('honesty cap: excellent/low but priors → half, capped', () => {
    expect(riskTierOf(m('excellent', 'low', 'prior'), true)).toEqual({ tier: 'half', capped: true, capReason: 'prior' });
  });

  it('good/medium → half; cap does not mark half as capped', () => {
    expect(riskTierOf(m('good', 'medium', 'empirical'), true)).toEqual({ tier: 'half', capped: false, capReason: null });
    expect(riskTierOf(m('good', 'low', 'prior'), true)).toEqual({ tier: 'half', capped: false, capReason: null });
  });

  it('rungs break on either dimension → quarter', () => {
    expect(riskTierOf(m('average', 'medium', 'empirical'), true)).toEqual({ tier: 'quarter', capped: false, capReason: null });
    expect(riskTierOf(m('excellent', 'high', 'empirical'), true)).toEqual({ tier: 'quarter', capped: false, capReason: null });
  });

  it('extreme risk → none, capped, regardless of quality (advisory cap, not an action veto)', () => {
    expect(riskTierOf(m('excellent', 'extreme', 'empirical'), true)).toEqual({ tier: 'none', capped: true, capReason: 'extreme_risk' });
  });

  it('invalidated lifecycle caps a full/half tier down to quarter, never upgrades a lower tier', () => {
    const invalidated = (quality: string, risk: string) => mkMarket({
      quality: { level: quality as never }, risk: { level: risk as never }, headline: { calibration: 'empirical' },
      outlook: { invalidation: { invalidated: true, condition: 'broken' } },
    });
    expect(riskTierOf(invalidated('excellent', 'low'), true)).toEqual({ tier: 'quarter', capped: true, capReason: 'lifecycle_invalidated' });
    expect(riskTierOf(invalidated('average', 'medium'), true)).toEqual({ tier: 'quarter', capped: false, capReason: null });
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/mtf/decision/riskTier.test.ts`
Expected: PASS (7/7)

- [ ] **Step 4: Commit**

```bash
git add lib/mtf/decision/riskTier.ts lib/mtf/decision/riskTier.test.ts
git commit -m "feat(mtf): M9 risk tier — extreme_risk/lifecycle_invalidated become advisory caps"
```

---

### Task 6: M9 orchestrator — consume the Board, not M8's bias

**Files:**
- Modify: `lib/mtf/decision/decisionTypes.ts`
- Modify: `lib/mtf/decision/decisionEngine.ts`
- Modify: `lib/mtf/decision/testFixtures.ts`
- Modify: `lib/mtf/decision/decisionEngine.test.ts`

**Interfaces:**
- Consumes: `BoardDecision` (Task 2), `computeBoardDecision` (Task 3), `boardGate` (Task 4), `riskTierOf`+`CapReason` (Task 5).
- Produces: `computeTradeDecision(board, intel, candlesByTf, smc?)`, `computeFullTradeDecision(candlesByTf, smc?) → {decision, intel, board}` — consumed by Task 7 (`useTradeDecision.ts`) and Task 9 (`m9-diagnose.ts`).

**Important invariant change (read before editing):** the old invariant `riskTier === 'none' ⟺ action === 'no_trade'` is now only one-directional. `action === 'no_trade' ⟹ riskTier === 'none'` still holds, but the reverse no longer does — `extreme_risk` can now cap `riskTier` to `'none'` while `action` stays `'long'`/`'short'` (the trade is still shown, just sized to zero). Get this right in the test helper in Step 4.

- [ ] **Step 1: Update `decisionTypes.ts`**

Find:
```typescript
import type { Timeframe } from '../../types';
import type { Verdict } from '../types';

export type TradeAction = 'long' | 'short' | 'no_trade';
export type TradeSide = 'long' | 'short';
```

Replace with:
```typescript
import type { Timeframe } from '../../types';
import type { Verdict } from '../types';
import type { BoardDirection } from '../board/boardTypes';

/** = BoardDirection. M9 never invents its own action union — the Board (Arch v2's
 *  sole direction authority) is upstream of M9, so M9's type is derived from it. */
export type TradeAction = BoardDirection;
export type TradeSide = Exclude<TradeAction, 'no_trade'>;
```

Find:
```typescript
  /** Echoed from M8 headline.bias — NEVER recomputed. */
  direction: Verdict;
```

Replace with:
```typescript
  /** Echoed from BoardDecision.bias — NEVER recomputed (Arch v2: the Board is
   *  the sole direction authority; M0-M8 only explain/advise). */
  direction: Verdict;
```

- [ ] **Step 2: Replace `decisionEngine.ts`**

```typescript
// M9 — Trade Decision orchestrator. The first ACTIONABLE layer: consumes the
// Board's direction (Arch v2 — the SOLE source of LONG/SHORT/NO_TRADE) plus the
// frozen M8 output (never recomputing lower layers, used only to explain and to
// cap risk tier), prices the setup on the Board's execution timeframe's closed
// bars, optionally refines via bounded SMC confluence, re-checks RR after
// refinement, and assigns a risk tier.
// Spec: docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md
// Arch v2: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import { TIMEFRAMES, type Candle, type Timeframe } from '../../types';
import type { SmcSnapshot } from '../../smc/types';
import { computeAlignmentMatrix } from '../../alignment';
import { computeConsensus, computeWeightedScore } from '../../multiTimeframe';
import { computeBoardDecision } from '../board/boardEngine';
import type { BoardDecision } from '../board/boardTypes';
import { computeFullMarketIntelligence, type FullMarketIntelligence } from '../market/marketEngine';
import type { MarketIntelligenceResult } from '../market/marketTypes';
import { DECISION_CONFIG } from './config';
import type {
  ConfluenceNote, DecisionSignal, GateResult, TradeDecisionResult, TradeSetup, TradeSide,
} from './decisionTypes';
import { boardGate } from './gate';
import { buildSetup } from './levels';
import { riskTierOf } from './riskTier';
import { applySmcConfluence } from './smcConfluence';
import { explain } from './explanation';

export const DECISION_SCHEMA_VERSION = 1;

/** Drop the still-forming last bar (closed-bar determinism). */
const closed = (c: Candle[]): Candle[] => (c.length > 1 ? c.slice(0, -1) : c);

interface AssembleArgs {
  board: BoardDecision;
  market: MarketIntelligenceResult;
  gate: GateResult;
  executionTf: Timeframe;
  setup: TradeSetup | null;
  side: TradeSide | null;
  confluence: ConfluenceNote[];
  extraWarnings: DecisionSignal[];
  diagnostics: { atr: number | null; swingHigh: number | null; swingLow: number | null; rawRR: number | null };
}

function assembleResult(args: AssembleArgs): TradeDecisionResult {
  const { board, market, gate, executionTf, setup, side, confluence, extraWarnings, diagnostics } = args;
  const action = gate.passed && setup && side ? side : 'no_trade';
  const calibration = market.headline.calibration;
  const { tier, capped, capReason } = riskTierOf(market, action !== 'no_trade');
  const signals: DecisionSignal[] = [];
  if (calibration === 'prior') {
    signals.push({
      code: 'DECISION_MODEL_PRIORS', severity: 'info',
      message: 'Probabilities behind this decision come from model priors, not measured frequencies',
    });
  }
  if (capped && capReason === 'prior') {
    signals.push({
      code: 'TIER_CAPPED_PRIOR', severity: 'info',
      message: 'Risk tier capped at half while probabilities run on model priors',
    });
  } else if (capped && capReason === 'extreme_risk') {
    signals.push({
      code: 'TIER_CAPPED_RISK', severity: 'warning',
      message: 'Risk tier capped to none — market risk is extreme (advisory only; board direction unchanged)',
    });
  } else if (capped && capReason === 'lifecycle_invalidated') {
    signals.push({
      code: 'TIER_CAPPED_LIFECYCLE', severity: 'warning',
      message: 'Risk tier capped to quarter — trend lifecycle is invalidated (advisory only; board direction unchanged)',
    });
  }
  return {
    schemaVersion: 1,
    action,
    gate,
    direction: board.bias,
    executionTf,
    setup: action === 'no_trade' ? null : setup,
    riskTier: tier,
    confluence,
    calibration,
    explanation: explain({
      action, gate, executionTf, setup: action === 'no_trade' ? null : setup, tier, capped, calibration,
    }),
    signals,
    warnings: extraWarnings,
    diagnostics: {
      schemaVersions: { market: market.schemaVersion },
      ...diagnostics,
      smcApplied: confluence.length > 0,
    },
  };
}

export function computeTradeDecision(
  board: BoardDecision,
  intel: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: Pick<SmcSnapshot, 'objects'>,
): TradeDecisionResult {
  const market = intel.result;
  const executionTf = board.executionTimeframe;
  const side: TradeSide | null = board.direction === 'no_trade' ? null : board.direction;
  const emptyDiag = { atr: null, swingHigh: null, swingLow: null, rawRR: null };

  const gate = boardGate(board);
  if (!gate.passed || !side) {
    return assembleResult({
      board, market, gate, executionTf, setup: null, side, confluence: [], extraWarnings: [], diagnostics: emptyDiag,
    });
  }

  const candles = closed(candlesByTf[executionTf] ?? []);
  if (candles.length < DECISION_CONFIG.minCandles) {
    return assembleResult({
      board, market, executionTf, setup: null, side, confluence: [], extraWarnings: [], diagnostics: emptyDiag,
      gate: {
        passed: false, blockedBy: 'insufficient_data',
        reason: 'not enough closed candles on the execution timeframe',
      },
    });
  }

  const out = buildSetup(side, candles);
  if (out.kind === 'block') {
    return assembleResult({
      board, market, executionTf, setup: null, side, confluence: [], extraWarnings: [],
      diagnostics: { atr: null, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: out.rawRR },
      gate: {
        passed: false, blockedBy: out.block,
        reason: out.block === 'rr_too_low'
          ? `reward-to-risk ${out.rawRR} is below the ${DECISION_CONFIG.minRR} minimum`
          : 'no reliable anchoring swing structure on the execution timeframe',
      },
    });
  }

  let setup = out.setup;
  let confluence: ConfluenceNote[] = [];
  let extraWarnings: DecisionSignal[] = [];
  if (smc) {
    const refined = applySmcConfluence(setup, side, out.lastClose, smc.objects);
    setup = refined.setup;
    confluence = refined.notes;
    extraWarnings = refined.warnings;
    // RR re-gate: refinement (stop extension) can lower RR below the minimum.
    if (setup.rr < DECISION_CONFIG.minRR) {
      return assembleResult({
        board, market, executionTf, setup: null, side, confluence, extraWarnings,
        diagnostics: { atr: setup.atr, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: setup.rr },
        gate: {
          passed: false, blockedBy: 'rr_too_low',
          reason: `reward-to-risk ${setup.rr} after confluence refinement is below the ${DECISION_CONFIG.minRR} minimum`,
        },
      });
    }
  }

  return assembleResult({
    board, market, gate, executionTf, setup, side, confluence, extraWarnings,
    diagnostics: { atr: setup.atr, swingHigh: out.swingHigh, swingLow: out.swingLow, rawRR: null },
  });
}

/** Convenience entry point: candles → Board + the entire frozen M0–M8 stack → decision. */
export function computeFullTradeDecision(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smc?: Pick<SmcSnapshot, 'objects'>,
): { decision: TradeDecisionResult; intel: FullMarketIntelligence; board: BoardDecision } {
  const tfs = [...TIMEFRAMES];
  const matrix = computeAlignmentMatrix(candlesByTf, tfs);
  const consensus = computeConsensus(matrix, tfs);
  const weighted = computeWeightedScore(matrix, tfs);
  const board = computeBoardDecision(matrix, consensus, weighted, candlesByTf);
  const intel = computeFullMarketIntelligence(candlesByTf);
  return { decision: computeTradeDecision(board, intel, candlesByTf, smc), intel, board };
}
```

Note: `executionTimeframeOf` and its `tfWeight`/`HierarchyResult` imports are deleted entirely — nothing calls it anymore (Task 7 removes its one other call site).

- [ ] **Step 3: Add `mkBoard` to `testFixtures.ts`**

Find the end of the file (after `mkFullIntel`) and append:
```typescript
import type { BoardDecision } from '../board/boardTypes';

const defaultBoard = (): BoardDecision => ({
  schemaVersion: 1,
  direction: 'long',
  bias: 'bullish',
  conviction: 70,
  trendStrength: { score: 60, label: 'moderate' },
  marketStructure: { label: 'Bull Trend', sublabel: 'Higher Highs / Higher Lows', verdict: 'bullish' },
  executionTimeframe: '5m',
  contributors: [],
  warnings: [],
});

export function mkBoard(patch: Partial<BoardDecision> = {}): BoardDecision {
  return { ...defaultBoard(), ...patch };
}
```
(Add the `import type { BoardDecision }` line to the existing top-of-file import block, not as a second import block — keep one import per module.)

- [ ] **Step 4: Replace `decisionEngine.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { computeFullTradeDecision, computeTradeDecision } from './decisionEngine';
import type { TradeDecisionResult } from './decisionTypes';
import { mkBoard, mkFullIntel, mkMarket } from './testFixtures';

const bars = (mids: number[]): Candle[] => mids.map((m, i) => ({
  time: 1000 + i * 60, open: i ? mids[i - 1] : m, high: m + 1, low: m - 1, close: m, volume: 100,
}));
const LONG = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 109, 108, 107, 106, 107, 107, 107, 107, 107];
// Forming bar appended — the engine must slice it off (closed-bar discipline).
const withForming = (mids: number[]): Candle[] => bars([...mids, mids[mids.length - 1]]);

const readyMarket = () => mkMarket({
  headline: { bias: 'bullish', calibration: 'prior' },
  risk: { level: 'low' },
  quality: { level: 'good' },
  outlook: { invalidation: { invalidated: false, condition: null } },
});

// NOTE (Arch v2): riskTier === 'none' no longer implies action === 'no_trade'
// (extreme_risk can cap tier to none while direction/action stand) — the
// invariant is now one-directional.
const invariants = (d: TradeDecisionResult) => {
  expect(d.setup === null).toBe(d.action === 'no_trade');
  if (d.action === 'no_trade') expect(d.riskTier).toBe('none');
  expect(d.gate.passed).toBe(d.action !== 'no_trade');
};

describe('M9 orchestrator — computeTradeDecision (Arch v2: Board is the sole direction authority)', () => {
  it('executionTf is echoed verbatim from board.executionTimeframe', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '15m' });
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '15m': withForming(LONG) });
    expect(d.executionTf).toBe('15m');
  });

  it('board no_trade: setup null, tier none, direction still echoed as board.bias', () => {
    const board = mkBoard({ direction: 'no_trade', bias: 'bearish', conviction: 40, executionTimeframe: '1d' });
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '1d': withForming(LONG) });
    expect(d.action).toBe('no_trade');
    expect(d.gate).toEqual({
      passed: false, blockedBy: 'board_no_trade',
      reason: 'board conviction 40% is below the 55% minimum',
    });
    expect(d.direction).toBe('bearish');
    expect(d.diagnostics).toEqual({
      schemaVersions: { market: 1 }, atr: null, swingHigh: null, swingLow: null, rawRR: null, smcApplied: false,
    });
    invariants(d);
  });

  it('happy path long: canonical setup, tier from ladder, priors signal present', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '1d': withForming(LONG) });
    expect(d.action).toBe('long');
    expect(d.direction).toBe('bullish');
    expect(d.executionTf).toBe('1d');
    expect(d.setup?.entry.zone).toEqual([105, 105.5]);
    expect(d.setup?.stop.price).toBe(103);
    expect(d.setup?.rr).toBe(2.56);
    expect(d.riskTier).toBe('half');
    expect(d.calibration).toBe('prior');
    expect(d.signals.some((s) => s.code === 'DECISION_MODEL_PRIORS')).toBe(true);
    expect(d.diagnostics).toMatchObject({ atr: 2, swingHigh: 111, swingLow: 105, rawRR: null, smcApplied: false });
    invariants(d);
  });

  it('extreme market risk caps tier to none but does NOT flip the board-decided action (Arch v2 core guarantee)', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const market = mkMarket({
      headline: { bias: 'bullish', calibration: 'empirical' },
      risk: { level: 'extreme' },
      quality: { level: 'excellent' },
      outlook: { invalidation: { invalidated: false, condition: null } },
    });
    const d = computeTradeDecision(board, mkFullIntel(market), { '1d': withForming(LONG) });
    expect(d.action).toBe('long');
    expect(d.setup).not.toBeNull();
    expect(d.riskTier).toBe('none');
    expect(d.signals.some((s) => s.code === 'TIER_CAPPED_RISK')).toBe(true);
  });

  it('insufficient data: missing or short execution-TF candles', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const intel = mkFullIntel(readyMarket());
    expect(computeTradeDecision(board, intel, {}).gate.blockedBy).toBe('insufficient_data');
    const short = computeTradeDecision(board, intel, { '1d': withForming(LONG.slice(0, 19)) });
    expect(short.gate.blockedBy).toBe('insufficient_data');
    invariants(short);
  });

  it('SMC re-gate: stop extension dropping RR below minRR blocks with rr_too_low', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const smc = {
      objects: {
        orderBlocks: [], fvgs: [], structureLevels: [], zones: [],
        liquidityPools: [{
          id: 'p', kind: 'liquidityPool' as const, scope: 'swing' as const, direction: 'bearish' as const,
          top: 101.5, bottom: 101.5, createdAtBar: 0, createdAtTime: 0, updatedAtBar: 0,
          state: 'active' as const, touches: 0, strength: 50, quality: 50, confidence: 50,
        }],
      },
    };
    const d = computeTradeDecision(board, mkFullIntel(readyMarket()), { '1d': withForming(LONG) }, smc);
    expect(d.action).toBe('no_trade');
    expect(d.gate.blockedBy).toBe('rr_too_low');
    expect(d.diagnostics.rawRR).toBe(1.46);
    expect(d.diagnostics.smcApplied).toBe(true);
    expect(d.confluence.some((n) => n.code === 'STOP_EXTENDED_LIQUIDITY')).toBe(true);
    invariants(d);
  });

  it('deterministic and closed-bar: forming-bar mutation changes nothing', () => {
    const board = mkBoard({ direction: 'long', bias: 'bullish', executionTimeframe: '1d' });
    const intel = mkFullIntel(readyMarket());
    const a = computeTradeDecision(board, intel, { '1d': withForming(LONG) });
    const b = computeTradeDecision(board, intel, { '1d': withForming(LONG) });
    expect(a).toEqual(b);
    const mutated = withForming(LONG);
    mutated[mutated.length - 1] = { ...mutated[mutated.length - 1], close: 999, high: 1000, low: 1 };
    expect(computeTradeDecision(board, intel, { '1d': mutated })).toEqual(a);
  });
});

describe('M9 — computeFullTradeDecision', () => {
  it('runs the Board + the whole M0-M8 stack and holds the structural invariants on real engine output', () => {
    const { decision, intel, board } = computeFullTradeDecision({ '15m': withForming(LONG) });
    expect(intel.result.schemaVersion).toBe(1);
    expect(board.schemaVersion).toBe(1);
    expect(board.executionTimeframe).toBe('5m');
    expect(decision.calibration).toBe(intel.result.headline.calibration);
    expect(decision.executionTf).toBe(board.executionTimeframe);
    invariants(decision);
    const again = computeFullTradeDecision({ '15m': withForming(LONG) });
    expect(again.decision).toEqual(decision);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run lib/mtf/decision/`
Expected: PASS on `decisionTypes`-dependent files (`gate.test.ts`, `riskTier.test.ts`, `decisionEngine.test.ts`, `explanation.test.ts`, `levels.test.ts`, `swings.test.ts`, `smcConfluence.test.ts`, `config.test.ts` all green — none of the untouched ones should regress).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add lib/mtf/decision/decisionTypes.ts lib/mtf/decision/decisionEngine.ts lib/mtf/decision/testFixtures.ts lib/mtf/decision/decisionEngine.test.ts
git commit -m "feat(mtf): M9 orchestrator consumes BoardDecision — direction/executionTf no longer from M8 (Arch v2)"
```

---

### Task 7: Hook + page wiring

**Files:**
- Modify: `components/mtf/useTradeDecision.ts`
- Modify: `app/custom-multi-timeframe/page.tsx`
- Check: `components/mtf/useTradeDecision.test.ts` (if it exists — grep first)

**Interfaces:**
- Consumes: `computeBoardDecision` (Task 3), `computeTradeDecision` (Task 6).
- Produces: page-level `board: BoardDecision`, passed to `useTradeDecision` and (Task 8) `BoardDecisionCard`.

- [ ] **Step 1: Check for an existing hook test**

Run: `ls components/mtf/useTradeDecision.test.ts 2>/dev/null || echo "no test file"`

If it exists, read it before editing — it will call `decideWithSmc`/`useTradeDecision` with the old 4-arg signature and needs the same `board` param added as the tests in Task 6 did. Update it following the same pattern (add a `mkBoard`-equivalent literal or import from `lib/mtf/decision/testFixtures.ts`) before moving on. If it doesn't exist, skip to Step 2.

- [ ] **Step 2: Replace `useTradeDecision.ts`**

```typescript
'use client';

// MTF Intelligence UI (Phase 1c) — M9 decision hook. Reuses the page's
// already-computed Board decision (Arch v2's sole direction authority) and
// FullMarketIntelligence (never re-runs either stack) plus the page's
// closed-bar-cached smcByTf; recomputes only on the closed-bar signature + the
// SMC toggle (indicator-tick-perf discipline — never on ticks).
// Spec: docs/superpowers/specs/2026-07-20-mtf-intelligence-ui-phase1c-design.md
// Arch v2: docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md

import { useMemo } from 'react';
import { TIMEFRAMES, type Candle, type Timeframe } from '@/lib/types';
import type { SmcSnapshot } from '@/lib/smc/types';
import type { BoardDecision } from '@/lib/mtf/board/boardTypes';
import type { FullMarketIntelligence } from '@/lib/mtf/market/marketEngine';
import { computeTradeDecision } from '@/lib/mtf/decision/decisionEngine';
import type { TradeDecisionResult } from '@/lib/mtf/decision/decisionTypes';

/** Pure core (exported for tests): pick the Board's execution TF's snapshot iff enabled. */
export function decideWithSmc(
  board: BoardDecision,
  full: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
  smcEnabled: boolean,
): TradeDecisionResult {
  const smc = smcEnabled ? smcByTf[board.executionTimeframe] : undefined;
  return computeTradeDecision(board, full, candlesByTf, smc);
}

export function useTradeDecision(
  board: BoardDecision,
  full: FullMarketIntelligence,
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  smcByTf: Partial<Record<Timeframe, SmcSnapshot>>,
  smcEnabled: boolean,
): TradeDecisionResult {
  // Signature over last-CLOSED bar per TF (last bar is still forming).
  const fullSig = TIMEFRAMES
    .map((tf) => { const a = candlesByTf[tf]; return a && a.length > 1 ? `${tf}:${a[a.length - 2].time}` : `${tf}:0`; })
    .join('|');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only on closed bars + toggle + board
  return useMemo(() => decideWithSmc(board, full, candlesByTf, smcByTf, smcEnabled), [board, full, fullSig, smcByTf, smcEnabled]);
}
```

- [ ] **Step 3: Wire `board` into `page.tsx`**

Find:
```typescript
  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES], indSettings), [candlesByTf, indSettings]);
  const consensus = useMemo(() => computeConsensus(matrix, [...TIMEFRAMES]), [matrix]);
  const weighted = useMemo(() => computeWeightedScore(matrix, [...TIMEFRAMES]), [matrix]);
```

Replace with:
```typescript
  const matrix = useMemo(() => computeAlignmentMatrix(candlesByTf, [...TIMEFRAMES], indSettings), [candlesByTf, indSettings]);
  const consensus = useMemo(() => computeConsensus(matrix, [...TIMEFRAMES]), [matrix]);
  const weighted = useMemo(() => computeWeightedScore(matrix, [...TIMEFRAMES]), [matrix]);
  // ---- MTF Board (Arch v2) — the sole direction authority, built from the
  // page's own already-computed alignment grid, never from the M0-M9 stack ----
  const board = useMemo(
    () => computeBoardDecision(matrix, consensus, weighted, candlesByTf),
    [matrix, consensus, weighted, candlesByTf],
  );
```

Find:
```typescript
  const tradeDecision = useTradeDecision(intel.full, candlesByTf, smcByTf, smcOn);
```

Replace with:
```typescript
  const tradeDecision = useTradeDecision(board, intel.full, candlesByTf, smcByTf, smcOn);
```

Add the import (near the other `lib/mtf` imports at the top of the file):
```typescript
import { computeBoardDecision } from '@/lib/mtf/board/boardEngine';
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 tsc errors (besides the pre-existing unrelated `DataTable.tsx` ones), full suite green.

- [ ] **Step 5: Commit**

```bash
git add components/mtf/useTradeDecision.ts app/custom-multi-timeframe/page.tsx
git add components/mtf/useTradeDecision.test.ts 2>/dev/null
git commit -m "feat(mtf): wire Board into the Custom MTF page + M9 hook (Arch v2)"
```

---

### Task 8: UI — Trading Board card

**Files:**
- Modify: `components/mtf/MarketIntelligence.tsx`
- Modify: `app/custom-multi-timeframe/page.tsx`

**Interfaces:**
- Consumes: `BoardDecision` (Task 2).
- Produces: `BoardDecisionCard({ board }: { board: BoardDecision })` — a new exported renderer, mounted on the page.

There are already two components with "Board" in the name (`MTFIntelligenceBoard`, a display of M5's hierarchy — and `MarketIntelligenceBoard`, an M8 data type). Neither is a decision authority. To avoid deepening that confusion, the new component is named `BoardDecisionCard` with panel title "Trading Board", and `MTFIntelligenceBoard`'s copy is updated to make its now-advisor-only role explicit.

- [ ] **Step 1: Add the `BoardDecisionCard` renderer**

In `components/mtf/MarketIntelligence.tsx`, add the import:
```typescript
import type { BoardDecision } from '@/lib/mtf/board/boardTypes';
```
(add it next to the other `@/lib/mtf/*` type imports near the top of the file)

Then insert this new function immediately before `// ---------------------------------------------------------------- 1. MTF board` (i.e., it becomes section "0"):

```typescript
// ---------------------------------------------------------------- 0. Trading Board (Arch v2 — sole direction authority)
export function BoardDecisionCard({ board }: { board: BoardDecision }) {
  const { direction, bias, conviction, trendStrength, marketStructure, executionTimeframe, contributors } = board;
  const dirColor = direction === 'long' ? 'text-bull-bright' : direction === 'short' ? 'text-bear-bright' : 'text-neutral';

  return (
    <Panel eyebrow title="Trading Board" badge="Direction Authority">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cx('text-lg font-bold uppercase', dirColor)}>{direction.replace('_', ' ')}</span>
        <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', vColor(bias), 'bg-surface-3')}>{bias}</span>
        <span className="text-[10px] text-ink-faint">Executes on {TF_LABEL[executionTimeframe]}</span>
      </div>
      <div className="grid grid-cols-3 gap-x-4">
        <Stat k="Conviction" v={`${conviction}%`} tone={conviction < 55 ? 'text-bear-bright' : 'text-ink'} />
        <Stat k="Trend Strength" v={`${trendStrength.label} (${trendStrength.score})`} />
        <Stat k="Structure" v={marketStructure.label} tone={vColor(marketStructure.verdict)} />
      </div>
      <div className="mt-1 text-[10px] text-ink-faint">{marketStructure.sublabel}</div>
      {board.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {board.warnings.map((w) => (
            <div key={w.code} className="rounded bg-regime-hot/10 px-2 py-1 text-[10px] text-regime-hot">{w.message}</div>
          ))}
        </div>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-ink-faint">
              <th className="pb-1 font-medium">TF</th><th className="pb-1 font-medium">Verdict</th>
              <th className="pb-1 text-right font-medium">Score</th><th className="pb-1 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {contributors.map((c) => (
              <tr key={c.timeframe} className="border-t border-line/40">
                <td className="py-1 font-semibold text-ink">{TF_LABEL[c.timeframe]}</td>
                <td className={cx('py-1', vColor(c.verdict))}><span className="inline-flex items-center gap-1"><VGlyph v={c.verdict} />{c.verdict}</span></td>
                <td className="py-1 text-right font-mono tabular-nums">{c.score}</td>
                <td className="py-1 text-right font-mono tabular-nums">{c.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Disambiguate `MTFIntelligenceBoard`'s copy**

Find:
```typescript
    <Panel eyebrow title="MTF Intelligence Board" badge="M2–M5">
```

Replace with:
```typescript
    <Panel eyebrow title="Timeframe Hierarchy" badge="M5 · Advisor Only">
```

- [ ] **Step 3: Mount the card on the page**

In `app/custom-multi-timeframe/page.tsx`, find:
```typescript
              {intel.full.layers.snapshots.length > 0 && (
                <>
                  <MarketIntelligenceVerdict result={intel.full.result} />
```

Replace with:
```typescript
              {intel.full.layers.snapshots.length > 0 && (
                <>
                  <BoardDecisionCard board={board} />
                  <MarketIntelligenceVerdict result={intel.full.result} />
```

Add `BoardDecisionCard` to the existing import from `MarketIntelligence.tsx`:
```typescript
  MTFIntelligenceBoard, AgreementConfidencePanel, CategoryStrip, TradeContextCard,
```
becomes:
```typescript
  BoardDecisionCard, MTFIntelligenceBoard, AgreementConfidencePanel, CategoryStrip, TradeContextCard,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/mtf/MarketIntelligence.tsx app/custom-multi-timeframe/page.tsx
git commit -m "feat(mtf): Trading Board card — mount the Arch v2 direction authority on Custom MTF"
```

---

### Task 9: Diagnostic script update + live verification

**Files:**
- Modify: `scripts/m9-diagnose.ts`

**Interfaces:**
- Consumes: `computeFullTradeDecision` (Task 6, new 3-field return).

- [ ] **Step 1: Update the script**

Find:
```typescript
  const { decision, intel } = computeFullTradeDecision(byTf);
  const m = intel.result;
  const L = intel.layers;

  console.log('\n=== LIVE BTC — FULL LAYER TRACE ===');
  console.log('price ~', byTf['5m']!.at(-1)!.close.toFixed(1));
```

Replace with:
```typescript
  const { decision, intel, board } = computeFullTradeDecision(byTf);
  const m = intel.result;
  const L = intel.layers;

  console.log('\n=== LIVE BTC — FULL LAYER TRACE ===');
  console.log('price ~', byTf['5m']!.at(-1)!.close.toFixed(1));

  console.log('\n-- BOARD (Arch v2 — sole direction authority) --');
  console.log('direction  :', board.direction, '| bias', board.bias, '| conviction', board.conviction + '%');
  console.log('strength   :', board.trendStrength.label, `(${board.trendStrength.score})`);
  console.log('structure  :', board.marketStructure.label, '—', board.marketStructure.sublabel);
  console.log('executes on:', board.executionTimeframe);
  if (board.warnings.length) {
    console.log('warnings   :', board.warnings.map((w) => w.message).join(' | '));
  }
  for (const c of board.contributors) {
    console.log(`   ${c.timeframe.padEnd(4)}: ${c.verdict.padEnd(8)} score ${String(c.score).padStart(3)} weight ${c.weight}`);
  }
```

Leave the rest of the file (M3 through M9 trace sections) unchanged — those still print the (now advisory-only) M0–M8 stack for comparison against the Board's call.

- [ ] **Step 2: Run it against live BTC data**

Run: `npx tsx scripts/m9-diagnose.ts`
Expected: prints the new `-- BOARD --` section followed by the existing layer trace. Confirm manually:
- `board.executionTimeframe` is `5m`.
- `decision.executionTf` equals `board.executionTimeframe`.
- If `board.direction` is `long`/`short`, `decision.action` matches it (or is `no_trade` only via a structural rung — `insufficient_data`/`insufficient_structure`/`rr_too_low` — never via an M8-derived reason).
- This is the direct regression check for the original bug: a weak/conflicted M5–M8 read (check the printed M5/M8 sections) must NOT change `board.direction` or `decision.action` — at most it should show up as a `TIER_CAPPED_*` signal.

- [ ] **Step 3: Live UI verification**

Start the dev server and open `/custom-multi-timeframe` in a browser (or via Playwright if available). Confirm:
- The new "Trading Board" card renders above "Timeframe Hierarchy" with a direction, bias, conviction, trend strength, structure, and the 6-row contributor table.
- "Timeframe Hierarchy" panel now shows badge "M5 · Advisor Only" instead of "M2–M5".
- The Trade Decision panel's action matches the Trading Board's direction (or is `no_trade` for a structural reason shown in its explanation — check the explanation text doesn't mention environment/readiness anymore).
- 0 console errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/m9-diagnose.ts
git commit -m "chore(mtf): m9-diagnose prints the Board trace (Arch v2 live verification)"
```

---

### Task 10: Constitution docs

**Files:**
- Modify: `docs/architecture/market-intelligence-pipeline.md`
- Modify: `docs/architecture/mtf-engine.md`

- [ ] **Step 1: Update the M9 section's invariants + deps in `market-intelligence-pipeline.md`**

Find:
```markdown
**Invariants:** `setup === null ⟺ action === 'no_trade' ⟺ riskTier === 'none'`;
`gate.passed ⟺ action ≠ no_trade`; direction never recomputed (echoed M8 headline bias); closed-bar
only; deterministic; banned predictive vocabulary in all text; `calibration` propagated, never hidden.

**Depends on:** M8 only (`FullMarketIntelligence`), candles for pricing (M9 owns price levels —
M7/M8 explicitly excluded them), and structurally `SmcSnapshot['objects']` when offered.
```

Replace with:
```markdown
**Invariants (Arch v2, 2026-07-25):** `setup === null ⟺ action === 'no_trade'`;
`action === 'no_trade' ⟹ riskTier === 'none'` (one-directional now — `extreme_risk` can cap
`riskTier` to `'none'` while `action` stays `long`/`short`, since M5-M8 may only cap sizing,
never flip direction); `gate.passed ⟺ action ≠ no_trade`; direction/executionTf never
recomputed (echoed `BoardDecision.bias`/`.executionTimeframe` — NOT M8 headline bias); closed-bar
only; deterministic; banned predictive vocabulary in all text; `calibration` propagated, never hidden.

**Depends on:** `BoardDecision` (Arch v2 — sole direction/executionTf authority, see below) for
`direction`/`executionTf`; M8 (`FullMarketIntelligence`) ONLY for explanation + risk-tier capping,
never for action; candles for pricing (M9 owns price levels — M7/M8 explicitly excluded them);
structurally `SmcSnapshot['objects']` when offered.

## The Board (Arch v2, 5m-only proof phase)

`lib/mtf/board/` — the sole source of `direction`/`conviction`/`trendStrength`/`marketStructure`/
`executionTimeframe` (fixed `'5m'` this phase). Built from the pre-existing, independent
`lib/alignment.ts` + `lib/multiTimeframe.ts` pipeline — NOT part of the M0-M9 dependency chain
above, which is what keeps M0-M4 "justify, never decide" non-circular. M5-M8 may only downgrade
M9's `riskTier` (`riskTierOf`'s `extreme_risk`/`lifecycle_invalidated`/`prior` caps); they can
never force `action = 'no_trade'` or change `direction`. Spec:
`docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md`.
```

- [ ] **Step 2: Add the spec link**

Find:
```markdown
- M9 trade decision: `docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md`
```

Replace with:
```markdown
- M9 trade decision: `docs/superpowers/specs/2026-07-20-m9-trade-decision-engine-design.md`
- Board Arch v2 (5m-only): `docs/superpowers/specs/2026-07-25-mtf-board-arch-v2-5m-design.md`
```

- [ ] **Step 3: Correct the consumer count in `mtf-engine.md`**

Find:
```markdown
`lib/alignment.ts` keeps its public API unchanged (`computeTfCells`,
`computeAlignmentMatrix`, `AlignmentMatrix`) and now delegates scoring to the
registry. Its 12 existing consumers — multi-timeframe page, alerts,
Stack Score, trade setup, scanner/reports via `multiTimeframe.ts` — are
untouched and continue to consume `AlignmentMatrix`.
```

Replace with:
```markdown
`lib/alignment.ts` keeps its public API unchanged (`computeTfCells`,
`computeAlignmentMatrix`, `AlignmentMatrix`) and now delegates scoring to the
registry. Its 12 existing consumers — multi-timeframe page, alerts,
Stack Score, trade setup, scanner/reports via `multiTimeframe.ts` — are
untouched and continue to consume `AlignmentMatrix`. A 13th consumer joined
2026-07-25: the MTF Board (`lib/mtf/board/`), which formalizes this same
independent pipeline into `BoardDecision`, the M0-M9 stack's sole direction
authority (Arch v2) — see `docs/architecture/market-intelligence-pipeline.md`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/market-intelligence-pipeline.md docs/architecture/mtf-engine.md
git commit -m "docs(mtf): record Arch v2 Board milestone in the constitution"
```

---

## Self-Review

**Spec coverage:**
- Phase 1 (Board decides direction/conviction/trendStrength/marketStructure/bias/executionTf=5m) → Tasks 2, 3.
- Phase 2 (M0–M4 unchanged, justify only) → enforced by construction (Board never imports `lib/mtf/indicators|categoryEngine|agreement|confidence`); no task touches those modules.
- Phase 3 (M5–M8 advisor only, may cap risk tier, never flip direction) → Tasks 4 (gate no longer reads M8), 5 (risk tier gains the caps).
- Phase 4 (M9 receives BoardDecision + 5m candles + optional SMC; outputs entry/stop/targets/tier/management/exit; never decides direction) → Task 6 (`computeTradeDecision` signature + `direction`/`executionTf` sourcing).
- Phase 5 (validate on 5m: live BTC, ranging/trending, bull/bear days) → Task 9 (diagnostic script + live UI check). Full bar-replay validation across many days is a manual practice-period activity (matching how M9 Phase 1c was validated originally) — out of scope for this plan's automated tests, called out explicitly in Task 9 Step 2/3.
- "Guiding principle" diagram (Board → M0-M4 explain → M5-M8 qualify → M9 execute) → the whole plan's dependency direction (Tasks 3→4/5→6→7/8).

**Placeholder scan:** no TBD/TODO, no "add appropriate X", no bare "similar to Task N" — every step has complete, real code including exact existing code being replaced.

**Type consistency:** `BoardDecision`/`BoardDirection`/`BoardContributor`/`BoardTrendStrength` (Task 2) are used identically in Tasks 3, 4, 6, 7, 8. `TradeAction = BoardDirection` (Task 6) keeps `TradeSide`/`action` consistent everywhere it's already used (`levels.ts`, `smcConfluence.ts`, `explanation.ts` — none of which are modified, since they only consume `TradeSide`/`TradeAction`/`GateResult` structurally, never board/market directly). `CapReason` (Task 5) is consumed by name in Task 6's `assembleResult`. `computeBoardDecision`'s signature (`matrix, consensus, weighted, candlesByTf`) is identical across Task 3's implementation, Task 6's `computeFullTradeDecision`, and Task 7's page wiring.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-25-mtf-board-arch-v2-5m.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
