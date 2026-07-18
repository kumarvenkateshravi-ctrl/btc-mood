# Market Structure Engine — Presentation Refinements

**Date:** 2026-07-18
**Status:** Approved (design)
**Builds on:** `2026-07-18-market-structure-engine-design.md`
**Source:** `CustomMTFEnhance.md` (12-item review)

## Scope

Presentation refinements to the Market Structure Engine card. **11 of 12** review
items plus the "Key Observations" rename. Item #12 (Structure Health Meter) is
**deferred** — it reintroduces the single-opaque-number pattern the engine was
deliberately built to avoid, and warrants its own spec if pursued.

**Guiding principle (unchanged from the base spec):** the engine is authoritative,
the card is a dumb renderer. Any computation that spans sections or must be
deterministic lives in `lib/mtf/structureEngine.ts` with a test; pure layout stays
in `components/mtf/MarketStructureCard.tsx`.

`SNAPSHOT_VERSION` bumps `'1.0' → '1.1'`.

## Out of scope

- #12 Structure Health Meter (single 0–100% consistency number) — deferred.
- No new engine metrics beyond the derived fields listed below.
- No changes to the SMC engine, the MTF matrix, or other pages.

---

## A. Engine changes — `lib/mtf/structureEngine.ts`

All additions remain deterministic (same inputs ⇒ identical snapshot except
`metadata.createdAt` / `computationTimeMs`) and descriptive-only (no predictive
vocabulary).

| # | Change | Field / shape |
|---|--------|---------------|
| 1 | Structure quality word, distinct from confidence | `StructureData.qualityWord: 'Strong' \| 'Moderate' \| 'Developing'`. Mapping from existing `confidence`: `≥70 → Strong`, `≥45 → Moderate`, else `Developing`. |
| 2 | Liquidity dominance | `LiquidityData.dominance: 'buy' \| 'sell' \| 'balanced'` and `net: number`. Derived from **active** pool counts: `net = buySide.active − sellSide.active`; `dominance = net > 0 ? 'buy' : net < 0 ? 'sell' : 'balanced'`. |
| 5 | Structure-break verdict | `StructureBreaksData.verdict: { tone: TrendWord; text: string }`. When the window has zero breaks: `{ tone: 'neutral', text: 'No BOS or CHoCH in the last N bars.' }`. Otherwise a descriptive line naming the dominant break kind/direction in the window. |
| 8 | Richer Structure Quality | `QualityData` gains `trend: TrendWord`, `liquidityBias: 'buy' \| 'sell' \| 'mixed'`, `recentBreaks: string`. `confidence` (already present) is surfaced as "Confluence". `liquidityBias` reuses `LiquidityData.dominance` (mapping `balanced → 'mixed'`); `recentBreaks` reuses the verdict summary (e.g. `"None"` when empty). |
| 9 | Categorized narratives | `narratives: string[]` → `narratives: Array<{ category: NarrativeCategory; text: string }>` where `NarrativeCategory = 'Liquidity' \| 'Structure' \| 'FVG' \| 'Premium'`. Each existing narrative line is tagged with its source category; generation order is unchanged. |

Empty-history / warming-up branches keep returning `narratives: []`.

## B. Card changes — `components/mtf/MarketStructureCard.tsx`

Pure rendering of the new fields. No market logic.

- **#10 Header:** three summary chips after the title — **Bias** (`structure.trend`),
  **Structure Quality** (`structure.qualityWord`), **Phase** (`phase.label`). Gracefully
  omit a chip whose section is not `ready`.
- **#1 Current Structure:** big Trend word + swing sequence, then distinct rows:
  `Structure Quality` (qualityWord), `Established` (age), `Confidence` (%).
- **#2 Liquidity:** existing per-side stats, then a divider + a **Liquidity Dominance**
  line — `BUY SIDE` / `SELL SIDE` / `Balanced` toned from `dominance`, with `net`.
- **#3 FVG:** thin horizontal comparison bars for **open** bullish vs bearish counts,
  widths normalized to the larger side; existing numbers retained.
- **#4 Order Blocks:** flip the nearest rows so **distance %** is primary (large),
  price secondary underneath.
- **#5 Market Structure:** `verdict.text` toned line on top, break counts underneath.
- **#6 Premium/Discount:** static teaching line under the description —
  "Typical institutional preference — Longs → Discount · Shorts → Premium". Constant
  string, no prediction.
- **#7 Latest Events:** an icon per event type (author's set: 💧 sweep, ↗ CHoCH,
  ⬆/⬇ BOS, 🟩/🟥 FVG, 🟦 OB), preserving directional color.
- **#8 Structure Quality:** expand from two lines to rows — Classification, Confluence %,
  Trend, Liquidity, Recent Breaks, Summary.
- **#9 + rename:** render narratives grouped under `category` subheadings; **rename the
  card "Reading the Market" → "Key Observations"**.
- **#11 Tooltips:** wrap specialized terms — Stacked FVG, Order Block, Liquidity Sweep,
  Premium/Discount, BOS, CHoCH — in `InfoTip`.

## C. New primitive — `components/ui/InfoTip.tsx`

Lightweight, reusable (not MTF-specific), exported from `components/ui/index.ts`.

- Trigger: a child with a dotted underline (or a `?` affordance), keyboard-focusable.
- Popover: `role="tooltip"`, shown on hover **and** focus, dismissable on blur/Escape,
  small max-width, positioned above/adjacent with viewport-safe fallback.
- Content: passed as `label` (term) → looked up in a static `SMC_GLOSSARY` map, or an
  explicit `content` prop.

## D. Tests

- **`lib/mtf/structureEngine.test.ts`** (extend):
  - `qualityWord` mapping at the 70 / 45 boundaries.
  - `dominance` / `net` for buy-dominant, sell-dominant, and balanced pools.
  - `verdict.text` for empty window vs a window with breaks.
  - `liquidityBias` (`balanced → mixed`) and `recentBreaks` (`None` when empty).
  - Categorized-narrative shape: each item has `category` + `text`.
  - Update the banned-vocabulary loop to read `n.text`; update the
    `narratives === []` assertion for the new element type.
- **`InfoTip`**: render + a11y test following `ui.test.tsx` / `a11y.test.tsx`
  conventions (tooltip appears on focus, `role="tooltip"`, Escape dismisses).

## Acceptance

- `npm test` green (engine + InfoTip + existing suites).
- `tsc` clean.
- Card live-renders all 11 refinements against BTCUSDT; grouped narratives read as
  category sections; tooltips appear on hover/focus.
- Banned-vocabulary guarantee still holds over categorized narratives.
