# ZoneSummary API — Developer Reference

`summarizeZones()` is the machine-readable seam over the Supply/Demand Zones
indicator. It builds the same non-repainting zones the chart draws, scores each
one, and returns a flat, ranked list of the **currently active** zones — one per
`(timeframe, zone-kind)` — for downstream consumers (primarily the planned **AI
Confluence Engine**) to reason about without re-deriving zone geometry or reading
any chart/rendering code.

- **Module:** `lib/indicators/sdZones.ts`
- **Depends on:** `lib/indicators/htf.ts` (HTF resampling), `lib/indicators/zoneStrength.ts` (scoring)
- **Purity:** pure function — no chart, DOM, or framework dependencies. Safe to
  call from a server route, a worker, or an engine module.
- **Consistency guarantee:** `summarizeZones` and the indicator's
  `computeSdZones` share the same internal `buildZones` + `scoreZone` steps, so
  the numbers an engine sees can never drift from what the chart renders.

## Signature

```ts
import { summarizeZones, type ZoneSummary, type SdZonesConfig } from '@/lib/indicators/sdZones';
import type { Candle } from '@/lib/types';

function summarizeZones(candles: Candle[], cfg: SdZonesConfig): ZoneSummary[];
```

### `SdZonesConfig`

```ts
interface SdZonesConfig {
  tfs: HtfPeriod[];                        // '4H' | 'D' | 'W' | 'M', one or more
  targetFactor: number;                    // projection multiple for target zones (default 1.5)
  weights?: Partial<ZoneStrengthWeights>;  // optional strength-weight overrides
}
```

- `tfs` — the higher timeframes to derive zones from. Passing more than one TF is
  what enables the `isMultiTimeframeConfluence` signal (a zone can only be in
  confluence with a same-kind zone on a *different* active TF).
- `targetFactor` — supply/demand **target** zones project by
  `range × targetFactor` beyond the prior period's high/low.
- `weights` — override any of the six strength weights; unspecified weights fall
  back to `DEFAULT_ZONE_STRENGTH_WEIGHTS`. Weights are normalized internally, so
  they need not sum to 1.

Returns `[]` for empty input or when no timeframe has ≥2 completed periods yet.

## `ZoneSummary` fields

```ts
interface ZoneSummary {
  zoneType: 'supply' | 'demand';
  kind: 'supply' | 'supplyTarget' | 'demand' | 'demandTarget';
  tf: '4H' | 'D' | 'W' | 'M';
  upper: number;
  lower: number;
  mid: number;
  zoneStrength: number;                 // 0..100
  tier: 'weak' | 'medium' | 'strong';
  factors: Record<ZoneFactor, number>;  // each 0..1
  distanceToPrice: number;              // signed %
  isMultiTimeframeConfluence: boolean;
  retestCount: number;
  formedAtIndex: number;
  formedTime: number;                   // unix seconds
}
```

| Field | Type | Meaning |
|---|---|---|
| `zoneType` | `'supply' \| 'demand'` | Simplified side. Supply = resistance-side (a supply or supplyTarget zone); demand = support-side. Use this for coarse bias. |
| `kind` | 4 values | Exact zone role. `supply`/`demand` are the primary reaction zones from the prior period's body-to-wick; `supplyTarget`/`demandTarget` are projected extensions (measured-move targets), not reaction zones. |
| `tf` | `'4H' \| 'D' \| 'W' \| 'M'` | Higher timeframe the zone was derived from. |
| `upper`, `lower` | `number` | Zone price bounds (`upper ≥ lower`). |
| `mid` | `number` | `(upper + lower) / 2`. Convenient single reference price. |
| `zoneStrength` | `0..100` | Overall importance score (weighted blend of `factors`). Higher = more significant. Rank/filter on this. |
| `tier` | `'weak' \| 'medium' \| 'strong'` | Bucketed `zoneStrength`: `<40` weak, `40–70` medium, `>70` strong. For quick thresholding without magic numbers. |
| `factors` | `Record<ZoneFactor, number>` | The six normalized (0..1) inputs behind the score — `formationVolume`, `rejectionStrength`, `retests`, `freshness`, `confluence`, `zoneWidth`. Exposed for explainability and for an engine that wants to re-weight or reason per-factor. |
| `distanceToPrice` | signed `%` | `((mid − lastClose) / lastClose) × 100`. Positive = zone sits **above** the last close (overhead supply); negative = **below** (support beneath). Use for proximity ranking. |
| `isMultiTimeframeConfluence` | `boolean` | `true` when this zone's price range overlaps a **same-kind** zone on another active TF (e.g. Daily supply overlapping Weekly supply). A strong corroboration signal. |
| `retestCount` | `number` | Raw count of distinct price touches of the zone after formation (a run of consecutive in-zone bars counts once). Unlike the normalized `factors.retests`, this is the uncapped integer. |
| `formedAtIndex` | `number` | Index into the input `candles` where the zone became active (the bar that opened the new HTF period). |
| `formedTime` | `number` | Unix **seconds** timestamp of the prior period that defined the zone. |

### `ZoneFactor` weights (for `cfg.weights`)

`formationVolume`, `rejectionStrength`, `retests`, `freshness`, `confluence`,
`zoneWidth`. Defaults live in `DEFAULT_ZONE_STRENGTH_WEIGHTS`
(`lib/indicators/zoneStrength.ts`): confluence 0.25, rejection 0.22, volume 0.18,
retests 0.13, zoneWidth 0.12, freshness 0.10.

## Intended AI usage

The AI Confluence Engine is expected to consume `ZoneSummary[]` as a compact,
pre-scored feature set — no candle scanning or geometry math required on its side:

1. **Rank candidate levels.** Sort by `zoneStrength` (or filter by `tier`) to pick
   the few zones worth reasoning about, instead of feeding raw price history.
2. **Bias & proximity.** Combine `zoneType` with `distanceToPrice` to describe the
   nearest overhead supply and underlying demand relative to current price.
3. **Corroboration.** Treat `isMultiTimeframeConfluence === true` (and/or a high
   `factors.confluence`) as multi-TF agreement — a stronger, more trustworthy
   level than a single-TF zone.
4. **Explainability.** Surface the top contributing `factors` (e.g. "strong because
   of high rejection + weekly confluence") so any AI narrative is grounded in the
   same numbers the chart shows.
5. **Freshness/decay.** `factors.freshness` and `formedTime` let the engine
   discount stale zones or prefer recently formed ones.

### Example

```ts
import { summarizeZones } from '@/lib/indicators/sdZones';

const zones = summarizeZones(candles, { tfs: ['D', 'W'], targetFactor: 1.5 });

// Strongest overhead supply within 3% of price:
const nearbySupply = zones
  .filter((z) => z.zoneType === 'supply' && z.distanceToPrice > 0 && z.distanceToPrice < 3)
  .sort((a, b) => b.zoneStrength - a.zoneStrength)[0];

// High-confidence, multi-TF-confirmed levels only:
const confirmed = zones.filter((z) => z.tier !== 'weak' && z.isMultiTimeframeConfluence);
```

## Notes & caveats

- **Non-repainting.** Zones derive only from *completed* prior HTF periods, so a
  zone's geometry never changes after it forms. `distanceToPrice`, `retestCount`,
  and the score do update as new bars arrive (they depend on the latest price).
- **Target zones are projections,** not reaction zones — weight `supplyTarget` /
  `demandTarget` accordingly (an engine may choose to ignore them for entries).
- **Confluence is same-kind only** — a projected target never inflates a real
  reaction zone's confluence.
- **Timestamps are unix seconds** (matching `Candle.time`), not milliseconds.
