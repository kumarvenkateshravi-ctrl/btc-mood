# Elephant Zone — pivot line — design

Extends the existing Elephant Zone indicator (`lib/indicators/elephantZone.ts`,
design: `docs/superpowers/specs/2026-07-25-elephant-zone-design.md`) with a single
central pivot line. Additive only — the 4 resistance + 4 support zones are unchanged.

## Decision (brainstormed 2026-07-27)

- **Pivot = the zone anchor = previous day's close** (Option A). This is the exact
  price the 4R/4S ladder is already centered on, so the pivot is literally the
  ladder's axis and can never drift out of sync with the zones. (Declined: the
  classic floor-trader `(H+L+C)/3` pivot — it would sit off-center and read as an
  independent reference, which is not what's wanted here.)
- **Look:** a dashed horizontal line in its own neutral/gold color (distinct from
  the orange resistance / green support fills), carrying a "Pivot" label. Resets
  each UTC day; draws nothing on the first day of history (no prior close), exactly
  like the zones.
- **Out of scope:** no pivot-derived R1/S1/R2/S2 levels — just the one center line.

## Implementation

- **Reuse `anchorForDay`.** The pivot value for any bar is `anchorForDay.get(dayKeys[i])`
  — the same map that already positions the zones. No new anchor computation, so the
  pivot is guaranteed consistent with the ladder center.
- **Render via the existing band primitive** (the same one the zones use), as a thin
  band centered on the anchor drawn as a dashed labeled centerline:
  `data[i] = { upper: anchor + PIVOT_HALF, lower: anchor - PIVOT_HALF }` with
  `zoneStyle: { lineStyle: 'dashed', mid: true, label: 'Pivot' }`. Using the band
  primitive (not a line series) gives clean per-day segments with no cross-day
  connector line, and keeps the entire feature inside `elephantZone.ts` — **zero
  changes to shared chart code** (`useChartData`, primitives, etc.). `PIVOT_HALF`
  is a small fixed visual half-height so the dashed centerline always renders.
- **New plot:** id `PIVOT`, `type: 'band'`, `pane: 'overlay'`, emitted after the 8
  zone plots (9 plots total). Null on the first day / outside any anchored day.
- **New config field:** `pivotColor` added to `ElephantZoneInputs` +
  `ELEPHANT_ZONE_DEFAULTS` (default a neutral gold, e.g. `rgba(230,200,120,0.9)`).
  Zone levels / width untouched.
- **Registry (`lib/customIndicatorsLibrary.ts`):** add a `pivotColor` input and a
  `PIVOT` entry to the `styles` array so the pivot gets a color picker + show/hide
  toggle in the settings modal, consistent with every other plot.

## Testing

Extend `lib/indicators/elephantZone.test.ts` (self-consistency only — still no Pine
source to prove parity against, same honesty caveat as the base indicator):

- The `PIVOT` plot exists and is the 9th plot; total plot count is 9.
- Pivot band is centered on the day's anchor: for a bar in day D, `(upper+lower)/2`
  equals `anchorForDay(D)` (= the previous day's last close).
- Pivot is `null` for every bar of the first day (no prior close).
- Pivot resets at the UTC boundary: day 1 pivot = day 0's close, day 2 pivot = day 1's close.
- Empty candles → no throw, no pivot plot beyond the guarded empty return.
