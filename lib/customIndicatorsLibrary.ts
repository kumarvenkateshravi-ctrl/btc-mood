import { computeSMACrossover } from './indicators/smaCrossover';
import { computeSqueezeMomentum } from './indicators/squeezeMomentum';
import { computeMaRibbonTV } from './indicators/maRibbonTV';
import { computeMacd } from './indicators/macd';
import { computeBollingerBands } from './indicators/bollingerBands';
import { computeRsi } from './indicators/rsi';
import { computeAtr } from './indicators/atr';
import { computeParabolicSar } from './indicators/parabolicSar';
import { computeStochastic } from './indicators/stochastic';
import { computeKeltnerChannels } from './indicators/keltnerChannels';
import { computeObv } from './indicators/obv';
import { computeVolume } from './indicators/volume';
import { computeVwap } from './indicators/vwap';
import { computeAdx } from './indicators/adx';
import { computeSuperTrend } from './indicators/superTrend';
import { computeVwapBands } from './indicators/vwapBands';
import { computeWilliamsR } from './indicators/williamsR';
import { computeSma } from './indicators/sma';
import { computeSdZones } from './indicators/sdZones';
import { computeSdSignals } from './indicators/sdSignals';
import { computeVolumeDistributionZones } from './indicators/volumeDistributionZones';
import { computeScannerSignals } from './indicators/scannerSignals';
import { computeVolSpike } from './indicators/volSpike';
import { computeMagicSr } from './indicators/magicSr';
import { computeFibPivot } from './indicators/fibPivot';
import type { Candle } from './types';
import type { IndicatorResult, CustomIndicatorConfig, IndicatorInputDef, IndicatorStyleDef } from './indicatorFramework';

export interface CustomIndicatorDef {
  id: string;
  name: string;
  description: string;
  compute: (candles: Candle[], config?: CustomIndicatorConfig, computedSources?: Record<string, (number | null)[]>) => IndicatorResult;
  inputs?: IndicatorInputDef[];
  styles?: IndicatorStyleDef[];
}

export const CUSTOM_INDICATORS: CustomIndicatorDef[] = [
  {
    id: 'sma',
    name: 'SMA',
    description: 'Simple Moving Average',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 9, min: 1, max: 1000, step: 1 },
      { id: 'source', name: 'Source', type: 'source', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
      { id: 'offset', name: 'Offset', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { id: 'smoothingType', name: 'Type', type: 'select', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'sma', label: 'SMA' }, { value: 'sma_bb', label: 'SMA + Bollinger Bands' }, { value: 'ema', label: 'EMA' }], group: 'SMOOTHING' },
      { id: 'smoothingLength', name: 'Length', type: 'number', default: 14, min: 1, max: 1000, step: 1, group: 'SMOOTHING', disabledIf: (inputs) => inputs['smoothingType'] === 'none' },
      { id: 'bbStdDev', name: 'BB StdDev', type: 'number', default: 2.0, min: 0.1, max: 10.0, step: 0.1, group: 'SMOOTHING', tooltip: 'Bollinger Bands Standard Deviation', disabledIf: (inputs) => inputs['smoothingType'] === 'none' },
      { id: 'timeframe', name: 'Timeframe', type: 'select', default: 'chart', options: [{ value: 'chart', label: 'Chart' }, { value: '1d', label: '1 Day' }], group: 'CALCULATION', tooltip: 'Timeframe for the indicator' },
      { id: 'waitForTimeframeCloses', name: 'Wait for timeframe closes', type: 'boolean', default: true, group: 'CALCULATION' },
    ],
    styles: [
      { id: 'smaLine', name: 'SMA', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeSma,
  },
  {
    id: 'sma_crossover_bb',
    name: 'SMA Crossover Signals + BB',
    description: 'Fast/Slow SMA crossover filtered by Trend and Bollinger Bands.',
    inputs: [
      { id: 'fastLength', name: 'Fast MA Length', type: 'number', default: 10, min: 1, max: 200, step: 1 },
      { id: 'slowLength', name: 'Slow MA Length', type: 'number', default: 21, min: 1, max: 200, step: 1 },
      { id: 'trendLength', name: 'Trend MA Length', type: 'number', default: 200, min: 1, max: 500, step: 1 },
      { id: 'bbLength', name: 'BB Length', type: 'number', default: 20, min: 1, max: 100, step: 1, group: 'SMOOTHING' },
      { id: 'bbDev', name: 'BB StdDev', type: 'number', default: 2.0, min: 0.1, max: 10.0, step: 0.1, group: 'SMOOTHING' },
      { id: 'source', name: 'Source', type: 'select', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
    ],
    styles: [
      { id: 'fastMA', name: 'Fast MA', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'slowMA', name: 'Slow MA', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'bbUpper', name: 'BB Upper', color: '#2962FF', thickness: 1, lineStyle: 'dashed', display: true },
      { id: 'bbLower', name: 'BB Lower', color: '#2962FF', thickness: 1, lineStyle: 'dashed', display: true },
    ],
    compute: computeSMACrossover,
  },
  {
    id: 'squeeze_momentum',
    name: 'Squeeze Momentum [LazyBear]',
    description: 'Carter TTM Squeeze: BB inside KC = squeeze building. Release with momentum = entry signal.',
    inputs: [
      { id: 'bbLength', name: 'BB Length', type: 'number', default: 20, min: 1, max: 500, step: 1, group: 'Bollinger Bands' },
      { id: 'bbMult', name: 'BB MultFactor', type: 'number', default: 2.0, min: 0.1, max: 10.0, step: 0.1, group: 'Bollinger Bands' },
      { id: 'kcLength', name: 'KC Length', type: 'number', default: 20, min: 1, max: 500, step: 1, group: 'Keltner Channel' },
      { id: 'kcMult', name: 'KC MultFactor', type: 'number', default: 1.5, min: 0.1, max: 10.0, step: 0.1, group: 'Keltner Channel' },
      { id: 'useTrueRange', name: 'Use TrueRange (KC)', type: 'boolean', default: true, group: 'Keltner Channel' },
    ],
    styles: [
      { id: 'momentum', name: 'Momentum', color: '#26A69A', thickness: 4, lineStyle: 'solid', display: true },
      { id: 'squeezeDots', name: 'Squeeze Dots', color: '#9E9E9E', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeSqueezeMomentum,
  },
  {
    id: 'ma_ribbon_tv',
    name: 'Moving Average Ribbon',
    description: 'Port of the TradingView built-in MA Ribbon. Four independently-togglable MAs (SMA/EMA/SMMA/WMA/VWMA), each with configurable type and length. Optional higher-timeframe calculation (5m/15m/1h/4h/1d). Defaults: SMA 20/50/100/200.',
    inputs: [
      // MA #1
      { id: 'showMa1',   name: 'MA #1',   type: 'boolean', default: true,   group: 'MA #1' },
      { id: 'ma1Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #1',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa1'] },
      { id: 'ma1Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #1',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa1'] },
      { id: 'ma1Length', name: 'Length',  type: 'number',  default: 20, min: 1, max: 2000, step: 1,
        group: 'MA #1', disabledIf: (i) => !i['showMa1'] },
      // MA #2
      { id: 'showMa2',   name: 'MA #2',   type: 'boolean', default: true,   group: 'MA #2' },
      { id: 'ma2Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #2',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa2'] },
      { id: 'ma2Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #2',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa2'] },
      { id: 'ma2Length', name: 'Length',  type: 'number',  default: 50, min: 1, max: 2000, step: 1,
        group: 'MA #2', disabledIf: (i) => !i['showMa2'] },
      // MA #3
      { id: 'showMa3',   name: 'MA #3',   type: 'boolean', default: true,   group: 'MA #3' },
      { id: 'ma3Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #3',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa3'] },
      { id: 'ma3Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #3',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa3'] },
      { id: 'ma3Length', name: 'Length',  type: 'number',  default: 100, min: 1, max: 2000, step: 1,
        group: 'MA #3', disabledIf: (i) => !i['showMa3'] },
      // MA #4
      { id: 'showMa4',   name: 'MA #4',   type: 'boolean', default: true,   group: 'MA #4' },
      { id: 'ma4Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #4',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa4'] },
      { id: 'ma4Source', name: 'Source',  type: 'select',  default: 'close', group: 'MA #4',
        options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }],
        disabledIf: (i) => !i['showMa4'] },
      { id: 'ma4Length', name: 'Length',  type: 'number',  default: 200, min: 1, max: 2000, step: 1,
        group: 'MA #4', disabledIf: (i) => !i['showMa4'] },
      // CALCULATION
      { id: 'timeframe', name: 'Timeframe', type: 'select', default: 'chart',
        options: [
          { value: 'chart', label: 'Chart' },
          { value: '5m', label: '5 minutes' },
          { value: '15m', label: '15 minutes' },
          { value: '1h', label: '1 hour' },
          { value: '4h', label: '4 hours' },
          { value: '1d', label: '1 day' },
        ],
        group: 'CALCULATION', tooltip: 'Compute the ribbon on a higher timeframe, then project onto the chart bars.' },
      { id: 'waitForTimeframeCloses', name: 'Wait for timeframe closes', type: 'boolean', default: true, group: 'CALCULATION',
        tooltip: 'Only reveal a higher-timeframe value once that bar has closed (non-repainting).' },
    ],
    styles: [
      { id: 'ma_1', name: 'MA #1', color: '#f6c309', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_2', name: 'MA #2', color: '#fb9800', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_3', name: 'MA #3', color: '#fb6500', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
      { id: 'ma_4', name: 'MA #4', color: '#f60c0c', thickness: 2, lineStyle: 'solid', display: true, hideCheckbox: true },
    ],
    compute: computeMaRibbonTV,
  },
  {
    id: 'macd',
    name: 'MACD',
    description: 'Faithful port of TradingView’s built-in MACD: configurable source, fast/slow/signal lengths, and EMA/SMA selection for both the oscillator and the signal line.',
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'number', default: 12, min: 1, max: 200, step: 1 },
      { id: 'slow', name: 'Slow Length', type: 'number', default: 26, min: 1, max: 200, step: 1 },
      { id: 'source', name: 'Source', type: 'source', default: 'close',
        options: [
          { value: 'close', label: 'Close' },
          { value: 'open', label: 'Open' },
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' },
          { value: 'hl2', label: 'HL2' },
          { value: 'hlc3', label: 'HLC3' },
          { value: 'ohlc4', label: 'OHLC4' },
        ] },
      { id: 'signal', name: 'Signal Smoothing', type: 'number', default: 9, min: 1, max: 100, step: 1 },
      { id: 'oscMaType', name: 'Oscillator MA Type', type: 'select', default: 'EMA',
        options: [{ value: 'EMA', label: 'EMA' }, { value: 'SMA', label: 'SMA' }] },
      { id: 'signalMaType', name: 'Signal Line MA Type', type: 'select', default: 'EMA',
        options: [{ value: 'EMA', label: 'EMA' }, { value: 'SMA', label: 'SMA' }] },
    ],
    styles: [
      { id: 'macd', name: 'MACD', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'signal', name: 'Signal', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'hist', name: 'Histogram', color: '#7b88a0', thickness: 4, lineStyle: 'solid', display: true },
    ],
    compute: computeMacd,
  },
  {
    id: 'bollinger_bands',
    name: 'Bollinger Bands (20, 2)',
    description: 'SMA basis ± mult × population stdev. Matches TradingView.',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'StdDev', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
    ],
    styles: [
      { id: 'basis', name: 'Basis', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upper', name: 'Upper', color: '#2962FF', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower', name: 'Lower', color: '#2962FF', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeBollingerBands,
  },
  {
    id: 'rsi',
    name: 'RSI',
    description: 'Relative Strength Index with 70/50/30 bands, channel fill, and optional smoothing MA / Bollinger Bands. Matches TradingView.',
    inputs: [
      { id: 'length', name: 'RSI Length', type: 'number', default: 14, min: 1, max: 2000, step: 1, group: 'RSI Settings' },
      { id: 'source', name: 'Source', type: 'source', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }], group: 'RSI Settings' },
      { id: 'calculateDivergence', name: 'Calculate Divergence', type: 'boolean', default: false, group: 'RSI Settings', tooltip: 'Show regular bullish/bearish divergence labels.' },
      { id: 'maType', name: 'Type', type: 'select', default: 'SMA', options: [{ value: 'None', label: 'None' }, { value: 'SMA', label: 'SMA' }, { value: 'SMA + Bollinger Bands', label: 'SMA + Bollinger Bands' }, { value: 'EMA', label: 'EMA' }, { value: 'SMMA (RMA)', label: 'SMMA (RMA)' }, { value: 'WMA', label: 'WMA' }, { value: 'VWMA', label: 'VWMA' }], group: 'Smoothing' },
      { id: 'maLength', name: 'Length', type: 'number', default: 14, min: 1, max: 2000, step: 1, group: 'Smoothing', disabledIf: (i) => i['maType'] === 'None' },
      { id: 'bbMult', name: 'BB StdDev', type: 'number', default: 2.0, min: 0.001, max: 50, step: 0.5, group: 'Smoothing', tooltip: 'Only applies when "SMA + Bollinger Bands" is selected.', disabledIf: (i) => i['maType'] !== 'SMA + Bollinger Bands' },
    ],
    styles: [
      { id: 'rsi', name: 'RSI', color: '#7E57C2', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'rsiMa', name: 'RSI-based MA', color: '#FFEB3B', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'bbUpper', name: 'Upper Bollinger Band', color: '#4CAF50', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'bbLower', name: 'Lower Bollinger Band', color: '#4CAF50', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeRsi,
  },
  {
    id: 'atr',
    name: 'ATR (14)',
    description: 'Faithful port of TradingView’s built-in ATR: ta.tr(true) smoothed by RMA/SMA/EMA/WMA (default RMA / Wilder).',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'smoothing', name: 'Smoothing', type: 'select', default: 'RMA',
        options: [
          { value: 'RMA', label: 'RMA' },
          { value: 'SMA', label: 'SMA' },
          { value: 'EMA', label: 'EMA' },
          { value: 'WMA', label: 'WMA' },
        ] },
    ],
    styles: [
      { id: 'atr', name: 'ATR', color: '#ef6c00', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeAtr,
  },
  {
    id: 'parabolic_sar',
    name: 'Parabolic SAR',
    description: 'Faithful port of TradingView’s ta.sar (Wilder stop-and-reverse); trend by dot position vs price.',
    inputs: [
      { id: 'start', name: 'Start', type: 'number', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { id: 'increment', name: 'Increment', type: 'number', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { id: 'max', name: 'Maximum', type: 'number', default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    styles: [
      { id: 'psar', name: 'PSAR', color: '#26A69A', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeParabolicSar,
  },
  {
    id: 'stochastic',
    name: 'Stochastic',
    description: 'Faithful port of TradingView’s built-in Stochastic: %K = SMA(ta.stoch, %K smoothing), %D = SMA(%K). TV defaults 14 / 1 / 3, with 80/50/20 bands.',
    inputs: [
      { id: 'kPeriod', name: '%K Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'smoothK', name: '%K Smoothing', type: 'number', default: 1, min: 1, max: 100, step: 1 },
      { id: 'dPeriod', name: '%D Smoothing', type: 'number', default: 3, min: 1, max: 100, step: 1 },
    ],
    styles: [
      { id: 'k', name: '%K', color: '#2962FF', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'd', name: '%D', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeStochastic,
  },
  {
    id: 'keltner_channels',
    name: 'Keltner Channels',
    description: 'EMA basis ± mult × ATR. Matches TradingView (EMA + Wilder ATR).',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'Multiplier', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
      { id: 'atrLength', name: 'ATR Length', type: 'number', default: 10, min: 1, max: 500, step: 1 },
    ],
    styles: [
      { id: 'basis', name: 'Basis', color: '#FF6D00', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upper', name: 'Upper', color: '#26A69A', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower', name: 'Lower', color: '#26A69A', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeKeltnerChannels,
  },
  {
    id: 'volume',
    name: 'Volume',
    description: 'Per-bar volume, colored by candle direction.',
    inputs: [],
    styles: [
      { id: 'volume', name: 'Volume', color: '#26A69A', thickness: 4, lineStyle: 'solid', display: true },
    ],
    compute: computeVolume,
  },
  {
    id: 'obv',
    name: 'OBV',
    description: 'On-Balance Volume cumulative flow.',
    inputs: [],
    styles: [
      { id: 'obv', name: 'OBV', color: '#5aa2e6', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeObv,
  },
  {
    id: 'vwap',
    name: 'VWAP',
    description: 'Faithful port of TradingView’s VWAP: Σ(src·vol)/Σvol per anchored period. Source hlc3, anchor Session/Week/Month/Quarter/Year.',
    inputs: [
      { id: 'anchor', name: 'Anchor Period', type: 'select', default: 'session',
        options: [
          { value: 'session', label: 'Session' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ] },
      { id: 'source', name: 'Source', type: 'source', default: 'hlc3',
        options: [
          { value: 'hlc3', label: 'HLC3' },
          { value: 'hl2', label: 'HL2' },
          { value: 'ohlc4', label: 'OHLC4' },
          { value: 'close', label: 'Close' },
          { value: 'high', label: 'High' },
          { value: 'low', label: 'Low' },
        ] },
    ],
    styles: [
      { id: 'vwap', name: 'VWAP', color: '#42a5f5', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeVwap,
  },
  {
    id: 'adx',
    name: 'ADX (14) — Trend Strength',
    description: "Wilder's Average Directional Index with +DI / -DI.",
    inputs: [
      { id: 'diLength', name: 'DI Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'adxSmoothing', name: 'ADX Smoothing', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    styles: [
      { id: 'adx', name: 'ADX', color: '#eeeeee', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'plusDI', name: '+DI', color: '#26A69A', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'minusDI', name: '-DI', color: '#F23645', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeAdx,
  },
  {
    id: 'supertrend',
    name: 'SuperTrend',
    description: 'ATR-banded trend follower; flips emit buy/sell signals.',
    inputs: [
      { id: 'atrPeriod', name: 'ATR Length', type: 'number', default: 10, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'Factor', type: 'number', default: 3, min: 0.1, max: 20, step: 0.1 },
    ],
    styles: [
      { id: 'supertrend', name: 'SuperTrend', color: '#26A69A', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeSuperTrend,
  },
  {
    id: 'vwap_bands',
    name: 'VWAP Bands',
    description: 'VWAP with volume-weighted ±σ bands (TV formula). Anchor Session/Week/Month/Quarter/Year, source hlc3.',
    inputs: [
      { id: 'mult1', name: 'Band 1 ×σ', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
      { id: 'mult2', name: 'Band 2 ×σ', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
      { id: 'anchor', name: 'Anchor Period', type: 'select', default: 'session',
        options: [
          { value: 'session', label: 'Session' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
          { value: 'year', label: 'Year' },
        ] },
      { id: 'source', name: 'Source', type: 'source', default: 'hlc3',
        options: [
          { value: 'hlc3', label: 'HLC3' },
          { value: 'hl2', label: 'HL2' },
          { value: 'ohlc4', label: 'OHLC4' },
          { value: 'close', label: 'Close' },
        ] },
    ],
    styles: [
      { id: 'vwap', name: 'VWAP', color: '#42a5f5', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upper1', name: '+σ', color: '#7e9cb5', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower1', name: '-σ', color: '#7e9cb5', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'upper2', name: '+2σ', color: '#5c7488', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'lower2', name: '-2σ', color: '#5c7488', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeVwapBands,
  },
  {
    id: 'williams_r',
    name: 'Williams %R',
    description: 'Momentum indicator that measures overbought and oversold levels.',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 14, min: 1, max: 2000, step: 1 },
      { id: 'source', name: 'Source', type: 'source', default: 'close', options: [{ value: 'close', label: 'Close' }, { value: 'open', label: 'Open' }, { value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
      { id: 'timeframe', name: 'Timeframe', type: 'select', default: 'chart', options: [{ value: 'chart', label: 'Chart' }, { value: '1d', label: '1 Day' }], group: 'CALCULATION', tooltip: 'Timeframe for the indicator' },
      { id: 'waitForTimeframeCloses', name: 'Wait for timeframe closes', type: 'boolean', default: true, group: 'CALCULATION' },
    ],
    styles: [
      { id: 'percentR', name: '%R', color: '#7E57C2', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'upperBand', name: 'Upper Band', color: '#787B86', thickness: 1, lineStyle: 'solid', display: true, hasValue: true, value: -20 },
      { id: 'middleLevel', name: 'Middle Level', color: '#787B86', thickness: 1, lineStyle: 'dotted', display: true, hasValue: true, value: -50 },
      { id: 'lowerBand', name: 'Lower Band', color: '#787B86', thickness: 1, lineStyle: 'solid', display: true, hasValue: true, value: -80 },
      { id: 'background', name: 'Background', color: '#7E57C21A', thickness: 1, lineStyle: 'solid', display: true, isFill: true },
    ],
    compute: computeWilliamsR,
  },
  {
    id: 'sd_zones',
    name: 'Supply / Demand Zones',
    description: 'Non-repainting supply/demand price bands from the prior higher-TF period (up to 3 TFs), ranked by a configurable Zone Strength Score.',
    inputs: [
      { id: 'tf1', name: 'Timeframe 1', type: 'select', default: 'D', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf2', name: 'Timeframe 2', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf3', name: 'Timeframe 3', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'targetFactor', name: 'Target projection ×', type: 'number', default: 1.5, min: 0, max: 5, step: 0.1 },
      { id: 'showLabels', name: 'Show labels', type: 'boolean', default: true },
      { id: 'showStrength', name: 'Show strength score', type: 'boolean', default: true },
      { id: 'minStrength', name: 'Min strength', type: 'number', default: 0, min: 0, max: 100, step: 1 },
      { id: 'wConfluence', name: 'Weight: Confluence', type: 'number', default: 0.25, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wRejection', name: 'Weight: Rejection', type: 'number', default: 0.22, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wVolume', name: 'Weight: Volume', type: 'number', default: 0.18, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wRetests', name: 'Weight: Retests', type: 'number', default: 0.13, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wZoneWidth', name: 'Weight: Zone Width', type: 'number', default: 0.12, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
      { id: 'wFreshness', name: 'Weight: Freshness', type: 'number', default: 0.10, min: 0, max: 1, step: 0.01, group: 'Zone Strength Weights' },
    ],
    // One style entry per band plot id (`{TF} {kind}`) so the settings modal
    // exposes color + visibility for every timeframe and both target zones.
    // Ids must match the `${TF_LABEL} ${KIND_LABEL}` plot ids in computeSdZones.
    // Mockup palette: supply = deep blue, demand = muted orange (structure
    // colors; green/red stay reserved for signals + trade levels). Measured-
    // move target bands default OFF — context on demand, not clutter.
    styles: (['4H', 'D', 'W', 'M'] as const).flatMap((tf) => {
      const su = { '4H': '122,160,255', D: '79,127,255', W: '61,105,224', M: '50,88,196' }[tf];
      const de = { '4H': '255,181,102', D: '255,159,54', W: '230,136,38', M: '204,117,30' }[tf];
      return [
        { id: `${tf} Su`, name: `${tf} Supply`, color: `rgba(${su},0.10)`, thickness: 1, lineStyle: 'solid' as const, display: true },
        { id: `${tf} Su T`, name: `${tf} Supply Target`, color: `rgba(${su},0.05)`, thickness: 1, lineStyle: 'solid' as const, display: false },
        { id: `${tf} De`, name: `${tf} Demand`, color: `rgba(${de},0.10)`, thickness: 1, lineStyle: 'solid' as const, display: true },
        { id: `${tf} De T`, name: `${tf} Demand Target`, color: `rgba(${de},0.05)`, thickness: 1, lineStyle: 'solid' as const, display: false },
      ];
    }),
    compute: computeSdZones,
  },
  {
    id: 'sd_signals',
    name: 'Supply / Demand Signals',
    description: 'Complete reversal trade setup on the same Supply/Demand zones as sd_zones: draws the zones, prints strictly non-repainting BUY/SELL signals (closed-bar only), and marks entry / stop-loss / TP1 (opposing zone) / TP2 (measured move) with an explained confidence score. One indicator = one full setup. Note: historical zone strength is scored against the full zone set (not strictly as-of-formation) — a Phase-1 approximation. Paper & educational — not financial advice.',
    inputs: [
      { id: 'tf1', name: 'Zone Timeframe 1', type: 'select', default: 'D', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf2', name: 'Zone Timeframe 2', type: 'select', default: '4H', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf3', name: 'Zone Timeframe 3', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'targetFactor', name: 'Target projection ×', type: 'number', default: 1.5, min: 0, max: 5, step: 0.1 },
      { id: 'signalOn', name: 'Signal on', type: 'select', default: 'close', options: [{ value: 'close', label: 'Bar close (strict)' }, { value: 'live', label: 'Live (provisional)' }] },
      { id: 'confirmation', name: 'Confirmation', type: 'select', default: 'rejection_close', options: ['touch','rejection_close','reversal_candle'].map((v) => ({ value: v, label: v })) },
      { id: 'minTier', name: 'Min zone tier', type: 'select', default: 'medium', options: ['medium','strong'].map((v) => ({ value: v, label: v })) },
      { id: 'confidenceFloor', name: 'Min confidence', type: 'number', default: 55, min: 0, max: 100, step: 1 },
      { id: 'minRR', name: 'Min R:R', type: 'number', default: 1.5, min: 0, max: 10, step: 0.1 },
      { id: 'slBufferMode', name: 'Stop buffer mode', type: 'select', default: 'atr', options: ['atr','percent','ticks'].map((v) => ({ value: v, label: v })) },
      { id: 'slBuffer', name: 'Stop buffer', type: 'number', default: 0.25, min: 0, max: 100, step: 0.05 },
      { id: 'tickSize', name: 'Tick size', type: 'number', default: 0.1, min: 0.00000001, max: 1000, step: 0.1 },
      { id: 'maxBarsToTrigger', name: 'Max bars to trigger', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'maxBarsInTrade', name: 'Max bars in trade', type: 'number', default: 150, min: 1, max: 5000, step: 1 },
      { id: 'showSupply', name: 'Show supply zones', type: 'boolean', default: true, group: 'Display' },
      { id: 'showDemand', name: 'Show demand zones', type: 'boolean', default: true, group: 'Display' },
      { id: 'showSignals', name: 'Show buy/sell signals', type: 'boolean', default: true, group: 'Display' },
      { id: 'showEntry', name: 'Show entry line', type: 'boolean', default: true, group: 'Display' },
      { id: 'showSl', name: 'Show stop loss', type: 'boolean', default: true, group: 'Display' },
      { id: 'showTp1', name: 'Show TP1', type: 'boolean', default: true, group: 'Display' },
      { id: 'showTp2', name: 'Show TP2', type: 'boolean', default: true, group: 'Display' },
      { id: 'showConfidence', name: 'Show confidence labels', type: 'boolean', default: true, group: 'Display' },
      { id: 'showRRBox', name: 'Show risk/reward box', type: 'boolean', default: true, group: 'Display' },
    ],
    // Zone band styles must match the `${TF} ${KIND}` plot ids emitted by computeSdZones.
    // Mockup palette: supply = deep blue, demand = muted orange (structure
    // colors; green/red stay reserved for signals + trade levels). Measured-
    // move target bands default OFF — context on demand, not clutter.
    styles: (['4H', 'D', 'W', 'M'] as const).flatMap((tf): IndicatorStyleDef[] => {
      const su = { '4H': '122,160,255', D: '79,127,255', W: '61,105,224', M: '50,88,196' }[tf];
      const de = { '4H': '255,181,102', D: '255,159,54', W: '230,136,38', M: '204,117,30' }[tf];
      return [
        { id: `${tf} Su`, name: `${tf} Supply`, color: `rgba(${su},0.10)`, thickness: 1, lineStyle: 'solid', display: true },
        { id: `${tf} Su T`, name: `${tf} Supply Target`, color: `rgba(${su},0.05)`, thickness: 1, lineStyle: 'solid', display: false },
        { id: `${tf} De`, name: `${tf} Demand`, color: `rgba(${de},0.10)`, thickness: 1, lineStyle: 'solid', display: true },
        { id: `${tf} De T`, name: `${tf} Demand Target`, color: `rgba(${de},0.05)`, thickness: 1, lineStyle: 'solid', display: false },
      ];
    }).concat([
      { id: 'R:R Reward', name: 'R:R Reward box', color: 'rgba(34,211,154,0.05)', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'R:R Risk', name: 'R:R Risk box', color: 'rgba(242,54,69,0.05)', thickness: 1, lineStyle: 'solid', display: true },
    ]),
    compute: computeSdSignals,
  },
  {
    id: 'volume_distribution_zones',
    name: 'Volume Distribution Zones',
    description: 'Original MyCryptoStack engine: per-period (4H/D/W/M) proportional range-volume histogram finds where volume actually concentrated — supply/demand zones with Upper/Weighted-Average/Midpoint/Lower, buy/sell delta, adaptive bins & threshold, and a full zone lifecycle (health, acceptance, sweep, reaction, classification, cross-TF clustering, confidence 0-100). Strictly non-repainting: zones freeze at period close, signals on closed bars only, with TP1 (opposite wavg) / TP2 (opposite boundary) / TP3 (measured move). Paper & educational — not financial advice.',
    inputs: [
      { id: 'tf1', name: 'Period 1', type: 'select', default: 'D', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf2', name: 'Period 2', type: 'select', default: '4H', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'tf3', name: 'Period 3', type: 'select', default: 'None', options: ['None','4H','D','W','M'].map((v) => ({ value: v, label: v })) },
      { id: 'thrBase', name: 'Base threshold %', type: 'number', default: 10, min: 1, max: 50, step: 0.5 },
      { id: 'volMult', name: 'Rejection volume ×', type: 'number', default: 1.2, min: 1, max: 5, step: 0.1, group: 'Signals' },
      { id: 'maxRetests', name: 'Max retests', type: 'number', default: 3, min: 0, max: 10, step: 1, group: 'Signals' },
      { id: 'minHealth', name: 'Min zone health', type: 'number', default: 40, min: 0, max: 100, step: 5, group: 'Signals' },
      { id: 'confidenceFloor', name: 'Min confidence', type: 'number', default: 50, min: 0, max: 100, step: 1, group: 'Signals' },
      { id: 'minRR', name: 'Min R:R', type: 'number', default: 1.2, min: 0, max: 10, step: 0.1, group: 'Signals' },
      { id: 'slBufferAtr', name: 'Stop buffer (ATR ×)', type: 'number', default: 0.25, min: 0, max: 5, step: 0.05, group: 'Signals' },
      { id: 'acceptanceBars', name: 'Acceptance bars', type: 'number', default: 3, min: 2, max: 20, step: 1, group: 'Signals' },
      { id: 'trendFilter', name: 'Trend filter (EMA50)', type: 'boolean', default: true, group: 'Signals' },
      { id: 'useContextGate', name: 'MTF context confirmation', type: 'boolean', default: true, group: 'Signals' },
      { id: 'minDecisionScore', name: 'Min decision score', type: 'number', default: 65, min: 0, max: 100, step: 1, group: 'Signals' },
      { id: 'beAfterTp1', name: 'Break-even stop after TP1', type: 'boolean', default: true, group: 'Exits' },
      { id: 'trailAtr', name: 'Trail after TP2 (ATR ×, 0 = off)', type: 'number', default: 1.0, min: 0, max: 10, step: 0.1, group: 'Exits' },
      { id: 'contextExit', name: 'Exit on context flip', type: 'boolean', default: true, group: 'Exits' },
      { id: 'showSupply', name: 'Show supply zones', type: 'boolean', default: true, group: 'Display' },
      { id: 'showDemand', name: 'Show demand zones', type: 'boolean', default: true, group: 'Display' },
      { id: 'showWavg', name: 'Show weighted average', type: 'boolean', default: true, group: 'Display' },
      { id: 'showSignals', name: 'Show buy/sell signals', type: 'boolean', default: true, group: 'Display' },
      { id: 'showTradeLevels', name: 'Show trade levels', type: 'boolean', default: true, group: 'Display' },
      { id: 'showTradeSetups', name: 'Show R:R boxes on signals', type: 'boolean', default: true, group: 'Display' },
      { id: 'showLabels', name: 'Show zone labels', type: 'boolean', default: true, group: 'Display' },
    ],
    // Ids must match the `${tf} Supply` / `${tf} Demand` (+ ` WAvg`) plot ids.
    styles: (['4H', 'D', 'W', 'M'] as const).flatMap((tf): IndicatorStyleDef[] => {
      const su = { '4H': '122,160,255', D: '79,127,255', W: '61,105,224', M: '50,88,196' }[tf];
      const de = { '4H': '255,181,102', D: '255,159,54', W: '230,136,38', M: '204,117,30' }[tf];
      return [
        { id: `${tf} Supply`, name: `${tf} Supply`, color: `rgba(${su},0.10)`, thickness: 1, lineStyle: 'solid', display: true },
        { id: `${tf} Supply WAvg`, name: `${tf} Supply WAvg`, color: `rgba(${su},0.85)`, thickness: 1, lineStyle: 'dashed', display: true },
        { id: `${tf} Demand`, name: `${tf} Demand`, color: `rgba(${de},0.10)`, thickness: 1, lineStyle: 'solid', display: true },
        { id: `${tf} Demand WAvg`, name: `${tf} Demand WAvg`, color: `rgba(${de},0.85)`, thickness: 1, lineStyle: 'dashed', display: true },
      ];
    }).concat([
      { id: 'Trade Risk', name: 'Trade risk box', color: 'rgba(242,54,69,0.07)', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'Trade Reward', name: 'Trade reward box', color: 'rgba(34,211,154,0.07)', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'Trade Runner', name: 'Trade runner box (TP1→TP3)', color: 'rgba(34,211,154,0.035)', thickness: 1, lineStyle: 'solid', display: true },
    ]),
    compute: computeVolumeDistributionZones,
  },
  {
    id: 'scanner_signals',
    name: 'Technical Scanner Signals',
    description: 'Renders your enabled Technical Scanner strategies on the chart: BUY/SELL arrows on strictly closed-bar signals, entry/SL/TP1-3 levels, R:R boxes and outcome chips per trade. Signals are immutable and non-repainting; build strategies in the Technical Scanner panel. Paper & educational — not financial advice.',
    inputs: [
      { id: 'showSignals', name: 'Show signals', type: 'boolean', default: true, group: 'Display' },
      { id: 'showTradeLevels', name: 'Show entry/SL/TP levels', type: 'boolean', default: true, group: 'Display' },
      { id: 'showRRBoxes', name: 'Show R:R boxes', type: 'boolean', default: true, group: 'Display' },
      { id: 'showOutcomeChips', name: 'Show outcome chips', type: 'boolean', default: true, group: 'Display' },
      { id: 'showHistorical', name: 'Show all historical signals', type: 'boolean', default: true, group: 'Display' },
    ],
    styles: [
      { id: 'Scan Risk', name: 'Risk box', color: 'rgba(242,54,69,0.07)', thickness: 1, lineStyle: 'solid', display: true },
      { id: 'Scan Reward', name: 'Reward box', color: 'rgba(38,198,218,0.08)', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeScannerSignals,
  },
  {
    id: 'vol_spike',
    name: 'Volume Spike Detection',
    description: 'Marks abnormal-volume bars: blue up-arrow = major buying, dark down-arrow = major selling.',
    inputs: [
      { id: 'length', name: 'Volume MA Length', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { id: 'mult', name: 'Spike ×', type: 'number', default: 1.8, min: 1, max: 10, step: 0.1 },
    ],
    styles: [],
    compute: computeVolSpike,
  },
  {
    id: 'magic_sr',
    name: 'Support & Resistance',
    description: 'Horizontal S/R from recent swing pivots: resistance above price, support below.',
    inputs: [
      { id: 'lookback', name: 'Pivot Lookback', type: 'number', default: 10, min: 2, max: 100, step: 1 },
      { id: 'count', name: 'Lines Each Side', type: 'number', default: 3, min: 1, max: 10, step: 1 },
      { id: 'showUp', name: 'Show Resistance', type: 'boolean', default: true },
      { id: 'showDown', name: 'Show Support', type: 'boolean', default: true },
    ],
    styles: [],
    compute: computeMagicSr,
  },
  {
    id: 'fib_pivot',
    name: 'Fibonacci Pivots',
    description: 'Fibonacci pivot P / R1-3 / S1-3 from the prior Day/Week/Month range.',
    inputs: [
      { id: 'period', name: 'Period', type: 'select', default: 'D', options: [{ value: 'D', label: 'Day' }, { value: 'W', label: 'Week' }, { value: 'M', label: 'Month' }] },
      { id: 'f1', name: 'Fib 1', type: 'number', default: 0.382, min: 0, max: 4, step: 0.001 },
      { id: 'f2', name: 'Fib 2', type: 'number', default: 0.618, min: 0, max: 4, step: 0.001 },
      { id: 'f3', name: 'Fib 3', type: 'number', default: 1.0, min: 0, max: 4, step: 0.001 },
    ],
    styles: [],
    compute: computeFibPivot,
  },
];
