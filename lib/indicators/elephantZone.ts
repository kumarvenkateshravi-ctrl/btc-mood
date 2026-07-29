// "Elephant Zone" S/R levels — a best-effort reconstruction of the "Elephant
// Zone Support & Resistance Levels" section of "Elephant Edge by AlgoBing V2".
// No Pine source exists for this indicator; this is NOT a golden-master port
// (see elephantZone.test.ts — self-consistency tests only, no reference
// output to compare against).
// Design: docs/superpowers/specs/2026-07-25-elephant-zone-design.md
//
// Model: each new UTC day, anchor = the PREVIOUS day's last close. A psychological
// S/R GRID is drawn around a base near that anchor. Spacing is chosen by mode:
//   volatility — step from the avg prior-day range, snapped to a nice increment
//   round      — continuous round-number magnitude (works at any price scale)
//   manual     — user-set roundBase + stepSize
// Levels: R_k = base + k·step, S_k = base − k·step. Plus a Base line, the anchor
// pivot (prev close) and the classic (H+L+C)/3 pivot. Lines, daily-reset.
// Design: docs/superpowers/specs/2026-07-29-elephant-adaptive-grid-design.md

import type { Candle } from '../types';
import type { CustomIndicatorConfig, IndicatorPlot, IndicatorResult, SignalSide } from '../indicatorFramework';
import { resolveInputs } from './itsTemplates';

export type SpacingMode = 'volatility' | 'round' | 'manual';

/** Round a raw step to the nearest "nice" increment: 1 / 2 / 2.5 / 5 / 10 × 10^k. */
export function niceSnap(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 0;
  const exp = Math.floor(Math.log10(x));
  const pow = Math.pow(10, exp);
  const f = Math.round((x / pow) * 1e6) / 1e6; // kill float dust at bucket edges
  const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 4 ? 2.5 : f < 7 ? 5 : 10;
  return nice * pow;
}

/** The grid's centre (base) and spacing (step) for one day's anchor, per mode.
 *  Returns null when a grid can't be formed (bad anchor, no volatility, bad manual params). */
export function gridScaleFor(
  anchor: number,
  avgDailyRange: number | null,
  inp: { spacingMode: SpacingMode; stepFraction: number; roundBase: number; stepSize: number },
): { base: number; step: number } | null {
  if (!(anchor > 0) || !Number.isFinite(anchor)) return null;

  if (inp.spacingMode === 'manual') {
    const { roundBase, stepSize } = inp;
    if (!(roundBase > 0) || !(stepSize > 0)) return null;
    return { base: Math.round(anchor / roundBase) * roundBase, step: stepSize };
  }

  if (inp.spacingMode === 'round') {
    const magnitude = Math.pow(10, Math.floor(Math.log10(anchor)));
    const roundBase = magnitude / 10;
    const step = roundBase / 5;
    if (!(roundBase > 0) || !(step > 0)) return null;
    return { base: Math.round(anchor / roundBase) * roundBase, step };
  }

  // volatility
  if (avgDailyRange == null || !(avgDailyRange > 0)) return null;
  const step = niceSnap(avgDailyRange * inp.stepFraction);
  if (!(step > 0)) return null;
  return { base: Math.round(anchor / step) * step, step };
}

export interface ElephantZoneInputs {
  spacingMode: SpacingMode;
  /** Volatility mode: days of prior daily-range history to average. */
  atrLength: number;
  /** Volatility mode: step = niceSnap(avgDailyRange × stepFraction). */
  stepFraction: number;
  /** Manual mode: base snaps to this; levels step by stepSize. */
  roundBase: number;
  stepSize: number;
  /** Grid levels each side of the base. */
  levelCount: number;
  showResistance: boolean;
  showSupport: boolean;
  showBase: boolean;
  showPivot: boolean;
  showPivotP: boolean;
  upperColor: string;
  lowerColor: string;
  baseColor: string;
  pivotColor: string;
  pivotPColor: string;
  lineWidth: number;
  pivotLineWidth: number;
}

export const ELEPHANT_ZONE_DEFAULTS: ElephantZoneInputs = {
  spacingMode: 'volatility',
  atrLength: 14,
  stepFraction: 0.25,
  roundBase: 1000,
  stepSize: 200,
  levelCount: 4,
  showResistance: true,
  showSupport: true,
  showBase: true,
  showPivot: true,
  showPivotP: true,
  upperColor: 'rgba(176,124,64,1)',  // amber resistance
  lowerColor: 'rgba(64,150,108,1)',  // green support
  baseColor: 'rgba(255,255,255,0.3)',
  pivotColor: 'rgba(80,190,240,1)',  // cyan (prev close)
  pivotPColor: 'rgba(99,102,241,1)', // indigo (HLC/3)
  lineWidth: 2,
  pivotLineWidth: 3,
};

const SECONDS_PER_DAY = 86400;

export function computeElephantZone(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const inp = resolveInputs<ElephantZoneInputs>(config, ELEPHANT_ZONE_DEFAULTS);
  const n = candles.length;
  const signals = new Array<SignalSide>(n).fill('neutral');
  if (n === 0) return { plots: [], signals };

  const dayOf = (t: number) => Math.floor(t / SECONDS_PER_DAY);
  const dayKeys = candles.map((c) => dayOf(c.time));
  const dayEndsAt = (i: number) => i + 1 < n && dayKeys[i + 1] !== dayKeys[i];

  // Anchor per day = the previous day's last close.
  const anchorForDay = new Map<number, number>();
  for (let i = 1; i < n; i++) {
    const day = dayKeys[i];
    if (dayKeys[i - 1] !== day && !anchorForDay.has(day)) {
      anchorForDay.set(day, candles[i - 1].close);
    }
  }

  // Per-day OHLC aggregate + chronological day list (for HLC/3 pivot + avg range).
  const dayAgg = new Map<number, { high: number; low: number; close: number }>();
  const orderedDays: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = dayKeys[i];
    const a = dayAgg.get(d);
    if (!a) { dayAgg.set(d, { high: candles[i].high, low: candles[i].low, close: candles[i].close }); orderedDays.push(d); }
    else { a.high = Math.max(a.high, candles[i].high); a.low = Math.min(a.low, candles[i].low); a.close = candles[i].close; }
  }
  const dayIndexOf = new Map<number, number>(orderedDays.map((d, idx) => [d, idx]));

  // Average daily range over the last `atrLength` PRIOR days (non-repainting).
  const avgRangeForDay = (day: number): number | null => {
    const p = dayIndexOf.get(day)!;
    const from = Math.max(0, p - inp.atrLength);
    let sum = 0, count = 0;
    for (let q = from; q < p; q++) {
      const a = dayAgg.get(orderedDays[q])!;
      sum += a.high - a.low; count++;
    }
    return count > 0 ? sum / count : null;
  };

  // Grid scale per day (cached).
  const scaleForDay = new Map<number, { base: number; step: number }>();
  for (const day of orderedDays) {
    const anchor = anchorForDay.get(day);
    if (anchor == null) continue;
    const scale = gridScaleFor(anchor, avgRangeForDay(day), inp);
    if (scale) scaleForDay.set(day, scale);
  }

  const plots: IndicatorPlot[] = [];

  const pushLevel = (id: string, sign: 1 | -1, k: number, color: string) => {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const s = scaleForDay.get(dayKeys[i]);
      if (!s) continue;
      data[i] = dayEndsAt(i) ? null : s.base + sign * k * s.step;
    }
    plots.push({ id, title: id, color, type: 'line', pane: 'overlay', data, lineWidth: inp.lineWidth });
  };
  if (inp.showResistance) for (let k = 1; k <= inp.levelCount; k++) pushLevel(`R${k}`, 1, k, inp.upperColor);
  if (inp.showSupport) for (let k = 1; k <= inp.levelCount; k++) pushLevel(`S${k}`, -1, k, inp.lowerColor);

  if (inp.showBase) {
    const data = new Array<number | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const s = scaleForDay.get(dayKeys[i]);
      if (!s) continue;
      data[i] = dayEndsAt(i) ? null : s.base;
    }
    plots.push({ id: 'BASE', title: 'Base', color: inp.baseColor, type: 'line', pane: 'overlay', data, lineWidth: 1, lineStyle: 'dashed' });
  }

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
