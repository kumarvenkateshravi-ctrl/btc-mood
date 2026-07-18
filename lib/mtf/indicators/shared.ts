// Shared numeric helpers for the lib/mtf/indicators/ engine modules (M1.x).
// Pure utilities only — no indicator logic, no state.

import type { IndicatorPlot } from '../../indicatorFramework';

/** Sub-epsilon differences are float residue (e.g. flat series), not signal. */
export const EPS = 1e-9;

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Conviction magnitude of a directional dim: 50→0, 0 or 100→100. */
export const conv = (x: number) => Math.abs(x - 50) * 2;

export type PlotData = IndicatorPlot['data'];

/** Numeric value of one plot datum (handles number | null | {value}). */
export function val(d: PlotData[number]): number | null {
  if (d == null) return null;
  const v = typeof d === 'number' ? d : (d as { value?: number }).value;
  return v != null && Number.isFinite(v) ? v : null;
}

/** All finite values of a plot series, in order. */
export function finiteVals(data: PlotData): number[] {
  const out: number[] = [];
  for (const d of data) {
    const v = val(d);
    if (v != null) out.push(v);
  }
  return out;
}

/** Last finite value of a plot series. */
export function lastVal(data: PlotData): number | null {
  for (let i = data.length - 1; i >= 0; i--) {
    const v = val(data[i]);
    if (v != null) return v;
  }
  return null;
}
