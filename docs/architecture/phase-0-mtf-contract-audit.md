# Phase 0 — Standard MTF contract and consumer audit

Status: complete for contract and regression-protection scope. No route, page,
navigation, or existing engine behaviour is changed by this phase.

## Official boundary

`lib/mtf/standardMtfContract.ts` is the migration boundary for Standard MTF.
It composes the existing `CompareSymbol`, `Timeframe`, `TimeframeSnapshot`,
`CategoryResult`, `EvidenceItem`, `OverallMarketState`, and `Verdict` domain
types instead of creating a second set of equivalent concepts.

The v1 boundary guarantees:

- readonly TypeScript fields plus recursive runtime freezing at publication;
- no wall-clock reads: `generatedAt` is deterministically equal to the supplied
  closed-bar `candleCutoff`;
- exact symbol isolation (`BTCUSDT` or `XAUUSD`);
- a separate candle identity for each of the six official timeframes;
- replay equivalence for an identical closed-candle prefix;
- an explicit `closed_bar` evaluation policy;
- independent schema and methodology versions;
- an explicit snapshot ID and cache key;
- cache identity over schema, methodology, symbol, cutoff, every timeframe's
  exact candle fingerprint, and the canonicalized parameter object;
- all eight official categories: trend, momentum, volume, volatility, market
  structure, volume profile, order flow, and confluence.

An official caller must pass every result-affecting option in `parameters`.
Ambient defaults are not sufficient for an official snapshot. The identity
builder rejects non-finite identity values, future candles, and non-ascending
candle sequences.

## Current dependency and consumer map

| Producer / concept | Direct production consumers | Current role |
| --- | --- | --- |
| `useMarketData` + `/api/klines` + WebSocket supervisors | Dashboard, Standard MTF, Custom MTF, Stack Score, Trade Setup, Alerts, Backtester, Journal, Strategies, Reports | Shared Binance candle/ticker path with integrity state. The REST route allowlists `BTCUSDT` and `XAUUSD`, although Binance Spot does not natively provide `XAUUSD` under that symbol. |
| `lib/mtf/registry.ts` | `lib/alignment.ts`, M8 full market pipeline | Fixed seven-indicator M0 roster and settings-aware per-timeframe evaluation. |
| `lib/alignment.ts` | Standard MTF, Custom MTF, Dashboard, Stack Score, Trade Setup, Alerts, Board/M9, Backtester/scanner helpers | Legacy cross-timeframe matrix and shared low-level input to both current pipelines. |
| `lib/multiTimeframe.ts` | Standard MTF, Custom MTF, Stack Score, Trade Setup, Alerts, Backtester | Legacy consensus, weighted score, heatmap, structure, and details. |
| Standard MTF route (`app/multi-timeframe/page.tsx`) | User-facing `/multi-timeframe` | Legacy alignment/multi-timeframe path plus daily/weekly VWAP crossover and closed-bar FVG activity. It does not consume M8 or M9. |
| Custom MTF route (`app/custom-multi-timeframe/page.tsx`) | User-facing `/custom-multi-timeframe` | Only route that composes custom indicator settings, SMC, market-structure snapshot, Board, M8 market intelligence, hierarchy/lifecycle, and M9 trade decision. |
| `computeMarketIntelligence` / `computeFullMarketIntelligence` | `components/mtf/useMarketIntelligence.ts`; `lib/mtf/decision/decisionEngine.ts`; test fixtures and intelligence panels | Canonical M8 synthesizer. The hook computes a 5m execution view and a separate six-timeframe hierarchy view. |
| `computeTradeDecision` / `computeFullTradeDecision` | `components/mtf/useTradeDecision.ts`; tests | Canonical M9 decision engine. The production hook reuses Custom MTF's already-computed Board and M8 result. The full convenience entrypoint currently has no route consumer. |
| hierarchy (`lib/mtf/timeframe/*`) | M8, lifecycle, probability, Custom MTF hierarchy panel, trade-context derivation | Canonical cross-timeframe regime/controller layer. |
| lifecycle (`lib/mtf/lifecycle/*`) | probability, M8, M9 risk-tier advisory, Custom MTF panels | Canonical stage/expectation/invalidation layer. |
| Board (`lib/mtf/board/*`) | Custom MTF and full M9 entrypoint | Sole direction authority for the canonical decision path. |
| `lib/stackScore.ts` | Dashboard | Legacy dashboard Stack Score. |
| `lib/stackScoreFactors.ts` | Stack Score, Trade Setup, Alerts | Separate seven-factor score, heuristic probability, insights, and trade grade. It is not M8 opportunity/confidence. |
| scanner live-edge Stack Score | `lib/scanner/registry.ts` | Mutable adapter exists, but no production publisher was found; `stackScore`/alignment scanner series can therefore remain null outside tests. |
| Dashboard intelligence | `/mycryptostack` | Live candle matrix + legacy Stack Score + ATR-derived paper setup. Does not consume the canonical M8/M9 result. |
| Trade Setup intelligence | `/trade-setup` | Live candles + legacy consensus/details + factor score + `generateTradeSetup`. Does not consume canonical M9. |
| Alerts | `/alerts`, `lib/alertsEngine.ts`, `lib/alertsStore.ts` | Evaluates browser-local rules against a legacy factor-score `MarketSnapshot` every five seconds. It does not consume the canonical M8/M9 snapshot. |
| SMC | Custom MTF, SMC screener/scanner, chart overlay, M9 optional confluence, replay verification | Shared pure SMC engine with a versioned config and optional live/replay provenance. Custom MTF explicitly removes the forming bar before computing it. |
| FVG | SMC, MA-FVG indicators, MT/ORB/FVG, Standard MTF activity counts | Shared `lib/fvg/domain.ts` supports raw/display sources, closed-bar policy, replay cutoff, and provenance. |
| Session Volume Profile / POC | Chart indicator and primitive, historical POC store, incremental cache, profile-shape classifier | Chart-only analytical path today; it is not part of M8/M9 or either MTF aggregation contract. Source tier/provenance exists, and the incremental cache includes session/profile/source parameters. |
| separate context decision engine (`lib/context/*`) | volume-distribution indicators, Market Context widget, VD trade panels, scanner workstation context | Independent from M9. It produces context-gated indicator decisions and is a naming/authority collision risk during migration. |

## Data provenance classification

This phase leaves all datasets in place.

### Live or historical exchange-backed

- Dashboard, Standard MTF, Custom MTF, Stack Score, Trade Setup, Alerts,
  Backtester, Journal header, Strategies header, and Reports header all attach to
  the shared Binance REST/WebSocket market-data path.
- Backtester results are computed from loaded historical candles; its built-in
  library metadata is static, but a run result is not fabricated.
- Browser alert rules for the currently selected symbol are evaluated from the
  current in-browser market snapshot. Delivery toggles other than browser are
  preferences only; no external delivery integration was found.
- Session Volume Profile/POC is computed from candle volume. Its default fast
  tier distributes a candle's volume across its high-low range, so it is an
  estimate rather than trade-at-price volume; provenance types already expose
  that distinction.

### Derived/generated values presented with empirical wording

- Trade Setup labels `factorsResult.probability` as “Historical Win Rate” and
  derives “Sample Size”, wins, and losses arithmetically from confidence. There
  is no matching outcome dataset behind those numbers.
- Stack Score labels the factor engine's heuristic probability as “Probability
  of Success” and “Historical Win Rate (Similar)”. No sample cohort is supplied.
- Positions contains fixed probability, historical-resolution, position-health,
  lifecycle, correlation, and performance claims. The page now carries a
  “Representative” badge, but several nested panels still say “Live”.
- Strategies mixes a genuinely live BTC indicator reading with static strategy
  health, win-rate/trade-count claims, opportunities, lessons, and a “Live
  Opportunity Scanner” label.
- Alert evaluation for rules whose symbol differs from the selected symbol
  reuses the selected symbol's snapshot after changing only the symbol label;
  the displayed alert score is synthesized from the threshold.

### Explicit static/representative/demo fixtures

- Alert Analytics totals, success rates, and performance chart are hard-coded
  and the panel is explicitly badged “representative”. Default alert rows are
  seeded locally with relative timestamps.
- Journal uses a deterministic 268-entry sample journal when real paper history
  is thin; the fixed sample anchor is documented in code.
- Reports is backed by static exported tables, KPIs, portfolio/risk values,
  coaching copy, goals, calendars, exports, and saved-report names.
- Strategies' catalog, comparison data, opportunities, and learning content are
  static exports.
- Positions' portfolio snapshot, allocation, position rows, MTF arrows, alerts,
  scenario values, and most analytics are representative constants.
- Backtester's built-in strategy-library win rates and profit factors are static
  presets; run output is separately computed from candles.
- `/sample` and `/craft` are prototype/sample surfaces with static datasets.

## Regression protection

- `lib/mtf/market/marketEngine.golden.test.ts` pins the complete canonical M0→M8
  output for deterministic six-timeframe candles.
- `lib/mtf/decision/decisionEngine.golden.test.ts` pins the Board, M8 market
  result, and M9 decision for deterministic six-timeframe candles.
- The fixtures are snapshot baselines, not claims of external market-methodology
  correctness. Refresh requires the explicit `UPDATE_GOLDEN=1` flag.
- `lib/mtf/standardMtfContract.test.ts` protects canonical parameter ordering,
  symbol/method/cutoff/parameter/input cache isolation, per-timeframe isolation,
  replay equivalence, closed-input validation, and recursive runtime freezing.

## Known architectural risks before Phase 1

1. There are two user-facing MTF truths. Standard MTF/Dashboard/Stack Score/Trade
   Setup/Alerts use the legacy alignment family, while Custom MTF alone consumes
   the canonical Board/M8/M9 stack.
2. Some legacy consumers evaluate the full arrays supplied by `useMarketData`,
   including the forming bar. They cannot publish an official Standard snapshot
   until a shared closed-bar adapter owns the cutoff.
3. M8 currently has no symbol, cutoff, methodology, snapshot ID, cache identity,
   or parameter manifest in its output. M9 has only an execution-timeframe
   closed-bar timestamp.
4. M8's M2 category engine owns six categories (`quality` and `participation`
   included); the official Standard boundary owns eight and needs explicit
   adapters for market structure, volume profile, order flow, and confluence.
5. `useMarketIntelligence` memoizes primarily by last-closed timestamp, not an
   exact input/parameter fingerprint. Corrected candles with unchanged timestamps
   can reuse stale computations.
6. `XAUUSD` is allowed by the UI/API contract but is sent directly to Binance
   Spot, where that native symbol is unavailable. The new contract isolates the
   symbol but does not solve data-source mapping.
7. “Decision engine” names refer to both canonical M9 and the independent
   volume-distribution context engine. Migration must preserve their distinct
   responsibilities.
8. SMC and FVG have replay/provenance concepts; the legacy alignment, Stack
   Score, Alerts, and M8 outputs do not yet share one evaluation identity.
9. Session Volume Profile/POC has strong local cache provenance but remains
   chart-only and uses estimated candle-volume distribution at its default tier.
10. Several UI claims use empirical language for heuristic/static values. They
    should be relabeled or connected to measured outcome datasets in a later
    authorized phase.

## Files inspected

- Routes/navigation: `components/stack/StackSidebar.tsx`; `app/mycryptostack`,
  `app/multi-timeframe`, `app/custom-multi-timeframe`, `app/stack-score`,
  `app/trade-setup`, `app/alerts`, `app/backtester`, `app/journal`,
  `app/positions`, `app/strategies`, `app/reports`, `app/sample`, and `app/craft`.
- Canonical MTF: registry/definitions/category, agreement, confidence, timeframe,
  hierarchy, lifecycle, probability, market, board, decision, structure, FVG
  activity, VWAP crossover, hooks, UI panels, fixtures, and their tests under
  `lib/mtf/**` and `components/mtf/**`.
- Legacy intelligence: `lib/alignment.ts`, `lib/multiTimeframe.ts`,
  `lib/stackScore.ts`, `lib/stackScoreFactors.ts`, `lib/tradeSetup.ts`, and
  `lib/setupBacktest.ts`.
- Domain engines: `lib/smc/**`, `lib/fvg/domain.ts`,
  `lib/indicators/sessionVolumeProfile*`, `lib/indicators/profileDataProvider.ts`,
  `lib/indicators/historicalPocStore.ts`, `lib/context/**`, and alert modules.
- Data/provenance: `lib/hooks/useMarketData.ts`, `lib/hooks/useMoodEngine.ts`,
  `lib/hooks/useMarketState.ts`, `lib/fetcher.ts`, `app/api/klines/route.ts`,
  `lib/dataSource/**`, `lib/marketDataIntegrity.ts`, `lib/marketDataTrust.ts`,
  and `lib/historicalRequestIdentity.ts`.
- Static/generated sources: `lib/journalEngine.ts`, `lib/reportsEngine.ts`,
  `lib/strategiesEngine.ts`, and page-local constants listed above.
- Project/test guidance: `AGENTS.md`, `package.json`, `tsconfig.json`,
  `vitest.config.ts`, `docs/architecture/mtf-engine.md`, related MTF design docs,
  existing golden-test helpers, and Next 16's installed Vitest guide.

