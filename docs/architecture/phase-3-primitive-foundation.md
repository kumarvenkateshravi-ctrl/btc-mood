# Phase 3: reusable primitive foundation

## Scope and authority

`lib/mtf/primitiveFoundation.ts` is a pure, raw-candle, closed-bar adapter layer. It composes existing indicators, SMC, FVG, Session Volume Profile, and taker-side flow; it does not calculate category weights, alter decisions, or publish a Standard snapshot.

Standard MTF remains owned by the versioned Board -> M8 -> M9 service. The new primitives are deliberately not wired into the currently unavailable Standard `marketStructure`, `volumeProfile`, or `orderFlow` categories. Custom remains isolated by its namespace and config fingerprint; this foundation does not import the Standard snapshot contract.

## Inventory and action matrix

| Indicator/family | Existing implementation/tests | Existing Standard/Custom use | Incremental, closed, replay | Canonical primitive and action |
| --- | --- | --- | --- | --- |
| EMA, SuperTrend, ADX | MTF evaluators + tests | Standard and Custom | caller-closed, deterministic | reuse; ADX direction is always null |
| SMA, VWAP | `pineMath.sma`; VWAP golden/crossover tests | Custom; VWAP presentation | deterministic, UTC VWAP anchors | reuse as raw/closed adapters |
| RSI, MACD | MTF evaluators + tests | Standard and Custom | caller-closed | reuse with oscillator state |
| Stoch RSI, ROC, CCI | RSI chart engine; `pineMath.cciSeries` | none | raw/closed/replay-bounded | add small compositions; CCI reuses shared math |
| Williams %R | chart primitive + golden | Custom | deterministic | reuse oscillator adapter |
| Volume, OBV, Spike | chart/MTF primitives + tests | Standard and Custom split | deterministic | reuse; volume remains activity |
| Volume SMA, CMF | `pineMath.sma` | none | raw/closed/replay-bounded | add deterministic adapters |
| ATR, Bollinger, Keltner, Std Dev | chart primitives/goldens | Custom | deterministic | reuse |
| Donchian, Squeeze | screener/channel and squeeze primitive tests | scanner/Custom | deterministic | add channel-width adapter; squeeze derived from BB/KC |
| S/R, zones, BOS, CHoCH, swings, sweeps | SMC goldens/lifecycle tests | Custom/scanner | context-closed and replay aware | SMC adapter only; no second structure engine |
| FVG | shared domain tests | Custom/presentation | raw, closed, replay aware | reuse FVG domain/lifecycle |
| 4H/D/W POC, prior-day shape | SVP, incremental cache, provenance/history/shape tests | Custom | UTC, raw/replay bound, cache | reuse profile builder/cache |
| Taker-side flow | daily/order-flow tests | live widget | real side input only | reuse semantics; unavailable when side input is absent |
| Fibonacci | fib-pivot display primitive | Custom | deterministic period pivots | defer MTF intelligence; no approved swing-anchor policy |

## Standard and Custom configuration matrix

| Primitive | Standard fixed parameters | Custom parameters | Shared primitive | Cache identity |
| --- | --- | --- | --- | --- |
| EMA | 20/50/200 | persisted fast/slow/long | MTF EMA evaluator | Standard schema/method/closed inputs/parameters; Custom config and candle fingerprints |
| SuperTrend | ATR 10, multiplier 3 | persisted atrPeriod/mult | MTF SuperTrend evaluator | same |
| RSI | 14 | persisted length | MTF RSI evaluator | same |
| MACD | 12/26/9 | persisted fast/slow/signal | MTF MACD evaluator | same |
| ADX | DI 14 | persisted DI length | MTF ADX evaluator | same |
| OBV, Volume | fixed M2 defaults | no Phase 3 persistence change | existing MTF/chart evaluators | same |
| SMA, VWAP, Stoch RSI, ROC, Williams %R, CCI, CMF, Volume SMA, ATR, bands/channels, Std Dev | not consumed by Standard methodology | safe existing settings accepted by pure adapter; no UI/storage added | existing chart primitives or pine math | no Standard identity until approved; Custom must include caller settings in its config fingerprint |
| SMC/FVG | not Standard category inputs | Custom SMC config / caller FVG policy | canonical domains | Custom identity plus policy/config |
| POC | not Standard category input | existing SVP settings | existing session profile cache | provider identity includes symbol/source timeframe/revision/mode/replay; cache scope includes profile options |
| Taker flow | not Standard category input | no UI change | existing daily flow semantics | source provenance plus caller identity |

The Standard identity is unchanged from Phase 1. This module never reads primitive settings while constructing an official snapshot, so Custom settings cannot change one.

## Safety, lifecycle, and availability

- Every adapter selects raw, closed candles and bounds replay at `replay.cutTime`; display transforms cannot alter VWAP, POC, FVG, or SMC.
- Insufficient history returns `insufficient_data`, null value, and null direction. It does not silently emit a directional or neutral decision.
- ADX and volume activity have null direction. ADX cannot flip trend; volume cannot be labelled buying/selling aggression.
- POC uses UTC 4-hour, daily, and ISO-week/Monday buckets. Current periods are developing; previous-day shape comes only from the finalized preceding profile. No line is extended from yesterday into today.
- Completed POC sessions use the existing incremental cache; active sessions recompute from their tail by design. Cache scope contains source provenance and profile options.
- Structure is SMC only. The adapter zeroes non-semantic `computeMs` telemetry so identical analytical inputs produce equal reusable structure output; the underlying engine still exposes performance measurement.
- FVG uses the existing raw, closed `DEFAULT_FVG_POLICY` and preserves active/partial/mitigated/invalidated/archived lifecycle states.
- Taker volume is valid only when every closed candle has finite `0 <= takerBuyVolume <= volume`. Delta, cumulative delta, imbalance, and bar-level aggression are then sourced from Binance kline taker-buy base volume. Absorption is always unavailable: it requires trade-at-price or order-book data. Candle colour is never used to infer side.

## Explicit deferrals

- Full FVG Intelligence, Daily/Weekly VWAP Structure, and POC Stack/POC Structure remain Phase 4 work. The reusable data exists, but no final weights were invented.
- Fibonacci MTF intelligence remains deferred because the existing period-pivot renderer is not an approved deterministic swing-anchor policy.
- No page redesign, Standard category weighting, Dashboard/Journal/Performance/navigation/execution change, XAU transport, static-data label, probability wording, Elephant Zone, or paperStore behavior changed.
