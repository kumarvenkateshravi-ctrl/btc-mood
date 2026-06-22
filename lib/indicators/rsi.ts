import type { Candle } from '../types';
import type {
  IndicatorResult,
  IndicatorPlot,
  IndicatorLevel,
  IndicatorFill,
  IndicatorGradientFill,
  IndicatorMarker,
  SignalSide,
  CustomIndicatorConfig,
} from '../indicatorFramework';
import * as pm from '../pineMath';
import { cols, neutralSignals, resolveInputs } from './itsTemplates';

export interface RsiInputs {
  length: number;
  source: 'open' | 'high' | 'low' | 'close';
  calculateDivergence: boolean;
  maType: string;
  maLength: number;
  bbMult: number;
}

const DEFAULTS: RsiInputs = {
  length: 14,
  source: 'close',
  calculateDivergence: false,
  maType: 'None',
  maLength: 14,
  bbMult: 2,
};

// PineScript palette from the built-in RSI.
const RSI_COLOR = '#7E57C2';
const BAND_COLOR = '#787B86';
const MID_COLOR = 'rgba(120, 123, 134, 0.5)';
const MA_COLOR = '#FFEB3B';
const BB_COLOR = '#4CAF50';
const CHANNEL_FILL = 'rgba(126, 87, 194, 0.1)'; // color.rgb(126,87,194, 90)

function applyMa(src: (number | null)[], length: number, type: string, volume: number[]): (number | null)[] {
  switch (type) {
    case 'SMA':
    case 'SMA + Bollinger Bands':
      return pm.sma(src, length);
    case 'EMA':
      return pm.ema(src, length);
    case 'SMMA (RMA)':
      return pm.rma(src, length);
    case 'WMA':
      return pm.wma(src, length);
    case 'VWMA':
      return pm.vwma(src, volume, length);
    default:
      return new Array<number | null>(src.length).fill(null);
  }
}

/**
 * Relative Strength Index — faithful port of TradingView's built-in RSI (v6):
 *   change = ta.change(src); up = rma(max(change,0)); down = rma(-min(change,0))
 *   rsi = down==0 ? 100 : up==0 ? 0 : 100 - 100/(1 + up/down)
 * Plus the 70/50/30 bands, the 70↔30 channel fill, and the optional Smoothing
 * MA group (None / SMA / SMA+BB / EMA / SMMA(RMA) / WMA / VWMA).
 *
 * Deferred vs the original: the green/red overbought/oversold *gradient* fills
 * and the (default-off) divergence labels.
 */
const BULL_COLOR = '#26A69A';
const BEAR_COLOR = '#F23645';
const NONE_COLOR = 'rgba(0,0,0,0)';

export function computeRsi(candles: Candle[], config?: CustomIndicatorConfig): IndicatorResult {
  const { length, source, calculateDivergence, maType, maLength, bbMult } = resolveInputs(config, DEFAULTS);
  const n = candles.length;

  const src = candles.map((c) => (c[source] ?? c.close) as number);

  // ta.change → na on the first bar.
  const change: (number | null)[] = src.map((v, i) => (i === 0 ? null : v - src[i - 1]));
  const maxUp = change.map((v) => (v == null ? null : Math.max(v, 0)));
  const maxDown = change.map((v) => (v == null ? null : Math.max(-v, 0)));

  const up = pm.rma(maxUp, length);
  const down = pm.rma(maxDown, length);

  const rsi: (number | null)[] = up.map((u, i) => {
    const d = down[i];
    if (u == null || d == null) return null;
    if (d === 0) return 100;
    if (u === 0) return 0;
    return 100 - 100 / (1 + u / d);
  });

  const plots: IndicatorPlot[] = [
    { id: 'rsi', title: `RSI ${length}`, color: RSI_COLOR, type: 'line', pane: 'separate', lineWidth: 2, data: rsi },
  ];

  // Smoothing MA group.
  const enableMA = maType !== 'None';
  const isBB = maType === 'SMA + Bollinger Bands';
  if (enableMA) {
    const ma = applyMa(rsi, maLength, maType, cols.volume(candles));
    plots.push({ id: 'rsiMa', title: 'RSI-based MA', color: MA_COLOR, type: 'line', pane: 'separate', lineWidth: 1, data: ma });
    if (isBB) {
      const dev = pm.multiply(pm.stdev(rsi, maLength), bbMult);
      plots.push({ id: 'bbUpper', title: 'Upper Bollinger Band', color: BB_COLOR, type: 'line', pane: 'separate', lineWidth: 1, data: pm.add(ma, dev) });
      plots.push({ id: 'bbLower', title: 'Lower Bollinger Band', color: BB_COLOR, type: 'line', pane: 'separate', lineWidth: 1, data: pm.subtract(ma, dev) });
    }
  }

  const levels: IndicatorLevel[] = [
    { value: 70, color: BAND_COLOR, title: 'Upper' },
    { value: 50, color: MID_COLOR, title: 'Middle' },
    { value: 30, color: BAND_COLOR, title: 'Lower' },
  ];
  const fills: IndicatorFill[] = [{ from: 70, to: 30, color: CHANNEL_FILL }];

  // Overbought / oversold gradient zones (fill between RSI and the 50 mid-line,
  // clipped to [70,100] green and [0,30] red, exactly like the Pine).
  const gradientFills: IndicatorGradientFill[] = [
    { plotId: 'rsi', baseline: 50, top: 100, bottom: 70, topColor: 'rgba(76,175,80,0.55)', bottomColor: 'rgba(76,175,80,0)' },
    { plotId: 'rsi', baseline: 50, top: 30, bottom: 0, topColor: 'rgba(242,54,69,0)', bottomColor: 'rgba(242,54,69,0.55)' },
  ];

  const signals = neutralSignals(n);
  const markers: IndicatorMarker[] = [];

  // --- Regular divergence (ta.pivothigh/low + valuewhen + barssince) ---
  if (calculateDivergence) {
    const left = 5;
    const right = 5;
    const rangeUpper = 60;
    const rangeLower = 5;
    const high = cols.high(candles);
    const low = cols.low(candles);

    const rsiLBR = pm.ref(rsi, right); // rsi[lookbackRight]
    const plFound = pm.pivotLow(rsi, left, right).map((v) => v != null);
    const phFound = pm.pivotHigh(rsi, left, right).map((v) => v != null);

    const inRange = (foundShift1: boolean[]): boolean[] => {
      const bs = pm.barsSince(foundShift1);
      return bs.map((b) => b != null && rangeLower <= b && b <= rangeUpper);
    };
    const inRangePl = inRange(pm.ref(plFound, 1).map((v) => v === true));
    const inRangePh = inRange(pm.ref(phFound, 1).map((v) => v === true));

    const vwPlRsi = pm.valueWhen(plFound, rsiLBR, 1);
    const lowLBR = pm.ref(low, right);
    const vwPlLow = pm.valueWhen(plFound, lowLBR, 1);
    const highLBR = pm.ref(high, right);
    const vwPhRsi = pm.valueWhen(phFound, rsiLBR, 1);
    const vwPhHigh = pm.valueWhen(phFound, highLBR, 1);

    const divBull = new Array<{ value: number; color: string } | null>(n).fill(null);
    const divBear = new Array<{ value: number; color: string } | null>(n).fill(null);

    for (let i = 0; i < n; i++) {
      const r = rsiLBR[i];
      // Regular bullish: RSI higher low + price lower low.
      const rsiHL = r != null && vwPlRsi[i] != null && r > (vwPlRsi[i] as number) && inRangePl[i];
      const llbr = lowLBR[i];
      const priceLL = llbr != null && vwPlLow[i] != null && llbr < (vwPlLow[i] as number);
      const bull = priceLL && rsiHL && plFound[i];

      // Regular bearish: RSI lower high + price higher high.
      const rsiLH = r != null && vwPhRsi[i] != null && r < (vwPhRsi[i] as number) && inRangePh[i];
      const hlbr = highLBR[i];
      const priceHH = hlbr != null && vwPhHigh[i] != null && hlbr > (vwPhHigh[i] as number);
      const bear = priceHH && rsiLH && phFound[i];

      const at = i - right; // offset = -lookbackRight (the pivot bar)
      if (at >= 0) {
        if (plFound[i] && r != null) divBull[at] = { value: r, color: bull ? BULL_COLOR : NONE_COLOR };
        if (phFound[i] && r != null) divBear[at] = { value: r, color: bear ? BEAR_COLOR : NONE_COLOR };
        if (bull) {
          markers.push({ index: at, position: 'belowBar', color: BULL_COLOR, shape: 'arrowUp', text: 'Bull' });
          signals[at] = 'buy' as SignalSide;
        }
        if (bear) {
          markers.push({ index: at, position: 'aboveBar', color: BEAR_COLOR, shape: 'arrowDown', text: 'Bear' });
          signals[at] = 'sell' as SignalSide;
        }
      }
    }

    plots.push({ id: 'divBull', title: 'Regular Bullish', color: BULL_COLOR, type: 'line', pane: 'separate', lineWidth: 2, data: divBull as IndicatorPlot['data'] });
    plots.push({ id: 'divBear', title: 'Regular Bearish', color: BEAR_COLOR, type: 'line', pane: 'separate', lineWidth: 2, data: divBear as IndicatorPlot['data'] });
  }

  return { plots, signals, levels, fills, gradientFills, markers };
}
