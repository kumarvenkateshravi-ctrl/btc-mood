// Multi-Timeframe Indicator Alignment engine — the core of the MyCryptoStack
// dashboard. For each timeframe it reduces our (golden-tested) indicators to a
// directional verdict + a 0–100 sub-score, then a per-timeframe score. Pure and
// unit-tested; the dashboard is a visualization layer on top of this.
//
// Indicator scoring lives in the MTF Indicator Registry (lib/mtf/); this module
// evaluates the fixed roster and shapes the results into the dashboard matrix.
// See docs/architecture/mtf-engine.md.

import type { Candle, Timeframe } from './types';
import { verdictOf, type IndicatorSettingsMap, type Verdict } from './mtf/types';
import { createDefaultRegistry } from './mtf/registry';

export type { Verdict };

export type IndicatorKey = 'ema' | 'supertrend' | 'rsi' | 'macd' | 'adx' | 'obv' | 'volume';

export interface Cell {
  verdict: Verdict;
  /** 0–100 directional sub-score (100 = max bull, 0 = max bear, 50 = neutral). */
  score: number;
  /** What the table cell shows (a label or a value). */
  display: string;
}

export interface IndicatorRow {
  key: IndicatorKey;
  label: string;
  sub: string;
  /** 'label' rows show Bullish/Bearish; 'value' rows show a number/percent. */
  kind: 'label' | 'value';
  cells: Partial<Record<Timeframe, Cell>>;
}

export interface AlignmentMatrix {
  rows: IndicatorRow[];
  /** 0–100 score per timeframe (the TIMEFRAME SCORE row). */
  tfScore: Partial<Record<Timeframe, number>>;
  /** Per-timeframe directional verdict (majority of indicators). */
  tfVerdict: Partial<Record<Timeframe, Verdict>>;
  /** Per-timeframe sub-scores per indicator (for the Stack Score engine). */
  sub: Partial<Record<Timeframe, Record<IndicatorKey, number>>>;
}

// Module-private instance: the alignment matrix always evaluates the fixed
// default roster, regardless of registries composed elsewhere.
const registry = createDefaultRegistry();

/** Compute the seven indicator cells for one timeframe's candles. */
export function computeTfCells(
  candles: Candle[],
  settings?: IndicatorSettingsMap,
): { cells: Record<IndicatorKey, Cell>; score: number; verdict: Verdict } {
  const results = registry.evaluate(candles, settings && { settings });
  const cells = {} as Record<IndicatorKey, Cell>;
  for (const r of results) {
    cells[r.id as IndicatorKey] = { verdict: r.verdict, score: r.score, display: r.display };
  }
  const score = registry.compositeScore(results);
  return { cells, score, verdict: verdictOf(score) };
}

/** Build the full matrix across all timeframes. */
export function computeAlignmentMatrix(
  candlesByTf: Partial<Record<Timeframe, Candle[]>>,
  tfs: Timeframe[],
  settings?: IndicatorSettingsMap,
): AlignmentMatrix {
  const tfScore: AlignmentMatrix['tfScore'] = {};
  const tfVerdict: AlignmentMatrix['tfVerdict'] = {};
  const sub: AlignmentMatrix['sub'] = {};
  const rows: IndicatorRow[] = registry.list().map((d) => {
    const s = settings?.[d.id];
    return { key: d.id as IndicatorKey, label: d.label, sub: (s && d.subFor?.(s)) ?? d.sub, kind: d.kind, cells: {} };
  });

  for (const tf of tfs) {
    const candles = candlesByTf[tf];
    if (!candles || candles.length === 0) continue;
    const { cells, score, verdict } = computeTfCells(candles, settings);
    tfScore[tf] = score;
    tfVerdict[tf] = verdict;
    sub[tf] = {
      ema: cells.ema.score, supertrend: cells.supertrend.score, rsi: cells.rsi.score,
      macd: cells.macd.score, adx: cells.adx.score, obv: cells.obv.score, volume: cells.volume.score,
    };
    for (const row of rows) row.cells[tf] = cells[row.key];
  }

  return { rows, tfScore, tfVerdict, sub };
}
