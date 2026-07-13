// Technical Scanner — Indicator Registry. Every source is a plugin: the
// builder UI, validator, and evaluator are driven entirely by these
// definitions. Adding source #80 = one entry here + one section in
// docs/TECHNICAL_SCANNER_REGISTRY.md. No switch statements anywhere.

import type { Candle } from '../types';
import { TIMEFRAMES } from '../types';
import * as pm from '../pineMath';
import { vdAtr } from '../indicators/vdEngine';
import { computeVwap } from '../indicators/vwap';
import { computeBollingerBands } from '../indicators/bollingerBands';
import { computeStochastic } from '../indicators/stochastic';
import { computeSuperTrend } from '../indicators/superTrend';
import { computeMacd } from '../indicators/macd';
import { computeRsi } from '../indicators/rsi';
import { computeAdx } from '../indicators/adx';
import { computeObv } from '../indicators/obv';
import { computeVdZoneObjects } from '../indicators/volumeDistributionZones';
import {
  plotSeries, structureScoreSeries,
  trendScoreSeries, momentumScoreSeries, volumeScoreSeries, contextScoreSeries,
} from './intelligenceSeries';
import { CMP_OPS } from './operators';
import { SMC_SCANNER_SOURCES } from './smcSources';
import { DSMART_SCANNER_SOURCES } from './dsmartSources';
import type { ScannerSource, Series } from './types';

const num = (v: number | string | undefined, d: number): number => {
  const x = typeof v === 'string' ? Number(v) : v;
  return x != null && Number.isFinite(x) ? x : d;
};

const lengthParam = (d: number) =>
  [{ id: 'length', name: 'Length', type: 'number' as const, default: d, min: 1, max: 500, step: 1 }];

const src = (s: ScannerSource): ScannerSource => s;

// ---- Live-edge store for cross-TF aggregates (Stack Score / Alignment). ----
// These aggregate the multi-TF matrix, so they have no per-bar history in v1:
// the page publishes the current values; the series is null everywhere except
// the last CLOSED bar. The validator warns about missing backtest coverage.
let _liveScores: { stackScore: number | null; alignment: number | null } = { stackScore: null, alignment: null };
export function publishScannerLiveScores(v: { stackScore: number | null; alignment: number | null }): void {
  _liveScores = v;
}
const liveEdgeSeries = (pick: () => number | null) => (candles: Candle[]): Series => {
  const out: Series = new Array(candles.length).fill(null);
  const v = pick();
  if (candles.length > 0 && v != null) out[candles.length - 1] = v;
  return out;
};

export const SCANNER_SOURCES: Record<string, ScannerSource> = Object.fromEntries([
  // ---- Standard -------------------------------------------------------------
  src({
    id: 'price', name: 'Price', group: 'standard', costWeight: 0.5, params: [],
    outputs: [{ id: 'close', label: 'Close' }, { id: 'high', label: 'High' }, { id: 'low', label: 'Low' }],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => c.map((b) => (out === 'high' ? b.high : out === 'low' ? b.low : b.close)),
  }),
  src({
    id: 'ema', name: 'EMA', group: 'standard', costWeight: 1, params: lengthParam(20),
    outputs: [{ id: 'value', label: 'EMA' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, p) => pm.ema(c.map((b) => b.close), num(p.length, 20)),
  }),
  src({
    id: 'sma', name: 'SMA', group: 'standard', costWeight: 1, params: lengthParam(50),
    outputs: [{ id: 'value', label: 'SMA' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, p) => pm.sma(c.map((b) => b.close), num(p.length, 50)),
  }),
  src({
    id: 'rsi', name: 'RSI (14)', group: 'standard', params: [],
    outputs: [{ id: 'rsi', label: 'RSI', range: [0, 100] as [number, number] }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeRsi(c).plots, out),
  }),
  src({
    id: 'macd', name: 'MACD (12/26/9)', group: 'standard', params: [],
    outputs: [{ id: 'macd', label: 'MACD line' }, { id: 'signal', label: 'Signal' }, { id: 'hist', label: 'Histogram' }],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeMacd(c).plots, out),
  }),
  src({
    id: 'vwap', name: 'VWAP', group: 'standard', params: [],
    outputs: [{ id: 'vwap', label: 'VWAP' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeVwap(c).plots, out),
  }),
  src({
    id: 'supertrend', name: 'Supertrend', group: 'standard', params: [],
    outputs: [{ id: 'supertrend', label: 'Supertrend' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeSuperTrend(c).plots, out),
  }),
  src({
    id: 'atr', name: 'ATR', group: 'standard', costWeight: 1, params: lengthParam(14),
    outputs: [{ id: 'value', label: 'ATR' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, p) => vdAtr(c, num(p.length, 14)),
  }),
  src({
    id: 'adx', name: 'ADX (14)', group: 'standard', params: [],
    outputs: [{ id: 'adx', label: 'ADX', range: [0, 100] as [number, number] }, { id: 'plusDI', label: '+DI' }, { id: 'minusDI', label: '−DI' }],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeAdx(c).plots, out),
  }),
  src({
    id: 'bollinger', name: 'Bollinger (20, 2)', group: 'standard', params: [],
    outputs: [{ id: 'upper', label: 'Upper' }, { id: 'basis', label: 'Basis' }, { id: 'lower', label: 'Lower' }],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeBollingerBands(c).plots, out),
  }),
  src({
    id: 'stochastic', name: 'Stochastic (14)', group: 'standard', params: [],
    outputs: [{ id: 'k', label: '%K', range: [0, 100] as [number, number] }, { id: 'd', label: '%D', range: [0, 100] as [number, number] }],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeStochastic(c).plots, out),
  }),
  src({
    id: 'volume', name: 'Volume', group: 'standard', costWeight: 0.5, params: [],
    outputs: [{ id: 'volume', label: 'Volume' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c) => c.map((b) => b.volume),
  }),
  src({
    id: 'volumeSma', name: 'Volume SMA', group: 'standard', costWeight: 1, params: lengthParam(20),
    outputs: [{ id: 'value', label: 'Vol SMA' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, p) => pm.sma(c.map((b) => b.volume), num(p.length, 20)),
  }),
  src({
    id: 'obv', name: 'OBV', group: 'standard', params: [],
    outputs: [{ id: 'obv', label: 'OBV' }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => plotSeries(computeObv(c).plots, out),
  }),

  // ---- Structure --------------------------------------------------------------
  src({
    id: 'structure', name: 'Market Structure', group: 'structure', costWeight: 3, params: [],
    outputs: [{ id: 'score', label: 'Structure score (0-100)', range: [0, 100] as [number, number] }],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c) => structureScoreSeries(c),
  }),
  src({
    id: 'vdZone', name: 'VD Zone', group: 'structure', costWeight: 6, params: [],
    outputs: [
      { id: 'distanceAtr', label: 'Distance to nearest zone (ATRs)' },
      { id: 'inside', label: 'Inside zone (0/1)', range: [0, 1] as [number, number] },
      { id: 'confidence', label: 'Nearest zone confidence', range: [0, 100] as [number, number] },
    ],
    operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c, _p, out) => {
      const n = c.length;
      const res: Series = new Array(n).fill(null);
      if (n === 0) return res;
      const { zones } = computeVdZoneObjects(c); // default D+4H config
      const healthy = zones.filter((z) => z.health > 0);
      const atr = vdAtr(c);
      for (let i = 0; i < n; i++) {
        const a = atr[i];
        let best: { dist: number; conf: number; inside: boolean } | null = null;
        for (const z of healthy) {
          if (z.formedAtIndex > i || (z.endIndex != null && z.endIndex < i)) continue;
          const px = c[i].close;
          const inside = px >= z.lower && px <= z.upper;
          const dist = inside ? 0 : Math.min(Math.abs(px - z.upper), Math.abs(px - z.lower));
          if (best == null || dist < best.dist) best = { dist, conf: z.confidence, inside };
        }
        if (best) {
          res[i] = out === 'inside' ? (best.inside ? 1 : 0)
            : out === 'confidence' ? best.conf
            : a != null && a > 0 ? best.dist / a : null;
        }
      }
      return res;
    },
  }),

  // ---- Intelligence (the USP) --------------------------------------------------
  src({
    id: 'trendScore', name: 'Trend Score', group: 'intelligence', costWeight: 5, params: [],
    outputs: [{ id: 'score', label: 'Trend (0-100)', range: [0, 100] as [number, number] }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c) => trendScoreSeries(c),
  }),
  src({
    id: 'momentumScore', name: 'Momentum Score', group: 'intelligence', costWeight: 5, params: [],
    outputs: [{ id: 'score', label: 'Momentum (0-100)', range: [0, 100] as [number, number] }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c) => momentumScoreSeries(c),
  }),
  src({
    id: 'volumeScore', name: 'Volume Score', group: 'intelligence', costWeight: 5, params: [],
    outputs: [{ id: 'score', label: 'Volume (0-100)', range: [0, 100] as [number, number] }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c) => volumeScoreSeries(c),
  }),
  src({
    id: 'contextScore', name: 'Context Score', group: 'intelligence', costWeight: 5, params: [],
    outputs: [{ id: 'score', label: 'Context (0-100)', range: [0, 100] as [number, number] }], operators: CMP_OPS, tfs: TIMEFRAMES,
    series: (c) => contextScoreSeries(c),
  }),
  src({
    id: 'stackScore', name: 'Stack Score', group: 'intelligence', costWeight: 0.5, params: [], liveOnly: true,
    outputs: [{ id: 'score', label: 'Stack Score (0-100)', range: [0, 100] as [number, number] }],
    operators: ['gt', 'lt', 'gte', 'lte', 'between'], tfs: TIMEFRAMES,
    series: liveEdgeSeries(() => _liveScores.stackScore),
  }),
  src({
    id: 'alignment', name: 'MTF Alignment', group: 'intelligence', costWeight: 0.5, params: [], liveOnly: true,
    outputs: [{ id: 'score', label: 'Alignment (0-100)', range: [0, 100] as [number, number] }],
    operators: ['gt', 'lt', 'gte', 'lte', 'between'], tfs: TIMEFRAMES,
    series: liveEdgeSeries(() => _liveScores.alignment),
  }),
].map((s) => [s.id, s]).concat(
  SMC_SCANNER_SOURCES.map((s) => [s.id, s]),
  DSMART_SCANNER_SOURCES.map((s) => [s.id, s]),
));

export const SCANNER_SOURCE_LIST: ScannerSource[] = Object.values(SCANNER_SOURCES);
