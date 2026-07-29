// "Jumbo Zones" — the creator's official Elephant Edge model (steps 1-7 + freeze).
// A SEPARATE indicator from `elephant_zone` (kept for comparison). No Pine source
// exists; this is a best-effort reconstruction from the creator's documentation.
//
// Model: each new UTC session, anchor = today's session OPEN. From the last N
// PRIOR sessions' expansion (bull = high-open, bear = open-low), take a robust
// average (median default), then percentile-pair bands around the open:
//   R1 = [O + ER·21%, O + ER·29%], R2 = [O + ER·53%, O + ER·62%]  (ER = bull exp)
//   S1/S2 mirror below with ES (bear exp). directional (separate bull/bear) or
//   symmetric ((EB+ES)/2). Bands validated (min/max), frozen per session,
//   non-repainting. Plus prev-close & HLC/3 pivots.
// Design: docs/superpowers/specs/2026-07-29-elephant-zone-v2-expansion-percentile-design.md

import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorPlot, IndicatorResult, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

const SECONDS_PER_DAY = 86400;

export interface ZoneBand { lower: number; upper: number; }

/** Median of a numeric array (0 for empty). */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The 4 Jumbo zone bands from the session open + resistance/support expansion +
 *  inner/outer percentile pairs (percent values, e.g. [21,29]). Each band is
 *  min/max-validated so it never flips. */
export function expansionZones(
  open: number,
  resistExp: number,
  supportExp: number,
  inner: [number, number],
  outer: [number, number],
): { R1: ZoneBand; R2: ZoneBand; S1: ZoneBand; S2: ZoneBand } {
  const band = (a: number, b: number): ZoneBand => ({ lower: Math.min(a, b), upper: Math.max(a, b) });
  const [p1, p2] = inner;
  const [p3, p4] = outer;
  return {
    R1: band(open + resistExp * (p1 / 100), open + resistExp * (p2 / 100)),
    R2: band(open + resistExp * (p3 / 100), open + resistExp * (p4 / 100)),
    S1: band(open - supportExp * (p1 / 100), open - supportExp * (p2 / 100)),
    S2: band(open - supportExp * (p3 / 100), open - supportExp * (p4 / 100)),
  };
}
