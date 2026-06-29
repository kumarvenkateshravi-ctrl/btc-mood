# MyCryptoStack Design System (MDS)

> Status: v0.3 — working spec and single source of truth for design decisions.
>
> Governing principle: **specify, do not enumerate.** Every rule carries a value, a
> threshold, or a contract a developer can build from and a reviewer can check. The
> target is **enforceable contracts**, not descriptive prose: designers, developers,
> tooling and CI should derive the same behavior from a chapter without interpretation.
>
> Build order matters: foundations are defined mathematically before components, so
> nothing is refactored later. Status tags below: **[SPECIFIED]** = build-ready,
> **[CONTRACT]** = architecture frozen, concrete values land in implementation,
> **[PLANNED]** = outline only.

## Roadmap and status

| Phase | Chapter | Status |
|---|---|---|
| A | Philosophy & Governance | [CONTRACT] |
| B | Foundations — B-i Tokens · B-ii Typography & Numerals · B-iii Surface & Elevation · B-iv Motion | [CONTRACT] |
| C | Component Platform | [CONTRACT] |
| D | Financial Data Visualization & Chart Interaction Grammar | [SPECIFIED] |
| E | Explainable AI Grammar | [SPECIFIED] |
| F | Market State Grammar | [SPECIFIED] |
| G | Dashboard Grammar & Cognitive Load Budget | [SPECIFIED] |
| H | Financial Tables | [SPECIFIED] |
| I | State Transition Grammar (real-time data) | [SPECIFIED] |
| J | Responsive Trading Layouts | [SPECIFIED] |
| K | Plugin & Extension Architecture | [CONTRACT] |
| L | Engineering Platform | [CONTRACT] |

The differentiators competitors cannot quickly copy, and that this document exists to
protect: the **data-visualization grammar (D)**, the **explainable-AI grammar (E)**,
the **market-state grammar (F)**, the **numeral design language (B5)**, and the
**financial-table + state-transition contracts (H, I)** that make dense, live data
legible, all kept in sync by the **engineering platform (L)**.

---

# A. Philosophy & Governance  [CONTRACT]

**Feel:** professional, calm, premium, data-first, trustworthy, institutional.
**Never:** gaming UI, neon cyberpunk, meme-coin, casino, rainbow gradients.
**Voice:** explain, never hype. "AI confidence rose to 84% as momentum held and
volatility fell," never "Buy BTC NOW."
**AI principle:** never present a score without its reasons (see E).

**Governance (locks the system as it grows):**
- Versioning: MDS is semver'd; this header carries the version. Breaking token or
  component-API changes bump major.
- Deprecation: a token/component is marked `@deprecated` for one minor cycle before
  removal, with the replacement named.
- Contribution: changes land via PR that updates DESIGN.md + the token source + the
  component, together; design and code never drift in separate PRs.
- Review gate: the Design QA checklist (G6) and the Information Hierarchy Score (G5)
  must pass before merge.

---

# B. Foundations  [CONTRACT]

**Implementation checkpoints (ship in order, each is one source of truth before the
next consumes it):** **B-i Token Foundation** (primitive OKLCH → semantic → component →
theme map), **B-ii Typography & Numerals** (font stack, OpenType features, format
utilities, locale, precision), **B-iii Surface & Elevation** (the recipe in B3),
**B-iv Motion Foundation** (timing, easing, state transitions, reduced-motion,
real-time update behavior). The spec subsections B1–B6 below define the contracts these
checkpoints implement.

## B1. Token architecture (three tiers)

Never reference a raw color in a component. Tokens cascade:

```
Primitive  →  Semantic  →  Component
--indigo-500   --accent      --button-primary-bg
--gray-950     --surface     --card-bg
--green-500    --bull        --signal-buy-bg
```

- **Primitive**: the raw scale (`--indigo-50..950`, `--slate-50..950`, etc.). No
  component uses these directly.
- **Semantic**: meaning aliases (`--surface`, `--surface-raised`, `--surface-hover`,
  `--text-primary/secondary/muted`, `--border-default/hover/focus`, `--accent`,
  `--bull`, `--bear`, `--warn`, `--info`, `--gold`). Theming swaps this layer only.
- **Component**: per-component tokens that reference semantics. This is what markup
  consumes.

This abstraction is what makes the four themes in B2 maintainable.

## B2. Perceptual color (OKLCH is the source of truth)

- Colors are authored in **OKLCH**, not hex, for even lightness steps and clean
  gradients on modern displays. Never pure `#000`/`#fff`; tint neutrals toward the
  brand hue (chroma ≈ 0.012, hue ≈ 256–268).
- Direction: **Obsidian Indigo** — cool slate surfaces, `--accent` electric indigo,
  `--accent-2` IQ violet, `--gold` reserved for premium (<2% coverage).
- Required artifacts per release: primitive palette, semantic aliases, **documented
  contrast pairs with APCA scores** for every text/icon-on-surface and
  signal-on-surface combination, **dark + light** theme maps (light is the report/PDF
  theme), and a **color-blind-safe** check (signals never rely on color alone, see F).
- Targets: AAA (7:1) for body text where feasible, AA for large/UI; signal colors
  meet AA on their surfaces.

## B3. Elevation recipe (every layer fully specified)

Depth on dark comes from **surface-lightness steps + a 1px specular top hairline**,
not from heavy shadows. Each elevation specifies all fields:

| Level | Background | Border | Specular (top edge) | Shadow | Z | Usage |
|---|---|---|---|---|---|---|
| e0 | `--base` | none | none | none | 0 | app canvas |
| e1 | `--surface` | `--border-default` 1px | `--specular` 1px top | `0 1px 2px -1px ink/25` | 1 | cards, panels |
| e2 | `--surface-raised` | `--border-hover` 1px | `--specular` 1px top | `0 8px 24px -12px ink/40` | 10 | hover, dropdowns, popovers |
| e3 | `--surface-raised` | `--border-hover` 1px | `--specular` 1px top | `0 16px 48px -16px ink/55` | 100 | modals, command palette |

Max 3 elevation levels above the canvas. Shadows are soft and tinted (never pure
black). `--specular` is one lightness step above the surface; it is the single biggest
"flat to crafted" move.

Each elevation is a **full contract**, not just bg+shadow:
- **Opacity:** 100% (scrims/overlays are separate tokens, never reduced-opacity surfaces).
- **Blur:** none, except an optional 8px backdrop on e3 over chart-heavy views.
- **Transition:** 180ms ease-out on background/border/shadow when an element changes
  elevation (hover e1→e2).
- **Allowed:** e1 = resting content; e2 = transient (hover/dropdown/popover); e3 =
  modal/command palette.
- **Forbidden:** e2/e3 on static content; jumping more than one level at once;
  shadow-based depth on e0/e1 (those read via surface step + specular only).

## B4. Typography roles

Roles, not just sizes: **Display, Hero, H1–H3, Body, Small, Caption, Label
(uppercase, +0.08em tracking), Code, Numerals, AI-reasoning text, Table text.**

- Families: **Geist** (UI), **Geist Mono** (numerals/code). Hierarchy by size + weight
  (≥1.25× step between levels), never by adding fonts.
- Card rule: max 2 sizes inside a card; page rule: max 3 weights.
- AI-reasoning text is its own role (slightly muted, comfortable line-length ≤72ch).

## B5. Numeral Design Language (its own chapter — critical)

Numbers are most of a trading UI, so they get a contract.

- **Font/features:** `--num-font` = Geist Mono with `font-variant-numeric: tabular-nums
  lining-nums`. Always tabular so columns align; always lining so digits sit on the
  baseline.
- **Alignment:** numerals right-aligned in tables; **align on the decimal point**;
  fixed-width columns so rows scan vertically.
- **Precision (max of exchange tick and magnitude):**
  - sub-unit crypto (e.g. SHIB) → up to **8 decimals** (`0.00000001`)
  - `< 1` → 3–4 dp (ETH-class small values, `0.001`)
  - `1–999` → 2 dp · `1,000–9,999` → 1 dp · `≥ 10,000` → grouped, 0–1 dp
    (`$109,421.52`)
- **Compact notation:** `≥1e4 K · ≥1e6 M · ≥1e9 B · ≥1e12 T` for counts, volume, and
  market cap (`$2.14T`).
- **Scientific notation:** only below `1e-8`; otherwise show full decimals to the
  precision rule.
- **Negatives:** signed with a true minus glyph and bear color; deltas always carry an
  explicit sign and semantic color (`+3.82%` bull, `-1.10%` bear).
- **Locale:** currency and digit grouping follow the user's locale. Support **USD**
  (default) and **INR** (`₹`, lakh/crore grouping `₹1,45,000`) at minimum; never
  hardcode `$` or US grouping.
- **Update animation:** on value change, a ≤250ms tick-flash (bull/bear) and optional
  digit roll; under `prefers-reduced-motion`, color-only, no roll.

## B6. Motion grammar

- **Easing:** ease-out family (`cubic-bezier(0.16, 1, 0.3, 1)` for entrances; standard
  `ease-out` for hovers). No bounce, no elastic.
- **Durations:** 120 / 180 / 220 / 300ms. Hovers 180; entrances 220–300.
- **Allowed properties:** `transform` and `opacity` only.
- **Forbidden:** animating layout-affecting properties (`top/left/width/height/margin`).
  Lift via `translateY`, not `top`.
- **Reduced motion:** every animation has a `prefers-reduced-motion` fallback
  (instant or opacity-only).
- **Financial data transitions:** live updates use the B5 tick-flash; never a full
  re-render flash. Concurrency capped per G3.

---

# C. Component Platform  [CONTRACT]

Built only after B is frozen. Primitives: Button, Input, Select, Card/Panel, Modal,
Sheet, Tabs, Table, Badge, Tooltip, ChartContainer, Skeleton, EmptyState, ErrorState,
Notification/Toast, CommandPalette, Gauge, Sparkline, ProgressBar.

**Every component documents the same contract:**
Anatomy · Tokens used (component-tier only) · States (default/hover/pressed/focus/
loading/disabled/success/warning/error/selected/active) · Accessibility (roles, ARIA,
contrast) · Keyboard behavior · Responsive behavior · Variants · Usage examples ·
Anti-patterns.

Components consume **component tokens only** (B1); no hardcoded color or spacing.

### C-FREEZE — Panel (frozen 2026-06-27)

Panel migration is **complete**: every screen uses `@/components/ui` `Panel`/`Pill`/
`FootLink`. The Panel primitive is now **frozen**:
- Do not create a new local panel/card/widget implementation in any page.
- Every new screen must use `@/components/ui` `Panel`.
- If a screen needs new panel behavior, **extend the shared `Panel`** (a new prop) and
  re-verify the Visual Regression Checklist, rather than forking a variant.

**Visual Regression Checklist** (run before merging any migration/UI pass; these catch
what tsc/tests cannot): identical panel padding, identical header heights, identical
title spacing, consistent elevation, consistent hover behavior, consistent badge
alignment, no new custom panel variant, mobile layout intact, dark/light themes correct.
Enforcement TODO (Phase L): an ESLint rule forbidding a local `function Panel`/`Widget`
in `app/**`.

### B5-FREEZE — Financial Information Language (frozen 2026-06-27)

`Num` (`@/components/ui`) is the **only legal way to render a financial value**. Callers
choose a SEMANTIC variant, never raw formatting:
- `Num.Price` (asset price), `Num.Money`, `Num.Pnl` (always signed + semantic color),
  `Num.Pct`, `Num.Delta` (signed + arrow + color), `Num.RR`, `Num.Qty` (value + unit),
  `Num.Score` (0-100, optional band), `Num.Compact` (K/M/B/T). `<Num />` is the generic
  escape hatch.
- `Stat` is the **light** label/value row; its value is a `<Num.* />`.
- `KpiCard` is the **rich** metric tile; it owns the delta grammar (renders `Num.Delta`
  from a number + caption), the value grammar is the caller's `Num` choice.

**Frozen rules:** no `toLocaleString` / `toFixed` / manual sign+symbol concatenation for a
financial value in a page. New value type → add a variant in `Num.tsx`, never format inline.
`Stat` stays light; do not grow it toward `KpiCard`. Enforcement TODO (Phase L): an ESLint
rule flagging numeric `toLocaleString`/`toFixed` in `app/**`.

### H-FREEZE — DataTable v1.0 (frozen 2026-06-27)

`DataTable` (`@/components/ui`) is the second cornerstone primitive (alongside `Panel`).
Validated across all four table archetypes with **no API change** — Analytics (Strategy
Performance), Comparison (Stack Score, MTF), Historical (Journal Recent Trades), Diagnostic
(Market Regime) — so the **`Column<T>` API is frozen at v1.0**. Layering is fixed:
`DataTable → Column Presets → Financial Cells → Num.*`.

**Frozen rules:**
- No page builds a bespoke `<table>` for tabular financial data; use `DataTable`.
- Columns are declared with the **Column Presets** (`priceColumn`/`pnlColumn`/`percentColumn`/
  `scoreColumn`/`statusColumn`/`timestampColumn`/`numColumn`/`textColumn`/`assetColumn`/
  `qtyColumn`); a one-off column may inline a Financial Cell, never raw formatting.
- New behavior (density modes, sticky first column, multi-select, keyboard nav, resize,
  virtualization >100) is a **v2 additive** extension of this same component, never a fork.

Remaining table migrations are now mechanical (same API): reports Timeframe / Mistake /
Missed, journal Setup&TF / Breakdown, strategies Comparison, positions MTF monitor.

---

# D. Financial Data Visualization Grammar  [SPECIFIED]

Charts are the product. These rules apply to every chart, gauge, sparkline, donut,
heatmap and overlay across all pages.

## D1. Chart-type decision matrix

| Intent | Use | Do not use |
|---|---|---|
| Price action, OHLC, entries/exits | Candlestick (lightweight-charts) | Line (loses range), area |
| Trend / equity / single series over time | Line + soft area fill | Candles, bars |
| Smoothed trend | Heikin Ashi (labeled) | Plain candles relabeled |
| Range compression / pure price moves | Renko (labeled, brick size shown) | Time-based candles |
| Magnitude across categories | Donut (≤6 slices) or horizontal bars | 3D pie, legend-only pie |
| Distribution across 2 dims | Heatmap (single-hue or diverging) | Rainbow heatmap |
| Multi-factor profile | Radar (≤8 axes) | Stacked bars |
| Event sequence | Timeline | Scatter |

A chart's type is chosen by **intent**, never novelty. If a line communicates it, do
not use candles.

## D2. Color budget per chart

- **Single-series:** one color, by semantic meaning (bull/bear for signed; `--accent`
  for neutral). Never multi-color a single series for decoration.
- **Categorical:** max **6** from the data-viz palette (`--dv-1..6`); a 7th becomes
  "Others."
- **Sequential** heatmaps: single-hue lightness ramp. **Diverging:** `bear → neutral →
  bull` only; neutral is tinted grey, never white.
- Distinct hues visible in one chart: **≤6** (hard cap).

## D3. Grid, axes, labels

- Gridlines: `--ink` at **6–8% opacity**, 1px, dashed `2 3`; never compete with data.
- Ticks: max **7** per axis; min **40px** spacing; drop labels before they overlap.
- Value axis auto-scales to data + referenced overlay levels (entry/SL/TP) with manual
  override; never clip a referenced level.
- Zero/baseline at `--ink` 12% dashed when a series crosses zero.
- All labels follow the **Numeral Contract (B5)**.

## D4. Crosshair and tooltip hierarchy

- Crosshair: 1px dashed `--border-hover`, **snaps to nearest data point**, value pills
  on both axes (price pill uses the series color).
- Tooltip is a strict hierarchy, max 5 rows: (1) primary value (largest, mono),
  (2) OHLC/series values, (3) delta vs prev / vs entry (semantic), (4) volume/secondary,
  (5) meta (time, source, smallest). One tooltip at a time, follows cursor at 120ms.

## D5. Overlay stacking (fixed z-order, bottom → top)

```
1 background bands (sessions, events, AI zones, liquidity)   ≤15% fill
2 volume
3 trend overlays (EMAs, VWAP, Supertrend, bands)
4 price (candles / line)
5 structure (S/R, trendlines, order blocks)
6 markers (signals, entries, exits, whale prints)
7 crosshair + tooltip + price marker (always top)
```

## D6. Zoom, pan, replay

Horizontal drag = time pan; wheel/pinch = time zoom (price auto-scales). Keep an ≈8%
right-edge gutter. Double-click resets. Replay mode steps bar-by-bar at 0.5–4x with
future bars hidden and overlays recomputed per visible bar.

## D7. Multi-pane and multi-monitor synchronization

Panes share a synchronized time axis and a shared crosshair. Workspace-level sync
(opt-in) links symbol/timeframe/zoom across panels with a visible "linked" indicator.
Indicator panes keep proportional heights and never exceed the price pane.

## D8. Accessibility

Series are distinguishable without color (line style/markers); tooltips are
keyboard-reachable; crosshair values are announced to screen readers on focus.

## D9. Drawing tools, shortcuts, annotations

- Tools: trendline, horizontal line, ray, rectangle/zone, Fibonacci, text note.
  Drawings persist per **symbol + workspace**.
- Annotation color comes from a constrained 4-color set (neutral, accent, bull, bear);
  annotation density is capped so drawings never out-ink price.
- Keyboard: `Esc` cancels the active tool, `Del` removes the selected drawing,
  modifier-drag snaps to OHLC, arrows nudge by one tick. Every shortcut is listed in
  the ⌘K command palette.
- Selected drawings show handles at e2; editing is non-destructive (undo/redo stack).

---

# E. Explainable AI Grammar  [SPECIFIED]

The differentiator. Every AI surface (Position/Strategy/Trading Coach, MyStack IQ,
Stack Score factors, any future signal) follows this grammar. Master rule: **never a
score without its reasons.**

## E1. Anatomy of an AI card (required slots, in order)

1. **Verdict** — recommendation/state.
2. **Confidence** — 0–100 + band + visualization (E2). Distinct from direction.
3. **Direction** — Bullish / Bearish / Neutral, explicit label + arrow.
4. **Evidence** — ranked supporting factors (E3).
5. **Counter-signals** — contradictory evidence shown explicitly (E3).
6. **Risk** — what invalidates this / downside.
7. **Historical context** — "setups like this resolved X% over N samples."
8. **Source + timestamp** — feeds used and analysis time (E4).
9. **Uncertainty** — range/quality, not false precision (E5).
10. **Actions** — one primary recommended step (E6).
11. **Affordances** — "Why?" and "What changed?" (E7).

Empty slots render an honest empty state ("insufficient history"), never a fabricated
value.

## E2. Confidence visualization

Ring or bar + numeric + band (`0–40 Weak · 41–70 Moderate · 71–90 Strong · 91–100 Very
Strong`). **Confidence color is orthogonal to direction** — use a neutral→strong ramp
or `--accent`, never bull-green/bear-red (green would imply "bullish," not "confident").
Direction is encoded separately (E1.3).

## E3. Evidence ordering and counter-signals

Evidence ordered by absolute contribution weight, descending; each item shows factor,
direction (▲ supports / ▼ opposes), weight bar. **Contradictory evidence is surfaced**
under "Counter-signals," never hidden. Material counter-signals lower the confidence
band and say why.

## E4–E7 (condensed)

- **E4 Source/timestamp:** name inputs + "as of HH:MM UTC"; stale data dims confidence
  and shows a "delayed" flag.
- **E5 Uncertainty:** prefer ranges ("target 62.6–62.8k," "win prob 60–66%"); thin data
  caps the band at Moderate with a "limited data" badge; whole-percent rounding.
- **E6 Actions:** exactly one primary action, justified by the evidence above it.
- **E7 Why / What changed:** "Why?" expands to the full factor breakdown; "What
  changed?" diffs against the previous snapshot ("confidence 78 → 84; volume turned
  supportive").

## E8. Anti-patterns

Score with no evidence · confidence colored by direction · hidden contradictions ·
false precision (`84.62%`) · recommendation without risk/reason/timestamp.

---

# F. Market State Grammar  [SPECIFIED]

Market direction, confidence, risk, volatility, liquidity and signal-agreement are
**independent perceptual channels.** No single visual variable carries two meanings
(e.g. green must not mean both "up" and "confident"). Keeping these orthogonal is what
makes the interface trustworthy and prevents users conflating concepts.

| Dimension | Independent encoding |
|---|---|
| **Direction** | semantic bull/bear/neutral color + arrow/icon + explicit label |
| **Confidence** | neutral→strong ramp ring/bar + number + band; **never** bull/bear color |
| **Risk** | dedicated risk scale (warn ramp) + shield/badge (Low/Med/High/Critical) |
| **Volatility** | a dedicated volatility indicator (ATR badge / chart texture), not just a color shift |
| **Liquidity** | explicit liquidity badge; low-liquidity zones get a distinct chart treatment (dimmed/striped), not silence |
| **Signal agreement** | when signals conflict, show evidence **side-by-side** with counter-evidence; **never average them into one number** |

Rules:
- Each concept owns its channel; reusing a channel for a second meaning is a defect.
- "Conflicting signals" is a first-class state, not noise to be smoothed away. It
  renders as a split evidence/counter-evidence view (ties to E3).
- This generalizes E2's "confidence orthogonal to direction" to every market dimension.

---

# G. Dashboard Grammar & Cognitive Load Budget  [SPECIFIED]

Measurable limits so dashboards stay usable as features are added. Numbers are starting
budgets; calibrate via testing, never remove.

## G1. Viewport budget by density mode

| Density | Max widgets/viewport | Max KPIs/row | Body | Row gap |
|---|---|---|---|---|
| Comfortable | 6 | 4 | 14px | 24px |
| Standard | 9 | 6 | 13px | 16px |
| Compact | 12 | 8 | 12px | 12px |

The cap is a function of density mode (this resolves the old "4 vs 8" contradiction).

## G2. Color & emphasis budget

One brand `--accent` per viewport (`--accent-2` reserved for IQ/AI identity). Semantic
hues only where they carry meaning. Accent + semantic coverage (excluding data-viz
panels) **≤10%** of pixels; `--gold` **≤2%**.

## G3. Motion concurrency

≤2 simultaneous non-essential animations; live tick-flash/pulse exempt but throttled
(≤1/cell/250ms) and reduced-motion aware; only one chart draw-in at a time; no count-up
on routine metrics (one hero figure on first load only).

## G4. Alert / notification rate

≤3 toasts on screen; ≤1 toast per source per 30s, duplicates coalesce with a count;
`Critical` bypasses immediately.

## G5. Information Hierarchy Score (IHS) — ship ≥ 80

| Criterion | Pts |
|---|---|
| One dominant focal point | 20 |
| ≤3 nested information levels | 15 |
| ≥1.25× size/weight step between levels | 15 |
| ≤1 primary CTA per view | 10 |
| Accent ≤10% coverage (G2) | 10 |
| Deliberate spacing rhythm | 10 |
| Clear scan path | 10 |
| No competing focal points / no card-in-card | 10 |

## G6. Widget hierarchy, panels, workspaces

Largest component = most important data; supporting metrics demoted; actions tertiary.
Panels are resizable; layouts persist per workspace (Scalping/Swing/Investing/…);
multi-monitor and floating windows supported; workspace templates ship as presets.

---

# H. Financial Tables  [SPECIFIED]

Dense tabular data is a primary surface, so tables get a full contract.

- **Alignment:** text left; numerals right, tabular, decimal-aligned (B5); status/badges
  centered.
- **Row height by density:** Comfortable 40px · Standard 32px · Compact 28px.
- **Sticky:** header always sticky; the first identifying column (symbol/date) sticky on
  horizontal scroll.
- **Sorting:** click header cycles none → desc → asc; one active sort key; arrow
  indicator; sort is stable.
- **Filtering:** per-column filter affordance; active filters appear as removable chips
  above the table.
- **Selection:** row hover raises bg to `--surface-hover`; multi-select via a checkbox
  column, `Shift` = range, `Cmd/Ctrl` = toggle; selection count + bulk actions in a
  sticky action bar.
- **Keyboard:** arrows move the focused cell/row; `Space` toggles selection; `Enter`
  opens the row; `Home/End` jump; fully reachable without a mouse.
- **Virtualization:** virtualize when rows > 100, preserving sticky header/column and the
  keyboard model.
- **Resize:** drag the header edge (min 64px); widths persist per workspace.
- **Overflow:** truncate text with ellipsis + tooltip; **numbers never truncate** (reduce
  density or wrap the column instead).
- **Update animation:** changed cells tick-flash per B5 (≤250ms); rows never reflow or
  reorder on live update unless the active sort demands it, and then they **animate
  position, never jump**.

---

# I. State Transition Grammar  [SPECIFIED]

Real-time market data moves through a defined lifecycle. Each state has a visual
treatment, and only certain transitions are legal.

| State | Visual treatment | Legal next states |
|---|---|---|
| Loading | skeleton (no spinner for data regions) | Ready, Error |
| Ready | data shown, neutral | Live |
| Live | subtle pulse dot, fresh | Updating, Stale, Disconnected |
| Updating | cell tick-flash (B5), value changes | Live |
| Stale | values dimmed + "delayed" badge when age > 2× refresh | Live, Disconnected |
| Disconnected | offline badge, last value frozen + greyed, no fake updates | Retrying |
| Retrying | inline progress with backoff, last value kept | Recovered, Disconnected |
| Recovered | brief confirm flash, then Live | Live |

Rules: never render stale data as if live; never blank the screen on disconnect (freeze
the last value and label it); AI/confidence cards **downgrade** when their inputs are
Stale/Disconnected (ties to E4). Transitions animate via opacity/color only (B4), never
layout.

---

# J. Responsive Trading Layouts  [SPECIFIED]

Trading needs more than phone breakpoints.

| Environment | Width | Behavior |
|---|---|---|
| Mobile portrait | < 768 | single column, stacked cards, bottom nav, full-bleed charts; tables collapse to cards |
| Tablet portrait | 768–1024 | 2-col, sidebar collapses to icons |
| Tablet landscape | 1024–1280 | sidebar + 2–3 col workspace |
| Laptop | 1280–1440 | sidebar 260px + 12-col, container 1280 |
| Desktop | 1440–1920 | full workspace, density toggle exposed |
| Ultrawide | ≥ 2560 | per-panel max-width caps; extra width adds workspace columns/panels, never stretches one panel |
| Dual / triple monitor | n/a | detachable floating windows; a workspace can span monitors; each window keeps its own symbol/timeframe unless workspace-synced (D7) |

Rules: the **panel** is the responsive unit, not the page; line-length stays ≤75ch on
any monitor; ultrawide gains panels, not stretched text; workspace layout persists per
environment.

---

# K. Plugin & Extension Architecture  [CONTRACT]

MyCryptoStack is a platform, so extension points are contracts from day one. Each is
versioned, capability-scoped and sandboxed.

- **CustomIndicator:** `(candles, config) → { plots, signals }` — already modeled by
  `lib/indicatorFramework` (`IndicatorResult` / `IndicatorPlot`); third-party indicators
  implement the same contract and run through the same golden-master harness.
- **AIProvider:** `(context) → AICard` conforming to the Explainable-AI grammar (E); a
  provider that cannot supply evidence + confidence is rejected.
- **ExchangeConnector / Datafeed:** the `lib/dataSource` registry contract (historical +
  stream); adding an exchange means implementing it, not patching pages.
- **BrokerConnector:** order-placement / position-sync contract (paper today, live later).
- **WorkspaceTemplate:** JSON export/import of layout + indicators + watchlists + density.
- **Widget:** a manifest (id, permissions, size) + a sandboxed render surface; widgets
  request capabilities, never global access.

Stability: extension contracts are semver'd independently and deprecated per Phase A
policy; a breaking change to a contract is a major bump with a migration note.

---

# L. Engineering Platform  [CONTRACT]

Transforms the system from a document into an enforceable standard.

- **Token pipeline:** author in **W3C Design Tokens** format → **Style Dictionary**
  builds CSS variables + **Tailwind (v4)** theme from one source. No parallel hand-maintained values.
- **Components:** typed React APIs; documented in **Storybook** with the C contract.
- **Quality gates in CI:** **token-only lint** (Stylelint/ESLint: no raw hex/spacing),
  **axe** a11y, **visual regression** (Chromatic), and enforced **performance budgets**
  (LCP < 2.0s, INP < 150ms, initial bundle < 250KB, charts lazy-loaded, WebP, SVG icons,
  variable fonts).
- A PR that violates a budget or introduces a raw color fails the build.

---

## Provenance

Synthesizes the MDS drafts plus the professional-trading pillars and the reference-spec
roadmaps. v0.3 adds the **reference-specification depth** layer: **Financial Tables (H)**,
**State Transition Grammar (I)**, **Responsive Trading Layouts (J)**, **Plugin &
Extension Architecture (K)**, chart **drawing/shortcut/annotation** rules (D9), the
**full elevation contract** (opacity/blur/transition/allowed/forbidden), and the
**B-i…B-iv** implementation checkpoints. Sections D–J are specified to buildable depth;
A–C, K and L freeze the architecture, with concrete token/typography/motion values
landing in the Phase B implementation. The plugin contracts (K) bind to code that already
exists: `lib/indicatorFramework`, the golden-master harness, and the `lib/dataSource`
registry. Retrofits the existing AI panels, tables and charts across Dashboard,
Strategies, Positions, Reports, Journal and MyStack IQ.
