# BTC Strategy Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this project forbids subagents). Milestones are executed one at a time; each gets its own task-level breakdown when started.

**Vision source:** `~/Downloads/grandPlan.md` — "An Institutional Strategy Studio for Bitcoin." The scanner becomes one engine inside a studio that answers: Should I trade? → Which direction? → What strategy? → Can I trust it?

**Governing principle (enforced every milestone):** every screen answers a *trading* question, never an engineering question.

**Hard constraints:** July 31 ship deadline; local-first (no backend/auth/LLM spend before launch — marketplace schema is already future-proof); all engines already deterministic and tested (653+ suite must stay green).

## Reality inventory (leverage, don't rebuild)

Already shipped and reusable: mood engine + Stack Score + Market Context (intelligence), SMC engine + Institutional Workflow + screener (bias, readiness, phases), scanner contract layer (registry sources, per-condition TF, AND/OR trees, immutable versions, marketplace fields), signals dock with reasons, bar replay, `/journal` page, validation basics (status/complexity/coverage), exits schema.

Genuinely new: studio shell/nav, intelligence home surface, style profiles, wide builder + wizard nav, categorized library, TF ladder inheritance, SMC-stage sources, risk studio extensions, deterministic validation warnings + cadence estimator, visual backtest, Strategy DNA, Quick-Add DSL. Post-launch: AI Coach/Builder, Marketplace/Community.

---

## M1 — Studio shell + Market Intelligence home

The answer to "Should I trade today?" becomes the studio's front door.

- Rename surface: `/technical-scanner` → **BTC Strategy Studio** (route stays; header + nav copy change). Left rail becomes studio nav: Intelligence · Builder · My Strategies · Backtests · Journal (link) · Marketplace (locked badge "coming soon").
- **Intelligence home** composes EXISTING engines into one read: Trend / Momentum / Volatility (mood engine rows), Market Structure + Liquidity + SMC Stage N/8 (SMC screener report), Institutional Score, Stack Score, **Trade Readiness %** (weighted blend of screener score + stack score + confluence — one new pure function with tests), **Today's Bias ★ rating with the counter-trend line** ("SHORT ★ — advanced only").
- **"Why?" expander**: the checklist rows straight from the screener report (daily trend, sweep, BOS, OB, volume…), reusing `ScreenerItem` rendering.
- CTA at the bottom: "Build a strategy for this market →" (hands bias + style hints to M2's builder).
- Tests: readiness blend function; copy audit.

## M2 — Build/Monitor mode split + Trading Style profiles

The space fix (builder ~65% width) and "Which trader are you?"

- **Two modes, one page.** Build mode: five-section surface (Style & Market → Conditions → Exits & Risk → Preview & Validate → Save & Activate) at ~65% width with a docked preview chart (~35%). Monitor mode: today's grid (chart-dominant) for running strategies. `Edit` flips modes.
- **Style profiles** (`lib/scanner/styleProfiles.ts`, pure data + tests): Scalper (1m–15m ladder, momentum/volatility sources first, SL 1×ATR, TP 1/1.5/2R, cadence 15–30/day), Intraday (5m–1h + 1h gate), Swing (1h–1d, structure/SMC first, SL 2×ATR, cadence 2–6/wk), Position, SMC Trader (workflow-stage template preloaded), Custom. Selecting one sets TF ladder, suggested sources, exit defaults, cadence expectation — all overridable.
- Direction step shows the M1 recommendation with stars + "Why", not a bare Long/Short toggle.
- Beginner/Advanced toggle = navigation style over the same surface: stepper with one-line explanations vs one scrollable canvas (Wizard Mode 1 and Canvas Mode 2 of the grand plan — one implementation, two speeds).

## M3 — Condition experience: library, TF ladder, SMC stages as sources

- **Categorized indicator library** (grand-plan taxonomy): Trend / Momentum / Volume / Volatility / Market Structure / Smart Money / Custom — a searchable picker panel (registry `group` field extended from 3 groups to these), replacing bare dropdowns; each source gets a one-line trading description.
- **Global TF ladder with inheritance**: strategy declares Primary / Confirmation / Higher-trend; condition rows default to Primary and show an override chip only when changed.
- **Register SMC as first-class sources**: workflow stage (`smcStage >= ready`), setup state, BOS/CHoCH confirmed, sweep completed, OB retested, zone (premium/discount), institutional score — thin adapters over `computeSmc`/`evaluateSmcScreener` snapshots (all cached on closed bar). This is grand-plan Phase 5 — "build scanners around institutional phases" — and nobody else has it.
- Rule cards visually per the plan: category tag, human sentence ("EMA20 crosses above EMA50"), TF chip, live Satisfied/Waiting state (exists), group nesting with clear indentation.

## M4 — Risk Studio + Validation engine + cadence

- **Risk Studio**: extend `ScannerStrategy.exits` → `risk` (schema v2 migration, old strategies auto-upgrade): SL (ATR mult), TP ladder (R), break-even toggle, trailing (ATR), position risk %, max daily loss %, max trades/day. UI as one section; defaults from the style profile.
- **Deterministic validation warnings** (`lib/scanner/lint.ts`, pure + tests): duplicate sources, redundant thresholds, conflicting logic (X>50 AND X<40), missing volume filter, missing higher-TF gate, too many conditions, style/TF mismatch, live-only source coverage warning, **rare trigger** (needs cadence).
- **Cadence estimator**: historical matches per week from the preview evaluation → "Expected frequency: ~4 signals/week" + powers the rare-trigger and style-mismatch warnings. Strategy Grade = weighted lint score (Grammarly-style, shown while building).

## M5 — Visual backtest

- Preview matches as **markers on the docked chart** (entry arrows, win/loss coloring, SL/TP outcome), scrub-to-signal.
- Backtest tab upgrade: equity curve + drawdown (dataviz-compliant), profit distribution histogram, MFE/MAE per trade, per-version comparison (versions already frozen with performance snapshots).
- Reuse the replay training-report math (win rate, payoff, max DD, grade) for consistency across replay and backtest.

## M6 — Strategy DNA + Quick-Add DSL + wizard polish

- **Strategy DNA** (`lib/scanner/dna.ts`, computed at save): style (declared or inferred from TFs/sources), direction, trend/momentum emphasis, SMC usage, risk profile, expected holding time + trades/period (from cadence), complexity, institutional grade. Rendered as the strategy card in My Strategies — and later the marketplace card, free.
- **Quick-Add DSL** (my addition; deterministic, no LLM): command bar parsing `RSI(14) > 55 on 15m`, `EMA20 crosses above EMA50`, `volume > 1.5x sma20`, `smc stage >= ready` → condition cards. Small grammar, full test suite, graceful "couldn't parse — try…" hints. Becomes the AI Builder's target format later.
- Wizard copy pass: every step explains WHY (the TurboTax standard); final copy audit against the governing principle.

## M7 — AI layer (post-MVP, needs server route + API key)

- **AI Coach**: server route calling Claude with the strategy JSON + DNA + lint results → critique and 1-click suggested edits (edits expressed as Quick-Add DSL, so they're inspectable before applying).
- **AI Builder**: natural language → DSL → condition tree (the DSL keeps the LLM honest and the output auditable). Explain-every-rule comes from the same categorized library descriptions.

## M8 — Marketplace + Community (post-launch, needs Supabase per launch plan)

- Publish/browse/clone/fork/rate; collections; creator profiles; GitHub-style version history view (data model already supports all of it). Strategy DNA card is the listing unit. Gate behind auth from the existing launch/monetization plan.

## Sequencing & sizing

| Milestone | Size | Ships alone? |
|---|---|---|
| M1 Intelligence home + shell | M | ✅ |
| M2 Mode split + styles | L (the big UX lift) | ✅ |
| M3 Library + TF ladder + SMC sources | M | ✅ |
| M4 Risk + lint + cadence | M | ✅ |
| M5 Visual backtest | M | ✅ |
| M6 DNA + DSL + polish | M | ✅ |
| M7 AI layer | M (post-MVP) | ✅ |
| M8 Marketplace | XL (post-launch) | ✅ |

Recommended order: M2 → M1 → M3 → M4 → M5 → M6 (M2 first: the space problem blocks everything else's usability; M1 second so the funnel exists end-to-end early). Each milestone gets its own task-level TDD breakdown when started.
