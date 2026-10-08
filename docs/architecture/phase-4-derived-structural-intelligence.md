# Phase 4: derived structural intelligence

## Architecture and authority

`lib/mtf/derivedIntelligence.ts` is a pure headless layer:

```text
raw closed primitives -> derived FVG/VWAP/POC structure -> future category intelligence
```

It is published per timeframe in `StandardMtfSnapshot.derived` under Standard schema 2 and methodology `standard-mtf/1.1.0`. It does not modify category scoring, Board, M8, M9, direction, confidence, or tradeability. Custom can use the same pure functions with a Custom-owned context; no mutable state is shared.

## FVG intelligence

The existing canonical FVG domain remains the detector and lifecycle owner. Only `active` and `partiallyMitigated` objects with `active: true` influence the current result. Mitigated, invalidated, and archived objects are historical only.

For each side the result provides count, nearest gap, raw/percent boundary distance, and price-inside state. Distance is zero inside a gap; otherwise it is the absolute distance to its nearest boundary. Ties resolve by newer creation time, then id. The domain has no canonical strength metric, so strength remains null.

| Active structure | State |
| --- | --- |
| no active FVG | `none` |
| bullish active only | `bullish` |
| bearish active only | `bearish` |
| both, inside bullish only | `bullish` |
| both, inside bearish only | `bearish` |
| both without one-sided inside state | `mixed` |
| missing closed price/history | `insufficient_data` |

## VWAP structure

Daily and weekly VWAP reuse shared anchored VWAP. Daily resets at UTC midnight and weekly at the project ISO-Monday UTC boundary. Structure and crossover remain separate. `daily > weekly` is structural; a crossover is a non-equal sign change. Equality neither emits nor resets a crossover. Comparisons within `1e-8 * max(abs(a), abs(b), 1)` are equal.

| Price / Daily / Weekly strict ordering | State |
| --- | --- |
| P > D > W | `strong_bullish` |
| P > W > D | `bullish` |
| D > P > W | `mixed` |
| D > W > P | `bearish` |
| W > P > D | `mixed` |
| W > D > P | `strong_bearish` |
| equality under tolerance | `mixed`, except clearly above/below both is `bullish`/`bearish` |
| missing daily or weekly VWAP | `insufficient_data` |

The engine also reports raw/percent price distances, daily-weekly spread, and the last `crossed_above`, `crossed_below`, or `none` event with time/bars-since. Distance alone cannot redefine state.

## POC structure

The engine consumes only Phase 3 developing 4H, daily, and weekly POCs. It does not calculate profiles, extend old POCs, or turn a prior-day POC into today's POC. Profile provenance remains estimated candle-distributed volume, not trade-level profile data.

| Price relative to 4H/D/W POCs | State |
| --- | --- |
| above all three | `fully_bullish` |
| below all three | `fully_bearish` |
| above two and above 4H POC | `bullish` |
| below two and below 4H POC | `bearish` |
| all other in-stack/equality cases | `mixed_range` |
| missing 4H, Daily, or Weekly POC | `insufficient_data` |

The result exposes descending ordering, nearest POC (tie order: 4H, Daily, Weekly), and raw/percent distances. Partial rules need majority and 4H alignment; 4H cannot alone override the stack. `mixed_range` is context only, not a trade block.

## Safety and deferrals

- All engines use raw, closed, replay-bounded Phase 3 candles.
- Genuine mixed/none is distinct from insufficient data.
- Snapshot identity includes `derivedStructuralIntelligence: phase-4/1.0.0`; publication is deep-frozen.
- Order Flow remains untouched; XAU side data and absorption remain unavailable.
- Phase 5 weighting, page redesign, setup lifecycle, execution analysis, and prohibited surfaces remain deferred.
