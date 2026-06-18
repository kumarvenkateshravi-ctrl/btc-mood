import { computeSMACrossover } from './indicators/smaCrossover';
import { computeSMARibbon } from './indicators/smaRibbon';
import { computeSqueezeMomentum } from './indicators/squeezeMomentum';
import { sma } from './indicators';
import type { Candle } from './types';
import type { IndicatorResult, CustomIndicatorConfig, IndicatorInputDef, IndicatorStyleDef } from './indicatorFramework';

export interface CustomIndicatorDef {
  id: string;
  name: string;
  description: string;
  compute: (candles: Candle[], config?: CustomIndicatorConfig) => IndicatorResult;
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
    compute: (candles, config) => {
      const inputs = config?.settings?.inputs || {};
      const length = Number(inputs['length']) || 9;
      const source = (inputs['source'] as 'close' | 'open' | 'high' | 'low') || 'close';
      
      const data = candles.map(c => c[source] as number);
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
    id: 'sma_ribbon',
    name: 'SMA Ribbon Signals',
    description: '10 SMAs ribbon with alignment scoring for trend signals.',
    inputs: [
      { id: 'strictness', name: 'Strictness', type: 'number', default: 9, min: 5, max: 9, step: 1 },
      { id: 'showFlipOnly', name: 'Show Flip Only', type: 'boolean', default: false },
    ],
    styles: [
      { id: 'ribbonBase', name: 'Ribbon Base', color: '#22c55e', thickness: 1, lineStyle: 'solid', display: true },
    ],
    compute: computeSMARibbon,
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
];
