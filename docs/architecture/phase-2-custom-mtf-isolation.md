# Phase 2 — Custom MTF isolation

## Boundary

Standard MTF remains the fixed Board -> M8 -> M9 -> StandardMtfSnapshot route.
Custom MTF is a separate configurable workspace. It can call the same pure
indicator and SMC primitives, but it cannot publish a Standard snapshot or
contribute settings, identity, cache keys, or persistence to Standard MTF.

## Dependency map before migration

| Custom MTF concern | Previous source | Phase 2 owner/disposition |
| --- | --- | --- |
| Indicator controls | page-local IndicatorSettingsMap | immutable CustomMtfConfig.indicatorSettings |
| Structure timeframe | custom_mtf_structure_tf localStorage key | config.workspace.structureTimeframe |
| SMC toggle | page-local React state | config.workspace.smcEnabled |
| SMC configuration | shared default passed implicitly | config.smc.config cloned and frozen per Custom config |
| Alignment matrix | shared pure alignment function | Custom workspace result with config fingerprint |
| SMC memoization | page-local Map keyed only by closed timestamp | Custom cache key with namespace, config, symbol, TF, OHLCV, mode/replay |
| M8/M9 panels | local hooks, default engine inputs | Custom analysis context only; cache scope includes Custom identity |
| URL/query state and context providers | none | none |

No Custom MTF configuration import was found in Standard MTF, setup, or alert
code. The existing Custom page uses a fixed product symbol and no query-state
or replay control. The workspace service nevertheless accepts explicit live or
replay identities for future wiring.

## Persistence

The only current key is mycryptostack.customMtf.config.v1. It can safely
migrate the two former Custom-only keys on first load. Malformed JSON and
unknown schemas reset Custom state; no Standard key is read or written.

## Cache identity

Custom cache keys are namespaced custom-mtf and contain schema/methodology,
symbol, timeframe, mode, replay session/cutoff, candle cutoff and full OHLCV
fingerprint, plus Custom configuration fingerprint. Standard cache keys retain
their independent standard-mtf namespace and methodology.

## Configuration scope

The existing UI still exposes SuperTrend, RSI, MACD, and ADX controls only.
EMA settings are supported by the Custom config API for migration/future UI,
while Standard uses its unchanged no-settings EMA defaults. SMC/FVG defaults
are cloned into Custom config but no new SMC/FVG controls were added in Phase 2.
MA-FVG has no persisted user setting on this page and remains a shared pure
signal primitive.

## Deferred risks

Custom M8/M9 display panels still use reusable canonical computation primitives
as Custom analysis context; they are not official publication outputs. A future
workspace-specific result model may consolidate those panels. XAUUSD transport,
official setup adapters, POC/FVG expansion, and other consumer migrations remain
out of scope.
