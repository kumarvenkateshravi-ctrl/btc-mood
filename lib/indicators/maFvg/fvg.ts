// Fair Value Gap engine — faithful port of the LuxAlgo FVG module
// (CC BY-NC-SA 4.0, © LuxAlgo). Pure: detects 3-bar gaps on the chart series,
// tracks mitigation, and reports counts. The composite turns these records into
// band boxes + unmitigated level lines.
//
// Detection (bar i, using i, i-1, i-2), verbatim from the Pine:
//   bull: low[i] > high[i-2] ∧ close[i-1] > high[i-2] ∧ (low[i]-high[i-2])/high[i-2] > threshold
//         → gap [top=low[i], bottom=high[i-2]]
//   bear: high[i] < low[i-2] ∧ close[i-1] < low[i-2] ∧ (low[i-2]-high[i])/high[i] > threshold
//         → gap [top=low[i-2], bottom=high[i]]
//   threshold = auto ? mean_{0..i}((high-low)/low) : thresholdPct/100
// Mitigation: bull filled when close < bottom; bear filled when close > top.

import type { Candle } from '../../types';
import { computeFvgDomain, type FvgEvaluationOptions, type FvgPolicy } from '../../fvg/domain';

export interface Fvg {
  isBull: boolean;
  top: number;
  bottom: number;
  /** Formation bar index (the box's left edge is startIndex-2). */
  startIndex: number;
  /** Bar index where the gap was filled, or null if still open at series end. */
  endIndex: number | null;
}

export interface FvgResult {
  fvgs: Fvg[];
  bullCount: number;
  bearCount: number;
  bullMitigated: number;
  bearMitigated: number;
}

/** Explicit MA/FVG policy. The legacy Pine threshold and close mitigation are
 * retained as policy values rather than hidden in a second implementation. */
export function maFvgPolicy(opts: { thresholdPct?: number; auto?: boolean } = {}, overrides: Partial<FvgPolicy> = {}): FvgPolicy {
  return {
    source: 'raw',
    requireClosedBars: false,
    threshold: {
      method: opts.auto ? 'autoRange' : opts.thresholdPct ? 'percentGap' : 'none',
      value: opts.thresholdPct ?? 0,
    },
    mitigation: 'close',
    partialFill: 'track',
    mitigationTiming: 'beforeCreation',
    maxHistory: 500,
    ...overrides,
  };
}

export function detectFvgs(
  candles: Candle[],
  opts: { thresholdPct?: number; auto?: boolean } = {},
  policyOverrides: Partial<FvgPolicy> = {},
  evaluationOptions?: FvgEvaluationOptions,
): FvgResult {
  const domain = computeFvgDomain(candles, maFvgPolicy(opts, policyOverrides), evaluationOptions);
  const fvgs = domain.map((g) => ({
    isBull: g.direction === 'bullish', top: g.top, bottom: g.bottom,
    startIndex: g.createdIndex, endIndex: g.endIndex,
  }));
  return {
    fvgs,
    bullCount: fvgs.filter((g) => g.isBull).length,
    bearCount: fvgs.filter((g) => !g.isBull).length,
    bullMitigated: fvgs.filter((g) => g.isBull && g.endIndex !== null).length,
    bearMitigated: fvgs.filter((g) => !g.isBull && g.endIndex !== null).length,
  };
}