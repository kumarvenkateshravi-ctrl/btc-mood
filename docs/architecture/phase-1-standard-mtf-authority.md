# Phase 1 — Standard MTF authority boundary

## Official route

The Standard MTF page is a consumer of the Standard MTF snapshot service through
the useStandardMtf hook. The service selects an exact closed-bar prefix, creates
its identity from complete OHLCV inputs, evaluates the existing canonical
Board -> M8 Market -> M9 Decision path, and publishes a deeply frozen
StandardMtfSnapshot.

The page must not use its display data to replace the official direction,
market state, confidence, tradeability, or canonical Board/M8/M9 objects. M9
direction remains the Board's direction.

The service's candlesAreClosed option is additive. Existing M8 and M9 callers
still use their prior default of dropping the final forming bar; Phase 0 golden
tests therefore remain the regression boundary for the pre-existing engines.

## Identity and replay

Identity includes schema, methodology, symbol, closed-bar evaluation policy,
global and per-timeframe cutoffs, every selected candle's timestamp/OHLCV/taker
buy volume, and explicit result-affecting service parameters. The candle
fingerprint catches corrections with unchanged timestamps. No wall-clock time
participates in identity.

Replay selection is not encoded as an ambient mode. A replay and a live
evaluation with the same bounded closed candle set and configuration resolve to
the same identity and cache key.

## Standard MTF category publication

Trend, Momentum, Volume, and Volatility reuse M2's category results after the
minimum closed-bar requirement is met. The following are explicit unavailable
categories, with null score/verdict and no signals; they are never neutral
placeholders:

| Category | Phase 1 disposition |
| --- | --- |
| Market Structure | Unavailable: no published canonical category adapter |
| Volume Profile | Unavailable: no published Session Volume Profile / POC adapter |
| Order Flow | Unavailable: no published Order Flow adapter |
| Confluence | Unavailable: no published canonical confluence adapter |

Chart-only POC, SMC, FVG, and Session Volume Profile calculations are not
integrated into the official snapshot in this phase.

## Legacy Standard MTF display inventory

| Existing Standard MTF output | Classification | Phase 1 disposition |
| --- | --- | --- |
| Alignment matrix | A — canonical Board input | Service computes it only to supply Board; page shows it as presentation |
| Board direction / conviction | A — canonical authority | Published in the official snapshot |
| M8 market intelligence | A — canonical authority | Published in the official snapshot |
| M9 trade decision | A — canonical authority | Published in the official snapshot |
| M2 trend/momentum/volume/volatility | A — canonical category results | Published when sufficiently sampled |
| Consensus counts, weighted score, summary bands, heatmap | B — display-only legacy derivations | Retained under presentation; cannot override official fields |
| Per-timeframe detail values and structure mini-view | B — display-only legacy derivations | Retained under presentation; structure category remains unavailable |
| Daily/weekly VWAP and active FVG rows | B — display-only chart adjuncts | Retained under presentation; not evidence or category inputs |
| Any page-local direction, consensus, or score used as a decision | C — competing authority bypass | Removed from Standard MTF official path |

## Explicit non-migration decisions

The context decision engine remains an evidence/context engine. It is not the
Standard MTF official route and was neither rewritten nor deleted.

Dashboard, Stack Score, Trade Setup, Alerts, Scanner, Backtester, Journal,
Performance, navigation, Custom MTF, the paper store, and the Elephant Zone
files are outside Phase 1 and unchanged.

## Known data-provider debt

The snapshot is symbol-isolated and accepts the existing CompareSymbol union,
but it does not solve XAUUSD feed acquisition. It also contains no Binance
venue identifier. Data-source availability/provenance remains an upstream
market-data responsibility and must be resolved in a later phase before XAUUSD
is represented as live.
