// PineScript port of "Regression Line [DW] + G-Channel".
// Source: C:/Users/ravic/.codex/attachments/353cd420-bd8e-4aae-8e72-ca39fff8a79c/pasted-text.txt
//
// The source is a composite overlay. This module intentionally keeps the four
// sections together at the public boundary while using small pure helpers so
// each Pine state machine can be tested independently.

import type { Candle } from '../types';
import type {
  CustomIndicatorConfig,
  IndicatorMarker,
  IndicatorPlot,
  IndicatorResult,

} from '../indicatorFramework';
import { emaPine, rma, sma, wma, vwma } from '../pineMath';
import { neutralSignals, resolveInputs, resolveSource } from './itsTemplates';

export type RegressionAverage = 'ALMA' | 'EMA' | 'SMA' | 'RMA' | 'LWMA' | 'VWMA';
export type RegressionWindow = 'Continuous' | 'Interval';
export type RegressionInterval = 'chart' | '15m' | '30m' | '1h' | '4h' | 'D' | 'W';

export interface RegressionGChannelConfig {
  source: string;
  filtType: RegressionAverage;
  windowType: RegressionWindow;
  length: number;
  interval: RegressionInterval;
  extendLines: boolean;
  showLine: boolean;
  lineWidth: number;
  lineStyle: 'Solid' | 'Dotted' | 'Dashed';
  positiveColor: string;
  negativeColor: string;
  flatColor: string;
  showTracer: boolean;
  tracerColor: string;
  gcShow: boolean;
  gcLength: number;
  gcSource: string;
  gcBullColor: string;
  gcBearColor: string;
  gcShowCross: boolean;
  showFibLevels: boolean;
  showFibBands: boolean;
  fibLength: number;
  fibOpacity: number;
  dcLength: number;
  showZoneFill: boolean;
  useAtrBuffer: boolean;
  atrLength: number;
  atrMultiplier: number;
  dsLineColor: string;
  dsLineWidth: number;
  maLength: number;
  maType: 'SMA' | 'EMA' | 'WMA' | 'RMA';
  dispHigh: number;
  dispLow: number;
}

export const REGRESSION_GCHANNEL_DEFAULTS: RegressionGChannelConfig = {
  source: 'close',
  filtType: 'SMA',
  windowType: 'Continuous',
  length: 200,
  interval: 'D',
  extendLines: false,
  showLine: true,
  lineWidth: 4,
  lineStyle: 'Solid',
  positiveColor: '#00e676',
  negativeColor: '#ef5350',
  flatColor: '#cccccc',
  showTracer: true,
  tracerColor: '#e5e7eb',
  gcShow: true,
  gcLength: 100,
  gcSource: 'close',
  gcBullColor: '#00e676',
  gcBearColor: '#ef5350',
  gcShowCross: true,
  showFibLevels: true,
  showFibBands: true,
  fibLength: 265,
  fibOpacity: 92,
  dcLength: 40,
  showZoneFill: true,
  useAtrBuffer: true,
  atrLength: 14,
  atrMultiplier: 0.25,
  dsLineColor: '#22c55e',
  dsLineWidth: 2,
  maLength: 20,
  maType: 'EMA',
  dispHigh: 5,
  dispLow: -5,
};

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

function rgba(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const values = rgb[1].split(',').slice(0, 3).map((v) => v.trim()).join(',');
    return `rgba(${values},${a})`;
  }
  return color;
}

function previousOrCurrent(values: number[], index: number, offset: number): number {
  const j = index - offset;
  return j >= 0 && Number.isFinite(values[j]) ? values[j] : values[index];
}

function intervalKey(time: number, interval: RegressionInterval, index: number): number {
  if (interval === 'chart') return index;
  const seconds = interval === '15m' ? 900
    : interval === '30m' ? 1800
      : interval === '1h' ? 3600
        : interval === '4h' ? 14400
          : interval === 'D' ? 86400
            : 604800;
  if (interval === 'W') {
    // Pine's exchange timezone is UTC for this crypto chart. Align weeks to
    // Monday 00:00 UTC, matching Binance's calendar boundary.
    const day = Math.floor(time / 86400);
    return Math.floor((day - 4) / 7);
  }
  return Math.floor(time / seconds);
}

function periodLengths(candles: Candle[], interval: RegressionInterval): number[] {
  const out = new Array<number>(candles.length).fill(1);
  let previous = Number.NaN;
  for (let i = 0; i < candles.length; i++) {
    const key = intervalKey(candles[i].time, interval, i);
    out[i] = i === 0 || key !== previous ? 1 : out[i - 1] + 1;
    previous = key;
  }
  return out;
}

/** ALMA with the exact Pine loop order and current-value nz fallback. */
function almaDynamic(values: number[], lengths: number[]): number[] {
  return values.map((_, i) => {
    const length = clampInt(lengths[i], 1, 5000);
    if (length === 1) return values[i];
    const m = 0.85 * (length - 1);
    const s = length / 6;
    let weighted = 0;
    let weights = 0;
    for (let j = 0; j < length; j++) {
      const weight = Math.exp(-Math.pow(j - m, 2) / (2 * Math.pow(s, 2)));
      weighted += weight * previousOrCurrent(values, i, length - 1 - j);
      weights += weight;
    }
    return weighted / weights;
  });
}

function dynamicFilter(values: number[], lengths: number[], type: RegressionAverage, volumes: number[]): number[] {
  if (type === 'ALMA') return almaDynamic(values, lengths);
  if (lengths.every((v) => v === lengths[0])) {
    const length = clampInt(lengths[0], 1, 5000);
    if (type === 'SMA') return sma(values, length).map((v, i) => v ?? values[i]);
    if (type === 'EMA') return emaPine(values, length).map((v, i) => v ?? values[i]);
    if (type === 'RMA') return rma(values, length).map((v, i) => v ?? values[i]);
    if (type === 'LWMA') return wma(values, length).map((v, i) => v ?? values[i]);
    return vwma(values, volumes, length).map((v, i) => v ?? values[i]);
  }

  const out = new Array<number>(values.length).fill(0);
  let recursive: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const length = clampInt(lengths[i], 1, 5000);
    if (type === 'EMA' || type === 'RMA') {
      const alpha = type === 'EMA' ? 2 / (length + 1) : 1 / length;
      recursive = recursive == null ? values[i] : (values[i] - recursive) * alpha + recursive;
      out[i] = recursive;
      continue;
    }
    if (type === 'SMA') {
      let sum = 0;
      for (let j = 0; j < length; j++) sum += previousOrCurrent(values, i, j);
      out[i] = sum / length;
      continue;
    }
    if (type === 'LWMA') {
      let sum = 0;
      let denominator = 0;
      for (let j = 0; j < length; j++) {
        sum += (length - j) * previousOrCurrent(values, i, j);
        denominator += length - j;
      }
      out[i] = sum / denominator;
      continue;
    }
    let sumPv = 0;
    let sumV = 0;
    for (let j = 0; j < length; j++) {
      const at = i - j;
      const volume = at >= 0 ? volumes[at] : volumes[i];
      sumPv += previousOrCurrent(values, i, j) * volume;
      sumV += volume;
    }
    out[i] = sumV === 0 ? values[i] : sumPv / sumV;
  }
  return out;
}

function dynamicStdev(values: number[], mean: number[], lengths: number[], type: RegressionAverage, volumes: number[]): number[] {
  const residual = values.map((v, i) => Math.pow(v - mean[i], 2));
  const filtered = dynamicFilter(residual, lengths, type, volumes);
  return filtered.map((v) => Math.sqrt(Math.max(0, v)));
}

function regression(values: number[], candles: Candle[], cfg: RegressionGChannelConfig) {
  const lengths = cfg.windowType === 'Interval'
    ? periodLengths(candles, cfg.interval)
    : new Array<number>(candles.length).fill(clampInt(cfg.length, 2, 5000));
  const volumes = candles.map((c) => Number.isFinite(c.volume) ? c.volume : 0);
  const mean = dynamicFilter(values, lengths, cfg.filtType, volumes);
  const deviation = dynamicStdev(values, mean, lengths, cfg.filtType, volumes);
  const y1: number[] = new Array(values.length).fill(0);
  const y2: number[] = new Array(values.length).fill(0);
  const colors: string[] = new Array(values.length).fill(cfg.flatColor);

  for (let i = 0; i < values.length; i++) {
    const length = clampInt(lengths[i], 1, 5000);
    const xDev = Math.round(length / 2);
    let xySum = 0;
    let x2Sum = 0;
    let y2Sum = 0;
    const yDev = values[i] - mean[i];
    for (let j = 0; j < length; j++) {
      const yd = (i - j >= 0 ? values[i - j] - mean[i - j] : yDev);
      xySum += xDev * yd;
      x2Sum += Math.pow(xDev, 2);
      y2Sum += Math.pow(yd, 2);
    }
    const denominator = Math.sqrt(x2Sum * y2Sum);
    const corr = denominator === 0 ? 0 : xySum / denominator;
    const sx = Math.round(length / 2);
    const xMean = i - sx >= 0 ? i - sx : 0;
    const b = length === 1 ? 0 : corr * (deviation[i] / sx);
    const a = mean[i] - b * xMean;
    const oldestX = i - (length - 1) >= 0 ? i - (length - 1) : i;
    y1[i] = a + b * oldestX;
    y2[i] = a + b * i;
    colors[i] = y2[i] > y1[i] ? cfg.positiveColor : y2[i] < y1[i] ? cfg.negativeColor : cfg.flatColor;
  }
  return { lengths, y1, y2, colors };
}

function rollingExtreme(values: number[], length: number, mode: 'high' | 'low'): number[] {
  const out = new Array<number>(values.length).fill(0);
  const size = clampInt(length, 1, 5000);
  for (let i = 0; i < values.length; i++) {
    let extreme = mode === 'high' ? -Infinity : Infinity;
    for (let j = Math.max(0, i - size + 1); j <= i; j++) {
      extreme = mode === 'high' ? Math.max(extreme, values[j]) : Math.min(extreme, values[j]);
    }
    out[i] = extreme;
  }
  return out;
}

function gChannel(values: number[], closes: number[], length: number, bullColor: string, bearColor: string) {
  const n = values.length;
  const a = new Array<number>(n).fill(0);
  const b = new Array<number>(n).fill(0);
  const avg = new Array<number>(n).fill(0);
  const bullish = new Array<boolean>(n).fill(false);
  const crossUp = new Array<boolean>(n).fill(false);
  const crossDown = new Array<boolean>(n).fill(false);
  const size = Math.max(1, Number.isFinite(length) ? length : 1);

  // Seed both recursive bounds from the first source value. Starting
  // from zero creates a large transient fill below price on the first
  // render while the channel converges, which is especially visible when
  // the initial history window is fitted to the chart.
  if (n > 0) {
    a[0] = values[0];
    b[0] = values[0];
    avg[0] = values[0];
  }
  for (let i = 1; i < n; i++) {
    const prevA = a[i - 1];
    const prevB = b[i - 1];
    const spread = prevA - prevB;
    a[i] = Math.max(values[i], prevA) - spread / size;
    b[i] = Math.min(values[i], prevB) + spread / size;
    avg[i] = (a[i] + b[i]) / 2;
    crossUp[i] = b[i - 1] < closes[i - 1] && b[i] > closes[i];
    crossDown[i] = a[i - 1] < closes[i - 1] && a[i] > closes[i];
  }

  let sinceUp: number | null = null;
  let sinceDown: number | null = null;
  for (let i = 0; i < n; i++) {
    if (crossUp[i]) sinceUp = 0;
    else if (sinceUp != null) sinceUp++;
    if (crossDown[i]) sinceDown = 0;
    else if (sinceDown != null) sinceDown++;
    // Pine's na comparison is false here until both cross families exist.
    bullish[i] = sinceDown != null && sinceUp != null && sinceDown <= sinceUp;
  }
  return { avg, bullish, crossUp, crossDown, bullColor, bearColor };
}

function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const previousClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose));
  });
}

function dSmart(candles: Candle[], cfg: RegressionGChannelConfig) {
  const n = candles.length;
  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const lowest = rollingExtreme(lows, cfg.dcLength, 'low');
  const highest = rollingExtreme(highs, cfg.dcLength, 'high');
  const atr = rma(trueRange(candles), clampInt(cfg.atrLength, 1, 5000));
  const line = new Array<number | null>(n).fill(null);
  const trend = new Array<'up' | 'down'>(n).fill('up');

  for (let i = 0; i < n; i++) {
    const buffer = cfg.useAtrBuffer ? (atr[i] ?? 0) * Math.max(0, cfg.atrMultiplier) : 0;
    if (i === 0) {
      line[i] = lowest[i];
      trend[i] = 'up';
      continue;
    }
    const previous = line[i - 1] ?? (trend[i - 1] === 'up' ? lowest[i] : highest[i]);
    if (trend[i - 1] === 'up') {
      const candidate = Math.max(previous, lowest[i]);
      if (candles[i].close < candidate - buffer) {
        trend[i] = 'down';
        line[i] = highest[i];
      } else {
        trend[i] = 'up';
        line[i] = candidate;
      }
    } else {
      const candidate = Math.min(previous, highest[i]);
      if (candles[i].close > candidate + buffer) {
        trend[i] = 'up';
        line[i] = lowest[i];
      } else {
        trend[i] = 'down';
        line[i] = candidate;
      }
    }
  }
  return { line, trend, lowest, highest };
}

function scalarData(values: Array<number | null>, visible: boolean): IndicatorPlot['data'] {
  return values.map((value) => visible ? value : null);
}

function bandData(upper: Array<number | null>, lower: Array<number | null>, visible: boolean): IndicatorPlot['data'] {
  return upper.map((value, i) => visible && value != null && lower[i] != null ? { upper: value, lower: lower[i]! } : null);
}

function fibPlots(candles: Candle[], cfg: RegressionGChannelConfig): IndicatorPlot[] {
  const closes = candles.map((c) => c.close);
  const high = rollingExtreme(closes, cfg.fibLength, 'high');
  const low = rollingExtreme(closes, cfg.fibLength, 'low');
  const range = high.map((v, i) => v - low[i]);
  const levels = [
    { id: 'fib_1', title: 'Fib 1', ratio: 1, color: '#9ca3af' },
    { id: 'fib_764', title: 'Fib 0.764', ratio: 0.764, color: '#3399ff' },
    { id: 'fib_618', title: 'Fib 0.618', ratio: 0.618, color: '#3b82f6' },
    { id: 'fib_5', title: 'Fib 0.5', ratio: 0.5, color: '#84cc16' },
    { id: 'fib_382', title: 'Fib 0.382', ratio: 0.382, color: '#22c55e' },
    { id: 'fib_236', title: 'Fib 0.236', ratio: 0.236, color: '#ef4444' },
    { id: 'fib_0', title: 'Fib 0', ratio: 0, color: '#9ca3af' },
  ];
  const values = levels.map((level) => high.map((v, i) => v - level.ratio * range[i]));
  const plots: IndicatorPlot[] = levels.map((level, i) => ({
    id: level.id,
    title: level.title,
    color: level.color,
    type: 'line',
    lineWidth: 1,
    data: scalarData(values[i], cfg.showFibLevels),
    axisLabel: false,
  }));
  const fillVisible = cfg.showFibLevels && cfg.showFibBands;
  for (let i = 0; i < levels.length - 1; i++) {
    plots.push({
      id: `fib_band_${i}`,
      title: `Fib Band ${i + 1}`,
      color: rgba(i === 0 || i === 5 ? '#ef4444' : '#3399ff', (100 - Math.max(0, Math.min(100, cfg.fibOpacity))) / 100),
      type: 'band',
      data: bandData(values[i], values[i + 1], fillVisible),
      areaFill: true,
      axisLabel: false,
    });
  }
  return plots;
}

export function computeRegressionGChannel(
  candles: Candle[],
  config?: CustomIndicatorConfig,
): IndicatorResult {
  const baseCfg = resolveInputs(config, REGRESSION_GCHANNEL_DEFAULTS);
  const styleColor = (id: string, fallback: string) => config?.settings?.styles?.[id]?.color ?? fallback;
  const cfg: RegressionGChannelConfig = {
    ...baseCfg,
    positiveColor: styleColor('regression_line', baseCfg.positiveColor),
    negativeColor: styleColor('regression_down', baseCfg.negativeColor),
    flatColor: styleColor('regression_flat', baseCfg.flatColor),
  };
  const n = candles.length;
  if (n === 0) return { plots: [], signals: [] };

  const source = resolveSource(candles, cfg.source).map((v, i) => v ?? candles[i].close);
  const gcSource = resolveSource(candles, cfg.gcSource).map((v, i) => v ?? candles[i].close);
  const reg = regression(source, candles, cfg);
  const gc = gChannel(gcSource, candles.map((c) => c.close), cfg.gcLength, cfg.gcBullColor, cfg.gcBearColor);
  const ds = dSmart(candles, cfg);
  const signals = neutralSignals(n);
  const markers: IndicatorMarker[] = [];

  for (let i = 1; i < n; i++) {
    const wasBull = gc.bullish[i - 1];
    if (gc.bullish[i] && !wasBull) {
      signals[i] = 'buy';
      if (cfg.gcShowCross && i > 0) markers.push({ index: i - 1, position: 'belowBar', color: cfg.gcBullColor, shape: 'arrowUp', text: 'Buy' });
    } else if (!gc.bullish[i] && wasBull) {
      signals[i] = 'sell';
      if (cfg.gcShowCross && i > 0) markers.push({ index: i - 1, position: 'aboveBar', color: cfg.gcBearColor, shape: 'arrowDown', text: 'Sell' });
    }
  }

  const regressionLine: IndicatorPlot = {
    id: 'regression_line',
    title: 'Regression Line',
    color: cfg.positiveColor,
    type: 'line',
    lineWidth: Math.min(4, Math.max(1, cfg.lineWidth)),
    // Pine renders this section through line.new; the custom primitive consumes
    // lineSegments below so the historical chart does not show an endpoint curve.
    data: scalarData(reg.y2, false),
  };
  const regressionValues: IndicatorPlot = {
    id: 'regression_values',
    title: 'Regression Values',
    color: cfg.positiveColor,
    type: 'line',
    lineWidth: 1,
    data: scalarData(reg.y2, cfg.showLine),
    axisLabel: false,
  };

  const tracer: IndicatorPlot = {
    id: 'regression_tracer',
    title: 'Regression Current Value',
    color: cfg.tracerColor,
    type: 'line',
    lineWidth: 1,
    data: scalarData(reg.y2, cfg.showTracer),
    axisLabel: false,
  };

  const bullAvg: IndicatorPlot['data'] = gc.avg.map((value, i) => cfg.gcShow ? { value, color: gc.bullish[i] ? cfg.gcBullColor : cfg.gcBearColor } : null);
  const gcBullUpper: Array<number | null> = gc.avg.map((v, i) => cfg.gcShow && gc.bullish[i] ? Math.max(v, gcSource[i]) : null);
  const gcBullLower: Array<number | null> = gc.avg.map((v, i) => cfg.gcShow && gc.bullish[i] ? Math.min(v, gcSource[i]) : null);
  const gcBearUpper: Array<number | null> = gc.avg.map((v, i) => cfg.gcShow && !gc.bullish[i] ? Math.max(v, gcSource[i]) : null);
  const gcBearLower: Array<number | null> = gc.avg.map((v, i) => cfg.gcShow && !gc.bullish[i] ? Math.min(v, gcSource[i]) : null);

  const dsmartLine: IndicatorPlot = {
    id: 'dsmart_line',
    title: 'D Smart Line',
    color: cfg.dsLineColor,
    type: 'line',
    lineWidth: Math.min(4, Math.max(1, cfg.dsLineWidth)),
    data: scalarData(ds.line, true),
  };
  const dsmartBullUpper = candles.map((c, i) => cfg.showZoneFill && ds.trend[i] === 'up' ? c.high : null);
  const dsmartBullLower = candles.map((c, i) => cfg.showZoneFill && ds.trend[i] === 'up' ? c.low : null);
  const dsmartBearUpper = candles.map((c, i) => cfg.showZoneFill && ds.trend[i] === 'down' ? c.high : null);
  const dsmartBearLower = candles.map((c, i) => cfg.showZoneFill && ds.trend[i] === 'down' ? c.low : null);

  const plots: IndicatorPlot[] = [
    regressionLine,
    regressionValues,
    tracer,
    { id: 'g_channel_average', title: 'G-Channel Average', color: cfg.gcBullColor, type: 'line', lineWidth: 1, data: bullAvg },
    { id: 'g_channel_bull', title: 'G-Channel Bullish', color: rgba(cfg.gcBullColor, 0.18), type: 'band', data: bandData(gcBullUpper, gcBullLower, cfg.gcShow), areaFill: true, axisLabel: false },
    { id: 'g_channel_bear', title: 'G-Channel Bearish', color: rgba(cfg.gcBearColor, 0.18), type: 'band', data: bandData(gcBearUpper, gcBearLower, cfg.gcShow), areaFill: true, axisLabel: false },
    ...fibPlots(candles, cfg),
    dsmartLine,
    { id: 'dsmart_zone_bull', title: 'D Smart Bull Zone', color: rgba('#22c55e', 0.08), type: 'band', data: bandData(dsmartBullUpper, dsmartBullLower, cfg.showZoneFill), areaFill: true, axisLabel: false },
    { id: 'dsmart_zone_bear', title: 'D Smart Bear Zone', color: rgba('#ef4444', 0.08), type: 'band', data: bandData(dsmartBearUpper, dsmartBearLower, cfg.showZoneFill), areaFill: true, axisLabel: false },
  ];

  const last = n - 1;
  const segmentLength = reg.lengths[last];
  const segmentStart = Math.max(0, n - segmentLength);
  const lineSegments = cfg.showLine ? [{
    id: 'regression_segment',
    startTime: candles[segmentStart].time,
    endTime: candles[last].time,
    startValue: reg.y1[last],
    endValue: reg.y2[last],
    color: reg.colors[last],
    lineWidth: Math.min(4, Math.max(1, cfg.lineWidth)),
    lineStyle: cfg.lineStyle.toLowerCase() as 'solid' | 'dashed' | 'dotted',
    extendRight: cfg.extendLines,
  }] : [];

  return { plots, signals, markers, lineSegments };
}
