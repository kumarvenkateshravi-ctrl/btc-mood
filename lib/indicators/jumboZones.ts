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

export type AvgMethod = 'median' | 'mean';
export type ExpansionMode = 'directional' | 'symmetric';

export interface JumboZonesInputs {
  /** Prior sessions to average expansion over. */
  sessionLookback: number;
  avgMethod: AvgMethod;
  /** directional = separate bull/bear expansion; symmetric = mean of both. */
  expansionMode: ExpansionMode;
  /** Inner/outer percentile pairs (percent values). */
  innerLow: number;
  innerHigh: number;
  outerLow: number;
  outerHigh: number;
  showResistance: boolean;
  showSupport: boolean;
  showPivot: boolean;
  showPivotP: boolean;
  upperColor: string;
  lowerColor: string;
  pivotColor: string;
  pivotPColor: string;
  pivotLineWidth: number;
}

export const JUMBO_ZONES_DEFAULTS: JumboZonesInputs = {
  sessionLookback: 20,
  avgMethod: 'median',
  expansionMode: 'directional',
  innerLow: 21,
  innerHigh: 29,
  outerLow: 53,
  outerHigh: 62,
  showResistance: true,
  showSupport: true,
  showPivot: true,
  showPivotP: true,
  upperColor: 'rgba(176,124,64,1)',  // amber resistance
  lowerColor: 'rgba(64,150,108,1)',  // green support
  pivotColor: 'rgba(80,190,240,1)',  // cyan (prev close)
  pivotPColor: 'rgba(99,102,241,1)', // indigo (HLC/3)
  pivotLineWidth: 3,
};

export function computeJumboZones(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<JumboZonesInputs>(config, JUMBO_ZONES_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const dayOf = (t: number) => Math.floor(t / SECONDS_PER_DAY);
  const dayKeys = candles.map((c) => dayOf(c.time));
  const dayEndsAt = (i: number) => i + 1 < n && dayKeys[i + 1] !== dayKeys[i];

  // Anchor pivot (previous day's last close).
  const anchorForDay = new Map<number, number>();
  for (let i = 1; i < n; i++) {
    const day = dayKeys[i];
    if (dayKeys[i - 1] !== day && !anchorForDay.has(day)) {
      anchorForDay.set(day, candles[i - 1].close);
    }
  }

  // Per-day session aggregate: open (first bar), high (max), low (min), close (last).
  const dayAgg = new Map<number, { open: number; high: number; low: number; close: number }>();
  const orderedDays: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dayKeys[i];
    const a = dayAgg.get(d);
    if (!a) { dayAgg.set(d, { open: candles[i].open, high: candles[i].high, low: candles[i].low, close: candles[i].close }); orderedDays.push(d); }
    else { a.high = Math.max(a.high, candles[i].high); a.low = Math.min(a.low, candles[i].low); a.close = candles[i].close; }
  }
  const dayIndexOf = new Map<number, number>(orderedDays.map((d, idx) => [d, idx]));

  const avg = inp.avgMethod === 'mean'
    ? (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    : median;

  // Zones per day from the last `sessionLookback` PRIOR sessions' expansion.
  const zonesForDay = new Map<number, ReturnType<typeof expansionZones>>();
  for (const day of orderedDays) {
    const p = dayIndexOf.get(day)!;
    if (p <= 0) continue; // no prior session
    const from = Math.max(0, p - inp.sessionLookback);
    const bull: number[] = [];
    const bear: number[] = [];
    for (let q = from; q < p; q++) {
      const a = dayAgg.get(orderedDays[q])!;
      bull.push(a.high - a.open);
      bear.push(a.open - a.low);
    }
    const EB = avg(bull);
    const ES = avg(bear);
    const resistExp = inp.expansionMode === 'symmetric' ? (EB + ES) / 2 : EB;
    const supportExp = inp.expansionMode === 'symmetric' ? (EB + ES) / 2 : ES;
    const O = dayAgg.get(day)!.open;
    zonesForDay.set(day, expansionZones(O, resistExp, supportExp, [inp.innerLow, inp.innerHigh], [inp.outerLow, inp.outerHigh]));
  }

  const plots: IndicatorPlot[] = [];

  // Zone bands — each day is a separate run (different upper/lower), so the band
  // primitive draws one rectangle per session; no day-boundary null needed.
  const pushZone = (id: string, pick: (z: ReturnType<typeof expansionZones>) => ZoneBand, color: string, boundary: 'lower' | 'upper') => {
    const data = new Array<{ upper: number; lower: number } | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const z = zonesForDay.get(dayKeys[i]);
      if (!z) continue;
      const b = pick(z);
      data[i] = { upper: b.upper, lower: b.lower };
    }
    plots.push({ id, title: id, color, type: 'band', pane: 'overlay', data, zoneStyle: { boundary, lineStyle: 'solid', emphasis: 0 } });
  };
  if (inp.showResistance) {
    pushZone('R1', (z) => z.R1, inp.upperColor, 'lower');
    pushZone('R2', (z) => z.R2, inp.upperColor, 'lower');
  }
  if (inp.showSupport) {
    pushZone('S1', (z) => z.S1, inp.lowerColor, 'upper');
    pushZone('S2', (z) => z.S2, inp.lowerColor, 'upper');
  }

  // Pivots (pixel-width lines, day-boundary break).
  if (inp.showPivot) {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const anchor = anchorForDay.get(dayKeys[i]);
      if (anchor == null) continue;
      data[i] = dayEndsAt(i) ? null : anchor;
    }
    plots.push({ id: 'PIVOT', title: 'Pivot', color: inp.pivotColor, type: 'line', pane: 'overlay', data, lineWidth: inp.pivotLineWidth });
  }

  if (inp.showPivotP) {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const p = dayIndexOf.get(dayKeys[i])!;
      if (p <= 0) continue; // no prior day
      const prev = dayAgg.get(orderedDays[p - 1])!;
      data[i] = dayEndsAt(i) ? null : (prev.high + prev.low + prev.close) / 3;
    }
    plots.push({ id: 'PIVOT_P', title: 'Pivot P', color: inp.pivotPColor, type: 'line', pane: 'overlay', data, lineWidth: inp.pivotLineWidth });
  }

  return { plots, signals };
}
