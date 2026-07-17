# Market Structure Engine — Design

Date: 2026-07-18 · Status: frozen (approved through three brainstorm rounds)

## Goal

A **Market Structure Engine** card on `/custom-multi-timeframe`, below the
alignment matrix: a live SMC intelligence dashboard that shows what
institutions are doing (structure, liquidity, FVGs, order blocks,
premium/discount, event timeline) instead of reducing SMC to a single
0–100 score. The MTF matrix stays focused on directional alignment; this
card is the complementary view.

This is the **first specialized intelligence engine** and the reference
pattern for future engines (Trend, Momentum, Volatility, Volume, Risk,
Trade Planning):

```
Raw Engine → Snapshot Projection → Reusable Snapshot → Renderer
```

## Decisions (from brainstorming)

1. **Scope: Market Structure only.** Other engines are later milestones.
2. **Placement:** Custom MTF page only. Main MTF page and all other
   alignment consumers untouched.
3. **Timeframes:** full card reflects one selectable TF; plus a compact
   per-TF BOS/CHoCH strip across the matrix's timeframes.
4. **Count window:** engine object window with lifecycle splits, plus
   "created today" (UTC) sub-counts from event timestamps.
5. **Timeline:** last significant `SmcEvent`s + Current Phase from the
   screener's existing `WorkflowStage`. No new state machine.
6. **Scores are real, display is descriptive:** confidence % comes from the
   existing confluence/institutional scores; the overall summary is a
   **Structure Quality** classification (no stars).
7. **No new detection math.** Everything projects from what `lib/smc/`
   already computes (except the small stacked-FVG geometry pass).

## Architecture

```
candles per TF (already fetched by the page for the matrix)
        ↓
computeSmc(candles) per TF        — existing lib/smc engine, memoized on
        ↓                            last-closed-bar time (never re-runs on ticks)
lib/mtf/structureEngine.ts        — NEW pure projection:
        ↓                            createMarketStructureSnapshot(smcSnapshot, config)
MarketStructureSnapshot           — reusable domain object (not a UI model)
        ↓
components/mtf/MarketStructureCard.tsx   — NEW renderer
        ↓
app/custom-multi-timeframe/page.tsx      — card below the matrix
```

Principles (inherited from the MTF architecture doc): pure, deterministic,
closed-bar only, configuration-driven, explainable, no UI/React/network
code in `lib/`.

`MarketStructureSnapshot` is a domain object designed for reuse by future
consumers (dashboard, AI, reports, trade planner, journal, replay,
notifications). The card is merely its first renderer.

## Configuration

```ts
interface StructureEngineConfig {
  /** Rolling window for BOS/CHoCH counts and the per-TF strip. */
  structureWindowBars: number;      // default 20
  /** Max significant events rendered in the timeline. */
  timelineLength: number;           // default 7
}
export const DEFAULT_STRUCTURE_ENGINE_CONFIG: StructureEngineConfig;

createMarketStructureSnapshot(
  smc: SmcSnapshot,
  candles: Candle[],
  config?: Partial<StructureEngineConfig>,
  meta?: { symbol: string; timeframe: Timeframe },
): MarketStructureSnapshot;
```

Nothing window-related is baked into domain logic — profiles (scalping 10 /
intraday 20 / swing 50) become pure configuration later.

## Snapshot contract

### Metadata (first field, part of the contract from day one)

```ts
metadata: {
  engine: 'marketStructure';  // engine identity — every future engine sets its own
  snapshotVersion: string;    // '1.0'
  symbol: string;
  timeframe: Timeframe;
  lastClosedBarTime: number;
  createdAt: number;
  computationTimeMs: number;
  config: StructureEngineConfig;
}
```

### Section health states

Every section carries its own readiness state instead of a global flag:

```ts
type SectionState =
  | 'ready' | 'warming_up' | 'insufficient_history'
  | 'disabled' | 'partial' | 'error';

interface Section<T> { state: SectionState; data: T | null; }
```

v1 emits `ready`, `warming_up`, and `insufficient_history`; the enum is
extensible without breaking consumers. The card renders a quiet
"warming up" treatment for non-ready sections — never fake zeros.

### Sections

| Section | Content | Source |
|---|---|---|
| `structure` | trend (bullish/bearish/neutral), swing sequence (e.g. HH → HL → HH), confidence % (confluence/institutional score), **structure age** ("established N bars ago" — bars since the last trend-flipping CHoCH/BOS; **`null` when no trend-flipping event exists** — null means "not yet established", never 0) | `state.swingTrend`, swing + structure events, existing scores |
| `liquidity` | per side: **Created / Swept / Still Active** pool counts; created-today sub-counts | `liquidityPools` lifecycle, `LIQUIDITY_SWEEP`/`EQH`/`EQL` events |
| `fvg` | per direction: created, still open, filled, created today, **stacked**; net bias (+N direction); freshest. **Stacked rule (formal):** two open same-direction FVGs are stacked when their price bands intersect with positive overlap — `min(a.top, b.top) > max(a.bottom, b.bottom)`. The stacked count per direction = number of open FVGs of that direction that overlap at least one other open FVG of the same direction | `fvgs` lifecycle + `FVG_*` events; small new geometry pass on existing top/bottom bands |
| `orderBlocks` | per direction: created, fresh, mitigated, broken; **nearest OB: price + distance %** from current close (closest unmitigated band on the relevant side) | `orderBlocks` lifecycle + `OB_*` events |
| `structureBreaks` | BOS/CHoCH counts per direction over the **last `structureWindowBars` bars**; per-TF strip (same window) across matrix TFs; lifetime totals kept internal, not rendered | `BOS`/`CHOCH` events (barIndex filter) |
| `premiumDiscount` | zone + descriptive sentence ("Price sits inside the discount half of the current dealing range.") — no badge/checkmark | `state.zone`, trailing range |
| `timeline` | last `timelineLength` **significant** events: LIQUIDITY_SWEEP, CHOCH, BOS, OB_CREATED, FVG_CREATED (consecutive duplicates collapsed). Excluded: FVG_FILLED, OB_TESTED, OB_MITIGATED, SWING_FORMED, EQH/EQL_FORMED, ZONE_CHANGED. **Ordering: oldest → newest, ending with Current Phase** (reads like a story). Each item preserves `{ eventId, eventType, barIndex, timestamp, direction, label }` even though the UI initially renders only the label — enables click-to-chart, replay-from-event, diagnostics, and AI explanations without a snapshot redesign | `events` |
| `phase` | Current Phase label | screener `WorkflowStage` (reused, not reimplemented) |
| `quality` | `{ classification, confidence, summary }` — **classification**: Excellent / Strong / Moderate / Weak, bucketed from the confluence score with **explicit thresholds: 90–100 Excellent, 75–89 Strong, 55–74 Moderate, 0–54 Weak** (defined as named constants; numeric `confidence` stays in the snapshot); **summary**: one concise descriptive headline sentence (e.g. "Bullish structure remains intact despite recent sell-side liquidity sweeps.") — narratives carry the detail | existing confluence score + narrative rule table |
| `narratives` | deterministic descriptive sentences (see below) | rule table over the above |

## Narratives — descriptive, never predictive

A small deterministic rule table emits statements of current fact only:

- ✔ "Sell-side liquidity has been swept while bullish structure remains intact."
- ✔ "Bullish order blocks continue to outnumber bearish order blocks."
- ✔ "Price currently trades inside a discount zone."
- ✘ Anything predictive.

A unit test asserts no narrative output contains banned predictive
vocabulary: `likely, expected, will, probable, should, forecast,
anticipate, anticipated, predicted, prediction`.

## Timeframe selector

The card's TF selector offers **only the timeframes the matrix currently
displays** — one shared timeframe universe. If the matrix set changes and
the selected TF disappears, fall back to the nearest available TF.
Selection persists in `localStorage['custom_mtf_structure_tf']`
(SSR-safe; corrupt/missing → default `1H` or nearest available).

## Debug mode & diagnostics

Debug is a **central service**, not a URL check in the component:

```ts
// lib/debug.ts (NEW, shared)
isDebugEnabled(scope: string): boolean   // e.g. isDebugEnabled('marketStructure')
```

v1 implementation reads `?debug=1` (all scopes on) internally; future
engines (scanner, replay, stack score, strategy studio) reuse the same
service, and the mechanism can change without touching components.

When enabled, the card shows a collapsed **Engine Diagnostics** section:
snapshot version, object counts per kind, event count, computation time
(ms), snapshot time (UTC), and **cache hit: yes/no** (whether the memoized
snapshot was served or recomputed).

## Performance

- `computeSmc` per TF is memoized on last-closed-bar time; live ticks never
  recompute (established indicator-perf rule).
- The projection itself is cheap (counts/filters over existing arrays); its
  cost is measured and reported as `computationTimeMs`.

## Edge cases

- Insufficient candles for swing detection → affected sections report
  `warming_up` / `insufficient_history`.
- No unmitigated OB on the relevant side → nearest OB renders "—".
- No significant events → timeline hidden; phase falls back to the
  screener's idle stage.
- Matrix TF set changes → selector re-syncs, fallback TF chosen.

## Testing

Vitest only (no Playwright), against the pure module:

1. Counts and lifecycle splits (created/swept/active; open/filled;
   fresh/mitigated/broken) from synthetic snapshots.
2. UTC "created today" boundary behavior.
3. Stacked-FVG overlap geometry (overlapping vs disjoint bands, direction
   separation).
4. Nearest-OB selection + distance % (both sides, none available).
5. Windowed BOS/CHoCH counts respect `structureWindowBars`; config
   override changes the window; per-TF strip aggregation.
6. Structure age from last trend-flipping event.
7. Timeline significance filter + duplicate collapse + length cap.
8. Structure Quality bucketing thresholds.
9. Narrative rule table outputs + banned-vocabulary scan.
10. Section health states (`ready`/`warming_up`/`insufficient_history`).
11. Metadata completeness (incl. `engine: 'marketStructure'`); determinism
    (same inputs ⇒ identical snapshot, modulo `createdAt`/`computationTimeMs`).
12. `isDebugEnabled` scope behavior.
13. **Default-drift guard:** `createMarketStructureSnapshot(smc, candles)`
    equals `createMarketStructureSnapshot(smc, candles, { structureWindowBars: 20,
    timelineLength: 7 })` (modulo timing fields).
14. Structure age is `null` (not 0) when no trend-flipping event exists.
15. Timeline items carry `eventId`/`eventType`/`barIndex`/`timestamp` and are
    ordered oldest → newest.
16. Quality thresholds honored at boundaries (89→Strong, 90→Excellent, etc.).
17. Entire pre-existing suite (830+) passes unchanged; `lib/smc/` and
    `lib/alignment.ts` are not modified.

## Future-proofing note

Every future intelligence engine standardizes on a common shape —
`IntelligenceSnapshot<T>` with `metadata` / `sections` / `diagnostics?` —
and `MarketStructureSnapshot` is written so it can declare conformance
when that interface is introduced. Not implemented in v1; the field naming
here (metadata-first, per-section health states) is chosen to make that
adoption a non-breaking change.

## Out of scope (v1)

- Trend / Momentum / Volatility / Volume / Risk / Trade Planning engines
  (future family; each will follow the same snapshot pattern).
- Main MTF page, widgets/drawer version, other pages.
- Configurable SMC detection parameters on this card.
- Window profiles UI (scalping/intraday/swing) — config-ready, no UI yet.
- Server-side persistence.
