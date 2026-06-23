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
import { resolveSourceNum } from './indicators/itsTemplates';
import { sma } from './indicators';
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
    compute: (candles, config, computedSources) => {
      const inputs = config?.settings?.inputs || {};
      const length = Number(inputs['length']) || 9;
      const source = (inputs['source'] as string) || 'close';
      
      const data = resolveSourceNum(candles, source, computedSources);
      const smaData = sma(data, length);

      return {
        plots: [
          {
            id: 'smaLine',
            title: 'SMA',
            color: '#2962FF',
            type: 'line',
            data: smaData
          }
        ],
        signals: new Array(candles.length).fill('neutral')
      };
    },
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
      { id: 'ma1Length', name: 'Length',  type: 'number',  default: 20, min: 1, max: 2000, step: 1,
        group: 'MA #1', disabledIf: (i) => !i['showMa1'] },
      // MA #2
      { id: 'showMa2',   name: 'MA #2',   type: 'boolean', default: true,   group: 'MA #2' },
      { id: 'ma2Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #2',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa2'] },
      { id: 'ma2Length', name: 'Length',  type: 'number',  default: 50, min: 1, max: 2000, step: 1,
        group: 'MA #2', disabledIf: (i) => !i['showMa2'] },
      // MA #3
      { id: 'showMa3',   name: 'MA #3',   type: 'boolean', default: true,   group: 'MA #3' },
      { id: 'ma3Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #3',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
        disabledIf: (i) => !i['showMa3'] },
      { id: 'ma3Length', name: 'Length',  type: 'number',  default: 100, min: 1, max: 2000, step: 1,
        group: 'MA #3', disabledIf: (i) => !i['showMa3'] },
      // MA #4
      { id: 'showMa4',   name: 'MA #4',   type: 'boolean', default: true,   group: 'MA #4' },
      { id: 'ma4Type',   name: 'Type',    type: 'select',  default: 'SMA',  group: 'MA #4',
        options: ['SMA','EMA','SMMA (RMA)','WMA','VWMA'].map((v) => ({ value: v, label: v })),
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
      { id: 'ma_1', name: 'MA #1 (SMA 20)',  color: '#f6c309', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'ma_2', name: 'MA #2 (SMA 50)',  color: '#fb9800', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'ma_3', name: 'MA #3 (SMA 100)', color: '#fb6500', thickness: 2, lineStyle: 'solid', display: true },
      { id: 'ma_4', name: 'MA #4 (SMA 200)', color: '#f60c0c', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeMaRibbonTV,
  },
  {
    id: 'macd',
    name: 'MACD',
    description: 'Moving Average Convergence Divergence with signal line and histogram.',
    inputs: [
      { id: 'fast', name: 'Fast Length', type: 'number', default: 12, min: 1, max: 200, step: 1 },
      { id: 'slow', name: 'Slow Length', type: 'number', default: 26, min: 1, max: 200, step: 1 },
      { id: 'signal', name: 'Signal Smoothing', type: 'number', default: 9, min: 1, max: 100, step: 1 },
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
      { id: 'maType', name: 'Type', type: 'select', default: 'None', options: [{ value: 'None', label: 'None' }, { value: 'SMA', label: 'SMA' }, { value: 'SMA + Bollinger Bands', label: 'SMA + Bollinger Bands' }, { value: 'EMA', label: 'EMA' }, { value: 'SMMA (RMA)', label: 'SMMA (RMA)' }, { value: 'WMA', label: 'WMA' }, { value: 'VWMA', label: 'VWMA' }], group: 'Smoothing' },
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
    description: 'Average True Range volatility (Wilder smoothing).',
    inputs: [
      { id: 'length', name: 'Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    styles: [
      { id: 'atr', name: 'ATR', color: '#ef6c00', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeAtr,
  },
  {
    id: 'parabolic_sar',
    name: 'Parabolic SAR',
    description: 'Stop-and-reverse trailing dots; trend by dot position vs price.',
    inputs: [
      { id: 'step', name: 'Step (AF)', type: 'number', default: 0.02, min: 0.001, max: 1, step: 0.001 },
      { id: 'max', name: 'Max AF', type: 'number', default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    styles: [
      { id: 'psar', name: 'PSAR', color: '#26A69A', thickness: 2, lineStyle: 'solid', display: true },
    ],
    compute: computeParabolicSar,
  },
  {
    id: 'stochastic',
    name: 'Stochastic (14, 3, 3)',
    description: 'Slow stochastic oscillator: %K and %D. Matches TradingView.',
    inputs: [
      { id: 'kPeriod', name: '%K Length', type: 'number', default: 14, min: 1, max: 500, step: 1 },
      { id: 'smoothK', name: '%K Smoothing', type: 'number', default: 3, min: 1, max: 100, step: 1 },
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
    description: 'Session-anchored Volume-Weighted Average Price (resets daily).',
    inputs: [],
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
    description: 'Session VWAP with volume-weighted ±σ standard-deviation bands.',
    inputs: [
      { id: 'mult1', name: 'Band 1 ×σ', type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
      { id: 'mult2', name: 'Band 2 ×σ', type: 'number', default: 2, min: 0.1, max: 10, step: 0.1 },
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
];
