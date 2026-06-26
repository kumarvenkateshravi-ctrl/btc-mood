/**
 * Moving Average Ribbon — port of the TradingView built-in PineScript indicator.
 *
 * //@version=6
 * indicator("Moving Average Ribbon", shorttitle="MA Ribbon", overlay=true)
 *
 * Four individually-togglable MAs, each with:
 *   - type: SMA | EMA | SMMA (RMA) | WMA | VWMA
 *   - source: close (only; VWMA uses volume automatically)
 *   - length: configurable
 *   - default colors matching TV: #f6c309 / #fb9800 / #fb6500 / #f60c0c
 *
 * No buy/sell signals are emitted (pure overlay, just like the original).
 */

import * as pm from '../pineMath';
import type { Candle, Timeframe } from '../types';
import type { IndicatorResult, CustomIndicatorConfig } from '../indicatorFramework';
import { neutralSignals, resolveInputs } from './itsTemplates';
import { TF_SECONDS } from '../confluence';

type MAType = 'SMA' | 'EMA' | 'SMMA (RMA)' | 'WMA' | 'VWMA';
/** 'chart' = compute on the chart's own bars; otherwise resample up to this TF. */
type RibbonTimeframe = 'chart' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface MaRibbonTVInputs {
  showMa1: boolean;
  ma1Type: MAType;
  ma1Length: number;
  showMa2: boolean;
  ma2Type: MAType;
  ma2Length: number;
  showMa3: boolean;
  ma3Type: MAType;
  ma3Length: number;
  showMa4: boolean;
  ma4Type: MAType;
  ma4Length: number;
  /** Calculate the ribbon on a higher timeframe, then project onto chart bars. */
  timeframe: RibbonTimeframe;
  /** Non-repainting: only reveal a HTF value once that HTF bar has closed. */
  waitForTimeframeCloses: boolean;
}

const DEFAULTS: MaRibbonTVInputs = {
  showMa1: true,  ma1Type: 'SMA', ma1Length: 20,
  showMa2: true,  ma2Type: 'SMA', ma2Length: 50,
  showMa3: true,  ma3Type: 'SMA', ma3Length: 100,
  showMa4: true,  ma4Type: 'SMA', ma4Length: 200,
  timeframe: 'chart',
  waitForTimeframeCloses: true,
};

/**
 * Resample chart candles into `seconds`-wide buckets (OHLCV aggregation), and
 * record which higher-timeframe bucket each chart bar falls into so HTF series
 * can be projected back onto the chart's x-axis.
 */
function resample(
  candles: Candle[],
  seconds: number,
): { htf: Candle[]; bucketOf: number[] } {
  const htf: Candle[] = [];
  const bucketOf = new Array<number>(candles.length);
  let curId: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const id = Math.floor(c.time / seconds);
    if (curId === null || id !== curId) {
      htf.push({ time: id * seconds, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      curId = id;
    } else {
      const b = htf[htf.length - 1];
      if (c.high > b.high) b.high = c.high;
      if (c.low < b.low) b.low = c.low;
      b.close = c.close;
      b.volume += c.volume;
    }
    bucketOf[i] = htf.length - 1;
  }
  return { htf, bucketOf };
}

/** TV default colors, matching the PineScript hex values. */
const COLORS = ['#f6c309', '#fb9800', '#fb6500', '#f60c0c'] as const;

/**
 * Compute one MA series. Returns (number | null)[] aligned to `n` bars.
 * VWMA uses candle volume; all others use close prices.
 */
function computeMA(
  closes: number[],
  volumes: number[],
  length: number,
  type: MAType,
): (number | null)[] {
  switch (type) {
    case 'SMA':        return pm.sma(closes, length);
    case 'EMA':        return pm.emaPine(closes, length); // TV ta.ema (src-seeded)
    case 'SMMA (RMA)': return pm.rma(closes, length);
    case 'WMA':        return pm.wma(closes, length);
    case 'VWMA':       return pm.vwma(closes, volumes, length);
    default:           return new Array(closes.length).fill(null);
  }
}

export function computeMaRibbonTV(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const inputs = resolveInputs<MaRibbonTVInputs>(config, DEFAULTS);
  const n = candles.length;
  const waitClose = Boolean(inputs.waitForTimeframeCloses);

  // Decide whether to run on a higher timeframe. We only resample UP: if the
  // requested TF is finer than (or equal to) the chart's bar spacing we have no
  // sub-bar data, so fall back to the chart's own resolution.
  const chartSpacing = n >= 2 ? candles[1].time - candles[0].time : 0;
  const targetSeconds =
    inputs.timeframe !== 'chart' ? (TF_SECONDS[inputs.timeframe as Timeframe] ?? 0) : 0;
  const useMTF = targetSeconds > chartSpacing && targetSeconds > 0;

  // Source series the MAs are computed on, and a projector back to chart bars.
  let srcCloses: number[];
  let srcVolumes: number[];
  let project: (htfMA: (number | null)[]) => (number | null)[];

  if (useMTF) {
    const { htf, bucketOf } = resample(candles, targetSeconds);
    srcCloses = htf.map((c) => c.close);
    srcVolumes = htf.map((c) => c.volume);
    // Each chart bar shows its HTF bucket's value; with "wait for closes" we lag
    // by one bucket so a value only appears after its HTF bar has closed.
    project = (htfMA) =>
      bucketOf.map((b) => {
        const idx = waitClose ? b - 1 : b;
        return idx >= 0 ? (htfMA[idx] ?? null) : null;
      });
  } else {
    srcCloses = candles.map((c) => c.close);
    srcVolumes = candles.map((c) => c.volume);
    project = (ma) => ma; // already aligned to chart bars
  }

  const mas: { show: boolean; type: MAType; length: number; label: string; color: string }[] = [
    { show: Boolean(inputs.showMa1), type: inputs.ma1Type, length: Number(inputs.ma1Length), label: 'MA #1', color: COLORS[0] },
    { show: Boolean(inputs.showMa2), type: inputs.ma2Type, length: Number(inputs.ma2Length), label: 'MA #2', color: COLORS[1] },
    { show: Boolean(inputs.showMa3), type: inputs.ma3Type, length: Number(inputs.ma3Length), label: 'MA #3', color: COLORS[2] },
    { show: Boolean(inputs.showMa4), type: inputs.ma4Type, length: Number(inputs.ma4Length), label: 'MA #4', color: COLORS[3] },
  ];

  const plots = mas.map((m, idx) => ({
    id:        `ma_${idx + 1}`,
    title:     `${m.label} (${m.type} ${m.length})`,
    color:     m.color,
    type:      'line' as const,
    pane:      'overlay' as const,
    lineWidth: 2 as const,
    data:      m.show && m.length >= 1
      ? project(computeMA(srcCloses, srcVolumes, m.length, m.type))
      : new Array<null>(n).fill(null),
  }));

  return { plots, signals: neutralSignals(n) };
}
