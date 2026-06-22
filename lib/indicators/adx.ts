import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { neutralSignals, resolveInputs } from './itsTemplates';

export interface AdxInputs {
  diLength: number;
  adxSmoothing: number;
}

// TradingView "ADX and DI" defaults: DI length 14, ADX smoothing 14.
const DEFAULTS: AdxInputs = { diLength: 14, adxSmoothing: 14 };

/**
 * ADX (14) — Wilder's Average Directional Index, separate pane. Bucket B
 * hand-port (not in indicatorts).
 *
 *   +DM = up-move if it dominates, else 0;  -DM = down-move if it dominates.
 *   +DI = 100 · RMA(+DM)/ATR;  -DI = 100 · RMA(-DM)/ATR
 *   DX  = 100 · |+DI − −DI| / (+DI + −DI);  ADX = RMA(DX)
 *
 * True range, +DM and −DM are all null on the first bar (no previous bar), so
 * their Wilder RMAs warm up in lockstep — matching TradingView's `na` at bar 0.
 */
export function computeAdx(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const { diLength, adxSmoothing } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const trL = new Array<number | null>(n).fill(null);
  const plusDM = new Array<number | null>(n).fill(null);
  const minusDM = new Array<number | null>(n).fill(null);

  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const prevClose = candles[i - 1].close;
    trL[i] = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));

    const up = h - candles[i - 1].high;
    const down = candles[i - 1].low - l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }

  const atr = pm.rma(trL, diLength);
  const plusDI = pm.divide(pm.multiply(pm.rma(plusDM, diLength), 100), atr);
  const minusDI = pm.divide(pm.multiply(pm.rma(minusDM, diLength), 100), atr);

  const dx = plusDI.map((p, i) => {
    const m = minusDI[i];
    if (p === null || m === null) return null;
    const sum = p + m;
    return sum === 0 ? 0 : (100 * Math.abs(p - m)) / sum;
  });
  const adx = pm.rma(dx, adxSmoothing);

  const plots: IndicatorPlot[] = [
    { id: 'adx', title: 'ADX', color: '#eeeeee', type: 'line', pane: 'separate', lineWidth: 2, data: adx },
    { id: 'plusDI', title: '+DI', color: '#26A69A', type: 'line', pane: 'separate', lineWidth: 1, data: plusDI },
    { id: 'minusDI', title: '-DI', color: '#F23645', type: 'line', pane: 'separate', lineWidth: 1, data: minusDI },
  ];

  return { plots, signals: neutralSignals(n) };
}
